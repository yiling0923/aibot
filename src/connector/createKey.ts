import 'dotenv/config';
import { getPool, closePool } from '../db/pool';
import { issueKey } from './keys';

/** npm run key:create -- MERCH_A   makes a bot API key for a merchant (the old keys keep working; add --replace to stop them). */
const [code, ...flags] = process.argv.slice(2);
if (!code) { console.error('Usage: npm run key:create -- <MERCHANT_CODE> [--replace]'); process.exit(1); }
issueKey(getPool(), code.toUpperCase(), { createdBy: 'command line', replace: flags.includes('--replace') })
  .then((r) => { console.log(`Bot API key for ${code.toUpperCase()} (shown once, copy it now):\n\n  ${r.key}\n\nPut it in LiveChat: Merchant Admin > Automation > AI Chat API key.`); })
  .catch((e) => { console.error((e as Error).message); process.exitCode = 1; })
  .finally(closePool);
