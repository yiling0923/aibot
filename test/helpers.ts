import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
export const seedJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'kb_seed.json'), 'utf8'));
export const accountsJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'fake_accounts.json'), 'utf8'));
export const evalCases: { merchant: string; message: string; language: string; expected_decision: string; expected_intent: string | null }[] = seedJson.eval_cases;

/** The same check the mockup used: the decision must match, and for ANSWER also the chosen entry. */
export function judge(r: { decision: string; top: { intent: string } }, c: { expected_decision: string; expected_intent: string | null }) {
  return r.decision === c.expected_decision && (c.expected_decision !== 'ANSWER' || r.top.intent === c.expected_intent);
}
