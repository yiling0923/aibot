import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import { Pill } from '../ui';
import { useT } from '../i18n';

const TINTS: [string, string][] = [['#e3f1f3', '#0f6f78'], ['#efe9fb', '#6d3fc0'], ['#fdecdc', '#b45309'], ['#e2f3ea', '#177a4b'], ['#e8f1fb', '#2563a8'], ['#fbe6ee', '#be185d']];
/** A round badge with the first letters of a merchant's name, in a soft colour that stays the same for the same merchant. */
function Av({ name, seed }: { name: string; seed: string }) {
  let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = TINTS[h % TINTS.length]; const ini = name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return <span className="av" style={{ background: bg, color: fg }} aria-hidden="true">{ini}</span>;
}

interface Row { code: string; name: string; chats: number; calls: number; inputTokens: number; outputTokens: number; totalTokens: number; cost: number; charge: number; ownKeyCalls: number; ownKeyTokens: number; unpricedCalls: number; problem?: string }
interface Price { provider: 'anthropic' | 'openai'; model: string; inputPerMTok: number; outputPerMTok: number; updatedBy: string | null; updatedAt: string }
interface Report {
  from: string; to: string; markupPct: number; merchants: Row[]; totals: Omit<Row, 'code' | 'name'>;
  byKind: { kind: string; calls: number; totalTokens: number; cost: number }[];
  unpricedModels: { provider: string; model: string; calls: number; tokens: number }[]; prices: Price[];
}

const KIND: Record<string, string> = { pick: 'Finding the right answer', describe: 'Describing new keywords', translate: 'Translating answers', suggest: 'Suggesting example questions', draft: 'Drafting answers from staff replies', write: 'Rewording replies' };
const PROVIDER: Record<string, string> = { anthropic: 'Claude', openai: 'ChatGPT' };
const n0 = (n: number) => n.toLocaleString('en-US');
const calls = (n: number, T: (s: string, v?: Record<string, string | number>) => string) => T(n === 1 ? '{n} call' : '{n} calls', { n: n0(n) });
const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n > 0 && n < 0.01 ? 4 : 2 });
const pad = (n: number) => String(n).padStart(2, '0');
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

type Preset = 'this' | 'last' | '30' | 'custom';
function range(preset: Preset, custom: { from: string; to: string }) {
  const now = new Date();
  if (preset === 'this') return { from: day(new Date(now.getFullYear(), now.getMonth(), 1)), to: day(now) };
  if (preset === 'last') return { from: day(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: day(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (preset === '30') return { from: day(new Date(now.getTime() - 29 * 86400_000)), to: day(now) };
  return custom;
}

/** Usage and billing (admin only): what each merchant used the AI for, and what to charge for it. */
export default function Billing() {
  const { t: T } = useT();
  const [preset, setPreset] = useState<Preset>('this'); const [custom, setCustom] = useState(() => range('this', { from: '', to: '' }));
  const [r, setR] = useState<Report | null>(null); const [err, setErr] = useState('');
  const { from, to } = useMemo(() => range(preset, custom), [preset, custom]);
  const load = useCallback(async () => {
    try { setR(await api<Report>(`/api/admin/billing?from=${from}&to=${to}`)); setErr(''); } catch (e) { setErr((e as Error).message); }
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);
  const t = r?.totals;

  return (
    <>
      <div className="card"><div className="head"><div><h2>{T('Usage & billing')}</h2>
        <div className="sub">{T('What each merchant used the AI for in the period, and what to charge for it. Tokens are the words the AI reads and writes; the provider bills by the million.')}</div></div>
        <div className="tools"><div className="segs" role="group" aria-label={T('Period')}>
          {([['this', 'This month'], ['last', 'Last month'], ['30', 'Last 30 days'], ['custom', 'Choose dates']] as [Preset, string][]).map(([k, l]) => <button key={k} type="button" aria-pressed={preset === k} onClick={() => setPreset(k)}>{T(l)}</button>)}</div>
          <a className="btn dl" href={`/api/admin/billing.csv?from=${from}&to=${to}`}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>{T('Download CSV')}</a></div></div>
        {preset === 'custom' && <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <label className="fld"><span>{T('From')}</span><input type="date" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
          <label className="fld"><span>{T('To')}</span><input type="date" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label></div>}
        <div className="rangechip">{T('Showing')} <b>{from}</b> {T('to')} <b>{to}</b></div>
        {err && <div className="note" style={{ background: 'var(--badbg)' }}>{err}</div>}</div>

      {r && t && <>
        <div className="btiles">
          <Tile label={T('AI calls')} value={n0(t.calls)} note={T('{n} real chats', { n: n0(t.chats) })} tint="#7fa8e8" />
          <Tile label={T('Tokens')} value={n0(t.totalTokens)} note={T('{a} read · {b} written', { a: n0(t.inputTokens), b: n0(t.outputTokens) })} tint="#9b8bd8" />
          <Tile label={T('AI cost')} value={usd(t.cost)} note={T('paid to the AI provider on the shared key')} tint="#f0c27b" />
          <Tile label={T('To charge')} value={usd(t.charge)} note={T('cost + {n}% markup', { n: r.markupPct })} tint="var(--accent)" strong />
        </div>
        {r.unpricedModels.length > 0 && <div className="note" style={{ background: 'var(--warnbg)' }}>
          <b>{T('No price set for {m}.', { m: r.unpricedModels.map((m) => m.model).join(', ') })}</b> {T('Its tokens are counted, but its cost shows as $0.00 until you set the price below ({c} waiting).', { c: calls(r.unpricedModels.reduce((a, m) => a + m.calls, 0), T) })}</div>}

        <div className="card"><h3>{T('Per merchant')}</h3>
          <div style={{ overflowX: 'auto' }}><table style={{ marginTop: 8 }}>
            <thead><tr><th>{T('Merchant')}</th><th className="num">{T('Chats')}</th><th className="num">{T('AI calls')}</th><th className="num">{T('Tokens read')}</th><th className="num">{T('Tokens written')}</th><th className="num">{T('Total tokens')}</th><th className="num">{T('AI cost')}</th><th className="num">{T('To charge')}</th><th>{T('Notes')}</th></tr></thead>
            <tbody>
              {[...r.merchants].sort((a, b) => b.charge - a.charge || b.totalTokens - a.totalTokens || a.name.localeCompare(b.name)).map((m) => (
                <tr key={m.code} className={m.calls || m.chats === 0 ? '' : 'quiet'}><td><div className="mcell"><Av name={m.name} seed={m.code} /><div><b>{m.name}</b> <span className="mono sub">{m.code}</span></div></div></td>
                  <td className="num">{n0(m.chats)}</td><td className="num">{n0(m.calls)}</td><td className="num">{n0(m.inputTokens)}</td><td className="num">{n0(m.outputTokens)}</td><td className="num">{n0(m.totalTokens)}</td>
                  <td className="num">{usd(m.cost)}</td><td className="num"><b>{usd(m.charge)}</b></td>
                  <td>{m.ownKeyCalls > 0 && <Pill c="info" title={T("These calls used the merchant's own AI key, so the merchant pays the AI provider for them. They are not in AI cost or To charge.")}>{T('Own key')}: {calls(m.ownKeyCalls, T)}</Pill>}{m.unpricedCalls > 0 && <> <Pill c="warn">{calls(m.unpricedCalls, T)} {T('not priced')}</Pill></>}{m.problem && <> <Pill c="bad" title={m.problem}>{T('Chats not counted')}</Pill></>}</td></tr>
              ))}
              <tr style={{ fontWeight: 700 }}><td>{T('Total')}</td><td className="num">{n0(t.chats)}</td><td className="num">{n0(t.calls)}</td><td className="num">{n0(t.inputTokens)}</td><td className="num">{n0(t.outputTokens)}</td><td className="num">{n0(t.totalTokens)}</td><td className="num">{usd(t.cost)}</td><td className="num">{usd(t.charge)}</td><td /></tr>
            </tbody></table></div>
          {!t.calls && <div className="note" style={{ marginTop: 10 }}><b>{T('No AI used in this period.')}</b> {T('The bot only uses the AI when a message matches no keyword, when a new keyword is described, or when you translate an answer, and only for merchants with an AI key.')}</div>}</div>

        {r.byKind.length > 0 && <div className="card"><h3>{T('What the AI was used for')}</h3>
          <table style={{ marginTop: 8 }}><thead><tr><th>{T('Use')}</th><th className="num">{T('Calls')}</th><th className="num">{T('Tokens')}</th><th className="num">{T('Cost')}</th></tr></thead>
            <tbody>{r.byKind.map((k) => <tr key={k.kind}><td>{T(KIND[k.kind] ?? k.kind)}</td><td className="num">{n0(k.calls)}</td><td className="num">{n0(k.totalTokens)}</td><td className="num">{usd(k.cost)}</td></tr>)}</tbody></table></div>}

        <div className="card pricing"><h3>{T('Pricing')}</h3>
          <Markup pct={r.markupPct} onSaved={load} />
          <Prices prices={r.prices} onChanged={load} /></div>
      </>}
    </>
  );
}

function Tile({ label, value, note, tint, strong }: { label: string; value: string; note: string; tint: string; strong?: boolean }) {
  return (
    <div className={'rptile' + (strong ? ' strong' : '')}><i style={{ background: tint }} /><small>{label}</small><b>{value}</b><span>{note}</span></div>
  );
}

function Markup({ pct, onSaved }: { pct: number; onSaved: () => Promise<void> }) {
  const p = usePanel(); const { t: T } = useT(); const [v, setV] = useState(String(pct)); useEffect(() => setV(String(pct)), [pct]);
  const save = async () => { try { await api('/api/admin/billing/markup', { pct: Number(v) }); await onSaved(); p.toast(T('Markup saved')); } catch (e) { p.toast((e as Error).message); } };
  return (
    <div className="psec"><h4>{T('Markup')}</h4>
      <div className="sub">{T('The extra percent added to the AI cost when you charge a merchant. 0 charges exactly what the provider charged you. It applies to the whole period shown, including past days.')}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <input type="number" min="0" max="1000" step="0.5" value={v} onChange={(e) => setV(e.target.value)} style={{ width: 110 }} aria-label={T('Markup percent')} /> %
        <button className="btn pri" type="button" disabled={v === '' || Number(v) === pct} onClick={save}>{T('Save markup')}</button></div></div>
  );
}

function Prices({ prices, onChanged }: { prices: Price[]; onChanged: () => Promise<void> }) {
  const p = usePanel(); const { t: T } = useT(); const [draft, setDraft] = useState<Record<string, { inp: string; out: string }>>({});
  const [add, setAdd] = useState({ provider: 'anthropic', model: '', inp: '', out: '' });
  const key = (x: { provider: string; model: string }) => x.provider + '|' + x.model;
  const save = async (provider: string, model: string, inp: string, out: string) => {
    try { await api('/api/admin/billing/price', { provider, model, inputPerMTok: Number(inp), outputPerMTok: Number(out) }); setDraft({}); await onChanged(); p.toast(T('Price saved')); } catch (e) { p.toast((e as Error).message); }
  };
  const remove = async (x: Price) => {
    if (!confirm(T('Remove the price of {m}? Its calls will show no cost until you set a price again.', { m: x.model }))) return;
    try { await api('/api/admin/billing/price/remove', { provider: x.provider, model: x.model }); await onChanged(); } catch (e) { p.toast((e as Error).message); }
  };
  return (
    <div className="psec"><h4>{T('Prices per model')}</h4>
      <div className="sub">{T("US dollars per million tokens, as the AI provider publishes them. Check them against the provider's current price list: the starting prices were copied once and can go out of date. A price applies to calls from the moment you save it; earlier calls keep the price they had.")}</div>
      <div style={{ overflowX: 'auto' }}><table style={{ marginTop: 8 }}>
        <thead><tr><th>{T('Provider')}</th><th>{T('Model')}</th><th className="num">{T('Read (per 1M)')}</th><th className="num">{T('Written (per 1M)')}</th><th>{T('Last changed')}</th><th /></tr></thead>
        <tbody>
          {prices.map((x) => {
            const d = draft[key(x)] ?? { inp: String(x.inputPerMTok), out: String(x.outputPerMTok) }; const changed = d.inp !== String(x.inputPerMTok) || d.out !== String(x.outputPerMTok);
            return (
              <tr key={key(x)}><td>{PROVIDER[x.provider]}</td><td className="mono">{x.model}</td>
                <td className="num"><input type="number" min="0" step="0.01" value={d.inp} aria-label={T('{m} read price', { m: x.model })} style={{ width: 90 }} onChange={(e) => setDraft({ ...draft, [key(x)]: { ...d, inp: e.target.value } })} /></td>
                <td className="num"><input type="number" min="0" step="0.01" value={d.out} aria-label={T('{m} written price', { m: x.model })} style={{ width: 90 }} onChange={(e) => setDraft({ ...draft, [key(x)]: { ...d, out: e.target.value } })} /></td>
                <td className="sub">{x.updatedBy ?? ''} {new Date(x.updatedAt).toLocaleDateString()}</td>
                <td style={{ whiteSpace: 'nowrap' }}><button className="btn sm pri" type="button" disabled={!changed} onClick={() => void save(x.provider, x.model, d.inp, d.out)}>{T('Save')}</button> <button className="btn sm" type="button" onClick={() => void remove(x)}>{T('Remove')}</button></td></tr>
            );
          })}
        </tbody></table></div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="fld"><span>{T('Provider')}</span><select value={add.provider} onChange={(e) => setAdd({ ...add, provider: e.target.value })}><option value="anthropic">Claude</option><option value="openai">ChatGPT</option></select></label>
        <label className="fld"><span>{T('Model name')}</span><input placeholder={T('e.g. claude-haiku-5-5')} value={add.model} onChange={(e) => setAdd({ ...add, model: e.target.value.trim() })} /></label>
        <label className="fld"><span>{T('Read, per 1M')}</span><input type="number" min="0" step="0.01" value={add.inp} style={{ width: 100 }} onChange={(e) => setAdd({ ...add, inp: e.target.value })} /></label>
        <label className="fld"><span>{T('Written, per 1M')}</span><input type="number" min="0" step="0.01" value={add.out} style={{ width: 100 }} onChange={(e) => setAdd({ ...add, out: e.target.value })} /></label>
        <button className="btn pri" type="button" disabled={!add.model || add.inp === '' || add.out === ''} onClick={async () => { await save(add.provider, add.model, add.inp, add.out); setAdd({ ...add, model: '', inp: '', out: '' }); }}>{T('Add price')}</button></div></div>
  );
}
