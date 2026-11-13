import 'dotenv/config';

/** All settings come from environment variables (see .env.example). */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'mysql://bot:bot@localhost:3306/livechat_bot',
  /** Secret shared with the merchant website; it signs the customer token. */
  tokenSecret: process.env.CUSTOMER_TOKEN_SECRET ?? 'demo-secret',
  /** Signs the login cookie of the control panel. Set your own long random value for real use. */
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-session-secret-change-me',
  /** Makes the AI keys saved in the panel unreadable in the database. Set your own long random value for real use (empty: the session secret is used). */
  secretsKey: process.env.SECRETS_KEY ?? '',
  /** The address LiveChat should use to reach this bot, shown on the merchant page (empty: the address of the page that is open). */
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/+$/, ''),
  /** Test helpers (fake customer tokens). Must be off in production. */
  devTools: (process.env.DEV_TOOLS ?? 'on') !== 'off',
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  /** Claude picks the entry and describes new keywords. A small fast model is plenty for this. */
  claudeModel: process.env.CLAUDE_MODEL || 'claude-haiku-5-5',
  /** The ChatGPT model that writes replies. Leave empty to keep the standard wording. */
  openaiModel: process.env.OPENAI_MODEL ?? '',
  /** Safety limit on AI calls per hour (cost control). */
  aiMaxCallsPerHour: Number(process.env.AI_MAX_CALLS_PER_HOUR ?? 600),
  /** How long the LiveChat connector may take before the chat is handed to a person. */
  /** How often the bot copies each merchant's LiveChat handoff number (milliseconds, 0 = never). */
  livechatSyncMs: Number(process.env.LIVECHAT_SYNC_MS ?? 60000),
  askTimeoutMs: Number(process.env.ASK_TIMEOUT_MS ?? 8000),
  openaiKey: process.env.OPENAI_API_KEY ?? '',
};
