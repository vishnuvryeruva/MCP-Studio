import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { FunctionModule } from '../models/function-module.model';
import { FunctionModuleEmbedding } from '../models/function-module-embedding.model';
import { EmbeddingService } from '../llm/embedding.service';

export interface ToolSelection {
  // The subset to advertise to the model this turn.
  modules: FunctionModule[];
  // False when every whitelisted tool is being advertised, for whatever reason
  // (small whitelist, embeddings unavailable, scoring failed).
  narrowed: boolean;
  reason: string;
}

export interface OverlapWarning {
  functionModuleId: string;
  name: string;
  fmName: string;
  isEnabled: boolean;
  score: number;
}

// Providers cap how many inputs one embeddings request may carry; tool documents
// are small enough that a conservative chunk stays well inside every limit.
const EMBED_CHUNK_SIZE = 64;

@Injectable()
export class ToolIndexService {
  private readonly logger = new Logger(ToolIndexService.name);
  private readonly enabled: boolean;
  private readonly sendAllBelow: number;
  private readonly topK: number;
  private readonly minScore: number;
  private readonly minTools: number;
  private readonly historyTurns: number;
  private readonly overlapThreshold: number;

  constructor(
    @InjectModel(FunctionModuleEmbedding)
    private readonly embeddingModel: typeof FunctionModuleEmbedding,
    private readonly embeddings: EmbeddingService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('llm.toolSelection.enabled') ?? true;
    this.sendAllBelow = config.get<number>('llm.toolSelection.sendAllBelow') ?? 8;
    this.topK = config.get<number>('llm.toolSelection.topK') ?? 10;
    this.minScore = config.get<number>('llm.toolSelection.minScore') ?? 0.2;
    // Clamped: a turn advertising zero tools would leave the model with no
    // grounding at all, which is worse than advertising an irrelevant one.
    this.minTools = Math.max(1, config.get<number>('llm.toolSelection.minTools') ?? 3);
    this.historyTurns = config.get<number>('llm.toolSelection.historyTurns') ?? 2;
    this.overlapThreshold = config.get<number>('llm.toolSelection.overlapThreshold') ?? 0.9;
  }

  // Narrows the whitelist to the tools worth advertising for this question.
  //
  // Every failure path returns the full list: advertising too many tools costs
  // tokens, but advertising too few makes an answerable question unanswerable.
  async selectForQuestion(
    modules: FunctionModule[],
    question: string,
    history: { role: 'user' | 'assistant'; content: string }[] = [],
  ): Promise<ToolSelection> {
    if (!this.enabled) {
      return this.everything(modules, 'tool selection disabled');
    }
    if (modules.length <= this.sendAllBelow) {
      // Below this size the shortlist would barely shrink anything, so skip the
      // embedding round-trip and its latency entirely.
      return this.everything(
        modules,
        `whitelist of ${modules.length} is at or below the ${this.sendAllBelow}-tool threshold`,
      );
    }
    if (!this.embeddings.isAvailable()) {
      return this.everything(modules, this.embeddings.unavailableReason());
    }

    try {
      const vectors = await this.ensureVectors(modules);
      const queryText = this.buildQueryText(question, history);
      const queryVector = await this.embeddings.embedOne(queryText);

      const scored: { module: FunctionModule; score: number }[] = [];
      const unscored: FunctionModule[] = [];
      for (const module of modules) {
        const vector = vectors.get(module.id);
        if (!vector || vector.length !== queryVector.length) {
          // No comparable vector means no evidence either way — keep it rather
          // than hide a tool the question might need.
          unscored.push(module);
          continue;
        }
        scored.push({ module, score: cosineSimilarity(queryVector, vector) });
      }

      scored.sort((a, b) => b.score - a.score);
      let keep = scored.filter((entry) => entry.score >= this.minScore).slice(0, this.topK);
      if (keep.length < this.minTools) {
        // Nothing cleared the bar (or barely anything did). Rather than gamble on
        // the threshold, advertise the best candidates anyway.
        keep = scored.slice(0, this.minTools);
      }

      const selected = [...keep.map((entry) => entry.module), ...unscored];

      // The scores are what you need to tell "the threshold is too high" from
      // "the descriptions don't distinguish these tools".
      this.logger.debug(
        `Tool scores: ${scored
          .slice(0, this.topK)
          .map((entry) => `${entry.module.name}=${entry.score.toFixed(3)}`)
          .join(', ')}`,
      );

      if (selected.length >= modules.length) {
        return { modules, narrowed: false, reason: 'every tool scored as relevant' };
      }

      return {
        modules: selected,
        narrowed: true,
        reason: `${selected.length} of ${modules.length} tools advertised`,
      };
    } catch (err) {
      this.logger.warn(
        `Tool shortlisting failed, advertising all ${modules.length} tools: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return this.everything(modules, 'shortlisting failed');
    }
  }

  // Flags whitelist entries whose tool document is close enough to `module` that
  // the model would have no reliable way to choose between them.
  async findOverlaps(module: FunctionModule, siblings: FunctionModule[]): Promise<OverlapWarning[]> {
    const others = siblings.filter((candidate) => candidate.id !== module.id);
    if (others.length === 0 || !this.embeddings.isAvailable()) return [];

    try {
      const vectors = await this.ensureVectors([module, ...others]);
      const target = vectors.get(module.id);
      if (!target) return [];

      return others
        .flatMap((other) => {
          const vector = vectors.get(other.id);
          if (!vector || vector.length !== target.length) return [];
          const score = cosineSimilarity(target, vector);
          if (score < this.overlapThreshold) return [];
          return [
            {
              functionModuleId: other.id,
              name: other.name,
              fmName: other.fmName,
              isEnabled: other.isEnabled,
              score: Number(score.toFixed(4)),
            },
          ];
        })
        .sort((a, b) => b.score - a.score);
    } catch (err) {
      // A save must never fail because the advisory check couldn't run.
      this.logger.warn(
        `Overlap check failed for "${module.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  // Called before a function module is deleted. The FK cascades, but dropping the
  // row explicitly means a delete can never fail on a leftover vector.
  async forget(functionModuleId: string): Promise<void> {
    await this.embeddingModel.destroy({ where: { functionModuleId } });
  }

  // Returns a vector per module, embedding (and persisting) any that are missing
  // or whose stored vector predates an edit or a provider change.
  private async ensureVectors(modules: FunctionModule[]): Promise<Map<string, number[]>> {
    const signature = this.embeddings.signature();
    if (!signature) return new Map();

    const documents = new Map(modules.map((fm) => [fm.id, this.buildDocument(fm)]));
    const rows = await this.embeddingModel.findAll({
      where: { functionModuleId: modules.map((fm) => fm.id) },
    });

    const fresh = new Map<string, number[]>();
    for (const row of rows) {
      const expectedHash = hashText(documents.get(row.functionModuleId) ?? '');
      if (row.embeddingModel === signature && row.sourceHash === expectedHash) {
        fresh.set(row.functionModuleId, row.vector);
      }
    }

    const stale = modules.filter((fm) => !fresh.has(fm.id));
    if (stale.length === 0) return fresh;

    this.logger.log(`Embedding ${stale.length} function module document(s) via ${signature}`);
    for (let i = 0; i < stale.length; i += EMBED_CHUNK_SIZE) {
      const batch = stale.slice(i, i + EMBED_CHUNK_SIZE);
      const texts = batch.map((fm) => documents.get(fm.id) ?? '');
      const vectors = await this.embeddings.embed(texts);
      await Promise.all(
        batch.map(async (fm, index) => {
          const vector = vectors[index];
          if (!vector?.length) return;
          fresh.set(fm.id, vector);
          await this.embeddingModel.upsert({
            functionModuleId: fm.id,
            vector,
            embeddingModel: signature,
            sourceHash: hashText(texts[index]),
          });
        }),
      );
    }

    return fresh;
  }

  // The text that stands in for a tool. It mirrors what the model actually sees
  // when choosing (name, description, parameters) so similarity here predicts
  // confusability there.
  private buildDocument(fm: FunctionModule): string {
    const params = (fm.parameters ?? [])
      .map((param) =>
        [humanize(param.name), param.description].filter(Boolean).join(': '),
      )
      .join('; ');
    return [
      humanize(fm.name),
      fm.description,
      `SAP function module: ${fm.fmName}`,
      params ? `Parameters: ${params}` : 'No parameters',
    ].join('\n');
  }

  // Follow-ups like "and for last quarter?" carry almost no searchable terms on
  // their own, so recent user turns are folded into the query.
  private buildQueryText(
    question: string,
    history: { role: 'user' | 'assistant'; content: string }[],
  ): string {
    // Guarded because slice(-0) returns the whole array, which would quietly fold
    // the entire conversation into the query when configured to fold in none.
    const priorUserTurns =
      this.historyTurns > 0
        ? history
            .filter((turn) => turn.role === 'user')
            .slice(-this.historyTurns)
            .map((turn) => turn.content)
        : [];
    return [...priorUserTurns, question].join('\n');
  }

  private everything(modules: FunctionModule[], reason: string): ToolSelection {
    return { modules, narrowed: false, reason };
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  // Not every provider returns unit-length vectors (Gemini does not at reduced
  // dimensions), so normalise rather than treating the dot product as cosine.
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').trim();
}
