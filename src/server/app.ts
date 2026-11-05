import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from '../config';
import { createPool, type Pool } from '../db/pool';
import { loadKnowledge } from '../db/loadKnowledge';
import { Bot, newSession, type Session, type Turn } from '../bot/responder';
import { makeToken, checkToken } from '../bot/token';
import { Store } from '../bot/store';
import type { Lang } from '../engine/types';
import { adminRoutes, ensureVersion } from '../admin/routes';
import { createAi, type AiService } from '../ai';
import { peopleRoutes } from '../admin/people';
import { checkLogin } from '../auth/users';
import { COOKIE, clearCookie, makeSession, parseCookies, readSession, sessionCookie, type SessionUser } from '../auth/session';
import '../auth/types';

/** The short reason saved with a decision. */
function whyOf(tr: Record<string, unknown>): string {
  if (tr.decision === 'ABUSE') {
    const hit = (tr.abuseHit as string[]).join(', ');
    return `Rude word: ${hit} || ${tr.close ? `Closed after ${tr.strike} rude messages` : `Replied kindly (${tr.strike} of ${tr.limit || 'no limit'})`}`;
  }
  return String(tr.why ?? '');
}

const PUBLIC_API = new Set(['/api/auth/login', '/health']);
const SIGNED_IN_PAGES = new Set(['/', '/admin', '/admin.html', '/chat.html']);

export interface AppOptions { pool?: Pool; logger?: boolean; ai?: AiService }

export async function buildApp(opts: AppOptions = {}) {
  const pool = opts.pool ?? createPool();
  const app = Fastify({ logger: opts.logger ?? true });
  // Claude and ChatGPT are optional: with no keys set, every AI step is off and the bot answers from its own rules.
  const ai = opts.ai ?? createAi({ anthropicKey: config.anthropicKey, claudeModel: config.claudeModel, openaiKey: config.openaiKey, openaiModel: config.openaiModel, maxCallsPerHour: config.aiMaxCallsPerHour });
  await app.register(fastifyStatic, { root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public') });

  let bot: Bot | null = null;
  const store = new Store(pool);
  const sessions = new Map<string, Session & { owner: string }>();
  const drafts = new Map<string, Bot>();      // copies of the bot built from the control panel's unpublished changes
  const getBot = async (reload = false) => { if (!bot || reload) bot = new Bot(await loadKnowledge(pool), undefined, ai); return bot; };
  /** The bot a chat talks to: the published one, or a draft copy when the control panel's Test chat opened it. */
  const botFor = async (s: Session) => (s.draft && drafts.get(s.draft)) || (await getBot());
  adminRoutes(app, { pool, reloadBot: () => getBot(true), drafts, ai });
  peopleRoutes(app, { pool, reloadBot: () => getBot(true) });
  await ensureVersion(pool).catch((e) => app.log.warn({ err: e }, 'could not prepare version history (run npm run db:migrate)'));

  /* ---------- sign in ---------- */
  // Every page and API call needs a valid signed-in cookie, except the login itself and the health check.
  app.addHook('onRequest', async (req, reply) => {
    const route = req.url.split('?')[0];
    const user = readSession(parseCookies(req.headers.cookie)[COOKIE]);
    req.user = user ?? undefined;
    if (route.startsWith('/api/')) { if (!user && !PUBLIC_API.has(route)) return reply.code(401).send({ error: 'Please sign in.' }); return; }
    if (!user && SIGNED_IN_PAGES.has(route)) return reply.redirect('/login.html');
  });

  const failures = new Map<string, { n: number; until: number }>();   // too many wrong passwords: wait a minute
  app.post<{ Body: { username?: string; password?: string } }>('/api/auth/login', async (req, reply) => {
    const username = String(req.body?.username ?? ''), password = String(req.body?.password ?? '');
    const key = `${req.ip}|${username.toLowerCase()}`, f = failures.get(key);
    if (f && f.until > Date.now()) return reply.code(429).send({ error: 'Too many tries. Wait a minute and try again.' });
    const user = username && password ? await checkLogin(pool, username, password) : null;
    if (!user) {
      const n = (f?.n ?? 0) + 1; failures.set(key, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
      return reply.code(401).send({ error: 'Wrong username or password.' });
    }
    failures.delete(key);
    reply.header('set-cookie', sessionCookie(makeSession(user)));
    return { user };
  });
  app.post('/api/auth/logout', async (_req, reply) => { reply.header('set-cookie', clearCookie()); return { ok: true }; });
  app.get('/api/auth/me', async (req) => ({ user: req.user }));

  app.get('/', async (_req, reply) => reply.redirect('/admin.html'));
  app.get('/admin', async (_req, reply) => reply.redirect('/admin.html'));

  app.get('/health', async () => {
    let db = 'down';
    try { await pool.query('select 1'); db = 'up'; } catch { /* reported below */ }
    return { ok: db === 'up', db };
  });

  /** Staff can only work with their own merchant. */
  const mayUse = (user: SessionUser, merchant: string) => user.role === 'admin' || user.merchant === merchant;

  /** Merchants for the chat page selector. */
  app.get<{ Querystring: { draft?: string } }>('/api/merchants', async (req) => {
    const b = (req.query.draft && drafts.get(req.query.draft)) || (await getBot());
    return b.knowledge.merchants.filter((m) => mayUse(req.user!, m.code)).map((m) => ({ code: m.code, name: m.name, tone: m.tone, defaultLanguage: m.defaultLanguage }));
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

  /** Claude writes a short note for each new keyword (a few per message), in the background so the customer never waits. */
  const describeNew = async (b: Bot, merchant: string, words: string[], sample: string) => {
    for (const word of words.slice(0, 5)) {
      const d = await ai.describeWord({ word, sample, merchantName: b.engine.merchant(merchant).name, topics: Object.keys(b.knowledge.globalAliases) });
      if (d) await store.setNote(merchant, word, d.note, d.type);
    }
  };

  const turnJson = (s: Session, t: Turn | null) => ({ closed: s.closed, handed: s.handed, turn: t });
  const own = (req: { user?: SessionUser }, s: (Session & { owner: string }) | undefined) => (s && s.owner === req.user!.username ? s : undefined);

  /** Starts a chat. The website sends the merchant code and (if the customer is logged in) the signed token. */
  app.post<{ Body: { merchant: string; token?: string | null; draft?: string | null } }>('/api/chat/start', async (req, reply) => {
    const { merchant, token = null, draft = null } = req.body ?? ({} as never);
    if (merchant && !mayUse(req.user!, merchant)) return reply.code(403).send({ error: 'You can only work with your own merchant.' });
    const b = (draft && drafts.get(draft)) || (await getBot());
    if (!merchant || !b.engine.hasMerchant(merchant)) return reply.code(404).send({ error: `unknown merchant ${merchant}` });
    const s = { ...newSession(randomUUID(), merchant, token, draft && drafts.has(draft) ? draft : null), owner: req.user!.username }; sessions.set(s.id, s);
    return { sessionId: s.id, greeting: b.greeting(s), identity: checkToken(token), merchant: { code: merchant, name: b.engine.merchant(merchant).name } };
  });

  /** A typed message. */
  app.post<{ Body: { sessionId: string; text: string; silent?: boolean } }>('/api/chat/message', async (req, reply) => {
    const { sessionId, text, silent } = req.body ?? ({} as never);
    const s = own(req, sessions.get(sessionId)); if (!s) return reply.code(404).send({ error: 'unknown session, start a new chat' });
    const b = await botFor(s);
    const t = await b.message(s, String(text ?? ''));
    if (!t) return { closed: s.closed, handed: s.handed, turn: null };
    let saved: { fresh: string[]; unmatched: boolean } = { fresh: [], unmatched: false };
    if (t.log && !silent) {
      saved = await store.hear(s.merchant, t.log.text, t.log.lang as Lang, t.log.notUnderstood);
      if (ai.canDescribe && saved.fresh.length) void describeNew(b, s.merchant, saved.fresh, t.log.text);
      void store.logTurn({ merchant: s.merchant, sessionKey: s.id, customerRef: null, text: t.log.text, lang: t.log.lang as Lang, decision: t.log.decision,
        confidence: Number(t.trace.conf ?? 0), reply: t.messages.map((m) => m.text).join('\n'), matchedKbId: (t.trace.decision === 'ANSWER' ? (t.trace.top as { id: number }).id : null), why: whyOf(t.trace) });
    }
    return { closed: s.closed, handed: s.handed, turn: t, saved };
  });

  /** A tapped button. */
  app.post<{ Body: { sessionId: string; kind: string; key: string; amt?: number; label: string; lang: Lang } }>('/api/chat/pick', async (req, reply) => {
    const body = req.body ?? ({} as never);
    const s = own(req, sessions.get(body.sessionId)); if (!s) return reply.code(404).send({ error: 'unknown session, start a new chat' });
    return turnJson(s, (await botFor(s)).pick(s, body));
  });

  /** What has been saved automatically from the chats so far. */
  app.get<{ Querystring: { merchant: string } }>('/api/keywords/summary', async (req, reply) => {
    if (!mayUse(req.user!, req.query.merchant)) return reply.code(403).send({ error: 'You can only work with your own merchant.' });
    return store.keywordCount(req.query.merchant);
  });

  /** Debug endpoint: shows what the engine decides for a message (no AI, no LiveChat yet). */
  app.post<{ Body: { merchant: string; text: string; clarifyCount?: number; lastTopic?: string | null } }>('/api/analyze', async (req, reply) => {
    const { merchant, text, clarifyCount = 0, lastTopic = null } = req.body ?? ({} as never);
    if (!merchant || !text) return reply.code(400).send({ error: 'merchant and text are required' });
    if (!mayUse(req.user!, merchant)) return reply.code(403).send({ error: 'You can only work with your own merchant.' });
    const eng = (await getBot()).engine;
    if (!eng.hasMerchant(merchant)) return reply.code(404).send({ error: `unknown merchant ${merchant}` });
    const r = eng.analyze(text, merchant, clarifyCount, { lastTopic });
    return {
      decision: r.decision, why: r.why, confidence: r.conf, language: r.lang, via: r.via,
      topic: r.topic, intent: r.decision === 'ANSWER' ? r.top.intent : null, options: r.options,
      amount: r.amt ? r.amt.n : null, direction: r.dir, normalized: r.normalized, keywords: { topics: r.ks.T, aspects: r.ks.A },
    };
  });

  app.post('/api/reload', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.code(403).send({ error: 'Only an admin can do this.' });
    await getBot(true); return { ok: true };
  });

  return app;
}
