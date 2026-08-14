import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { ConfigService } from '@nestjs/config';
import { executeHttpRequest } from '@sap-cloud-sdk/http-client';
import type { HttpResponse } from '@sap-cloud-sdk/http-client';
import { getServiceBinding, serviceToken } from '@sap-cloud-sdk/connectivity';
import type { HttpDestination } from '@sap-cloud-sdk/connectivity';
import { timeout } from '@sap-cloud-sdk/resilience';
import { isAxiosError } from 'axios';
import { SapDestination } from '../../models/sap-destination.model';
import { EncryptionService } from '../../common/services/encryption.service';
import { CreateSapDestinationDto } from '../dto/create-sap-destination.dto';
import { UpdateSapDestinationDto } from '../dto/update-sap-destination.dto';

export interface TestConnectionResult {
  success: boolean;
  statusCode: number | null;
  durationMs: number;
  message: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

@Injectable()
export class SapDestinationsService {
  private readonly logger = new Logger(SapDestinationsService.name);

  constructor(
    @InjectModel(SapDestination)
    private readonly sapDestinationModel: typeof SapDestination,
    private readonly encryptionService: EncryptionService,
    private readonly configService: ConfigService,
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
    const destination = await this.sapDestinationModel.create({
      organizationId,
      name: dto.name,
      description: dto.description ?? null,
      url: dto.url,
      cloudConnectorLocationId: dto.cloudConnectorLocationId ?? null,
      encryptedSapUser: this.encryptionService.encrypt(dto.sapUser),
      encryptedSapPassword: this.encryptionService.encrypt(dto.sapPassword),
      createdByUserId: userId,
      isActive: true,
    });
    return this.toSafeResponse(destination);
  }

  async update(organizationId: string, id: string, dto: UpdateSapDestinationDto) {
    const destination = await this.findOneOrThrow(organizationId, id);
    const { sapUser, sapPassword, ...rest } = dto;
    const trimmedUser = sapUser?.trim();
    const trimmedPassword = sapPassword?.trim();
    await destination.update({
      ...rest,
      // Credentials are write-only over the API — only replace them when the
      // client sends a non-empty value (edit forms leave these fields blank).
      ...(trimmedUser ? { encryptedSapUser: this.encryptionService.encrypt(trimmedUser) } : {}),
      ...(trimmedPassword
        ? { encryptedSapPassword: this.encryptionService.encrypt(trimmedPassword) }
        : {}),
    });
    return this.toSafeResponse(destination);
  }

  async remove(organizationId: string, id: string) {
    const destination = await this.findOneOrThrow(organizationId, id);
    await destination.destroy();
  }

  // Decrypted credentials should only ever be read by the internal fmcall invoker, never returned over the API.
  decryptCredentials(destination: SapDestination) {
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
      url: destination.url,
      cloudConnectorLocationId: destination.cloudConnectorLocationId,
      isActive: destination.isActive,
      createdByUserId: destination.createdByUserId,
      createdAt: destination.get('createdAt'),
      updatedAt: destination.get('updatedAt'),
    };
  }
}
