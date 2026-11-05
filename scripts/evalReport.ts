import { Engine, knowledgeFromSeed } from '../src/engine';
import fs from 'node:fs';

/** Runs every sample message from data/kb_seed.json through the engine and prints the ones that give a different result than expected.
 *    npm run eval:report            all failures
 *    npm run eval:report -- MERCH_D one merchant */
const seed = JSON.parse(fs.readFileSync('data/kb_seed.json', 'utf8'));
const accounts = JSON.parse(fs.readFileSync('data/fake_accounts.json', 'utf8'));
const engine = new Engine(knowledgeFromSeed(seed, accounts));
const only = process.argv[2];
let bad = 0, total = 0;
const byMerchant: Record<string, [number, number]> = {};
for (const c of seed.eval_cases as { merchant: string; message: string; expected_decision: string; expected_intent: string | null }[]) {
  if (only && c.merchant !== only) continue;
  total++;
  const r = engine.analyze(c.message, c.merchant, 0);
  const ok = r.decision === c.expected_decision && (c.expected_decision !== 'ANSWER' || r.top.intent === c.expected_intent);
  const m = (byMerchant[c.merchant] ??= [0, 0]); m[1]++;
  if (ok) { m[0]++; continue; }
  bad++;
  console.log(`${c.merchant}  "${c.message}"\n    wanted ${c.expected_decision}${c.expected_intent ? ' ' + c.expected_intent : ''}  got ${r.decision}${r.decision === 'ANSWER' ? ' ' + r.top.intent : ''}${r.topic ? '  topic=' + r.topic : ''}  [T=${r.ks.T.join(',')} A=${r.ks.A.join(',')}]`);
}
console.log(`\n${total - bad} of ${total} pass`, Object.entries(byMerchant).map(([k, v]) => `${k} ${v[0]}/${v[1]}`).join('  '));
process.exitCode = bad ? 1 : 0;
