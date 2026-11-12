import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool, closePool, type Pool } from './pool';
import { Tenants, ident, migrateMerchantDb } from './tenants';
import { splitIntoMerchantDatabases } from './steps/008_merchant_databases';
import { addLanguages } from './steps/012_languages';
import { allowWipe } from './guard';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');

/** Steps written in code (they move data, which plain SQL cannot do). They run in name order together with the .sql files. */
const STEPS: Record<string, (pool: Pool) => Promise<void>> = { '008_merchant_databases': splitIntoMerchantDatabases, '012_languages': addLanguages };

/** Brings the main database and every merchant database up to date.
 *  Main database: the files in db/migrations (and the code steps), each once, in name order.
 *  Each merchant database: the files in db/merchant, each once per database.
 *  MySQL cannot undo table changes, so if a file fails halfway run `npm run db:reset` and fix the file. */
export async function migrate(pool: Pool = getPool(), opts: { reset?: boolean } = {}) {
  const tenants = new Tenants(pool);
  if (opts.reset) {
    const [tables] = await pool.query<RowDataPacket[]>('SELECT table_name AS t, table_type AS ty FROM information_schema.tables WHERE table_schema = DATABASE()');
    for (const d of await tenants.allMerchantDbs()) await pool.query(`DROP DATABASE IF EXISTS ${ident(d)}`);
    if (tables.length) {
      await pool.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const r of tables) await pool.query(`DROP ${r.ty === 'VIEW' ? 'VIEW' : 'TABLE'} IF EXISTS \`${r.t}\``);   // views are dropped as views
      await pool.query('SET FOREIGN_KEY_CHECKS = 1');
    }
  }
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(200) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const [rows] = await pool.query<RowDataPacket[]>('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name as string));
  const applied: string[] = [];
  const todo = [...fs.readdirSync(dir).filter((f) => f.endsWith('.sql')), ...Object.keys(STEPS).map((n) => n + '.step')].sort();
  for (const file of todo) {
    if (done.has(file)) continue;
    if (file.endsWith('.step')) await STEPS[file.slice(0, -5)](pool);
    else await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    await pool.query('INSERT INTO schema_migrations(name) VALUES (?)', [file]);
    applied.push(file);
  }
  for (const m of await tenants.list(true)) {                      // every merchant has its own database, kept up to date
    const before = (await tenants.allMerchantDbs()).includes(m.db);
    const a = before ? await migrateMerchantDb(pool, m.db) : (await tenants.ensure(m.code), ['(created)']);
    if (a.length) applied.push(`${m.db}: ${a.join(', ')}`);
    await pool.query('UPDATE merchants SET db_name = ? WHERE id = ?', [m.db, m.id]);
  }
  return applied;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('migrate.ts')) {
  const pool = getPool(), reset = process.argv.includes('--reset');
  (reset ? allowWipe(pool, 'db:migrate -- --reset') : Promise.resolve(true)).then((ok) => (ok ? migrate(pool, { reset }) : null))
    .then((a) => { if (!a) return; console.log(a.length ? `applied: ${a.join(', ')}` : 'database is up to date'); })
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(closePool);
}
