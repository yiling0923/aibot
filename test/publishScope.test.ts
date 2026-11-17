import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_ADMIN } from '../src/db/seed';
import { buildApp } from '../src/server/app';

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 6); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('Publish runs the sample messages only for the merchants that changed (needs TEST_DATABASE_URL)', () => {
  let app: FastifyInstance; let admin = '';
  const call = (method: 'GET' | 'POST', path: string, payload?: object) => app.inject({ method, url: path, payload: payload as object, headers: { cookie: admin } });
  const state = async () => (await call('GET', '/api/admin/state')).json().snapshot;
  const merchantsOf = (r: { results: { merchant: string }[] }) => [...new Set(r.results.map((x) => x.merchant))].sort();
  beforeAll(async () => {
    await migrate(pool!, { reset: true }); await seed(pool!); app = await buildApp({ pool: pool!, logger: false });
    admin = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: DEMO_ADMIN })).headers['set-cookie']).split(';')[0];
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('with nothing changed it runs every merchant, as before', async () => {
    const r = (await call('POST', '/api/admin/tests', { snapshot: await state() })).json();
    expect(merchantsOf(r).length).toBeGreaterThan(2); expect(r.total).toBeGreaterThan(100);
  });

  it('a change to one merchant\'s answer runs only that merchant (much faster)', async () => {
    const s = await state(); s.kb.find((e: { merchant: string }) => e.merchant === 'MERCH_B').translations.en.answer_text = 'A new answer for B.';
    const r = (await call('POST', '/api/admin/tests', { snapshot: s })).json();
    expect(merchantsOf(r)).toEqual(['MERCH_B']);
    const all = (await call('POST', '/api/admin/tests', { snapshot: await state() })).json();
    expect(r.total).toBeLessThan(all.total / 2);
  });

  it('a change to the shared word lists reaches every merchant, so every merchant is run', async () => {
    const s = await state(); s.aliases.deposit.en.push('zzdeposit');
    expect(merchantsOf((await call('POST', '/api/admin/tests', { snapshot: s })).json()).length).toBeGreaterThan(2);
  });

  it('publishing does not run the sample messages a second time, and answers fast with a large merchant', async () => {
    const s = await state();
    for (let i = 0; i < 200; i++) s.kb.push({ id: 30000 + i, merchant: 'MERCH_A', category: 'General', intent_key: 'bulk_' + i, topic: 'deposit', aspect: null, topic_optional: false, status: 'live', translations: { en: { question_examples: ['b1 ' + i, 'b2 ' + i, 'b3 ' + i], answer_text: 'Answer ' + i } } });
    const t0 = Date.now(); const r = await call('POST', '/api/admin/publish', { snapshot: s, changes: ['Imported 200 entries'] }); const ms = Date.now() - t0;
    expect(r.statusCode).toBe(200); expect(r.json()).toEqual({ published: [{ scope: 'merchant', code: 'MERCH_A', ver: expect.any(Number) }] });   // no "pass" and "total" any more
    expect(ms).toBeLessThan(4000);                                                                  // it took more than 5 seconds before
    expect((await state()).kb.filter((e: { intent_key: string }) => e.intent_key.startsWith('bulk_')).length).toBe(200);
  });
});
