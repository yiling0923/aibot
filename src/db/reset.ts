import { closePool, getPool } from './pool';
import { migrate } from './migrate';
import { seed } from './seed';
import { allowWipe } from './guard';

/** npm run db:reset -- --force : erase everything and load the 6 sample merchants again. Refuses to run when there is data, unless --force is given. */
const pool = getPool();
try {
  if (await allowWipe(pool, 'db:reset')) {
    console.log(await migrate(pool, { reset: true }));
    console.log('seeded', await seed(pool));
  }
} catch (e) { console.error(e); process.exitCode = 1; } finally { await closePool(); }
