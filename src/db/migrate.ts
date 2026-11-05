import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool, closePool, type Pool } from './pool';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');

/** Runs every .sql file in db/migrations once, in name order.
 *  MySQL cannot undo table changes, so if a file fails halfway run `npm run db:reset` and fix the file. */
export async function migrate(pool: Pool = getPool(), opts: { reset?: boolean } = {}) {
  if (opts.reset) {
    const [tables] = await pool.query<RowDataPacket[]>('SELECT table_name AS t, table_type AS ty FROM information_schema.tables WHERE table_schema = DATABASE()');
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
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    await pool.query('INSERT INTO schema_migrations(name) VALUES (?)', [file]);
    applied.push(file);
  }
  return applied;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('migrate.ts')) {
  migrate(getPool(), { reset: process.argv.includes('--reset') })
    .then((a) => { console.log(a.length ? `applied: ${a.join(', ')}` : 'database is up to date'); })
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(closePool);
}
