import { createHash, randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';
import { Tenants, tbl } from '../db/tenants';
import { newSession, type Bot, type Button, type Session, type Turn } from '../bot/responder';
import type { Store } from '../bot/store';
import type { Lang } from '../engine/types';

/**
 * The LiveChat connector. LiveChat calls POST /api/v1/ai/ask with a question; this turns it into a bot decision and back.
 *
 *   In (LiveChat's existing format):  { question, history: [{role, text, created_at}], session_id? }   (+ optional member)
 *   Out:                              { answer, confidence, should_escalate, should_close, close_message, session_id }
 *   Also sent, for other channels and for staff: decision, topic, keywords, choices.
 *
 * The chat's memory is kept in the merchant's own database (bot_sessions), so a restart loses nothing.
 * LiveChat has no buttons, so choices are written into the answer as a numbered list, and the next message may pick one.
 */
export class AskError extends Error { constructor(public status: number, message: string) { super(message); } }

export interface Member { id: string; name: string; rank?: string }
export interface Choice { label: string; value: string }
export interface AskResponse {
  answer: string; confidence: number; should_escalate: boolean; should_close: boolean; close_message: string | null; session_id: string;
  decision: 'answer' | 'clarify' | 'handover' | 'close' | 'silent';
  /** The flow of the plan: the words the customer typed (keywords), what they want (topic), and the answer (answer_id, the knowledge base entry). */
  topic: string | null; keywords: string[]; choices: Choice[]; answer_id: number | null;
  /** True only for a plain answer that depends on nothing but the words of the question. LiveChat keeps a reply by those words for every customer, so every other reply is marked false and given a confidence under its cache limit. */
  cacheable: boolean;
}
interface State { session: Session; choices: Button[] | null; lang: Lang | null }
export interface AskDeps { pool: Pool; bot: Bot; store: Store; timeoutMs?: number; /** 'test' for the panel's "Test the link" button: saved as a test chat, not as live traffic. Default 'live'. */ source?: 'live' | 'test' }

const SESSION_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const q = async <T extends RowDataPacket = RowDataPacket>(pool: Pool, sql: string, p: unknown[] = []) => (await pool.query<T[]>(sql, p))[0];

/** The customer, when the channel says who they are. Several spellings are accepted (LiveChat calls the id externalId). */
export function parseMember(raw: unknown): Member | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = o.id ?? o.member_id ?? o.external_id ?? o.externalId;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  const sid = String(id).trim(); if (!sid || sid.length > 255) return null;
  return { id: sid, name: String(o.name ?? '').slice(0, 255), rank: o.rank != null ? String(o.rank).slice(0, 64) : o.member_rank != null ? String(o.member_rank).slice(0, 64) : undefined };
}

export { matchChoice } from '../bot/choices';

function renderChoices(buttons: Button[]): { text: string; choices: Choice[] } {
  return { text: buttons.map((b, i) => `${i + 1}. ${b.label}`).join('\n'), choices: buttons.map((b) => ({ label: b.label, value: `${b.kind}:${b.key}` })) };
}

function decisionOf(turn: Turn, s: Session, hasChoices: boolean): AskResponse['decision'] {
  const d = String(turn.trace.decision ?? '');
  if (turn.locked || s.closed) return 'close';
  if (s.handed) return 'handover';
  if (hasChoices || d === 'CHOICE' || d === 'CLARIFY' || d === 'REASK') return 'clarify';
  return 'answer';
}

export async function ask(deps: AskDeps, merchant: string, body: Record<string, unknown>): Promise<AskResponse> {
  const { pool, bot, store } = deps;
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 2000) : '';
  if (!question) throw new AskError(400, 'question is required.');
  const history = Array.isArray(body.history) ? body.history : [];
  let sessionId: string | null = null;
  if (body.session_id != null && body.session_id !== '') {
    if (typeof body.session_id !== 'string' || !SESSION_ID.test(body.session_id)) throw new AskError(400, 'session_id must be up to 64 letters, digits, dots, dashes or colons.');
    sessionId = body.session_id;
  }
  const member = parseMember(body.member);

  const tenant = await new Tenants(pool).get(merchant);
  if (!tenant) throw new AskError(404, 'Unknown merchant.');
  const SESSIONS = tbl(tenant.db, 'bot_sessions'), REQUESTS = tbl(tenant.db, 'bot_requests');

  // LiveChat sends no message id and retries when it hears nothing: the same request gets the same answer, and the chat does not move twice.
  const requestKey = sha([merchant, sessionId ?? '', member?.id ?? '', question, JSON.stringify(history)].join('\u0001'));   // who is asking is part of the request
  const [seen] = await q(pool, `SELECT response, created_at FROM ${REQUESTS} WHERE request_key = ?`, [requestKey]);
  if (seen) {
    if (Date.now() - new Date(seen.created_at).getTime() < DUPLICATE_WINDOW_MS) return JSON.parse(seen.response) as AskResponse;
    await pool.query(`DELETE FROM ${REQUESTS} WHERE request_key = ?`, [requestKey]);
  }

  const id = sessionId ?? `bot_${randomUUID()}`;
  const [row] = await q(pool, `SELECT state FROM ${SESSIONS} WHERE session_id = ?`, [id]);
  const state: State = row ? (JSON.parse(row.state) as State) : { session: newSession(id, merchant, null), choices: null, lang: null };
  state.session.merchant = merchant;
  if (member) state.session.member = member;

  const started = Date.now();
  const fallback = (): AskResponse => {                       // slow or not ready: pass the chat to a person, never leave the customer in silence
    const cfg = bot.engine.hasMerchant(merchant) ? bot.engine.merchant(merchant) : null;
    const lang = state.lang ?? (cfg?.defaultLanguage as Lang) ?? 'en';
    const text = cfg ? (cfg.handoff[lang] ?? cfg.handoff.en ?? '') : '';
    return { answer: text, confidence: 0, should_escalate: true, should_close: false, close_message: null, session_id: id, decision: 'handover', topic: null, keywords: [], choices: [], answer_id: null, cacheable: false };
  };

  let abandoned = false;
  const work = async (): Promise<AskResponse> => {
    if (!bot.engine.hasMerchant(merchant)) return fallback();
    const s = state.session;
    if (s.handed || s.closed) return { answer: '', confidence: 0, should_escalate: s.handed, should_close: s.closed, close_message: null, session_id: id, decision: 'silent', topic: null, keywords: [], choices: [], answer_id: null, cacheable: false };

    // LiveChat keeps a reply by the words of the question, for every customer: so no reply carries personal account data (it is for staff).
    s.noPersonal = true;
    s.channel = typeof body.channel === 'string' && /^[a-z0-9_-]{1,20}$/i.test(body.channel.trim()) ? body.channel.trim().toLowerCase() : 'livechat';
    if (state.choices && !s.choices) s.choices = state.choices;       // a chat saved before the choices moved into the session
    state.choices = null;
    // A reply to the choices ("deposit", "depo", "2", "the first one") is read by the bot itself, so every channel behaves the same.
    const turn: Turn | null = await bot.message(s, question);
    if (!turn) return fallback();

    const lang = (turn.log?.lang ?? (turn.trace.lang as Lang | undefined) ?? s.lang ?? state.lang) as Lang | null; state.lang = lang;
    let answer = turn.messages.filter((m) => m.kind === 'bot').map((m) => m.text).join('\n\n');
    let choices: Choice[] = [];
    if (turn.buttons?.length) { const r = renderChoices(turn.buttons); answer = (answer ? answer + '\n\n' : '') + r.text + (turn.hint ? '\n\n' + turn.hint : ''); choices = r.choices; }
    const decision = decisionOf(turn, s, choices.length > 0);
    const cacheable = decision === 'answer' && !!turn.cacheable;
    const conf = Math.min(1, Math.max(0, Number(turn.trace.conf ?? 0)));
    const res: AskResponse = {
      answer, confidence: cacheable ? conf : Math.min(conf, 0.8), should_escalate: s.handed, should_close: turn.locked || s.closed,
      close_message: turn.locked || s.closed ? answer : null, session_id: id, decision,
      topic: typeof turn.trace.topic === 'string' ? turn.trace.topic : null, keywords: Array.isArray(turn.trace.kw) ? (turn.trace.kw as string[]) : [], choices,
      answer_id: decision === 'answer' && typeof turn.trace.answerId === 'number' ? turn.trace.answerId : null, cacheable,
    };
    if (!abandoned && turn.log) {
      const matched = turn.trace.decision === 'ANSWER' ? ((turn.trace.top as { id?: number } | undefined)?.id ?? null) : null;
      await store.hear(merchant, turn.log.text, turn.log.lang, turn.log.notUnderstood, deps.source ?? 'live');
      void store.logTurn({ merchant, sessionKey: id, customerRef: member?.id ?? null, text: turn.log.text, lang: turn.log.lang, decision: turn.log.decision, confidence: res.confidence,
        reply: answer, matchedKbId: matched, why: String(turn.trace.why ?? '').slice(0, 500), topic: typeof turn.trace.topic === 'string' ? turn.trace.topic : null, keywords: Array.isArray(turn.trace.kw) ? (turn.trace.kw as string[]) : [], source: deps.source ?? 'live' });
    }
    return res;
  };

  const limit = deps.timeoutMs ?? 8000; let timer: NodeJS.Timeout | undefined;
  const slow = new Promise<'slow'>((resolve) => { timer = setTimeout(() => resolve('slow'), limit); });
  const safe = work().catch((e): AskResponse => { console.error('connector: the bot failed, handing over', e); return fallback(); });
  const outcome = await Promise.race([safe, slow]).finally(() => clearTimeout(timer));
  let response: AskResponse;
  if (outcome === 'slow') { abandoned = true; state.session.handed = true; response = fallback(); }
  else response = outcome;

  await pool.query(`INSERT INTO ${SESSIONS}(session_id, state, language) VALUES(?,?,?) ON DUPLICATE KEY UPDATE state = VALUES(state), language = VALUES(language)`, [id, JSON.stringify(state), state.lang]);
  await pool.query(`INSERT IGNORE INTO ${REQUESTS}(request_key, session_id, decision, latency_ms, response) VALUES(?,?,?,?,?)`, [requestKey, id, response.decision, Date.now() - started, JSON.stringify(response)]);
  if (Math.random() < 0.02) void pool.query(`DELETE FROM ${REQUESTS} WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 DAY)`).catch(() => undefined);
  return response;
}
