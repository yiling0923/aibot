import 'dotenv/config';

/** All settings come from environment variables (see .env.example). */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'mysql://bot:bot@localhost:3306/livechat_bot',
  /** Secret shared with the merchant website; it signs the customer token. */
  tokenSecret: process.env.CUSTOMER_TOKEN_SECRET ?? 'demo-secret',
  /** Test helpers (fake customer tokens). Must be off in production. */
  devTools: (process.env.DEV_TOOLS ?? 'on') !== 'off',
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  openaiKey: process.env.OPENAI_API_KEY ?? '',
};
