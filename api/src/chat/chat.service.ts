import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { FunctionModule } from '../models/function-module.model';
import { User } from '../models/user.model';
import { ChatThread } from '../models/chat-thread.model';
import { ChatMessage } from '../models/chat-message.model';
import { SapDestination } from '../models/sap-destination.model';
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
  sapDestinationId: string;
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
  sapDestinationId: string | null;
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

// Used when the selected destination is an XSUAA/CAP application: there is no
// per-module whitelist, so the model names the function module itself.
const SYSTEM_PROMPT_CAP = `You are an assistant that answers questions about a company's SAP data.

You have one tool, execute_sap_function_module, which calls SAP function modules through
a CAP service authenticated with XSUAA. There is no separate whitelist — any function
module the CAP service permits can be called.

Grounding — this is the most important rule:
- Every figure, identifier, amount, date, and count in your answer must come from a tool
  result in this conversation. You have no SAP data until a tool returns it.
- If you have not called a tool, you cannot state a number. Call the tool instead.
- Never estimate, extrapolate, or fill in a plausible-looking value. If the data isn't in
  a tool result, say what you don't have.

Calling tools:
- When the user's question needs SAP data, call execute_sap_function_module immediately.
- Set functionModule to the SAP function module name (for example BAPI_SALESORDER_GETLIST).
- Put import parameters in "parameters" using the names SAP expects (for example
  customer_number, sales_organization). Use the values the user gave; do not ask them
  to confirm what they just told you.
- If you are unsure of the exact function module name, pick the standard BAPI/RFC that
  matches the request and say which one you called.
- Only ask a clarifying question when a required parameter is genuinely missing and you
  cannot reasonably infer it.
- If a call can answer part of the question, make it and answer that part, rather than
  declining the whole question.

Reporting:
- If a tool returns an error, say plainly what failed. Do not substitute invented data.
- Lead with the answer, then brief supporting detail. Use prose or a small table.
  Do not dump raw JSON at the user.`;

const CAP_EXECUTE_TOOL_NAME = 'execute_sap_function_module';

const CAP_EXECUTE_TOOL: LlmToolDefinition = {
  name: CAP_EXECUTE_TOOL_NAME,
  description:
    'Call a SAP function module by name through the selected XSUAA application. ' +
    'Use this whenever the question needs live SAP data.',
  parameters: {
    type: 'object',
    properties: {
      functionModule: {
        type: 'string',
        description: 'SAP function module name, e.g. BAPI_SALESORDER_GETLIST',
      },
      parameters: {
        type: 'object',
        description:
          'Import parameters as a JSON object, e.g. {"customer_number":"BP-CUST","sales_organization":"1010"}',
      },
    },
    required: ['functionModule'],
  },
};

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
      sapDestinationId: thread.sapDestinationId,
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
      sapDestinationId: thread.sapDestinationId,
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
      sapDestinationId: thread.sapDestinationId,
      createdAt: thread.createdAt,
      lastMessageAt: thread.lastMessageAt,
    };
  }

  async deleteThread(threadId: string, userId: string, organizationId: string): Promise<void> {
    const thread = await this.getThreadOrThrow(threadId, userId, organizationId);
    await this.chatMessageModel.destroy({ where: { threadId: thread.id } });
    await thread.destroy();
  }

  async listDestinations(organizationId: string): Promise<
    {
      id: string;
      name: string;
      description: string | null;
      transport: string;
    }[]
  > {
    const destinations = await this.sapDestinationsService.findAll(organizationId);
    return destinations
      .filter((destination) => destination.isActive)
      .map((destination) => ({
        id: destination.id,
        name: destination.name,
        description: destination.description,
        transport: destination.transport,
      }));
  }

  // Powers the chat empty state. Cloud Connector destinations list their
  // whitelist; XSUAA destinations advertise the generic execute tool instead.
  async listAvailableTools(
    organizationId: string,
    sapDestinationId?: string,
  ): Promise<{ name: string; description: string; fmName: string }[]> {
    if (!sapDestinationId) return [];
    const destination = await this.requireActiveDestination(organizationId, sapDestinationId);
    if (destination.transport === 'cap_facade') {
      return [
        {
          name: CAP_EXECUTE_TOOL.name,
          description: CAP_EXECUTE_TOOL.description,
          fmName: '*',
        },
      ];
    }
    const functionModules = await this.functionModuleModel.findAll({
      where: { organizationId, isEnabled: true, sapDestinationId },
    });
    return functionModules.map((fm) => ({
      name: fm.name,
      description: fm.description,
      fmName: fm.fmName,
    }));
  }

  async handleTurn(input: ChatTurnInput): Promise<ChatTurnResult> {
    const destination = await this.requireActiveDestination(
      input.organizationId,
      input.sapDestinationId,
    );
    const isCap = destination.transport === 'cap_facade';

    // Cloud Connector destinations can only run FMs the admin whitelisted.
    // XSUAA/CAP destinations skip that list — the CAP service is the gate.
    const functionModules = isCap
      ? []
      : await this.functionModuleModel.findAll({
          where: {
            organizationId: input.organizationId,
            sapDestinationId: destination.id,
            isEnabled: true,
          },
        });

    if (!isCap && functionModules.length === 0) {
      throw new UnprocessableEntityException(
        `No SAP function modules are whitelisted for "${destination.name}", so there is no data to query. Whitelist a function module on that destination first.`,
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
          sapDestinationId: destination.id,
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

    let tools: LlmToolDefinition[];
    if (isCap) {
      tools = [CAP_EXECUTE_TOOL];
    } else {
      // Follow-up questions ("and last quarter?") need prior user turns in the
      // embedding query; history lives on the thread, not on ChatTurnInput.
      const selection = await this.toolIndexService.selectForQuestion(
        functionModules,
        input.message,
        previousTurns.map((turn) => ({ role: turn.role, content: turn.content })),
      );
      tools = selection.modules.map((fm) => this.toToolDefinition(fm));
      if (selection.narrowed) {
        this.logger.log(
          `Advertising ${tools.length}/${functionModules.length} tools for org ${input.organizationId}: ${selection.reason}`,
        );
      }
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
        system: isCap ? SYSTEM_PROMPT_CAP : SYSTEM_PROMPT,
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
        const outcome = isCap
          ? await this.executeCapToolCall(destination, call)
          : await this.executeToolCall(input.organizationId, call, byToolName);
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
    await thread.update({ lastMessageAt: new Date(), sapDestinationId: destination.id });
    const maybeRetitled = await this.ensureThreadTitle(thread, input.message, finalReply, provider.name);

    return {
      threadId: thread.id,
      threadTitle: maybeRetitled.title,
      reply: finalReply,
      provider: provider.name,
      model: provider.model,
      toolInvocations,
      availableToolCount: isCap ? 1 : functionModules.length,
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

  private async requireActiveDestination(organizationId: string, destinationId: string) {
    const destination = await this.sapDestinationsService.findOneOrThrow(
      organizationId,
      destinationId,
    );
    if (!destination.isActive) {
      throw new UnprocessableEntityException(
        `Destination "${destination.name}" is inactive. Choose another SAP source, or reactivate it under SAP Destinations.`,
      );
    }
    return destination;
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

  private async executeCapToolCall(
    destination: SapDestination,
    call: LlmToolCall,
  ): Promise<{ invocation: ChatToolInvocation; content: string }> {
    const started = Date.now();
    const parsed = this.capCallArguments(call.arguments ?? {});

    if (call.name !== CAP_EXECUTE_TOOL_NAME) {
      const message = `Unknown tool "${call.name}". Use ${CAP_EXECUTE_TOOL_NAME} to call a SAP function module.`;
      return {
        invocation: {
          toolName: call.name,
          fmName: parsed.fmName || '—',
          arguments: call.arguments,
          success: false,
          statusCode: null,
          durationMs: Date.now() - started,
          message,
        },
        content: message,
      };
    }

    if (!parsed.fmName) {
      const message = 'A SAP function module name is required.';
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

    try {
      const response = await this.fmInvokerService.invokeNamed(
        destination,
        parsed.fmName,
        parsed.parameters,
      );
      return {
        invocation: {
          toolName: call.name,
          fmName: parsed.fmName,
          arguments: parsed.parameters,
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
      this.logger.warn(
        `CAP tool "${call.name}" (${parsed.fmName}) failed for destination ${destination.id}: ${message}`,
      );
      return {
        invocation: {
          toolName: call.name,
          fmName: parsed.fmName,
          arguments: parsed.parameters,
          success: false,
          statusCode: status,
          durationMs: Date.now() - started,
          message,
        },
        content: message,
      };
    }
  }

  // Accepts the nested { functionModule, parameters } shape, a JSON string for
  // parameters (Gemini often stringifies objects), or leftover top-level keys.
  private capCallArguments(args: Record<string, unknown>): {
    fmName: string;
    parameters: Record<string, unknown>;
  } {
    const fmName = String(args.functionModule ?? args.function_module ?? '').trim();
    let raw = args.parameters ?? args.parametersJson;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw) as unknown;
      } catch {
        raw = undefined;
      }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      const {
        functionModule: _fm,
        function_module: _fm2,
        parameters: _p,
        parametersJson: _pj,
        ...rest
      } = args;
      raw = rest;
    }
    return { fmName, parameters: raw as Record<string, unknown> };
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
