import { getPool, closePool } from '../db/pool';
import { upsertUser } from './users';

/**
 * Creates a login, or changes the password of an existing one.
 *   npm run user:add -- <username> <password> admin
 *   npm run user:add -- <username> <password> staff <MERCHANT_CODE>
 */
const [username, password, role, merchant] = process.argv.slice(2);
if (!username || !password || (role !== 'admin' && role !== 'staff') || (role === 'staff' && !merchant)) {
  console.error('Usage:\n  npm run user:add -- <username> <password> admin\n  npm run user:add -- <username> <password> staff <MERCHANT_CODE>');
  process.exit(1);
}
upsertUser(getPool(), { username, password, role, merchant })
  .then(() => console.log(`saved ${role} "${username.toLowerCase()}"${role === 'staff' ? ` for merchant ${merchant}` : ''}`))
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(closePool);
