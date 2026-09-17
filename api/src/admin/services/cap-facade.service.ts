import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import axios, { isAxiosError } from 'axios';
import { SapDestination } from '../../models/sap-destination.model';
import { EncryptionService } from '../../common/services/encryption.service';
import { FmInvocationError } from './fm-invocation.types';
import type { FmInvocationResponse } from './fm-invocation.types';

const REQUEST_TIMEOUT_MS = 30_000;
// XSUAA tokens are reused from the destination row until this much life remains,
// then minted again so a call cannot leave with a token that expires in flight.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

// Client for the generic Function Module CAP service: obtains an XSUAA token with
// the client-credentials grant, then posts { functionModule, parameters } to the
// CAP action. The Cloud Connector hop lives inside that service, which is the whole
// reason this transport exists — none of the on-premise proxy handling applies here.
@Injectable()
export class CapFacadeService {
  private readonly logger = new Logger(CapFacadeService.name);

  constructor(
    private readonly encryptionService: EncryptionService,
    @InjectModel(SapDestination)
    private readonly sapDestinationModel: typeof SapDestination,
  ) {}

  async execute(
    destination: SapDestination,
    fmName: string,
    parameters: Record<string, unknown>,
  ): Promise<FmInvocationResponse> {
    const config = this.requireConfig(destination);
    const url = joinUrl(destination.url, config.executePath);

    try {
      return await this.post(destination, url, fmName, parameters, false);
    } catch (err) {
      // A 401 on the action itself means the token was rejected rather than the
      // credentials being wrong — usually a token invalidated server-side before its
      // stated expiry. Drop the stored one and try once more.
      if (this.statusFrom(err) === 401) {
        this.logger.warn(
          `CAP facade returned 401 for destination ${destination.id}; retrying once with a fresh token`,
        );
        return this.post(destination, url, fmName, parameters, true);
      }
      throw this.describeFailure(err, url);
    }
  }

  // Verifies the XSUAA credentials and that the CAP service answers, without
  // executing a function module against the backend.
  async probe(
    destination: SapDestination,
    metadataPath?: string,
  ): Promise<FmInvocationResponse> {
    const config = this.requireConfig(destination);
    const token = await this.getToken(destination, true);
    const path = metadataPath?.trim() || defaultMetadataPath(config.executePath);
    const url = joinUrl(destination.url, path);

    try {
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        timeout: REQUEST_TIMEOUT_MS,
      });
      return { status: response.status, data: response.data };
    } catch (err) {
      throw this.describeFailure(err, url);
    }
  }

  // Called when a destination's CAP settings change, so the next call can't reuse a
  // token minted for the previous client.
  async invalidate(destinationId: string): Promise<void> {
    await this.sapDestinationModel.update(
      { encryptedCapAccessToken: null, capAccessTokenExpiresAt: null },
      { where: { id: destinationId } },
    );
  }

  private async post(
    destination: SapDestination,
    url: string,
    fmName: string,
    parameters: Record<string, unknown>,
    forceFreshToken: boolean,
  ): Promise<FmInvocationResponse> {
    const token = await this.getToken(destination, forceFreshToken);
    const response = await axios.post(
      url,
      { functionModule: fmName, parameters },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
    );
    return { status: response.status, data: response.data };
  }

  private async getToken(destination: SapDestination, forceFresh: boolean): Promise<string> {
    const config = this.requireConfig(destination);
    if (!forceFresh) {
      const stored = await this.readStoredToken(destination.id);
      // Refresh when five minutes or less remain, including already-expired tokens.
      if (stored && stored.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
        return stored.token;
      }
    }

    let response: { data: unknown };
    try {
      response = await axios.post(
        config.tokenUrl,
        new URLSearchParams({ grant_type: 'client_credentials' }),
        {
          auth: { username: config.clientId, password: config.clientSecret },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: REQUEST_TIMEOUT_MS,
        },
      );
    } catch (err) {
      const status = this.statusFrom(err);
      throw new FmInvocationError(
        status,
        status === 401
          ? 'XSUAA rejected the CAP client credentials (HTTP 401). Check the client ID and secret — the request never reached the CAP service or SAP.'
          : `Could not obtain an XSUAA token from ${config.tokenUrl}${status ? ` (HTTP ${status})` : ''}. Check the token URL.`,
      );
    }

    const body = response.data as { access_token?: string; expires_in?: number };
    if (!body?.access_token) {
      throw new FmInvocationError(null, 'XSUAA returned no access_token for the CAP client.');
    }
    // XSUAA reports expires_in in seconds; fall back to a short life if it's absent
    // so a missing field can't pin a stale token on the destination.
    const lifetimeMs = (body.expires_in ?? 600) * 1000;
    await this.persistToken(destination.id, body.access_token, lifetimeMs);
    return body.access_token;
  }

  private async readStoredToken(
    destinationId: string,
  ): Promise<{ token: string; expiresAt: number } | null> {
    const row = await this.sapDestinationModel.findByPk(destinationId, {
      attributes: ['encryptedCapAccessToken', 'capAccessTokenExpiresAt'],
    });
    if (!row?.encryptedCapAccessToken || !row.capAccessTokenExpiresAt) {
      return null;
    }
    try {
      return {
        token: this.encryptionService.decrypt(row.encryptedCapAccessToken),
        expiresAt: new Date(row.capAccessTokenExpiresAt).getTime(),
      };
    } catch {
      this.logger.warn(
        `Stored XSUAA token for destination ${destinationId} could not be decrypted; fetching a new one`,
      );
      return null;
    }
  }

  private async persistToken(
    destinationId: string,
    token: string,
    lifetimeMs: number,
  ): Promise<void> {
    await this.sapDestinationModel.update(
      {
        encryptedCapAccessToken: this.encryptionService.encrypt(token),
        capAccessTokenExpiresAt: new Date(Date.now() + lifetimeMs),
      },
      { where: { id: destinationId } },
    );
  }

  private requireConfig(destination: SapDestination) {
    const missing: string[] = [];
    if (!destination.capTokenUrl) missing.push('XSUAA token URL');
    if (!destination.capClientId) missing.push('client ID');
    if (!destination.encryptedCapClientSecret) missing.push('client secret');
    if (!destination.capExecutePath) missing.push('execute path');
    if (missing.length > 0) {
      throw new FmInvocationError(
        null,
        `Destination "${destination.name}" uses the CAP facade but is missing its ${missing.join(', ')}.`,
      );
    }
    return {
      executePath: destination.capExecutePath!,
      tokenUrl: destination.capTokenUrl!,
      clientId: destination.capClientId!,
      clientSecret: this.encryptionService.decrypt(destination.encryptedCapClientSecret!),
    };
  }

  private describeFailure(err: unknown, url: string): FmInvocationError {
    if (err instanceof FmInvocationError) return err;
    const status = this.statusFrom(err);
    const detail = isAxiosError(err) ? (err.code ?? err.message) : String(err);

    switch (status) {
      case 401:
      case 403:
        return new FmInvocationError(
          status,
          `The CAP service rejected the token (HTTP ${status}). Check that the XSUAA client is authorized for this application.`,
        );
      case 400:
        return new FmInvocationError(
          status,
          `The CAP service rejected the request (HTTP 400) — usually an unsupported function-module name or a parameter it could not accept. ${this.serverMessage(err) ?? ''}`.trim(),
        );
      case 404:
        return new FmInvocationError(
          status,
          `The CAP action was not found at ${url} (HTTP 404). Check the execute path on this destination.`,
        );
      case 502:
      case 503:
        return new FmInvocationError(
          status,
          `The CAP service reached an error talking to SAP (HTTP ${status}). The function module may not be permitted by its fmcall class, or the backend is unreachable. ${this.serverMessage(err) ?? ''}`.trim(),
        );
      default:
        return new FmInvocationError(
          status,
          status
            ? `The CAP service returned HTTP ${status}. ${this.serverMessage(err) ?? ''}`.trim()
            : `Could not reach the CAP service at ${url} (${detail}).`,
        );
    }
  }

  // CAP reports its own errors as { error: { message } }; surfacing that is far more
  // useful than the bare status, and it never contains credentials.
  private serverMessage(err: unknown): string | null {
    if (!isAxiosError(err)) return null;
    const data = err.response?.data as { error?: { message?: string }; message?: string } | undefined;
    const message = data?.error?.message ?? data?.message;
    return message ? `Reported: ${message}` : null;
  }

  private statusFrom(err: unknown): number | null {
    if (isAxiosError(err) && err.response) return err.response.status;
    return null;
  }
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

// The CAP service exposes $metadata as a sibling of the execute action, so the
// probe path is derived from whatever execute path the destination stored.
function defaultMetadataPath(executePath: string): string {
  const trimmed = executePath.replace(/\/+$/, '');
  const parent = trimmed.slice(0, trimmed.lastIndexOf('/'));
  return `${parent}/$metadata`;
}
