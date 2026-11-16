import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';
import type { SessionUser } from '../auth/session';
import { Tenants, ident, tbl } from '../db/tenants';
import { readSnapshot, type Snapshot, type SnapEntry, type SnapSettings, type Words } from './snapshot';

/** Publish history is kept per merchant, so every merchant publishes and rolls back on its own.
 *  The word lists shared by all merchants have a history of their own ("shared"). */
export interface MerchantSlice { kb: SnapEntry[]; mAliases: Snapshot['mAliases'][string]; settings: SnapSettings }
export interface SharedSlice { aliases: Words; aspects: Words; smalltalk: Words; guard: Words; fillers: Snapshot['fillers'] }
export type Scope = { kind: 'merchant'; code: string } | { kind: 'shared' };

const q = async <T extends RowDataPacket = RowDataPacket>(pool: Pool, sql: string, p: unknown[] = []) => (await pool.query<T[]>(sql, p))[0];
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

export const merchantSlice = (s: Snapshot, code: string): MerchantSlice => ({ kb: s.kb.filter((e) => e.merchant === code), mAliases: s.mAliases[code] ?? [], settings: s.settings[code] });
export const sharedSlice = (s: Snapshot): SharedSlice => ({ aliases: s.aliases, aspects: s.aspects, smalltalk: s.smalltalk, guard: s.guard, fillers: s.fillers });

/** Puts a saved merchant slice into a snapshot (a copy is returned). */
export function withMerchantSlice(s: Snapshot, code: string, slice: MerchantSlice): Snapshot {
  const out = clone(s);
  out.kb = [...out.kb.filter((e) => e.merchant !== code), ...slice.kb.map((e) => ({ ...e, merchant: code }))];
  out.mAliases[code] = slice.mAliases; out.settings[code] = slice.settings;
  return out;
}
export function withSharedSlice(s: Snapshot, slice: SharedSlice): Snapshot {
  return { ...clone(s), aliases: slice.aliases, aspects: slice.aspects, smalltalk: slice.smalltalk, guard: slice.guard, fillers: slice.fillers };
}

/* ---------- has anything really changed? (ids, update times, empty languages and key order do not count) ---------- */
const sortKeys = (v: unknown): unknown => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sortKeys(x)])) : v;
const words = (w: Words | Record<string, string[]>): unknown => Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Array.isArray(v) ? v : words(v as Words)])
  .filter(([, v]) => (Array.isArray(v) ? v.length : Object.keys(v as object).length)));
const texts = (m: Record<string, string> | undefined) => Object.fromEntries(Object.entries(m ?? {}).filter(([, v]) => v));
const sig = (v: unknown) => JSON.stringify(sortKeys(v));
export const merchantSig = (sl: MerchantSlice) => sig({
  kb: sl.kb.map((e) => ({ k: e.intent_key, c: e.category, t: e.topic, a: e.aspect || null, o: !!e.topic_optional, s: e.status,
    tr: Object.fromEntries(Object.entries(e.translations).filter(([, t]) => t && ((t.answer_text || '').trim() || (t.question_examples || []).length))) })).sort((a, b) => (a.k < b.k ? -1 : 1)),
  m: sl.mAliases.map((a) => `${a.language}|${a.variant}|${a.canonical}`).sort(),
  s: { ...sl.settings, kind: texts(sl.settings?.kind), closing: texts(sl.settings?.closing), handoff: texts(sl.settings?.handoff), more_help: texts(sl.settings?.more_help) },
});
export const sharedSig = (sl: SharedSlice) => sig({ a: words(sl.aliases), s: words(sl.aspects), t: words(sl.smalltalk), g: words(sl.guard), f: words(sl.fillers) });

/* ---------- reading and writing versions ---------- */
/** A merchant's versions are in its own database (table versions); the shared lists' versions are in the main database (shared_versions). */
async function place(pool: Pool, scope: Scope): Promise<string> {
  if (scope.kind === 'shared') return ident('shared_versions');
  const t = await new Tenants(pool).get(scope.code);
  if (!t) throw new Error(`unknown merchant ${scope.code}`);
  return tbl(t.db, 'versions');
}
const latest = async (pool: Pool, scope: Scope) => Number((await q(pool, `SELECT COALESCE(MAX(version), 0) AS v FROM ${await place(pool, scope)}`))[0].v);

/** Saves a new version for one merchant (or the shared lists) and returns its number. */
export async function recordVersion(pool: Pool, scope: Scope, actor: string, summary: string, slice: MerchantSlice | SharedSlice): Promise<number> {
  const ver = (await latest(pool, scope)) + 1;
  await pool.query(`INSERT INTO ${await place(pool, scope)}(version, actor, summary, snapshot) VALUES(?,?,?,?)`, [ver, actor, summary.slice(0, 500), JSON.stringify(slice)]);
  return ver;
}

/** Reads one saved version (the data it holds), or null. */
export async function readVersion(pool: Pool, scope: Scope, version: number): Promise<{ version: number; snapshot: string } | null> {
  const [r] = await q(pool, `SELECT version, snapshot FROM ${await place(pool, scope)} WHERE version = ?`, [version]);
  return r ? { version: Number(r.version), snapshot: r.snapshot as string } : null;
}

/** Every merchant and the shared lists get a first version, so there is always something to roll back to. */
export async function ensureVersions(pool: Pool): Promise<void> {
  let snap: Snapshot | null = null;
  for (const t of await new Tenants(pool).list()) {
    if (await latest(pool, { kind: 'merchant', code: t.code })) continue;
    snap ??= await readSnapshot(pool);
    if (snap.settings[t.code]) await recordVersion(pool, { kind: 'merchant', code: t.code }, 'system', 'Template data loaded', merchantSlice(snap, t.code));
  }
  if (!(await latest(pool, { kind: 'shared' }))) await recordVersion(pool, { kind: 'shared' }, 'system', 'Template data loaded', sharedSlice(snap ?? (await readSnapshot(pool))));
}

export interface HistoryRow { kind: 'merchant' | 'shared'; merchant: string | null; version: number; actor: string; summary: string; created_at: Date }

/** The live version of each merchant a person may see (and of the shared lists, for an admin), plus the history rows. */
export async function versionState(pool: Pool, user: SessionUser, codes: string[]) {
  const versions: Record<string, number> = {}; const history: HistoryRow[] = [];
  for (const code of codes) {
    const D = await place(pool, { kind: 'merchant', code });
    versions[code] = await latest(pool, { kind: 'merchant', code });
    for (const r of await q(pool, `SELECT version, actor, summary, created_at FROM ${D} ORDER BY version DESC LIMIT 50`)) history.push({ kind: 'merchant', merchant: code, version: Number(r.version), actor: r.actor, summary: r.summary, created_at: r.created_at });
  }
  let sharedVer: number | null = null;
  if (user.role === 'admin') {
    sharedVer = await latest(pool, { kind: 'shared' });
    for (const r of await q(pool, 'SELECT version, actor, summary, created_at FROM shared_versions ORDER BY version DESC LIMIT 50')) history.push({ kind: 'shared', merchant: null, version: Number(r.version), actor: r.actor, summary: r.summary, created_at: r.created_at });
  }
  history.sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b.version - a.version);
  return { versions, sharedVer, stamp: JSON.stringify([versions, sharedVer]), history: history.slice(0, 200) };
}
