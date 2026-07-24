import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { ConfigService } from '@nestjs/config';
import { executeHttpRequest } from '@sap-cloud-sdk/http-client';
import type { HttpResponse } from '@sap-cloud-sdk/http-client';
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
    await destination.update({
      ...rest,
      ...(sapUser ? { encryptedSapUser: this.encryptionService.encrypt(sapUser) } : {}),
      ...(sapPassword
        ? { encryptedSapPassword: this.encryptionService.encrypt(sapPassword) }
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
  private buildDestination(destination: SapDestination): HttpDestination {
    const { sapUser, sapPassword } = this.decryptCredentials(destination);
    const locationId =
      destination.cloudConnectorLocationId ||
      this.configService.get<string>('sap.defaultCloudConnectorLocationId') ||
      undefined;

    return {
      url: destination.url,
      username: sapUser,
      password: sapPassword,
      authentication: 'BasicAuthentication',
      proxyType: locationId ? 'OnPremise' : 'Internet',
      ...(locationId ? { cloudConnectorLocationId: locationId } : {}),
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
    return executeHttpRequest(this.buildDestination(destination), {
      method,
      url: path ?? '',
      ...(data !== undefined ? { data } : {}),
      middleware: [timeout(REQUEST_TIMEOUT_MS)],
    });
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
      const status = this.statusFromError(err);
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
