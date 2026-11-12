import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed } from '../src/db/seed';
import { allowWipe, whatWouldBeLost } from '../src/db/guard';

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 4); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('the wipe commands protect data (needs TEST_DATABASE_URL)', () => {
  beforeAll(async () => { await migrate(pool!, { reset: true }); });
  afterAll(async () => { await pool?.end(); });

  it('lets a wipe go ahead on an empty database', async () => {
    expect(await whatWouldBeLost(pool!)).toBeNull();
    expect(await allowWipe(pool!, 'db:seed', ['node', 'seed.ts'])).toBe(true);
  });

  it('refuses to wipe a database that holds merchants, unless --force is given, and says what would be lost', async () => {
    await seed(pool!);
    const lost = await whatWouldBeLost(pool!);
    expect(lost).toMatch(/6 merchants and 6 merchant databases/);
    const before = process.exitCode; const err: string[] = []; const orig = console.error; console.error = (m: string) => { err.push(String(m)); };
    try { expect(await allowWipe(pool!, 'db:reset', ['node', 'reset.ts'])).toBe(false); } finally { console.error = orig; process.exitCode = before; }
    expect(err.join('')).toContain('npm run db:reset -- --force'); expect(err.join('')).toContain('6 merchants');
    expect(await allowWipe(pool!, 'db:reset', ['node', 'reset.ts', '--force'])).toBe(true);
    expect(await whatWouldBeLost(pool!)).not.toBeNull();                                  // nothing was changed by asking
  });
});
