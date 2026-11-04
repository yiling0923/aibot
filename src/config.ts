import 'dotenv/config';

/** All settings come from environment variables (see .env.example). */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://bot:bot@localhost:5432/livechat_bot',
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  openaiKey: process.env.OPENAI_API_KEY ?? '',
};
