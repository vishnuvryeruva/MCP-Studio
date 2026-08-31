import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { ConfigService } from '@nestjs/config';
import { executeHttpRequest } from '@sap-cloud-sdk/http-client';
import type { HttpResponse } from '@sap-cloud-sdk/http-client';
import { getServiceBinding, serviceToken } from '@sap-cloud-sdk/connectivity';
import type { HttpDestination } from '@sap-cloud-sdk/connectivity';
import { timeout } from '@sap-cloud-sdk/resilience';
import { isAxiosError } from 'axios';
import { SapDestination } from '../../models/sap-destination.model';
import type { DestinationTransport } from '../../models/sap-destination.model';
import { EncryptionService } from '../../common/services/encryption.service';
import { CreateSapDestinationDto } from '../dto/create-sap-destination.dto';
import { UpdateSapDestinationDto } from '../dto/update-sap-destination.dto';
import { CapFacadeService } from './cap-facade.service';
import { FmInvocationError } from './fm-invocation.types';

export interface TestConnectionResult {
  success: boolean;
  statusCode: number | null;
  durationMs: number;
  message: string;
}

const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_CAP_EXECUTE_PATH = '/integration/execute';

@Injectable()
export class SapDestinationsService {
  private readonly logger = new Logger(SapDestinationsService.name);

  constructor(
    @InjectModel(SapDestination)
    private readonly sapDestinationModel: typeof SapDestination,
    private readonly encryptionService: EncryptionService,
    private readonly configService: ConfigService,
    private readonly capFacadeService: CapFacadeService,
  ) {}

  async findAll(organizationId: string) {
    const destinations = await this.sapDestinationModel.findAll({
      where: { organizationId },
    });
    return destinations.map((d) => this.toSafeResponse(d));
  }

  async findOneOrThrow(organizationId: string, id: string): Promise<SapDestination> {
    const destination = await this.sapDestinationModel.findOne({
      where: { id, organizationId },
    });
    if (!destination) {
      throw new NotFoundException('SAP destination not found');
    }
    return destination;
  }

  async findOneSafe(organizationId: string, id: string) {
    return this.toSafeResponse(await this.findOneOrThrow(organizationId, id));
  }

  async create(organizationId: string, userId: string, dto: CreateSapDestinationDto) {
    const transport: DestinationTransport = dto.transport ?? 'direct_fmcall';
    const isCap = transport === 'cap_facade';
    const destination = await this.sapDestinationModel.create({
      organizationId,
      name: dto.name,
      description: dto.description ?? null,
      transport,
      url: dto.url,
      // Fields belonging to the other transport are stored as null rather than kept
      // around, so a destination can never present two sets of credentials.
      cloudConnectorLocationId: isCap ? null : (dto.cloudConnectorLocationId ?? null),
      encryptedSapUser: isCap ? null : this.encryptionService.encrypt(dto.sapUser!),
      encryptedSapPassword: isCap ? null : this.encryptionService.encrypt(dto.sapPassword!),
      capExecutePath: isCap ? (dto.capExecutePath?.trim() || DEFAULT_CAP_EXECUTE_PATH) : null,
      capTokenUrl: isCap ? dto.capTokenUrl! : null,
      capClientId: isCap ? dto.capClientId! : null,
      encryptedCapClientSecret: isCap
        ? this.encryptionService.encrypt(dto.capClientSecret!)
        : null,
      createdByUserId: userId,
      isActive: true,
    });
    return this.toSafeResponse(destination);
  }

  async update(organizationId: string, id: string, dto: UpdateSapDestinationDto) {
    const destination = await this.findOneOrThrow(organizationId, id);
    const { sapUser, sapPassword, capClientSecret, transport, ...rest } = dto;
    const effectiveTransport = transport ?? destination.transport;

    const patch: Record<string, unknown> = { ...rest, transport: effectiveTransport };

    // Changing transport discards the settings the old one used, so a destination
    // never keeps two sets of credentials — one of which nothing would ever verify.
    if (transport && transport !== destination.transport) {
      Object.assign(
        patch,
        effectiveTransport === 'cap_facade'
          ? { encryptedSapUser: null, encryptedSapPassword: null, cloudConnectorLocationId: null }
          : {
              capExecutePath: null,
              capTokenUrl: null,
              capClientId: null,
              encryptedCapClientSecret: null,
            },
      );
    }

    // Credentials are write-only over the API — only replace them when the
    // client sends a non-empty value (edit forms leave these fields blank).
    const trimmedUser = sapUser?.trim();
    const trimmedPassword = sapPassword?.trim();
    const trimmedSecret = capClientSecret?.trim();
    if (trimmedUser) patch.encryptedSapUser = this.encryptionService.encrypt(trimmedUser);
    if (trimmedPassword) {
      patch.encryptedSapPassword = this.encryptionService.encrypt(trimmedPassword);
    }
    if (trimmedSecret) {
      patch.encryptedCapClientSecret = this.encryptionService.encrypt(trimmedSecret);
    }
    if (effectiveTransport === 'cap_facade' && !patch.capExecutePath) {
      patch.capExecutePath = rest.capExecutePath ?? destination.capExecutePath ?? DEFAULT_CAP_EXECUTE_PATH;
    }

    // Switching transport (or filling in a missing field) must not leave a
    // destination that passes validation field-by-field but can't actually connect.
    this.assertTransportUsable(effectiveTransport, {
      ...destination.get({ plain: true }),
      ...patch,
    } as Partial<SapDestination>);

    await destination.update(patch);
    // The XSUAA client may have changed; a token minted for the old one must not be reused.
    this.capFacadeService.invalidate(destination.id);
    return this.toSafeResponse(destination);
  }

  private assertTransportUsable(
    transport: DestinationTransport,
    merged: Partial<SapDestination>,
  ): void {
    const missing: string[] = [];
    if (transport === 'cap_facade') {
      if (!merged.capTokenUrl) missing.push('XSUAA token URL');
      if (!merged.capClientId) missing.push('client ID');
      if (!merged.encryptedCapClientSecret) missing.push('client secret');
      if (missing.length > 0) {
        throw new BadRequestException(
          `A CAP facade destination needs its ${missing.join(', ')}. Provide them with this change.`,
        );
      }
      return;
    }
    if (!merged.encryptedSapUser) missing.push('SAP_USER');
    if (!merged.encryptedSapPassword) missing.push('SAP_PWD');
    if (missing.length > 0) {
      throw new BadRequestException(
        `A direct fmcall destination needs its ${missing.join(', ')}. Provide them with this change.`,
      );
    }
  }

  async remove(organizationId: string, id: string) {
    const destination = await this.findOneOrThrow(organizationId, id);
    await destination.destroy();
    this.capFacadeService.invalidate(id);
  }

  // Decrypted credentials should only ever be read by the internal fmcall invoker, never returned over the API.
  decryptCredentials(destination: SapDestination) {
    if (!destination.encryptedSapUser || !destination.encryptedSapPassword) {
      throw new BadRequestException(
        `Destination "${destination.name}" has no stored SAP credentials — it reaches SAP through the CAP facade.`,
      );
    }
    return {
      sapUser: this.encryptionService.decrypt(destination.encryptedSapUser),
      sapPassword: this.encryptionService.decrypt(destination.encryptedSapPassword),
    };
  }

  // Builds the SAP Cloud SDK destination for a stored SapDestination. When a Cloud
  // Connector Location ID is resolved (per-destination or the app-wide default), the
  // destination is marked OnPremise so the SDK tunnels through the bound Connectivity
  // service + Cloud Connector to reach the on-prem ABAP system. Otherwise it's a
  // direct Internet call (e.g. local dev against an internet-reachable system).
  private async buildDestination(
    destination: SapDestination,
    forceFreshProxyToken = false,
  ): Promise<HttpDestination> {
    const { sapUser, sapPassword } = this.decryptCredentials(destination);
    const locationId =
      destination.cloudConnectorLocationId ||
      this.configService.get<string>('sap.defaultCloudConnectorLocationId') ||
      undefined;

    const base: HttpDestination = {
      url: destination.url,
      username: sapUser,
      password: sapPassword,
      authentication: 'BasicAuthentication',
      proxyType: locationId ? 'OnPremise' : 'Internet',
      ...(locationId ? { cloudConnectorLocationId: locationId } : {}),
    };

    if (!locationId) {
      return base;
    }
    // The SDK only attaches the on-premise proxy for destinations it fetches from the
    // Destination service by name; for ad-hoc destinations like ours `proxyType:
    // 'OnPremise'` alone is ignored and it dials the private host directly. Attach the
    // Connectivity service proxy ourselves so the call tunnels via Cloud Connector.
    return {
      ...base,
      proxyConfiguration: await this.onPremiseProxyConfiguration(locationId, forceFreshProxyToken),
    };
  }

  private async onPremiseProxyConfiguration(locationId: string, forceFreshToken = false) {
    const binding = getServiceBinding('connectivity');
    if (!binding) {
      throw new Error(
        'No connectivity service binding found — bind a connectivity service instance to reach on-premise systems via Cloud Connector.',
      );
    }
    const credentials = binding.credentials as unknown as {
      onpremise_proxy_host: string;
      onpremise_proxy_http_port?: string | number;
      onpremise_proxy_port?: string | number;
    };
    // serviceToken caches by default; a stale cached token makes the connectivity
    // proxy reject the call with 407, so allow callers to force a fresh one.
    const token = await serviceToken(binding, { useCache: !forceFreshToken });

    return {
      host: credentials.onpremise_proxy_host,
      port: Number(credentials.onpremise_proxy_http_port ?? credentials.onpremise_proxy_port),
      protocol: 'http' as const,
      headers: {
        'Proxy-Authorization': `Bearer ${token}`,
        'SAP-Connectivity-SCC-Location_ID': locationId,
      },
    };
  }

  // Reusable outbound SAP call. `path` is appended to the destination's base URL
  // (e.g. an fmcall path). Throws on non-2xx (Axios default) so callers can inspect
  // the error's response status. Used by testConnection and, later, the fmcall invoker.
  async callSap(
    destination: SapDestination,
    path?: string,
    method: 'get' | 'post' = 'get',
    data?: unknown,
  ): Promise<HttpResponse> {
    try {
      return await this.executeSapRequest(destination, path, method, data, false);
    } catch (err) {
      // 407 comes from the BTP connectivity proxy, not SAP — almost always a cached
      // proxy token that expired while the app stayed up. Refresh it and retry once.
      if (this.statusFromError(err) === 407) {
        this.logger.warn(
          `Connectivity proxy returned 407 for destination ${destination.id}; retrying once with a fresh token`,
        );
        return this.executeSapRequest(destination, path, method, data, true);
      }
      throw err;
    }
  }

  private async executeSapRequest(
    destination: SapDestination,
    path: string | undefined,
    method: 'get' | 'post',
    data: unknown,
    forceFreshProxyToken: boolean,
  ): Promise<HttpResponse> {
    return executeHttpRequest(
      await this.buildDestination(destination, forceFreshProxyToken),
      {
        method,
        url: path ?? '',
        ...(data !== undefined ? { data } : {}),
        middleware: [timeout(REQUEST_TIMEOUT_MS)],
        // Don't auto-follow redirects: the Proxy-Authorization header we attach for
        // Cloud Connector is not re-applied to the redirected request, so a silent
        // 30x (e.g. SAP Gateway adding a trailing slash) resurfaces as a misleading
        // 407. Failing on the 30x lets us report the exact URL to use instead.
        maxRedirects: 0,
      },
    );
  }

  // Pulls the redirect target out of a 30x so the caller can tell the admin which
  // URL to whitelist, instead of reporting a downstream proxy-auth failure.
  redirectTargetFromError(err: unknown): string | null {
    const status = this.statusFromError(err);
    if (!status || status < 300 || status >= 400) return null;
    const headers =
      (err as { response?: { headers?: Record<string, string> } })?.response?.headers ??
      (err as { cause?: { response?: { headers?: Record<string, string> } } })?.cause?.response
        ?.headers;
    return headers?.location ?? headers?.Location ?? '(unknown location)';
  }

  // Makes a real outbound call to the SAP destination (optionally a specific fmcall
  // path) using the stored SAP_USER/SAP_PWD, to verify the destination is reachable
  // and the credentials are accepted. Never exposes the decrypted credentials.
  async testConnection(
    organizationId: string,
    id: string,
    path?: string,
  ): Promise<TestConnectionResult> {
    const destination = await this.findOneOrThrow(organizationId, id);
    if (destination.transport === 'cap_facade') {
      return this.testCapConnection(destination, path);
    }

    const start = Date.now();
    try {
      const response = await this.callSap(destination, path);
      return {
        success: true,
        statusCode: response.status,
        durationMs: Date.now() - start,
        message: 'Connected successfully and credentials were accepted',
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      this.logConnectionError(destination.id, err);
      const status = this.statusFromError(err);
      const redirectTarget = this.redirectTargetFromError(err);
      if (redirectTarget) {
        return {
          success: false,
          statusCode: status,
          durationMs,
          message: `SAP redirected this URL (HTTP ${status}) to "${redirectTarget}". Use that exact path — a redirect cannot be followed through the Cloud Connector proxy. Adding a trailing slash usually fixes it.`,
        };
      }
      if (status !== null) {
        const unauthorized = status === 401 || status === 403;
        return {
          success: false,
          statusCode: status,
          durationMs,
          message: unauthorized
            ? 'Reached the SAP system, but SAP_USER/SAP_PWD were rejected'
            : `SAP system responded with HTTP ${status}`,
        };
      }
      return {
        success: false,
        statusCode: null,
        durationMs,
        message: `Could not reach SAP system (${this.detailFromError(err)})`,
      };
    }
  }

  // The CAP equivalent: prove the XSUAA client credentials are accepted and the CAP
  // service answers, without executing a function module against the backend. `path`
  // overrides the metadata path that is otherwise derived from the execute path.
  private async testCapConnection(
    destination: SapDestination,
    path?: string,
  ): Promise<TestConnectionResult> {
    const start = Date.now();
    try {
      const response = await this.capFacadeService.probe(destination, path);
      return {
        success: true,
        statusCode: response.status,
        durationMs: Date.now() - start,
        message: 'Obtained an XSUAA token and the CAP service responded',
      };
    } catch (err) {
      this.logger.error(
        `CAP facade test failed for destination ${destination.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return {
        success: false,
        statusCode: err instanceof FmInvocationError ? err.status : null,
        durationMs: Date.now() - start,
        message: err instanceof Error ? err.message : 'CAP facade test failed',
      };
    }
  }

  // Extracts an HTTP status from an error thrown by executeHttpRequest. HTTP error
  // responses surface as Axios errors; connectivity/proxy failures may be wrapped in
  // an ErrorWithCause, so we also unwrap `cause`.
  private statusFromError(err: unknown): number | null {
    if (isAxiosError(err) && err.response) {
      return err.response.status;
    }
    const cause = (err as { cause?: unknown } | null)?.cause;
    if (isAxiosError(cause) && cause.response) {
      return cause.response.status;
    }
    return null;
  }

  // Logs enough detail to diagnose Connectivity Proxy / Cloud Connector failures
  // (actual host/port attempted, error code, cause chain) without ever logging
  // credentials (SAP_USER/SAP_PWD, proxy auth headers).
  private logConnectionError(destinationId: string, err: unknown): void {
    const summarize = (e: unknown): Record<string, unknown> => {
      if (isAxiosError(e)) {
        return {
          code: e.code,
          message: e.message,
          requestUrl: e.config?.url,
          baseURL: e.config?.baseURL,
          proxyHost: e.config?.proxy ? (e.config.proxy as { host?: string }).host : undefined,
          proxyPort: e.config?.proxy ? (e.config.proxy as { port?: number }).port : undefined,
        };
      }
      if (e instanceof Error) {
        return { name: e.name, message: e.message };
      }
      return { value: String(e) };
    };

    const cause = (err as { cause?: unknown } | null)?.cause;
    this.logger.error(
      `SAP test-connection failed for destination ${destinationId}: ${JSON.stringify({
        error: summarize(err),
        ...(cause && cause !== err ? { cause: summarize(cause) } : {}),
      })}`,
    );
  }

  private detailFromError(err: unknown): string {
    if (isAxiosError(err)) {
      return err.code ?? err.message;
    }
    return err instanceof Error ? err.message : 'Unknown error';
  }

  private toSafeResponse(destination: SapDestination) {
    return {
      id: destination.id,
      organizationId: destination.organizationId,
      name: destination.name,
      description: destination.description,
      transport: destination.transport,
      url: destination.url,
      cloudConnectorLocationId: destination.cloudConnectorLocationId,
      capExecutePath: destination.capExecutePath,
      capTokenUrl: destination.capTokenUrl,
      // The client ID is not a secret and knowing it makes a misconfiguration
      // obvious; the client secret is never returned.
      capClientId: destination.capClientId,
      isActive: destination.isActive,
      createdByUserId: destination.createdByUserId,
      createdAt: destination.get('createdAt'),
      updatedAt: destination.get('updatedAt'),
    };
  }
}
