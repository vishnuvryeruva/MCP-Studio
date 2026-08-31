import { Injectable } from '@nestjs/common';
import { FunctionModule } from '../../models/function-module.model';
import { SapDestination } from '../../models/sap-destination.model';
import { SapDestinationsService } from './sap-destinations.service';
import { CapFacadeService } from './cap-facade.service';
import { FmInvocationError } from './fm-invocation.types';
import type { FmInvocationResponse } from './fm-invocation.types';

// Single entry point for running a whitelisted function module, whichever way its
// destination reaches SAP. Callers pass the module and the arguments the model
// proposed; everything about transport, parameter shaping, and failure wording is
// decided here.
@Injectable()
export class FmInvokerService {
  constructor(
    private readonly sapDestinationsService: SapDestinationsService,
    private readonly capFacadeService: CapFacadeService,
  ) {}

  async invoke(
    organizationId: string,
    functionModule: FunctionModule,
    args: Record<string, unknown>,
  ): Promise<FmInvocationResponse> {
    const destination = await this.resolveDestination(organizationId, functionModule);
    const parameters = this.declaredParametersOnly(functionModule, args);

    if (destination.transport === 'cap_facade') {
      return this.capFacadeService.execute(destination, functionModule.fmName, parameters);
    }
    return this.invokeDirect(destination, functionModule, parameters);
  }

  // Only parameters the admin declared are forwarded; anything the model invents is
  // dropped rather than reaching SAP as an extra query parameter.
  private declaredParametersOnly(
    functionModule: FunctionModule,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    const declared = new Set((functionModule.parameters ?? []).map((param) => param.name));
    const parameters: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args ?? {})) {
      if (declared.has(key) && value !== undefined && value !== null) {
        parameters[key] = value;
      }
    }
    return parameters;
  }

  private async resolveDestination(
    organizationId: string,
    functionModule: FunctionModule,
  ): Promise<SapDestination> {
    try {
      return await this.sapDestinationsService.findOneOrThrow(
        organizationId,
        functionModule.sapDestinationId,
      );
    } catch {
      throw new FmInvocationError(
        null,
        `The SAP destination for "${functionModule.name}" no longer exists. Re-point or remove this function module.`,
      );
    }
  }

  private async invokeDirect(
    destination: SapDestination,
    functionModule: FunctionModule,
    parameters: Record<string, unknown>,
  ): Promise<FmInvocationResponse> {
    if (!functionModule.fmcallUrl) {
      throw new FmInvocationError(
        null,
        `"${functionModule.name}" has no fmcall URL, which destination "${destination.name}" needs to call SAP directly.`,
      );
    }

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(parameters)) {
      query.append(key, String(value));
    }
    const queryString = query.toString();
    const path = queryString
      ? `${functionModule.fmcallUrl}${functionModule.fmcallUrl.includes('?') ? '&' : '?'}${queryString}`
      : functionModule.fmcallUrl;

    try {
      const response = await this.sapDestinationsService.callSap(destination, path);
      return { status: response.status ?? 200, data: response.data };
    } catch (err) {
      throw this.describeDirectFailure(err);
    }
  }

  // Distinguishes failures at the tunnel from failures in SAP, so the answer doesn't
  // blame SAP credentials for what is actually a BTP connectivity problem.
  private describeDirectFailure(err: unknown): FmInvocationError {
    const status = this.statusFromError(err);
    const redirectTarget = this.sapDestinationsService.redirectTargetFromError(err);
    if (redirectTarget) {
      return new FmInvocationError(
        status,
        `SAP redirected this fmcall URL (HTTP ${status}) to "${redirectTarget}". Update the whitelisted URL to that exact path — redirects cannot be followed through the Cloud Connector proxy.`,
      );
    }

    switch (status) {
      case 407:
        return new FmInvocationError(
          status,
          'The BTP connectivity proxy rejected the call (HTTP 407, proxy authentication). The request never reached SAP — this is a Cloud Connector/connectivity binding problem, not the SAP user.',
        );
      case 401:
      case 403:
        return new FmInvocationError(
          status,
          `SAP rejected the credentials for this destination (HTTP ${status}). Check SAP_USER/SAP_PWD and that user's authorization for this function module.`,
        );
      case 404:
        return new FmInvocationError(
          status,
          'SAP returned HTTP 404 — the fmcall URL for this function module does not exist on that system.',
        );
      default:
        return new FmInvocationError(
          status,
          status
            ? `SAP returned HTTP ${status}`
            : `SAP call failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
    }
  }

  private statusFromError(err: unknown): number | null {
    const direct = (err as { response?: { status?: number } })?.response?.status;
    if (direct) return direct;
    const cause = (err as { cause?: { response?: { status?: number } } })?.cause?.response?.status;
    return cause ?? null;
  }
}
