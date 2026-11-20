import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ZH } from './zh';

/**
 * The panel in more than one language. A text is written in English in the code: `t('Save to draft')`. In Chinese the same text is looked up in `zh.ts`;
 * a text that is not there yet stays English, so the panel never shows a hole. `{name}` in a text is replaced from the second argument.
 */
export type PanelLang = 'en' | 'zh';
interface I18n { lang: PanelLang; setLang: (l: PanelLang) => void; t: (en: string, vars?: Record<string, string | number>) => string }

const fill = (s: string, v?: Record<string, string | number>) => (v ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? '{' + k + '}')) : s);
const Ctx = createContext<I18n>({ lang: 'en', setLang: () => undefined, t: (s, v) => fill(s, v) });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<PanelLang>(() => { try { return localStorage.getItem('panelLang') === 'zh' ? 'zh' : 'en'; } catch { return 'en'; } });
  const setLang = (l: PanelLang) => { setLangState(l); try { localStorage.setItem('panelLang', l); } catch { /* the choice is only not remembered */ } };
  useEffect(() => { document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'; }, [lang]);
  const value = useMemo<I18n>(() => ({ lang, setLang, t: (en, v) => fill(lang === 'zh' ? (ZH[en] ?? en) : en, v) }), [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useT = () => useContext(Ctx);

/** The status of a word ("Topic: deposit", "Filler", "Not set yet") in the panel language. The name after the colon stays as written. */
export const tStatus = (t: I18n['t'], s: string): string => {
  const m = s.match(/^(Topic|Question word|Greeting list): (.*?)( \(this merchant\))?$/);
  return m ? t(m[1]) + ': ' + m[2] + (m[3] ? ' ' + t('(this merchant)') : '') : t(s);
};
