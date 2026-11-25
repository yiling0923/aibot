import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import { LANG_NAMES } from '../model';
import { COUNTRIES, countryOf, guessCountry } from '../countries';
import { useTranslateJobs } from './TranslateAll';
import { useT } from '../i18n';

interface Basics { currency: string; defaultLanguage: string; languages: string[]; country: string | null; autoTranslate: boolean }

/** Knowledge base → Languages: the country, the language staff type in, the languages the merchant uses, and automatic translation. Only an admin changes them. */
export default function KbLanguages({ onTranslateAll }: { onTranslateAll: () => void }) {
  const p = usePanel(); const { t, lang } = useT(); const zh = lang === 'zh'; const lock = !p.isAdmin;
  const [b, setB] = useState<Basics | null>(null); const [f, setF] = useState<Basics | null>(null); const [busy, setBusy] = useState(false);
  const { count, total } = useTranslateJobs();
  const load = useCallback(async () => {
    try { const x = await api<Basics>(`/api/admin/merchants/${encodeURIComponent(p.merchant)}/basics`); setB(x); setF({ currency: x.currency, defaultLanguage: x.defaultLanguage, languages: x.languages, country: x.country, autoTranslate: x.autoTranslate }); } catch (e) { p.toast((e as Error).message); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.merchant]);
  useEffect(() => { setB(null); setF(null); void load(); }, [load]);
  if (!b || !f) return <div className="card"><div className="sub">{t('Loading…')}</div></div>;

  const cty = countryOf(f.country); const guess = !f.country ? guessCountry(f.currency) : undefined;
  const set = (patch: Partial<Basics>) => setF({ ...f, ...patch });
  const on = new Set(f.languages);
  const toggle = (l: string) => { if (lock || l === f.defaultLanguage) return; const n = new Set(on); if (n.has(l)) n.delete(l); else n.add(l); set({ languages: [...n] }); };
  /** Choosing a country sets its usual main language and ticks its usual languages. You can still change both. */
  const setCountry = (code: string | null) => {
    const c = countryOf(code); if (!c) return set({ country: code });
    setF({ ...f, country: code, defaultLanguage: c.langs[0], languages: [...new Set([...c.langs, c.langs[0]])] });
  };
  const setSource = (l: string) => set({ defaultLanguage: l, languages: [...new Set([...f.languages, l])] });
  const dirty = JSON.stringify([f.country, f.defaultLanguage, [...f.languages].sort(), f.autoTranslate]) !== JSON.stringify([b.country, b.defaultLanguage, [...b.languages].sort(), b.autoTranslate]);
  const suggest = cty?.langs ?? [];
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/merchants/${encodeURIComponent(p.merchant)}/basics`, { country: f.country, defaultLanguage: f.defaultLanguage, languages: f.languages, autoTranslate: f.autoTranslate });
      await p.reloadAll(); await load(); p.toast(t('Languages saved'));
    } catch (e) { p.toast((e as Error).message); } finally { setBusy(false); }
  };
  const cName = (c: { name: string; zh: string }) => (zh ? c.zh : c.name);
  return (
    <div className="card kblang">
      <h3>{t('Languages for {m}', { m: p.M.name })}</h3>
      <div className="sub">{t("Tick the languages this merchant's customers use. You type in the source language, and the others are filled in for you.")}</div>
      <div className="klrow">
        <label className="fld"><span>{t('Country')}</span><select value={f.country ?? ''} disabled={lock} onChange={(e) => setCountry(e.target.value || null)}><option value="">{t('Not chosen')}</option>{COUNTRIES.map((c) => <option key={c.code} value={c.code}>{cName(c)}</option>)}</select></label>
        <label className="fld"><span>{t('Timezone')}</span><input readOnly value={cty ? `${cty.tz} · ${cty.utc}` : '—'} aria-label={t('Timezone')} /></label>
        <label className="fld"><span>{t('Source language (your staff type in)')}</span><select value={f.defaultLanguage} disabled={lock} onChange={(e) => setSource(e.target.value)}>{LANG_NAMES.map(([k, n]) => <option key={k} value={k}>{t(n)}</option>)}</select></label></div>
      {guess && !lock && <div className="sub">{t('Suggested from the money sign ({c}): {n}.', { c: f.currency, n: cName(guess) })} <button className="btn sm" type="button" onClick={() => set({ country: guess.code })}>{t('Use {n}', { n: cName(guess) })}</button></div>}
      <div className="mlbl" style={{ marginTop: 16 }}>{t('Translate into')}{cty && !lock && suggest.length > 0 && <> <button className="btn sm" type="button" title={t('Tick the languages that usually fit this country')} onClick={() => set({ languages: [...new Set([...suggest, f.defaultLanguage])] })}>{t('{n} suggests {l}', { n: cName(cty), l: suggest.map((x) => x.toUpperCase()).join(' · ') })}</button></>}</div>
      <div className="klgrid" role="group" aria-label={t('Languages')}>{LANG_NAMES.map(([k, n]) => <button key={k} type="button" className={'kllang' + (on.has(k) ? ' on' : '')} aria-pressed={on.has(k)} disabled={lock} onClick={() => toggle(k)}><span className="klbox" aria-hidden="true">{on.has(k) ? '✓' : ''}</span><b>{t(n)}</b>{k === f.defaultLanguage && <span className="sub">{t('source')}</span>}</button>)}</div>
      <div className="klset"><div><b>{t('Translate automatically')}</b><div className="sub">{t('When you save an entry, the empty languages are filled by the AI. Text a person wrote is never overwritten. The new texts are marked “AI draft”.')}</div></div>
        <label className="switch"><input type="checkbox" role="switch" aria-label={t('Translate automatically')} checked={f.autoTranslate} disabled={lock} onChange={(e) => set({ autoTranslate: e.target.checked })} /><span className="track"><span className="thumb" /></span></label></div>
      <div className="klset"><div><b>{t('Old entries')}</b><div className="sub">{count ? t('{n} entries are missing a language ({m} translations).', { n: count, m: total }) : t('Every entry has all the languages this merchant uses.')}</div></div>
        <button className="btn pri" type="button" disabled={!count} onClick={onTranslateAll}>{t('Translate all')}{count ? ` (${count})` : ''}</button></div>
      {lock ? <div className="note">{t('Only admins can change this tab. Every extra language uses AI tokens. Usage is in Usage & billing.')}</div>
        : <div className="head" style={{ marginTop: 14 }}><span className="sub">{dirty ? t('You have changes that are not saved.') : ''}</span><button className="btn pri" type="button" disabled={!dirty || busy} onClick={() => void save()}>{t('Save languages')}</button></div>}
    </div>
  );
}
