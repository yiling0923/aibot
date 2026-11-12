import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from './pool';
import { Tenants } from './tenants';

/** What a wipe would destroy, in words, or null when the database is empty. Used by the commands that erase and re-create the sample data. */
export async function whatWouldBeLost(pool: Pool): Promise<string | null> {
  const dbs = await new Tenants(pool).allMerchantDbs();
  let merchants = 0;
  try { merchants = Number((await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM merchants'))[0][0].n); } catch { /* no table yet: nothing to lose there */ }
  if (!dbs.length && !merchants) return null;
  return `${merchants} merchant${merchants === 1 ? '' : 's'} and ${dbs.length} merchant database${dbs.length === 1 ? '' : 's'} (their knowledge bases, keywords, chats, settings and history), plus the logins and bot keys`;
}

/** Stops a wipe command unless the person added --force. Returns true when it is fine to go on. */
export async function allowWipe(pool: Pool, command: string, argv = process.argv): Promise<boolean> {
  if (argv.includes('--force')) return true;
  const lost = await whatWouldBeLost(pool);
  if (!lost) return true;
  console.error(`\nStopped. "${command}" erases this database and loads the sample data again.\nIt would delete ${lost}.\n\nIf you really want that, run it again with --force:  npm run ${command} -- --force\nTo keep your data, do not run it. (Start the bot with npm run dev, and update the database with npm run db:migrate.)\n`);
  process.exitCode = 1; return false;
}
