import { useEffect, useRef, useState } from 'react';
import '../styles/admin.css';
import '../styles/login.css';
import { api } from '../lib/api';

const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const POINTS: [string, string][] = [
  ['Answers from your own knowledge base', 'The bot never makes up an answer. If it is not sure, it asks once, then hands over to a person.'],
  ['Every merchant on its own', 'Separate answers, words and settings, with a draft you check before it goes live.'],
  ['Works inside LiveChat', 'Customers keep chatting in LiveChat. Your team joins in when the bot hands over.'],
];

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const pw = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'Sign in · LiveChat AI bot';
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && d.user) window.location.replace('/admin'); }).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      await api('/api/auth/login', { username, password });
      window.location.replace('/admin');
    } catch (err) {
      setError((err as Error).message || 'Could not sign in.'); setBusy(false); pw.current?.select();
    }
  };

  return (
    <main className="login">
      <section className="lg-brand" aria-label="About the panel">
        <div className="lg-logo" aria-hidden="true"><Icon><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /><path d="M9 11h6M9 14h4" /></Icon></div>
        <h2>Bot Control Panel</h2>
        <p className="lg-tag">Look after the AI customer-service bot of every merchant in one place.</p>
        <ul>{POINTS.map(([t, d]) => <li key={t}><span className="lg-tick" aria-hidden="true"><Icon><path d="m5 12 4.5 4.5L19 7" /></Icon></span><div><b>{t}</b><span>{d}</span></div></li>)}</ul>
      </section>
      <section className="lg-form">
        <div className="lg-card">
          <div className="lg-mini"><span className="lg-logo sm" aria-hidden="true"><Icon><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></Icon></span><b>Bot Control Panel</b></div>
          <h1>Sign in</h1>
          <p className="lg-sub">Welcome back. Sign in to manage your bots.</p>
          <form onSubmit={submit}>
            <label className="fld"><span>Username</span><input autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} /></label>
            <div className="lg-pw">
              <label className="fld"><span>Password</span>
                <input ref={pw} type={show ? 'text' : 'password'} autoComplete="current-password" required value={password}
                  onChange={(e) => setPassword(e.target.value)} onKeyUp={(e) => setCaps(e.getModifierState?.('CapsLock') ?? false)} onBlur={() => setCaps(false)} /></label>
              <button type="button" className="lg-eye" aria-label={show ? 'Hide the password' : 'Show the password'} aria-pressed={show} onClick={() => setShow((v) => !v)}>
                {show ? <Icon><path d="M3 3l18 18" /><path d="M10.6 6.1A10.9 10.9 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.2 3.9M6.4 6.9C3.8 8.6 2.5 12 2.5 12s3.5 6 9.5 6c1.5 0 2.8-.4 4-.9" /></Icon>
                  : <Icon><path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></Icon>}
              </button>
            </div>
            {caps && <div className="lg-caps" role="status">Caps Lock is on</div>}
            {error && <div className="err" role="alert"><Icon><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></Icon>{error}</div>}
            <button className="btn pri" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <p className="lg-help">Forgot your password? Ask an admin to reset it for you.</p>
        </div>
      </section>
    </main>
  );
}
