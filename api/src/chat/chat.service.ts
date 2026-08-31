import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { FunctionModule } from '../models/function-module.model';
import { User } from '../models/user.model';
import { ChatThread } from '../models/chat-thread.model';
import { ChatMessage } from '../models/chat-message.model';
import { SapDestinationsService } from '../admin/services/sap-destinations.service';
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
  threadId?: string;
  message: string;
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
  threadId: string;
  threadTitle: string;
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

export interface ChatThreadSummary {
  id: string;
  title: string;
  lastMessageAt: Date;
  createdAt: Date;
}

export interface ChatThreadDetail extends ChatThreadSummary {
  messages: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    toolInvocations?: ChatToolInvocation[];
    failed: boolean;
    answeredWithoutSap: boolean;
    createdAt: Date;
  }[];
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
    @InjectModel(ChatThread)
    private readonly chatThreadModel: typeof ChatThread,
    @InjectModel(ChatMessage)
    private readonly chatMessageModel: typeof ChatMessage,
    private readonly sapDestinationsService: SapDestinationsService,
    private readonly fmInvokerService: FmInvokerService,
    private readonly llmService: LlmService,
    private readonly toolIndexService: ToolIndexService,
    config: ConfigService,
  ) {
    this.maxIterations = config.get<number>('llm.maxToolIterations') ?? 5;
    this.maxToolResultChars = config.get<number>('llm.maxToolResultChars') ?? 20000;
  }

  async listThreads(userId: string, organizationId: string): Promise<ChatThreadSummary[]> {
    const threads = await this.chatThreadModel.findAll({
      where: { userId, organizationId },
      order: [['lastMessageAt', 'DESC'], ['createdAt', 'DESC']],
    });
    return threads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      lastMessageAt: thread.lastMessageAt,
      createdAt: thread.createdAt,
    }));
  }

  async getThread(threadId: string, userId: string, organizationId: string): Promise<ChatThreadDetail> {
    const thread = await this.getThreadOrThrow(threadId, userId, organizationId);
    const messages = await this.chatMessageModel.findAll({
      where: { threadId: thread.id },
      order: [['createdAt', 'ASC']],
    });
    return {
      id: thread.id,
      title: thread.title,
      createdAt: thread.createdAt,
      lastMessageAt: thread.lastMessageAt,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        toolInvocations: message.toolInvocations ?? undefined,
        failed: message.failed,
        answeredWithoutSap: message.answeredWithoutSap,
        createdAt: message.createdAt,
      })),
    };
  }

  async createThread(userId: string, organizationId: string): Promise<ChatThreadSummary> {
    const thread = await this.chatThreadModel.create({
      userId,
      organizationId,
      title: 'New chat',
      titleAutoGenerated: true,
      lastMessageAt: new Date(),
    });
    return {
      id: thread.id,
      title: thread.title,
      createdAt: thread.createdAt,
      lastMessageAt: thread.lastMessageAt,
    };
  }

  async deleteThread(threadId: string, userId: string, organizationId: string): Promise<void> {
    const thread = await this.getThreadOrThrow(threadId, userId, organizationId);
    await this.chatMessageModel.destroy({ where: { threadId: thread.id } });
    await thread.destroy();
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

    const user = await this.userModel.findByPk(input.userId);
    const provider = this.llmService.resolve(user?.llmProvider);
    const thread = input.threadId
      ? await this.getThreadOrThrow(input.threadId, input.userId, input.organizationId)
      : await this.chatThreadModel.create({
          userId: input.userId,
          organizationId: input.organizationId,
          title: 'New chat',
          titleAutoGenerated: true,
          lastMessageAt: new Date(),
        });

    const persistedHistory = await this.chatMessageModel.findAll({
      where: { threadId: thread.id },
      order: [['createdAt', 'ASC']],
    });
    const previousTurns = persistedHistory.filter(
      (message) => !message.failed && (message.role === 'user' || message.role === 'assistant'),
    );

    // Follow-up questions ("and last quarter?") need prior user turns in the
    // embedding query; history lives on the thread, not on ChatTurnInput.
    const selection = await this.toolIndexService.selectForQuestion(
      functionModules,
      input.message,
      previousTurns.map((turn) => ({ role: turn.role, content: turn.content })),
    );
    const tools = selection.modules.map((fm) => this.toToolDefinition(fm));
    if (selection.narrowed) {
      this.logger.log(
        `Advertising ${tools.length}/${functionModules.length} tools for org ${input.organizationId}: ${selection.reason}`,
      );
    }

    const messages: LlmMessage[] = [
      ...previousTurns.map((turn) => ({ role: turn.role, content: turn.content }) as LlmMessage),
      { role: 'user', content: input.message },
    ];

    await this.chatMessageModel.create({
      threadId: thread.id,
      role: 'user',
      content: input.message,
      failed: false,
      answeredWithoutSap: false,
      toolInvocations: null,
    });

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
        reply =
          response.text ||
          'The model declined to answer this request. Try rephrasing, or ask about something else.';
        break;
      }

      if (response.toolCalls.length === 0) {
        break;
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
    const finalReply =
      reply ||
      'I was not able to finish this request within the allowed number of SAP calls. Try narrowing the question.';
    await this.chatMessageModel.create({
      threadId: thread.id,
      role: 'assistant',
      content: finalReply,
      failed: false,
      answeredWithoutSap: toolInvocations.length === 0,
      toolInvocations,
    });
    await thread.update({ lastMessageAt: new Date() });
    const maybeRetitled = await this.ensureThreadTitle(thread, input.message, finalReply, provider.name);

    return {
      threadId: thread.id,
      threadTitle: maybeRetitled.title,
      reply: finalReply,
      provider: provider.name,
      model: provider.model,
      toolInvocations,
      availableToolCount: functionModules.length,
      advertisedToolCount: tools.length,
    };
  }

  private async ensureThreadTitle(
    thread: ChatThread,
    firstUserMessage: string,
    assistantReply: string,
    providerName: User['llmProvider'],
  ): Promise<ChatThread> {
    if (!thread.titleAutoGenerated || thread.title !== 'New chat') {
      return thread;
    }

    const title = await this.generateTitleFromLlm(firstUserMessage, assistantReply, providerName);
    await thread.update({ title, titleAutoGenerated: true });
    return thread;
  }

  private async generateTitleFromLlm(
    userMessage: string,
    assistantReply: string,
    providerName: User['llmProvider'],
  ): Promise<string> {
    const fallback = this.fallbackTitle(userMessage);
    try {
      const response = await this.llmService.complete(
        {
          system:
            'Generate a short chat title (max 7 words). Return only the title text, no quotes or punctuation at the end.',
          messages: [
            { role: 'user', content: userMessage },
            { role: 'assistant', content: assistantReply },
            { role: 'user', content: 'Create the best concise title for this conversation.' },
          ],
          tools: [],
        },
        providerName,
      );
      const cleaned = this.cleanTitle(response.text);
      return cleaned || fallback;
    } catch (err) {
      this.logger.warn(
        `Failed to auto-title chat thread with provider ${providerName}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return fallback;
    }
  }

  private cleanTitle(raw: string): string {
    const normalized = (raw || '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return '';
    return normalized.slice(0, 80);
  }

  private fallbackTitle(text: string): string {
    const words = text
      .trim()
      .replace(/\s+/g, ' ')
      .split(' ')
      .slice(0, 7)
      .join(' ');
    return (words || 'New chat').slice(0, 80);
  }

  private async getThreadOrThrow(
    threadId: string,
    userId: string,
    organizationId: string,
  ): Promise<ChatThread> {
    const thread = await this.chatThreadModel.findOne({
      where: { id: threadId, userId, organizationId },
    });
    if (!thread) {
      throw new NotFoundException('Chat not found');
    }
    return thread;
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
