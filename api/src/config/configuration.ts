export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'mygo_fm_bridge',
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  },
  credentialsEncryptionKey: process.env.CREDENTIALS_ENCRYPTION_KEY ?? '',
  sap: {
    // Default SAP Cloud Connector Location ID (from the BTP subaccount's Cloud
    // Connector). Used when a SapDestination doesn't specify its own. When set,
    // outbound calls route through the Connectivity service to the on-prem system.
    defaultCloudConnectorLocationId:
      process.env.SAP_CLOUD_CONNECTOR_LOCATION_ID ?? '',
  },
  llm: {
    // Active vendor: anthropic | openai | gemini. Keys come from the environment
    // for now; per-organization settings can override this later.
    provider: process.env.LLM_PROVIDER ?? 'anthropic',
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS ?? '16000', 10),
    // Anthropic-only: thinking depth / token spend (low | medium | high).
    effort: process.env.LLM_EFFORT ?? 'medium',
    // Caps how many tool-call rounds one chat turn may run before giving up.
    maxToolIterations: parseInt(process.env.LLM_MAX_TOOL_ITERATIONS ?? '5', 10),
    // Truncation guard so a large SAP payload can't blow the context window.
    maxToolResultChars: parseInt(process.env.LLM_MAX_TOOL_RESULT_CHARS ?? '20000', 10),
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5',
      // Override for proxies or local testing; unset means the public API.
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? '',
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY ?? '',
      model: process.env.OPENAI_MODEL ?? 'gpt-4o',
      baseUrl: process.env.OPENAI_BASE_URL ?? '',
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY ?? '',
      model: process.env.GEMINI_MODEL ?? 'gemini-2.5-pro',
    },
    // Anthropic has no embeddings API, so this is chosen independently of
    // `provider` above: an org can run Anthropic for chat and OpenAI for
    // embeddings. Keys are reused from the vendor blocks above.
    embedding: {
      provider: process.env.EMBEDDING_PROVIDER ?? 'openai',
      openaiModel: process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
      geminiModel: process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001',
    },
    // Controls which whitelisted function modules get advertised to the model
    // for a given question. Every setting here is a safety/cost trade-off:
    // advertising too many wastes tokens, too few makes answerable questions
    // unanswerable, so the defaults lean towards advertising more.
    toolSelection: {
      enabled: (process.env.LLM_TOOL_SELECTION ?? 'true').toLowerCase() !== 'false',
      // Whitelists this size or smaller skip embedding entirely and send everything.
      sendAllBelow: parseInt(process.env.LLM_TOOL_SELECTION_SEND_ALL_BELOW ?? '8', 10),
      topK: parseInt(process.env.LLM_TOOL_SELECTION_TOP_K ?? '10', 10),
      // Cosine floor for a tool to count as relevant to the question.
      minScore: parseFloat(process.env.LLM_TOOL_SELECTION_MIN_SCORE ?? '0.2'),
      // Advertised even when nothing clears minScore, so a turn is never toolless.
      minTools: parseInt(process.env.LLM_TOOL_SELECTION_MIN_TOOLS ?? '3', 10),
      // Prior user turns folded into the query so follow-ups still match.
      historyTurns: parseInt(process.env.LLM_TOOL_SELECTION_HISTORY_TURNS ?? '2', 10),
      // Similarity at which two whitelist entries are flagged as confusable.
      overlapThreshold: parseFloat(process.env.LLM_OVERLAP_WARN_SCORE ?? '0.9'),
    },
  },
});
