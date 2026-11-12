import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';

/** One AI call, as the AI service reports it. */
export interface UsageEvent {
  merchant?: string; provider: 'anthropic' | 'openai'; model: string; kind: 'pick' | 'describe' | 'translate' | 'write';
  inputTokens: number; outputTokens: number;
  /** true when the merchant's own key paid for it (the merchant pays the provider, not you). */
  own?: boolean;
}

/** Writes one row per AI call: the tokens and the cost at today's price. Never throws into the chat: a failed write is only logged. */
export class UsageRecorder {
  private prices = new Map<string, { inp: number; out: number }>(); private loadedAt = 0;
  constructor(private pool: Pool) {}

  private async price(provider: string, model: string) {
    if (Date.now() - this.loadedAt > 30_000) {
      const [rows] = await this.pool.query<RowDataPacket[]>('SELECT provider, model, input_per_mtok, output_per_mtok FROM ai_prices');
      this.prices = new Map(rows.map((r) => [`${r.provider}|${r.model}`, { inp: Number(r.input_per_mtok), out: Number(r.output_per_mtok) }])); this.loadedAt = Date.now();
    }
    return this.prices.get(`${provider}|${model}`) ?? null;
  }
  /** Called after a price changes, so the next call uses it at once. */
  forgetPrices() { this.loadedAt = 0; }

  async record(e: UsageEvent): Promise<void> {
    try {
      const p = await this.price(e.provider, e.model);
      const cost = p ? (e.inputTokens * p.inp + e.outputTokens * p.out) / 1_000_000 : null;
      await this.pool.query(
        'INSERT INTO ai_usage(merchant_id, provider, model, kind, key_source, input_tokens, output_tokens, cost_usd) VALUES((SELECT id FROM merchants WHERE code = ?),?,?,?,?,?,?,?)',
        [e.merchant ?? null, e.provider, e.model, e.kind, e.own ? 'own' : 'shared', Math.max(0, Math.round(e.inputTokens)), Math.max(0, Math.round(e.outputTokens)), cost]);
    } catch (err) { console.warn('AI usage could not be saved:', (err as Error).message); }
  }
}
