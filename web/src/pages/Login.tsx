import { useEffect, useRef, useState } from 'react';
import '../styles/admin.css';
import '../styles/login.css';
import { api } from '../lib/api';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
      <div className="card">
        <div className="brandwrap">
          <span className="logo" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /><path d="M9 11h6M9 14h4" /></svg></span>
          <div className="brand">Bot Control Panel<small>LiveChat AI bot</small></div>
        </div>
        <h1>Sign in</h1>
        <form onSubmit={submit}>
          <label className="fld"><span>Username</span><input autoComplete="username" autoCapitalize="none" required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} /></label>
          <label className="fld"><span>Password</span><input ref={pw} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn pri" type="submit" disabled={busy}>Sign in</button>
        </form>
      </div>
    </main>
  );
}
