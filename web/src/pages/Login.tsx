import { useEffect, useRef, useState } from 'react';
import '../styles/admin.css';
import '../styles/login.css';
import { api } from '../lib/api';

const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const POINTS: [string, string][] = [
  ['Answers from your own knowledge base', 'Never makes up an answer. Asks once, then hands over to a person.'],
  ['Every merchant on its own', 'Own answers, words and settings, with a draft you check first.'],
  ['Works inside LiveChat', 'Your team joins in when the bot hands over.'],
];
/** The words of this page in Chinese. The panel keeps the same choice (panelLang), so signing in keeps the language. */
const ZH: Record<string, string> = {
  'Answers from your own knowledge base': '只根据你自己的知识库回答', 'Never makes up an answer. Asks once, then hands over to a person.': '从不编造答案。只追问一次，然后转给真人。',
  'Every merchant on its own': '每个商户各自独立', 'Own answers, words and settings, with a draft you check first.': '各自的答案、词库和设置，先看草稿再上线。',
  'Works inside LiveChat': '在 LiveChat 里工作', 'Your team joins in when the bot hands over.': '机器人转接时，你的团队接手。',
  'Bot Control Panel': '机器人控制面板', 'Look after the AI customer-service bot of every merchant in one place.': '在一个地方管理每个商户的 AI 客服机器人。',
  'Sign in': '登录', 'Signing in…': '登录中…', 'Use the username your admin gave you.': '请使用管理员给你的用户名。', 'Username': '用户名', 'Password': '密码',
  'Forgot your password? Ask an admin to reset it for you.': '忘记密码？请让管理员为你重置。', 'Caps Lock is on': '大写锁定已开启', 'Bot is running': '机器人运行中',
  'Show the password': '显示密码', 'Hide the password': '隐藏密码', 'Could not sign in.': '无法登录。',
};

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [lang, setLangState] = useState<'en' | 'zh'>(() => { try { return localStorage.getItem('panelLang') === 'zh' ? 'zh' : 'en'; } catch { return 'en'; } });
  const [up, setUp] = useState(false);
  const T = (x: string) => (lang === 'zh' ? ZH[x] ?? x : x);
  const setLang = (l: 'en' | 'zh') => { setLangState(l); try { localStorage.setItem('panelLang', l); } catch { /* not remembered */ } };
  const pw = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'Sign in · LiveChat AI bot';
    fetch('/health').then((r) => setUp(r.ok)).catch(() => {});
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && d.user) window.location.replace('/admin'); }).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      await api('/api/auth/login', { username, password });
      window.location.replace('/admin');
    } catch (err) {
      setError((err as Error).message || T('Could not sign in.')); setBusy(false); pw.current?.select();
    }
  };

  return (
    <main className="login">
      <section className="lg-brand" aria-label="About the panel">
        <div className="lg-logo" aria-hidden="true"><Icon><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /><path d="M9 11h6M9 14h4" /></Icon></div>
        <h2>{T('Bot Control Panel')}</h2>
        <p className="lg-tag">{T('Look after the AI customer-service bot of every merchant in one place.')}</p>
        <ul>{POINTS.map(([t, d]) => <li key={t}><span className="lg-tick" aria-hidden="true"><Icon><path d="m5 12 4.5 4.5L19 7" /></Icon></span><div><b>{T(t)}</b><span>{T(d)}</span></div></li>)}</ul>
        {up && <div className="lg-up"><i aria-hidden="true" />{T('Bot is running')}</div>}
      </section>
      <section className="lg-form">
        <div className="segs lg-lang" role="group" aria-label="Language">{([['en', 'EN'], ['zh', '中文']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={lang === k} onClick={() => setLang(k)}>{l}</button>)}</div>
        <div className="lg-card">
          <div className="lg-mini"><span className="lg-logo sm" aria-hidden="true"><Icon><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></Icon></span><b>{T('Bot Control Panel')}</b></div>
          <h1>{T('Sign in')}</h1>
          <p className="lg-sub">{T('Use the username your admin gave you.')}</p>
          <form onSubmit={submit}>
            <label className="fld"><span>{T('Username')}</span><input autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} /></label>
            <div className="lg-pw">
              <label className="fld"><span>{T('Password')}</span>
                <input ref={pw} type={show ? 'text' : 'password'} autoComplete="current-password" required value={password}
                  onChange={(e) => setPassword(e.target.value)} onKeyUp={(e) => setCaps(e.getModifierState?.('CapsLock') ?? false)} onBlur={() => setCaps(false)} /></label>
              <button type="button" className="lg-eye" aria-label={show ? T('Hide the password') : T('Show the password')} aria-pressed={show} onClick={() => setShow((v) => !v)}>
                {show ? <Icon><path d="M3 3l18 18" /><path d="M10.6 6.1A10.9 10.9 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.2 3.9M6.4 6.9C3.8 8.6 2.5 12 2.5 12s3.5 6 9.5 6c1.5 0 2.8-.4 4-.9" /></Icon>
                  : <Icon><path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></Icon>}
              </button>
            </div>
            {caps && <div className="lg-caps" role="status">{T('Caps Lock is on')}</div>}
            {error && <div className="err" role="alert"><Icon><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></Icon>{error}</div>}
            <button className="btn pri" type="submit" disabled={busy}>{busy ? T('Signing in…') : T('Sign in')}</button>
          </form>
          <p className="lg-help">{T('Forgot your password? Ask an admin to reset it for you.')}</p>
        </div>
      </section>
    </main>
  );
}
