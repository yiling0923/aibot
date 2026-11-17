type Fetch = typeof fetch;

export interface AlertConfig { webhookUrl: string; telegramToken: string; telegramChatId: string; name: string }
/** What happened to each way of sending: "sent", "off" (not set up) or "failed: why". */
export interface SendResult { webhook: string; telegram: string }

/**
 * Sends one short text to the places the admin set up: a webhook (Slack, Discord, Teams or any address that takes JSON) and/or a Telegram chat.
 * It never throws and never waits more than 5 seconds: an alert that cannot be sent must not break the bot.
 * The text carries no customer data, only what is wrong.
 */
export function createNotifier(cfg: AlertConfig, fetchFn: Fetch = fetch) {
  const post = async (url: string, body: unknown): Promise<string> => {
    try {
      const r = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
      return r.ok ? 'sent' : `failed: the address answered ${r.status}`;
    } catch (e) { return 'failed: ' + ((e as Error).name === 'TimeoutError' ? 'no answer in 5 seconds' : (e as Error).message.slice(0, 120)); }
  };
  const configured = { webhook: !!cfg.webhookUrl, telegram: !!(cfg.telegramToken && cfg.telegramChatId) };
  const send = async (text: string): Promise<SendResult> => {
    const line = `${cfg.name}: ${text}`;
    const [webhook, telegram] = await Promise.all([
      configured.webhook ? post(cfg.webhookUrl, { text: line, content: line }) : Promise.resolve('off'),       // "text" is read by Slack and Teams, "content" by Discord
      configured.telegram ? post(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, { chat_id: cfg.telegramChatId, text: line }) : Promise.resolve('off'),
    ]);
    return { webhook, telegram };
  };
  return { send, configured };
}
export type Notifier = ReturnType<typeof createNotifier>;
