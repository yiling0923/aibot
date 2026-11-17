/** An answer that takes longer than this (milliseconds) counts as slow. The bot hands over at 8 seconds. */
export const SLOW_MS = 5000;
export type Kind = 'ok' | 'slow' | 'timeout' | 'error' | 'badkey';
export type State = 'ok' | 'slow' | 'down' | 'badkey';

export interface Status {
  state: State; reason: string; since: string | null; windowMinutes: number; total: number;
  counts: Record<Kind, number>; failed: number; db: 'up' | 'down' | 'unknown'; lastError: string | null;
  /** The merchants with the most failures in the window, so "only LuckyPay fails" is easy to see. */
  worst: { merchant: string; failed: number; total: number }[];
  lastAlertAt: string | null;
}
interface Ev { at: number; kind: Kind; merchant: string; ms: number }

export interface MonitorOpts {
  windowMs?: number; minCalls?: number; failRate?: number; slowShare?: number; reminderMs?: number;
  now?: () => number; notify?: (text: string) => Promise<unknown>;
}

/**
 * Watches how LiveChat's calls to the bot go. Over the last 5 minutes:
 *  - down:   at least 4 calls and a quarter or more of them failed or timed out (customers are being handed to a person)
 *  - slow:   at least 4 calls and half of them took longer than the "slow" line
 *  - badkey: 3 or more calls with a wrong or stopped key (LiveChat is set up with a key the bot does not accept)
 *  - down:   the database does not answer
 * It sends an alert when the state gets worse, one more when it is normal again, and a reminder every 30 minutes while it lasts.
 */
export class HealthMonitor {
  private ev: Ev[] = []; private db: 'up' | 'down' | 'unknown' = 'unknown'; private dbFails = 0; private dbWasDown = false;
  private state: State = 'ok'; private since: number | null = null; private lastError: string | null = null; private lastAlert: number | null = null;
  private readonly o: Required<Omit<MonitorOpts, 'notify'>> & { notify?: MonitorOpts['notify'] };
  constructor(opts: MonitorOpts = {}) {
    this.o = { windowMs: 5 * 60_000, minCalls: 4, failRate: 0.25, slowShare: 0.5, reminderMs: 30 * 60_000, now: Date.now, ...opts };
  }

  record(kind: Kind, merchant: string, ms: number, error?: string) {
    this.ev.push({ at: this.o.now(), kind, merchant, ms });
    if (error && (kind === 'error' || kind === 'timeout')) this.lastError = error.slice(0, 200);
    if (this.ev.length > 5000) this.ev.splice(0, this.ev.length - 5000);
    void this.check();
  }
  /** The result of a database check (every 30 seconds). Two failures in a row count as down. */
  setDb(up: boolean) { this.dbFails = up ? 0 : this.dbFails + 1; this.db = up ? 'up' : this.dbFails >= 2 ? 'down' : this.db; if (this.db === 'down') this.dbWasDown = true; void this.check(); }

  private trim() { const from = this.o.now() - this.o.windowMs; if (this.ev.length && this.ev[0].at < from) this.ev = this.ev.filter((e) => e.at >= from); }

  status(): Status {
    this.trim();
    const counts: Record<Kind, number> = { ok: 0, slow: 0, timeout: 0, error: 0, badkey: 0 }; const by = new Map<string, { failed: number; total: number }>();
    for (const e of this.ev) { counts[e.kind]++; const m = by.get(e.merchant) ?? { failed: 0, total: 0 }; m.total++; if (e.kind === 'timeout' || e.kind === 'error') m.failed++; by.set(e.merchant, m); }
    const total = this.ev.length, failed = counts.timeout + counts.error;
    let state: State = 'ok', reason = total ? 'The bot is answering normally.' : 'No calls from LiveChat in the last 5 minutes.';
    if (this.db === 'down') { state = 'down'; reason = 'The bot cannot reach its database. Customers cannot be answered.'; }
    else if (counts.badkey >= 3) { state = 'badkey'; reason = `LiveChat called ${counts.badkey} times with a wrong or stopped bot key. Check the key on the merchant page and in LiveChat.`; }
    else if (total >= this.o.minCalls && failed / total >= this.o.failRate) { state = 'down'; reason = `${failed} of ${total} answers failed or took too long in the last 5 minutes. Customers are being handed to a person.`; }
    else if (total >= this.o.minCalls && (counts.slow + counts.timeout) / total >= this.o.slowShare) { state = 'slow'; reason = `The bot is slow: ${counts.slow + counts.timeout} of ${total} answers took more than 5 seconds in the last 5 minutes.`; }
    return {
      state, reason, since: this.since ? new Date(this.since).toISOString() : null, windowMinutes: this.o.windowMs / 60_000, total, counts, failed, db: this.db, lastError: this.lastError,
      worst: [...by.entries()].filter(([, v]) => v.failed > 0).sort((a, b) => b[1].failed - a[1].failed).slice(0, 3).map(([merchant, v]) => ({ merchant, ...v })),
      lastAlertAt: this.lastAlert ? new Date(this.lastAlert).toISOString() : null,
    };
  }

  /**
   * Looks at the numbers now and sends an alert when the state changed (also called every 30 seconds, so a problem that fades out is noticed).
   * "Working normally again" is only said with proof: at least 2 good answers since the problem began (or the database answering again).
   * When the failures just expire because no calls arrive (at night), nothing is said and the state is kept; after an hour without calls it is reset quietly.
   */
  async check(): Promise<Status> {
    const s = this.status(), now = this.o.now();
    if (s.state !== 'ok') {
      if (this.state === 'ok') { this.since = now; this.state = s.state; await this.say(`🔴 ${s.reason}`, now); }
      else if (s.state !== this.state) { this.state = s.state; await this.say(`🔴 ${s.reason}`, now); }
      else if (this.lastAlert !== null && now - this.lastAlert >= this.o.reminderMs) await this.say(`🔴 Still a problem: ${s.reason}`, now);
    } else if (this.state !== 'ok') {
      const good = this.ev.filter((e) => e.kind === 'ok' && e.at >= (this.since ?? 0)).length >= 2, dbBack = this.dbWasDown && this.db === 'up';
      if (good || dbBack) { this.state = 'ok'; this.since = null; this.dbWasDown = false; await this.say('🟢 The bot is working normally again.', now); }
      else if (this.since !== null && now - this.since >= 12 * this.o.windowMs) { this.state = 'ok'; this.since = null; this.dbWasDown = false; }
    }
    return { ...s, since: this.since ? new Date(this.since).toISOString() : null };
  }
  private async say(text: string, now: number) { this.lastAlert = now; try { await this.o.notify?.(text); } catch { /* an alert that cannot be sent must not break the bot */ } }
}
