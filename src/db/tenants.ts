import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from './pool';

/** Each merchant has its own database (named <main database>_m_<code>), so a merchant's knowledge base, keywords, chats and settings
 *  are all inside it. The main database keeps what is shared: the merchant list, the logins and the shared word lists. */
export interface Tenant { id: number; code: string; name: string; status: string; db: string }

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/merchant');

/** `db`.`table`, safe to put into a query. */
export const ident = (name: string) => '`' + name.replace(/`/g, '``') + '`';
export const tbl = (db: string, table: string) => `${ident(db)}.${ident(table)}`;

/** The database name for a merchant code. Only letters, digits and underscores survive, so the name is always safe. */
export const dbNameFor = (control: string, code: string) => `${control}_m_${code.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`.slice(0, 64);

export class Tenants {
  private control: string | null = null;
  constructor(readonly pool: Pool) {}

  async controlDb(): Promise<string> {
    if (!this.control) this.control = String((await this.pool.query<RowDataPacket[]>('SELECT DATABASE() AS d'))[0][0].d);
    return this.control;
  }

  async list(includeInactive = false): Promise<Tenant[]> {
    const control = await this.controlDb();
    const rows = (await this.pool.query<RowDataPacket[]>(`SELECT id, code, name, status, db_name FROM merchants ${includeInactive ? '' : "WHERE status = 'active'"} ORDER BY id`))[0];
    return rows.map((r) => ({ id: Number(r.id), code: r.code, name: r.name, status: r.status, db: r.db_name || dbNameFor(control, r.code) }));
  }

  async get(code: string): Promise<Tenant | null> { return (await this.list(true)).find((t) => t.code === code) ?? null; }

  /** Creates the merchant's database if it is missing and brings its tables up to date. Returns the database name. */
  async ensure(code: string): Promise<string> {
    const db = dbNameFor(await this.controlDb(), code);
    try { await this.pool.query(`CREATE DATABASE IF NOT EXISTS ${ident(db)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); }
    catch (e) {
      if ((e as { code?: string }).code === 'ER_DBACCESS_DENIED_ERROR' || (e as { code?: string }).code === 'ER_SPECIFIC_ACCESS_DENIED_ERROR')
        throw new Error(`The database user may not create the database ${db}. Ask the MySQL admin to run db/setup.sql once (it grants the bot user the right to create merchant databases).`);
      throw e;
    }
    await migrateMerchantDb(this.pool, db);
    await this.pool.query('UPDATE merchants SET db_name = ? WHERE code = ?', [db, code]);
    return db;
  }

  /** Brings every existing merchant database up to date (new files in db/merchant). Used when the server starts, so an update never leaves a merchant behind. */
  async migrateAll(): Promise<string[]> {
    const have = new Set(await this.allMerchantDbs()); const applied: string[] = [];
    for (const t of await this.list(true)) if (have.has(t.db)) for (const f of await migrateMerchantDb(this.pool, t.db)) applied.push(`${t.db}: ${f}`);
    return applied;
  }

  /** Every database that belongs to this installation's merchants (also leftovers of merchants that were removed). */
  async allMerchantDbs(): Promise<string[]> {
    const control = await this.controlDb();
    const like = `${control.replace(/[\\%_]/g, '\\$&')}\\_m\\_%`;
    return (await this.pool.query<RowDataPacket[]>('SELECT schema_name AS n FROM information_schema.schemata WHERE schema_name LIKE ?', [like]))[0].map((r) => r.n as string);
  }
}

/** Runs the files in db/merchant that this merchant database has not had yet. */
export async function migrateMerchantDb(pool: Pool, db: string): Promise<string[]> {
  const c = await pool.getConnection(); const applied: string[] = [];
  const back = String((await c.query<RowDataPacket[]>('SELECT DATABASE() AS d'))[0][0].d);
  try {
    await c.query(`USE ${ident(db)}`);
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(200) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    const done = new Set((await c.query<RowDataPacket[]>('SELECT name FROM schema_migrations'))[0].map((r) => r.name as string));
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      await c.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await c.query('INSERT INTO schema_migrations(name) VALUES (?)', [file]); applied.push(file);
    }
    for (const r of await repairs(c, db)) applied.push(r);
  } finally { await c.query(`USE ${ident(back)}`); c.release(); }   // give the connection back pointing at the main database again
  return applied;
}

/** Columns that later files added. If a merchant database says it ran the file but the column is not there (a half-finished update, a restored backup),
 *  the column is added again. Safe to repeat: it only acts on a column that is missing. */
const REQUIRED: { table: string; column: string; add: string; after?: string }[] = [
  { table: 'chat_sessions', column: 'source', add: "ADD COLUMN source VARCHAR(10) NOT NULL DEFAULT 'live' AFTER status" },
  { table: 'settings', column: 'max_choices', add: 'ADD COLUMN max_choices INT NOT NULL DEFAULT 3' },
  { table: 'settings', column: 'more_help_on', add: 'ADD COLUMN more_help_on TINYINT(1) NOT NULL DEFAULT 1' },
  { table: 'bot_decisions', column: 'topic', add: 'ADD COLUMN topic VARCHAR(100) NULL' },
  { table: 'bot_decisions', column: 'keywords', add: 'ADD COLUMN keywords VARCHAR(500) NULL' },
  { table: 'settings', column: 'more_help_msg', add: 'ADD COLUMN more_help_msg JSON NULL' },
];
async function repairs(c: import('mysql2/promise').PoolConnection, db: string): Promise<string[]> {
  const fixed: string[] = [];
  for (const r of REQUIRED) {
    const [has] = await c.query<RowDataPacket[]>('SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?', [db, r.table, r.column]);
    const [tab] = await c.query<RowDataPacket[]>('SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?', [db, r.table]);
    if (has.length || !tab.length) continue;
    await c.query(`ALTER TABLE ${ident(r.table)} ${r.add}`); fixed.push(`repaired ${r.table}.${r.column}`);
  }
  return fixed;
}
