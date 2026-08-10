import {
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { GeminiProvider } from './providers/gemini.provider';
import type {
  LlmCompletionRequest,
  LlmProvider,
  LlmProviderName,
  LlmResponse,
} from './llm-provider.interface';

// Single switch point between vendors. Today the active provider comes from
// LLM_PROVIDER; when per-organization settings land, resolve(name) can take the
// org's stored choice (and key) instead of the env default.
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly providers: Record<LlmProviderName, LlmProvider>;
  private readonly defaultProviderName: LlmProviderName;

  constructor(
    config: ConfigService,
    anthropic: AnthropicProvider,
    openai: OpenAiProvider,
    gemini: GeminiProvider,
  ) {
    this.providers = { anthropic, openai, gemini };
    const configured = (config.get<string>('llm.provider') || 'anthropic').toLowerCase();
    if (!this.isKnownProvider(configured)) {
      throw new Error(
        `LLM_PROVIDER "${configured}" is not supported. Use one of: ${Object.keys(this.providers).join(', ')}`,
      );
    }
    this.defaultProviderName = configured;
  }

  listProviders(): {
    name: LlmProviderName;
    model: string;
    configured: boolean;
    active: boolean;
  }[] {
    return Object.values(this.providers).map((provider) => ({
      name: provider.name,
      model: provider.model,
      configured: provider.isConfigured(),
      active: provider.name === this.defaultProviderName,
    }));
  }

  resolve(name?: LlmProviderName): LlmProvider {
    const providerName = name ?? this.defaultProviderName;
    const provider = this.providers[providerName];
    if (!provider) {
      throw new InternalServerErrorException(`Unknown LLM provider "${providerName}"`);
    }
    if (!provider.isConfigured()) {
      throw new InternalServerErrorException(
        `The "${providerName}" provider has no API key configured. Set the corresponding key in the environment.`,
      );
    }
    return provider;
  }

  async complete(request: LlmCompletionRequest, name?: LlmProviderName): Promise<LlmResponse> {
    const provider = this.resolve(name);
    const startedAt = Date.now();
    try {
      return await provider.complete(request);
    } catch (err) {
      this.logger.error(
        `LLM call failed after ${Date.now() - startedAt}ms on ${provider.name}/${provider.model}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw this.toReadableError(err, provider.name, provider.model);
    }
  }

  // Vendor SDK errors otherwise surface as an opaque 500. Map the common
  // account-level failures (bad key, no credit, quota) to something a user can act on.
  private toReadableError(err: unknown, providerName: string, model: string): HttpException {
    if (err instanceof HttpException) return err;

    const status = (err as { status?: number })?.status;
    const raw = err instanceof Error ? err.message : String(err);
    const label = `${providerName}/${model}`;

    if (status === 401 || status === 403) {
      return new ServiceUnavailableException(
        `The ${label} API rejected the configured API key. Check the key in the server environment.`,
      );
    }
    if (status === 429) {
      return new ServiceUnavailableException(
        `The ${label} API is rate-limited or out of quota. Check the provider's plan and billing, then retry.`,
      );
    }
    if (/credit balance is too low|billing|quota/i.test(raw)) {
      return new ServiceUnavailableException(
        `The ${label} account has insufficient credit or quota. Top up the provider account, or switch LLM_PROVIDER to one that is funded.`,
      );
    }
    return new ServiceUnavailableException(
      `The ${label} API call failed. See server logs for details.`,
    );
  }

  private isKnownProvider(value: string): value is LlmProviderName {
    return Object.prototype.hasOwnProperty.call(this.providers, value);
  }
}
