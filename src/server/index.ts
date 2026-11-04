import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from '../config';
import { getPool } from '../db/pool';
import { loadKnowledge } from '../db/loadKnowledge';
import { Bot, newSession, type Session, type Turn } from '../bot/responder';
import { makeToken, checkToken } from '../bot/token';
import { Store } from '../bot/store';
import type { Lang } from '../engine/types';
import { adminRoutes, ensureVersion } from '../admin/routes';

const app = Fastify({ logger: true });
await app.register(fastifyStatic, { root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public') });

let bot: Bot | null = null;
const store = new Store(getPool());
const sessions = new Map<string, Session>();
const drafts = new Map<string, Bot>();      // copies of the bot built from the control panel's unpublished changes
async function getBot(reload = false) {
  if (!bot || reload) bot = new Bot(await loadKnowledge(getPool()));
  return bot;
}
/** The bot a chat talks to: the published one, or a draft copy when the control panel's Test chat opened it. */
async function botFor(s: Session) { return (s.draft && drafts.get(s.draft)) || (await getBot()); }
adminRoutes(app, { pool: getPool(), reloadBot: () => getBot(true), drafts });
await ensureVersion(getPool()).catch((e) => app.log.warn({ err: e }, 'could not prepare version history (run npm run db:migrate)'));

app.get('/', async (_req, reply) => reply.redirect('/chat.html'));
app.get('/admin', async (_req, reply) => reply.redirect('/admin.html'));

app.get('/health', async () => {
  let db = 'down';
  try { await getPool().query('select 1'); db = 'up'; } catch { /* reported below */ }
  return { ok: db === 'up', db };
});

/** Merchants for the chat page selector. */
app.get<{ Querystring: { draft?: string } }>('/api/merchants', async (req) => {
  const b = (req.query.draft && drafts.get(req.query.draft)) || (await getBot());
  return b.knowledge.merchants.map((m) => ({ code: m.code, name: m.name, tone: m.tone, defaultLanguage: m.defaultLanguage }));
});

/** Fake customers for testing account lookups. The token is signed exactly like the merchant website would sign it. */
app.get('/api/dev/customers', async (_req, reply) => {
  if (!config.devTools) return reply.code(404).send({ error: 'dev tools are off' });
  const tom = { customer_id: 8841, name: 'Tom' }, mary = { customer_id: 9120, name: 'Mary' };
  const good = makeToken(tom);
  return [
    { key: 'tom', label: 'Tom (logged in)', token: good },
    { key: 'mary', label: 'Mary (logged in)', token: makeToken(mary) },
    { key: 'edited', label: 'Tom, ID edited', token: makeToken(mary).split('.')[0] + '.' + good.split('.')[1] },   // Mary's data, Tom's signature
    { key: 'guest', label: 'Not logged in', token: null },
  ];
});

/** The short reason saved with a decision (shown in Needs review). */
function whyOf(tr: Record<string, unknown>): string {
  if (tr.decision === 'ABUSE') {
    const hit = (tr.abuseHit as string[]).join(', ');
    return `Rude word: ${hit} || ${tr.close ? `Closed after ${tr.strike} rude messages` : `Replied kindly (${tr.strike} of ${tr.limit || 'no limit'})`}`;
  }
  return String(tr.why ?? '');
}
const turnJson = (s: Session, t: Turn | null) => ({ closed: s.closed, handed: s.handed, turn: t });

/** Starts a chat. The website sends the merchant code and (if the customer is logged in) the signed token. */
app.post<{ Body: { merchant: string; token?: string | null; draft?: string | null } }>('/api/chat/start', async (req, reply) => {
  const { merchant, token = null, draft = null } = req.body ?? ({} as never);
  const b = (draft && drafts.get(draft)) || (await getBot());
  if (!merchant || !b.engine.hasMerchant(merchant)) return reply.code(404).send({ error: `unknown merchant ${merchant}` });
  const s = newSession(randomUUID(), merchant, token, draft && drafts.has(draft) ? draft : null); sessions.set(s.id, s);
  return { sessionId: s.id, greeting: b.greeting(s), identity: checkToken(token), merchant: { code: merchant, name: b.engine.merchant(merchant).name } };
});

/** A typed message. */
app.post<{ Body: { sessionId: string; text: string; silent?: boolean } }>('/api/chat/message', async (req, reply) => {
  const { sessionId, text, silent } = req.body ?? ({} as never);
  const s = sessions.get(sessionId); if (!s) return reply.code(404).send({ error: 'unknown session, start a new chat' });
  const b = await botFor(s);
  const t = b.message(s, String(text ?? ''));
  if (!t) return { closed: s.closed, handed: s.handed, turn: null };
  let saved: { fresh: string[]; unmatched: boolean } = { fresh: [], unmatched: false };
  if (t.log && !silent) {
    saved = await store.hear(s.merchant, t.log.text, t.log.lang as Lang, t.log.notUnderstood);
    void store.logTurn({ merchant: s.merchant, sessionKey: s.id, customerRef: null, text: t.log.text, lang: t.log.lang as Lang, decision: t.log.decision,
      confidence: Number(t.trace.conf ?? 0), reply: t.messages.map((m) => m.text).join('\n'), matchedKbId: (t.trace.decision === 'ANSWER' ? (t.trace.top as { id: number }).id : null), why: whyOf(t.trace) });
  }
  return { closed: s.closed, handed: s.handed, turn: t, saved };
});

/** A tapped button. */
app.post<{ Body: { sessionId: string; kind: string; key: string; amt?: number; label: string; lang: Lang } }>('/api/chat/pick', async (req, reply) => {
  const body = req.body ?? ({} as never);
  const s = sessions.get(body.sessionId); if (!s) return reply.code(404).send({ error: 'unknown session, start a new chat' });
  const t = (await botFor(s)).pick(s, body);
  return turnJson(s, t);
});

/** What has been saved automatically from the chats so far. */
app.get<{ Querystring: { merchant: string } }>('/api/keywords/summary', async (req) => store.keywordCount(req.query.merchant));

/** Debug endpoint: shows what the engine decides for a message (no AI, no LiveChat yet). */
app.post<{ Body: { merchant: string; text: string; clarifyCount?: number; lastTopic?: string | null } }>('/api/analyze', async (req, reply) => {
  const { merchant, text, clarifyCount = 0, lastTopic = null } = req.body ?? ({} as never);
  if (!merchant || !text) return reply.code(400).send({ error: 'merchant and text are required' });
  const eng = (await getBot()).engine;
  if (!eng.hasMerchant(merchant)) return reply.code(404).send({ error: `unknown merchant ${merchant}` });
  const r = eng.analyze(text, merchant, clarifyCount, { lastTopic });
  return {
    decision: r.decision, why: r.why, confidence: r.conf, language: r.lang, via: r.via,
    topic: r.topic, intent: r.decision === 'ANSWER' ? r.top.intent : null, options: r.options,
    amount: r.amt ? r.amt.n : null, direction: r.dir, normalized: r.normalized, keywords: { topics: r.ks.T, aspects: r.ks.A },
  };
});

app.post('/api/reload', async () => { await getBot(true); return { ok: true }; });

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => { app.log.error(err); process.exit(1); });
