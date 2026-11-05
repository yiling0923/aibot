import { useEffect, useRef, useState } from 'react';
import { usePanel } from '../store';

export default function Tests() {
  const p = usePanel();
  const [filter, setFilter] = useState('all'); const [running, setRunning] = useState(false); const [prog, setProg] = useState(5);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const run = async () => {
    setRunning(true); setProg(5); let n = 0; timer.current = setInterval(() => { n = Math.min(90, n + 8); setProg(n); }, 120);
    try { const r = await p.runTests(); p.toast(r.pass + ' of ' + r.total + ' tests passed'); } catch (e) { p.toast('Tests could not run: ' + (e as Error).message); }
    clearInterval(timer.current); setRunning(false);
  };
  useEffect(() => { if (!p.testsRun) void run(); return () => clearInterval(timer.current); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const all = p.tests; const list = all.filter((t) => filter === 'all' || (filter === 'fail' ? !t.ok : t.expected === filter));
  const pass = all.filter((t) => t.ok).length; const kinds = [...new Set(all.map((t) => t.expected))];
  const done = p.testsRun && !running;
  return (
    <>
      <div className="card"><div className="head"><div><h2>Tests</h2><div className="sub">Sample customer messages with the result the bot should give. Run them before every publish.</div></div><button className="btn pri" type="button" disabled={running} onClick={run}>Run all tests</button></div>
        <div className="prog" style={{ marginTop: 12 }}><i style={{ width: (done ? 100 : prog) + '%' }} /></div>
        <div className="quiet"><b>{done ? pass : 0}</b> passed · <b>{done ? all.length - pass : 0}</b> failed · {all.length} total</div>
        <div className="tools" style={{ marginTop: 10 }}><select aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All results</option><option value="fail">Failed only</option>{kinds.map((k) => <option key={k} value={k}>Should be {k}</option>)}</select></div></div>
      <div className="card scroll"><table><thead><tr><th>Customer message</th><th>Merchant</th><th>Should be</th><th>Bot gave</th><th></th></tr></thead><tbody>
        {list.map((t, i) => (
          <tr key={i}><td>{t.message}</td><td className="sub">{p.merchants.find((m) => m.code === t.merchant)?.name}</td>
            <td><span className="pill info">{t.expected}</span>{t.expIntent ? <> <span className="mono sub">{t.expIntent}</span></> : null}</td>
            <td><span className={'pill ' + (t.ok ? 'ok' : 'bad')}>{t.got}</span>{t.gotIntent ? <> <span className="mono sub">{t.gotIntent}</span></> : null}</td>
            <td>{t.ok ? <span className="pill ok">pass</span> : <span className="pill bad">fail</span>}</td></tr>))}</tbody></table></div>
    </>
  );
}
