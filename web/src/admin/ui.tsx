import { useEffect, type ReactNode } from 'react';

/** A dialog over the page. Clicking the dark area or pressing Escape closes it. */
export function Modal({ label, onClose, small, children }: { label: string; onClose: () => void; small?: boolean; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className={'ov' + (small ? ' c' : '')} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'pane' + (small ? ' modal' : '')} role="dialog" aria-label={label}>{children}</div>
    </div>
  );
}

export const Pill = ({ c = '', title, children }: { c?: string; title?: string; children: ReactNode }) => <span className={'pill ' + c} title={title}>{children}</span>;

export function Spark({ v, w = 130, h = 30 }: { v: number[]; w?: number; h?: number }) {
  const mx = Math.max(...v, 1);
  const pts = v.map((y, i) => [4 + (i * (w - 8)) / Math.max(1, v.length - 1), h - 4 - (y / mx) * (h - 8)]);
  return <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><polyline fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" points={pts.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ')} /></svg>;
}

export function Medal({ n }: { n: number }) {
  const col = ({ 1: '#f0a81c', 2: '#97a3b0', 3: '#d27c2c' } as Record<number, string>)[n];
  return (
    <svg width="36" height="42" viewBox="0 0 36 42" aria-hidden="true">
      <polygon points="8,0 18,15 13,17 5,4" fill="#4c6ef5" /><polygon points="28,0 18,15 23,17 31,4" fill="#e5484d" />
      <circle cx="18" cy="26" r="13" fill={col} /><circle cx="18" cy="26" r="9.5" fill="none" stroke="rgba(255,255,255,.65)" strokeWidth="1.5" />
      <text x="18" y="31" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff" fontFamily="sans-serif">{n}</text>
    </svg>
  );
}

export const ChgPill = ({ c }: { c: number }) => <span className={'pill ' + (c >= 0 ? 'ok' : 'bad')}>{c >= 0 ? '▲' : '▼'} {Math.abs(c)}%</span>;

const ICONS: Record<string, ReactNode> = {
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.5 3.2-5.5 6.5-5.5s5.9 2 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.7c2 .7 3.2 2.6 3.5 5.3" /></>,
  kb: <><path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z" /><path d="M4 21V5" /><path d="M9 8h6" /></>,
  imp: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
  kw: <><path d="M20 12 12 20 4 12V4h8z" /><circle cx="8.5" cy="8.5" r="1" /></>,
  store: <path d="M4 6h16M4 12h16M4 18h10" />,
  rank: <path d="M6 20V10M12 20V4M18 20v-7" />,
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  test: <path d="m5 12 4 4 10-10" />,
  rev: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  set: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  report: <><path d="M4 20h16" /><path d="M7 16v-5" /><path d="M12 16V6" /><path d="M17 16v-8" /></>,
  unm: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7" /><path d="M12 17h.01" /></>,
  hist: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></>,
};
export const NavIcon = ({ name }: { name: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>
);
