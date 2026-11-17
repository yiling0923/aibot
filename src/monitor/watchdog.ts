import 'dotenv/config';
import { config } from '../config';
import { createNotifier, type Notifier } from './notify';

type Fetch = typeof fetch;

/**
 * Checks from OUTSIDE that the bot answers. The bot cannot tell you it has stopped, so this small program asks http://.../health
 * every 30 seconds and sends the same alert (webhook / Telegram) when it fails 3 times in a row, and again when it is back.
 * Run it with `npm run watchdog`, ideally on another computer than the bot.
 */
export class Watchdog {
  private fails = 0; private down = false; private lastAlert = 0; private downSince = 0;
  constructor(private o: { url: string; failAfter?: number; reminderMs?: number; notify: (t: string) => Promise<unknown>; fetchFn?: Fetch; now?: () => number }) {}

  private async probe(): Promise<string | null> {
    try {
      const r = await (this.o.fetchFn ?? fetch)(this.o.url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return `answered ${r.status}`;
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean };
      return j.ok === false ? 'answered, but says its database is down' : null;
    } catch (e) { return (e as Error).name === 'TimeoutError' ? 'no answer in 5 seconds' : 'cannot be reached'; }
  }

  /** One check. Returns what it saw (null: the bot is fine). */
  async tick(): Promise<string | null> {
    const now = (this.o.now ?? Date.now)(); const problem = await this.probe();
    if (problem) {
      this.fails++;
      if (!this.down && this.fails >= (this.o.failAfter ?? 3)) { this.down = true; this.downSince = now; this.lastAlert = now; await this.o.notify(`🔴 The bot does not answer at ${this.o.url}: ${problem}. Customers may get no reply.`).catch(() => undefined); }
      else if (this.down && now - this.lastAlert >= (this.o.reminderMs ?? 30 * 60_000)) { this.lastAlert = now; await this.o.notify(`🔴 Still down since ${new Date(this.downSince).toLocaleTimeString()}: ${problem}.`).catch(() => undefined); }
    } else {
      if (this.down) await this.o.notify('🟢 The bot answers again.').catch(() => undefined);
      this.fails = 0; this.down = false;
    }
    return problem;
  }
}

export function alertConfig() { return { webhookUrl: config.alertWebhookUrl, telegramToken: config.alertTelegramToken, telegramChatId: config.alertTelegramChatId, name: config.alertName }; }

/** Runs forever (used by `npm run watchdog`). */
export async function runWatchdog(notifier: Notifier = createNotifier(alertConfig()), url = process.env.WATCHDOG_URL || `http://localhost:${config.port}/health`, everyMs = Number(process.env.WATCHDOG_EVERY_MS ?? 30_000)) {
  if (!notifier.configured.webhook && !notifier.configured.telegram) console.warn('No alert address is set (ALERT_WEBHOOK_URL or ALERT_TELEGRAM_TOKEN and ALERT_TELEGRAM_CHAT_ID in .env): problems are only written here.');
  const w = new Watchdog({ url, notify: async (t) => { console.log(new Date().toISOString(), t); return notifier.send(t); } });
  console.log(`Watching ${url} every ${everyMs >= 1000 ? Math.round(everyMs / 1000) + ' seconds' : everyMs + ' ms'}. Press Ctrl+C to stop.`);
  for (;;) { const p = await w.tick(); if (p) console.log(new Date().toISOString(), 'problem:', p); await new Promise((r) => setTimeout(r, everyMs)); }
}

if (process.argv[1] && /watchdog\.ts$/.test(process.argv[1])) void runWatchdog();
