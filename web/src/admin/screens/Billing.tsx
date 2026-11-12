import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import { Pill } from '../ui';

interface Row { code: string; name: string; chats: number; calls: number; inputTokens: number; outputTokens: number; totalTokens: number; cost: number; charge: number; ownKeyCalls: number; ownKeyTokens: number; unpricedCalls: number }
interface Price { provider: 'anthropic' | 'openai'; model: string; inputPerMTok: number; outputPerMTok: number; updatedBy: string | null; updatedAt: string }
interface Report {
  from: string; to: string; markupPct: number; merchants: Row[]; totals: Omit<Row, 'code' | 'name'>;
  byKind: { kind: string; calls: number; totalTokens: number; cost: number }[];
  unpricedModels: { provider: string; model: string; calls: number; tokens: number }[]; prices: Price[];
}

const KIND: Record<string, string> = { pick: 'Finding the right answer', describe: 'Describing new keywords', translate: 'Translating answers', write: 'Rewording replies' };
const PROVIDER: Record<string, string> = { anthropic: 'Claude', openai: 'ChatGPT' };
const n0 = (n: number) => n.toLocaleString('en-US');
const calls = (n: number) => `${n0(n)} call${n === 1 ? '' : 's'}`;
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
      <div className="card"><div className="head"><div><h2>Usage &amp; billing</h2>
        <div className="sub">What each merchant used the AI for in the period, and what to charge for it. Tokens are the words the AI reads and writes; the provider bills by the million.</div></div>
        <div className="tools"><div className="segs" role="group" aria-label="Period">
          {([['this', 'This month'], ['last', 'Last month'], ['30', 'Last 30 days'], ['custom', 'Choose dates']] as [Preset, string][]).map(([k, l]) => <button key={k} type="button" aria-pressed={preset === k} onClick={() => setPreset(k)}>{l}</button>)}</div>
          <a className="btn" style={{ textDecoration: 'none', color: 'inherit' }} href={`/api/admin/billing.csv?from=${from}&to=${to}`}>Download CSV</a></div></div>
        {preset === 'custom' && <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <label className="fld"><span>From</span><input type="date" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
          <label className="fld"><span>To</span><input type="date" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label></div>}
        <div className="sub" style={{ marginTop: 8 }}>Showing {from} to {to}.</div>
        {err && <div className="note" style={{ background: 'var(--badbg)' }}>{err}</div>}</div>

      {r && t && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <Tile label="AI calls" value={n0(t.calls)} note={`${n0(t.chats)} real chats`} />
          <Tile label="Tokens" value={n0(t.totalTokens)} note={`${n0(t.inputTokens)} read · ${n0(t.outputTokens)} written`} />
          <Tile label="AI cost" value={usd(t.cost)} note="paid to the AI provider on the shared key" />
          <Tile label="To charge" value={usd(t.charge)} note={`cost + ${r.markupPct}% markup`} strong />
        </div>
        {r.unpricedModels.length > 0 && <div className="note" style={{ background: 'var(--warnbg)' }}>
          <b>No price set for {r.unpricedModels.map((m) => m.model).join(', ')}.</b> Its tokens are counted, but its cost shows as $0.00 until you set the price below ({calls(r.unpricedModels.reduce((a, m) => a + m.calls, 0))} waiting).</div>}

        <div className="card"><h3>Per merchant</h3>
          <div style={{ overflowX: 'auto' }}><table style={{ marginTop: 8 }}>
            <thead><tr><th>Merchant</th><th className="num">Chats</th><th className="num">AI calls</th><th className="num">Tokens read</th><th className="num">Tokens written</th><th className="num">Total tokens</th><th className="num">AI cost</th><th className="num">To charge</th><th>Notes</th></tr></thead>
            <tbody>
              {r.merchants.map((m) => (
                <tr key={m.code}><td><b>{m.name}</b> <span className="mono sub">{m.code}</span></td>
                  <td className="num">{n0(m.chats)}</td><td className="num">{n0(m.calls)}</td><td className="num">{n0(m.inputTokens)}</td><td className="num">{n0(m.outputTokens)}</td><td className="num">{n0(m.totalTokens)}</td>
                  <td className="num">{usd(m.cost)}</td><td className="num"><b>{usd(m.charge)}</b></td>
                  <td>{m.ownKeyCalls > 0 && <Pill c="info" title="These calls used the merchant's own AI key, so the merchant pays the AI provider for them. They are not in AI cost or To charge.">Own key: {calls(m.ownKeyCalls)}</Pill>}{m.unpricedCalls > 0 && <> <Pill c="warn">{calls(m.unpricedCalls)} not priced</Pill></>}</td></tr>
              ))}
              <tr style={{ fontWeight: 700 }}><td>Total</td><td className="num">{n0(t.chats)}</td><td className="num">{n0(t.calls)}</td><td className="num">{n0(t.inputTokens)}</td><td className="num">{n0(t.outputTokens)}</td><td className="num">{n0(t.totalTokens)}</td><td className="num">{usd(t.cost)}</td><td className="num">{usd(t.charge)}</td><td /></tr>
            </tbody></table></div>
          {!t.calls && <div className="sub" style={{ marginTop: 8 }}>No AI calls in this period. The bot only uses the AI when a message matches no keyword, when a new keyword is described, or when you translate an answer, and only for merchants with an AI key.</div>}</div>

        {r.byKind.length > 0 && <div className="card"><h3>What the AI was used for</h3>
          <table style={{ marginTop: 8 }}><thead><tr><th>Use</th><th className="num">Calls</th><th className="num">Tokens</th><th className="num">Cost</th></tr></thead>
            <tbody>{r.byKind.map((k) => <tr key={k.kind}><td>{KIND[k.kind] ?? k.kind}</td><td className="num">{n0(k.calls)}</td><td className="num">{n0(k.totalTokens)}</td><td className="num">{usd(k.cost)}</td></tr>)}</tbody></table></div>}

        <Markup pct={r.markupPct} onSaved={load} />
        <Prices prices={r.prices} onChanged={load} />
      </>}
    </>
  );
}

function Tile({ label, value, note, strong }: { label: string; value: string; note: string; strong?: boolean }) {
  return (
    <div className="card" style={{ margin: 0, ...(strong ? { borderColor: 'var(--accent)' } : null) }}>
      <div className="sub">{label}</div><div style={{ fontSize: 26, fontWeight: 700, margin: '2px 0' }}>{value}</div><div className="sub">{note}</div>
    </div>
  );
}

function Markup({ pct, onSaved }: { pct: number; onSaved: () => Promise<void> }) {
  const p = usePanel(); const [v, setV] = useState(String(pct)); useEffect(() => setV(String(pct)), [pct]);
  const save = async () => { try { await api('/api/admin/billing/markup', { pct: Number(v) }); await onSaved(); p.toast('Markup saved'); } catch (e) { p.toast((e as Error).message); } };
  return (
    <div className="card"><h3>Markup</h3>
      <div className="sub">The extra percent added to the AI cost when you charge a merchant. 0 charges exactly what the provider charged you. It applies to the whole period shown, including past days.</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <input type="number" min="0" max="1000" step="0.5" value={v} onChange={(e) => setV(e.target.value)} style={{ width: 110 }} aria-label="Markup percent" /> %
        <button className="btn pri" type="button" disabled={v === '' || Number(v) === pct} onClick={save}>Save markup</button></div></div>
  );
}

function Prices({ prices, onChanged }: { prices: Price[]; onChanged: () => Promise<void> }) {
  const p = usePanel(); const [draft, setDraft] = useState<Record<string, { inp: string; out: string }>>({});
  const [add, setAdd] = useState({ provider: 'anthropic', model: '', inp: '', out: '' });
  const key = (x: { provider: string; model: string }) => x.provider + '|' + x.model;
  const save = async (provider: string, model: string, inp: string, out: string) => {
    try { await api('/api/admin/billing/price', { provider, model, inputPerMTok: Number(inp), outputPerMTok: Number(out) }); setDraft({}); await onChanged(); p.toast('Price saved'); } catch (e) { p.toast((e as Error).message); }
  };
  const remove = async (x: Price) => {
    if (!confirm(`Remove the price of ${x.model}? Its calls will show no cost until you set a price again.`)) return;
    try { await api('/api/admin/billing/price/remove', { provider: x.provider, model: x.model }); await onChanged(); } catch (e) { p.toast((e as Error).message); }
  };
  return (
    <div className="card"><h3>Prices</h3>
      <div className="sub">US dollars per million tokens, as the AI provider publishes them. Check them against the provider's current price list: the starting prices were copied once and can go out of date. A price applies to calls from the moment you save it; earlier calls keep the price they had.</div>
      <div style={{ overflowX: 'auto' }}><table style={{ marginTop: 8 }}>
        <thead><tr><th>Provider</th><th>Model</th><th className="num">Read (per 1M)</th><th className="num">Written (per 1M)</th><th>Last changed</th><th /></tr></thead>
        <tbody>
          {prices.map((x) => {
            const d = draft[key(x)] ?? { inp: String(x.inputPerMTok), out: String(x.outputPerMTok) }; const changed = d.inp !== String(x.inputPerMTok) || d.out !== String(x.outputPerMTok);
            return (
              <tr key={key(x)}><td>{PROVIDER[x.provider]}</td><td className="mono">{x.model}</td>
                <td className="num"><input type="number" min="0" step="0.01" value={d.inp} aria-label={x.model + ' read price'} style={{ width: 90 }} onChange={(e) => setDraft({ ...draft, [key(x)]: { ...d, inp: e.target.value } })} /></td>
                <td className="num"><input type="number" min="0" step="0.01" value={d.out} aria-label={x.model + ' written price'} style={{ width: 90 }} onChange={(e) => setDraft({ ...draft, [key(x)]: { ...d, out: e.target.value } })} /></td>
                <td className="sub">{x.updatedBy ?? ''} {new Date(x.updatedAt).toLocaleDateString()}</td>
                <td style={{ whiteSpace: 'nowrap' }}><button className="btn sm pri" type="button" disabled={!changed} onClick={() => void save(x.provider, x.model, d.inp, d.out)}>Save</button> <button className="btn sm" type="button" onClick={() => void remove(x)}>Remove</button></td></tr>
            );
          })}
        </tbody></table></div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="fld"><span>Provider</span><select value={add.provider} onChange={(e) => setAdd({ ...add, provider: e.target.value })}><option value="anthropic">Claude</option><option value="openai">ChatGPT</option></select></label>
        <label className="fld"><span>Model name</span><input placeholder="e.g. claude-haiku-5-5" value={add.model} onChange={(e) => setAdd({ ...add, model: e.target.value.trim() })} /></label>
        <label className="fld"><span>Read, per 1M</span><input type="number" min="0" step="0.01" value={add.inp} style={{ width: 100 }} onChange={(e) => setAdd({ ...add, inp: e.target.value })} /></label>
        <label className="fld"><span>Written, per 1M</span><input type="number" min="0" step="0.01" value={add.out} style={{ width: 100 }} onChange={(e) => setAdd({ ...add, out: e.target.value })} /></label>
        <button className="btn pri" type="button" disabled={!add.model || add.inp === '' || add.out === ''} onClick={async () => { await save(add.provider, add.model, add.inp, add.out); setAdd({ ...add, model: '', inp: '', out: '' }); }}>Add price</button></div></div>
  );
}
