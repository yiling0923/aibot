import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from './pool';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');

/** Runs every .sql file in db/migrations once, in name order. Files ending in .optional.sql may fail without stopping. */
export async function migrate(pool = getPool(), opts: { reset?: boolean } = {}) {
  if (opts.reset) await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const optional = file.endsWith('.optional.sql');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      if (!optional) throw err;
      console.warn(`skipped optional migration ${file}: ${(err as Error).message}`);
    } finally { client.release(); }
  }
  return applied;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('migrate.ts')) {
  migrate(getPool(), { reset: process.argv.includes('--reset') })
    .then((a) => { console.log(a.length ? `applied: ${a.join(', ')}` : 'database is up to date'); })
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(closePool);
}
