import Fastify from 'fastify';
import { config } from '../config';
import { getPool } from '../db/pool';
import { loadKnowledge } from '../db/loadKnowledge';
import { Engine } from '../engine/engine';

const app = Fastify({ logger: true });

let engine: Engine | null = null;
async function getEngine(reload = false) {
  if (!engine || reload) engine = new Engine(await loadKnowledge(getPool()));
  return engine;
}

app.get('/health', async () => {
  let db = 'down';
  try { await getPool().query('select 1'); db = 'up'; } catch { /* reported below */ }
  return { ok: db === 'up', db };
});

/** Debug endpoint: shows what the engine decides for a message (no AI, no LiveChat yet). */
app.post<{ Body: { merchant: string; text: string; clarifyCount?: number; lastTopic?: string | null } }>('/api/analyze', async (req, reply) => {
  const { merchant, text, clarifyCount = 0, lastTopic = null } = req.body ?? ({} as never);
  if (!merchant || !text) return reply.code(400).send({ error: 'merchant and text are required' });
  const eng = await getEngine();
  if (!eng.hasMerchant(merchant)) return reply.code(404).send({ error: `unknown merchant ${merchant}` });
  const r = eng.analyze(text, merchant, clarifyCount, { lastTopic });
  return {
    decision: r.decision, why: r.why, confidence: r.conf, language: r.lang, via: r.via,
    topic: r.topic, intent: r.decision === 'ANSWER' ? r.top.intent : null, options: r.options,
    amount: r.amt ? r.amt.n : null, direction: r.dir, normalized: r.normalized, keywords: { topics: r.ks.T, aspects: r.ks.A },
  };
});

app.post('/api/reload', async () => { await getEngine(true); return { ok: true }; });

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => { app.log.error(err); process.exit(1); });
