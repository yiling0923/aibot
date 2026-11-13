import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed } from '../src/db/seed';
import { readSnapshot, writeSnapshot } from '../src/admin/snapshot';
import { loadKnowledge } from '../src/db/loadKnowledge';

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 6); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('entry type and end date are saved and loaded (needs TEST_DATABASE_URL)', () => {
  beforeAll(async () => { await migrate(pool!, { reset: true }); await seed(pool!); });
  afterAll(async () => { await pool?.end(); });

  it('a new database has the defaults: Answer, no end date', async () => {
    const e = (await readSnapshot(pool!)).kb.find((x) => x.merchant === 'MERCH_A')!;
    expect(e).toMatchObject({ entry_type: 'answer', ends_on: null });
  });

  it('saves them through the draft/publish path, cleans bad values, and the bot loads them', async () => {
    const snap = await readSnapshot(pool!); const [a, b, c] = snap.kb.filter((x) => x.merchant === 'MERCH_A');
    a.entry_type = 'promotion'; a.ends_on = '2030-01-02';
    b.entry_type = 'bogus' as never; b.ends_on = 'tomorrow';                                   // not valid: becomes Answer, no end date
    c.entry_type = 'needs_staff';
    await writeSnapshot(pool!, snap, { merchants: ['MERCH_A'], shared: false });
    const back = (await readSnapshot(pool!)).kb.filter((x) => x.merchant === 'MERCH_A');
    expect(back.find((x) => x.intent_key === a.intent_key)).toMatchObject({ entry_type: 'promotion', ends_on: '2030-01-02' });
    expect(back.find((x) => x.intent_key === b.intent_key)).toMatchObject({ entry_type: 'answer', ends_on: null });
    const k = (await loadKnowledge(pool!)).kbEntries.filter((x) => x.merchant === 'MERCH_A');
    expect(k.find((x) => x.intentKey === a.intent_key)).toMatchObject({ entryType: 'promotion', endsOn: '2030-01-02' });
    expect(k.find((x) => x.intentKey === c.intent_key)?.entryType).toBe('needs_staff');
  });
});
