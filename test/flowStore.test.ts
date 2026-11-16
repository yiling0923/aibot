import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed } from '../src/db/seed';
import { readSnapshot, writeSnapshot, knowledgeFromSnapshot, readMerchants } from '../src/admin/snapshot';
import { scopeSnapshot, effectiveSnapshot } from '../src/admin/scope';
import { loadKnowledge } from '../src/db/loadKnowledge';
import { buildApp } from '../src/server/app';
import { seed as seedDb, DEMO_ADMIN } from '../src/db/seed';
import type { FastifyInstance } from 'fastify';
import type { Flow } from '../src/engine/flowTypes';

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false; let pool2: Pool | null = null;
if (url) { pool = createPool(url, 6); pool2 = createPool(url, 6); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

const flow = (id: number, status: 'live' | 'draft', topic = 'deposit'): Flow & { merchant: string } => ({ merchant: 'MERCH_A', id, name: 'Deposit help ' + id, topic, status,
  blocks: [{ id: 'q', type: 'question', text: { en: 'What do you need?' }, options: [{ id: 'a', label: { en: 'Limits' }, next: '__end' }] }, { id: 'e', type: 'end', text: { en: 'Bye' } }] });

describe.skipIf(!reachable)('flows are saved, scoped and loaded (needs TEST_DATABASE_URL)', () => {
  beforeAll(async () => { await migrate(pool!, { reset: true }); await seed(pool!); });
  afterAll(async () => { await pool?.end(); });

  it('a new database has no flows', async () => { expect((await readSnapshot(pool!)).flows).toEqual([]); });

  it('saves flows through publish, reads them back, and the live bot loads only the live ones', async () => {
    const snap = await readSnapshot(pool!); snap.flows = [flow(1, 'live'), flow(2, 'draft', 'withdraw')];
    await writeSnapshot(pool!, snap, { merchants: ['MERCH_A'], shared: false });
    const back = (await readSnapshot(pool!)).flows!;
    expect(back.map((f) => [f.id, f.status, f.topic])).toEqual([[1, 'live', 'deposit'], [2, 'draft', 'withdraw']]);
    expect(back[0].blocks).toHaveLength(2);
    const cfg = (await loadKnowledge(pool!)).merchants.find((m) => m.code === 'MERCH_A')!;
    expect(cfg.flows?.map((f) => f.id)).toEqual([1]);                                           // the draft is not used live
  });

  it('a snapshot without the flows list leaves the saved flows alone', async () => {
    const snap = await readSnapshot(pool!); delete snap.flows;
    await writeSnapshot(pool!, snap, { merchants: ['MERCH_A'], shared: false });
    expect((await readSnapshot(pool!)).flows).toHaveLength(2);
  });

  it('testing a draft includes draft flows; the live view does not', async () => {
    const snap = await readSnapshot(pool!); const ms = await readMerchants(pool!);
    expect(knowledgeFromSnapshot(snap, ms, {}, true).merchants.find((m) => m.code === 'MERCH_A')?.flows).toHaveLength(2);
    expect(knowledgeFromSnapshot(snap, ms, {}, false).merchants.find((m) => m.code === 'MERCH_A')?.flows).toHaveLength(1);
  });

  it('staff see and change only their own merchant\'s flows', async () => {
    const snap = await readSnapshot(pool!); snap.flows!.push({ ...flow(9, 'live'), merchant: 'MERCH_B' });
    const staff = { username: 's', role: 'staff', merchant: 'MERCH_A' } as never;
    expect(scopeSnapshot(staff, snap).flows!.every((f) => f.merchant === 'MERCH_A')).toBe(true);
    const mine = scopeSnapshot(staff, snap); mine.flows = [...mine.flows!, flow(3, 'live'), { ...flow(4, 'live'), merchant: 'MERCH_B' }];     // adds one of its own and sneaks in another merchant's
    const eff = effectiveSnapshot(staff, snap, mine);
    expect(eff.flows!.filter((f) => f.merchant === 'MERCH_A').map((f) => f.id).sort()).toEqual([1, 2, 3]);
    expect(eff.flows!.filter((f) => f.merchant === 'MERCH_B').map((f) => f.id)).toEqual([9]);   // the other merchant's flows are untouched
  });
});

describe.skipIf(!reachable)('flows through the real server (needs TEST_DATABASE_URL)', () => {
  let app: FastifyInstance; let admin = '';
  const post = (path: string, payload: object) => app.inject({ method: 'POST', url: path, payload, headers: { cookie: admin } });
  beforeAll(async () => {
    await migrate(pool2!, { reset: true }); await seedDb(pool2!);
    app = await buildApp({ pool: pool2!, logger: false });
    admin = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: DEMO_ADMIN })).headers['set-cookie']).split(';')[0];
  });
  afterAll(async () => { await app?.close(); await pool2?.end(); });

  it('the try-it box runs the flow step by step, without saving anything', async () => {
    const f = flow(1, 'draft');
    const a = (await post('/api/admin/flows/try', { flow: f, lang: 'en', answers: {} })).json();
    expect(a.messages).toEqual(['What do you need?']); expect(a.buttons).toEqual([{ key: 'a', label: 'Limits' }]);
    const b = (await post('/api/admin/flows/try', { flow: f, state: a.state, input: { pick: 'a' }, lang: 'en', answers: {} })).json();
    expect(b.done).toBe(true); expect(b.state).toBeNull();
    expect((await post('/api/admin/flows/try', { lang: 'en' })).statusCode).toBe(400);
  });

  it('a flow published from the panel runs in a real chat', async () => {
    const snap = (await app.inject({ method: 'GET', url: '/api/admin/state', headers: { cookie: admin } })).json().snapshot;
    snap.flows = [{ merchant: 'MERCH_A', id: 1, name: 'Deposit help', topic: 'deposit', status: 'live', blocks: [
      { id: 'q', type: 'question', text: { en: 'What do you need for your deposit?' }, options: [{ id: 'a', label: { en: 'The steps' }, next: 'ans' }, { id: 'b', label: { en: 'Talk to someone' }, next: 'h' }] },
      { id: 'ans', type: 'answer', intent: 'deposit_how', next: '__end' }, { id: 'h', type: 'handoff', text: { en: 'Connecting you now.' } }] }];
    expect((await post('/api/admin/publish', { snapshot: snap, changes: ['Added a flow'] })).statusCode).toBe(200);
    const s = (await post('/api/chat/start', { merchant: 'MERCH_A' })).json().sessionId;
    const m = (await post('/api/chat/message', { sessionId: s, text: 'deposit' })).json();
    expect(m.error ?? '').toBe(''); expect(m.turn.messages[0].text).toContain('What do you need for your deposit?');
    expect(m.turn.buttons.map((x: { kind: string }) => x.kind)).toEqual(['flow', 'flow', 'agent']);
    const p = (await post('/api/chat/pick', { sessionId: s, kind: 'flow', key: 'a', label: 'The steps', lang: 'en' })).json();
    expect(p.turn.messages.map((x: { text: string }) => x.text).join(' ')).toContain('Wallet');
  });
});
