import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { FunctionModule } from '../models/function-module.model';
import { User } from '../models/user.model';
import { FmInvokerService } from '../admin/services/fm-invoker.service';
import { FmInvocationError } from '../admin/services/fm-invocation.types';
import { LlmService } from '../llm/llm.service';
import { ToolIndexService } from '../tool-index/tool-index.service';
import type {
  LlmMessage,
  LlmToolCall,
  LlmToolDefinition,
} from '../llm/llm-provider.interface';

export interface ChatTurnInput {
  userId: string;
  organizationId: string;
  message: string;
  // Prior turns, so follow-up questions ("and for last quarter?") keep context.
  history: { role: 'user' | 'assistant'; content: string }[];
}

export interface ChatToolInvocation {
  toolName: string;
  fmName: string;
  arguments: Record<string, unknown>;
  success: boolean;
  statusCode: number | null;
  durationMs: number;
  message: string;
}

export interface ChatTurnResult {
  reply: string;
  provider: string;
  model: string;
  toolInvocations: ChatToolInvocation[];
  // Everything whitelisted and enabled for the organization.
  availableToolCount: number;
  // The subset actually offered to the model this turn. Lower than
  // availableToolCount means the shortlist narrowed it — worth surfacing so a
  // "no tool can answer that" reply can be traced to the shortlist.
  advertisedToolCount: number;
}

const SYSTEM_PROMPT = `You are an assistant that answers questions about a company's SAP data.

You have tools that call whitelisted SAP function modules. They are the only source of
SAP data you have.

Grounding — this is the most important rule:
- Every figure, identifier, amount, date, and count in your answer must come from a tool
  result in this conversation. You have no SAP data until a tool returns it.
- If you have not called a tool, you cannot state a number. Call the tool instead.
- Never estimate, extrapolate, or fill in a plausible-looking value. If the data isn't in
  a tool result, say what you don't have.

Calling tools:
- When the user's question needs SAP data, call the relevant tool immediately.
- If the user names an entity (a supplier, customer, order, plant, or date range), use
  that value directly as the parameter. Do not ask them to confirm what they just told you.
- Only ask a clarifying question when a required parameter is genuinely missing and you
  cannot reasonably infer it. Prefer calling the tool and stating your assumption.
- If a tool can answer part of the question, call it and answer that part, rather than
  declining the whole question.

Reporting:
- If a tool returns an error, say plainly what failed. Do not substitute invented data.
- If no available tool can answer the question, say so and name the data you would need.
- Lead with the answer, then brief supporting detail. Use prose or a small table.
  Do not dump raw JSON at the user.`;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly maxIterations: number;
  private readonly maxToolResultChars: number;

  constructor(
    @InjectModel(FunctionModule)
    private readonly functionModuleModel: typeof FunctionModule,
    @InjectModel(User)
    private readonly userModel: typeof User,
    private readonly fmInvokerService: FmInvokerService,
    private readonly llmService: LlmService,
    private readonly toolIndexService: ToolIndexService,
    config: ConfigService,
  ) {
    this.maxIterations = config.get<number>('llm.maxToolIterations') ?? 5;
    this.maxToolResultChars = config.get<number>('llm.maxToolResultChars') ?? 20000;
  }

  // Powers the chat empty state: what this organization can actually ask about.
  async listAvailableTools(
    organizationId: string,
  ): Promise<{ name: string; description: string; fmName: string }[]> {
    const functionModules = await this.functionModuleModel.findAll({
      where: { organizationId, isEnabled: true },
    });
    return functionModules.map((fm) => ({
      name: fm.name,
      description: fm.description,
      fmName: fm.fmName,
    }));
  }

  async handleTurn(input: ChatTurnInput): Promise<ChatTurnResult> {
    // Only enabled, org-owned function modules are ever exposed as tools.
    const functionModules = await this.functionModuleModel.findAll({
      where: { organizationId: input.organizationId, isEnabled: true },
    });

    // With no tools there is no SAP data to ground an answer in. Calling the model
    // anyway invites it to narrate a plausible-sounding result (and even a fake tool
    // error), so fail loudly instead of returning something that looks like data.
    if (functionModules.length === 0) {
      throw new UnprocessableEntityException(
        'No SAP function modules are whitelisted for this organization, so there is no data to query. Whitelist a function module first.',
      );
    }

    // Keyed on the *whole* whitelist, not the advertised subset: the shortlist
    // decides what the model is told about, not what it is allowed to call. A
    // module that gets named anyway is still enabled and org-owned, so running it
    // is safe — and it rescues the turn when the shortlist guessed wrong.
    const byToolName = new Map(functionModules.map((fm) => [fm.name, fm]));

    const selection = await this.toolIndexService.selectForQuestion(
      functionModules,
      input.message,
      input.history,
    );
    const tools = selection.modules.map((fm) => this.toToolDefinition(fm));
    if (selection.narrowed) {
      this.logger.log(
        `Advertising ${tools.length}/${functionModules.length} tools for org ${input.organizationId}: ${selection.reason}`,
      );
    }

    const user = await this.userModel.findByPk(input.userId);
    const provider = this.llmService.resolve(user?.llmProvider);
    const messages: LlmMessage[] = [
      ...input.history.map((turn) => ({ role: turn.role, content: turn.content }) as LlmMessage),
      { role: 'user', content: input.message },
    ];

    const toolInvocations: ChatToolInvocation[] = [];
    let reply = '';

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const response = await this.llmService.complete({
        system: SYSTEM_PROMPT,
        messages,
        tools,
      });
      reply = response.text || reply;

      if (response.stopReason === 'refusal') {
        return {
          reply:
            response.text ||
            'The model declined to answer this request. Try rephrasing, or ask about something else.',
          provider: provider.name,
          model: provider.model,
          toolInvocations,
          availableToolCount: functionModules.length,
          advertisedToolCount: tools.length,
        };
      }

      if (response.toolCalls.length === 0) {
        return {
          reply,
          provider: provider.name,
          model: provider.model,
          toolInvocations,
          availableToolCount: functionModules.length,
          advertisedToolCount: tools.length,
        };
      }

      messages.push({
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls,
      });

      // The model only proposes calls; the backend is what actually invokes SAP.
      for (const call of response.toolCalls) {
        const outcome = await this.executeToolCall(input.organizationId, call, byToolName);
        toolInvocations.push(outcome.invocation);
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: outcome.content,
          isError: !outcome.invocation.success,
        });
      }
    }

    this.logger.warn(
      `Chat turn hit the ${this.maxIterations}-iteration tool limit for org ${input.organizationId}`,
    );
    return {
      reply:
        reply ||
        'I was not able to finish this request within the allowed number of SAP calls. Try narrowing the question.',
      provider: provider.name,
      model: provider.model,
      toolInvocations,
      availableToolCount: functionModules.length,
      advertisedToolCount: tools.length,
    };
  }

  private toToolDefinition(fm: FunctionModule): LlmToolDefinition {
    const properties: Record<string, { type: string; description?: string }> = {};
    const required: string[] = [];
    for (const param of fm.parameters ?? []) {
      properties[param.name] = {
        // 'date' isn't a JSON Schema primitive; describe it as a string instead.
        type: param.type === 'date' ? 'string' : param.type,
        description:
          param.type === 'date'
            ? `${param.description ?? ''} (date, format YYYY-MM-DD)`.trim()
            : param.description,
      };
      if (param.required) {
        required.push(param.name);
      }
    }
    return {
      name: fm.name,
      description: `${fm.description} (SAP function module: ${fm.fmName})`,
      parameters: { type: 'object', properties, required },
    };
  }

  private async executeToolCall(
    organizationId: string,
    call: LlmToolCall,
    byToolName: Map<string, FunctionModule>,
  ): Promise<{ invocation: ChatToolInvocation; content: string }> {
    const started = Date.now();
    const fm = byToolName.get(call.name);

    // A model can hallucinate a tool name — never let that reach SAP.
    if (!fm) {
      const message = `No whitelisted function module named "${call.name}" is available.`;
      return {
        invocation: {
          toolName: call.name,
          fmName: '—',
          arguments: call.arguments,
          success: false,
          statusCode: null,
          durationMs: Date.now() - started,
          message,
        },
        content: message,
      };
    }

    // The invoker owns the transport: whether this destination calls the ABAP fmcall
    // service directly or posts to the CAP facade, and how each one's failures read.
    try {
      const response = await this.fmInvokerService.invoke(
        organizationId,
        fm,
        call.arguments ?? {},
      );
      return {
        invocation: {
          toolName: call.name,
          fmName: fm.fmName,
          arguments: call.arguments,
          success: true,
          statusCode: response.status,
          durationMs: Date.now() - started,
          message: 'OK',
        },
        content: this.stringifyBody(response.data),
      };
    } catch (err) {
      const status = err instanceof FmInvocationError ? err.status : null;
      const message =
        err instanceof Error ? err.message : 'The function module call failed for an unknown reason';
      this.logger.warn(`Tool "${call.name}" failed for org ${organizationId}: ${message}`);
      return {
        invocation: {
          toolName: call.name,
          fmName: fm.fmName,
          arguments: call.arguments,
          success: false,
          statusCode: status,
          durationMs: Date.now() - started,
          message,
        },
        content: message,
      };
    }
  }

  // SAP payloads can be far larger than the context window; truncate with a marker
  // so the model knows the data was cut rather than silently incomplete.
  private stringifyBody(data: unknown): string {
    let body: string;
    try {
      body = typeof data === 'string' ? data : JSON.stringify(data);
    } catch {
      body = String(data);
    }
    if (!body) return '(empty response)';
    if (body.length <= this.maxToolResultChars) return body;
    return `${body.slice(0, this.maxToolResultChars)}\n\n[truncated: response was ${body.length} characters]`;
  }
}
