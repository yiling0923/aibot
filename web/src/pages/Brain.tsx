import type { ReactNode } from 'react';
import type { Acct, MessageTrace, PickTrace, Trace } from './chatTypes';

const LANGN: Record<string, string> = { zh: '中文', ms: 'Bahasa Melayu', en: 'English' };
const DEC: Record<string, [string, string]> = {
  AMOUNT: ['info', 'Amount message'], ACCOUNT: ['info', 'Account lookup'], REFUSE: ['warn', 'Refuse for security'], SMALLTALK: ['info', 'Greeting'], ANSWER: ['ok', 'Answer'],
  CLARIFY: ['warn', 'Show 2 buttons'], CHOICE: ['info', 'Show choice buttons'], HANDOFF: ['warn', 'Hand off to human'], REASK: ['warn', 'Ask again first'], ABUSE: ['warn', 'Reply kindly'],
};
const fmtAmt = (n: number) => 'RM' + Number(n).toLocaleString('en-US');

const Pill = ({ kind, children }: { kind: string; children: ReactNode }) => <span className={'pill ' + kind}>{children}</span>;
const Mono = ({ children }: { children: ReactNode }) => <span className="mono">{children}</span>;
const Sub = ({ children, top }: { children: ReactNode; top?: boolean }) => <span className="sub" style={top ? { display: 'block', marginTop: 3 } : undefined}>{children}</span>;
function Step({ n, title, pill, children }: { n: number; title: ReactNode; pill?: ReactNode; children?: ReactNode }) {
  return (
    <div className="step"><div className="n">{n}</div>
      <div><div className="t">{title}{pill ? <> {pill}</> : null}</div><div className="b">{children}</div></div></div>
  );
}

function AcctSteps({ ac, n, tone }: { ac: Acct; n: number; tone: string }) {
  const c = ac.chk;
  const rows = ac.json || JSON.stringify((ac.rows || []).map((r) => ({ ref: r.ref, amount: r.amount, status: r.status })));
  return (
    <>
      <Step n={n} title="Identity check"
        pill={c.state === 'valid' ? <Pill kind="ok">signature valid</Pill> : c.state === 'invalid' ? <Pill kind="bad">invalid</Pill> : <Pill kind="warn">no token</Pill>}>
        {c.state === 'valid' ? <Sub>customer_id <Mono>{c.id}</Mono> ({c.name}), taken from the signed token and never from what the customer types.</Sub>
          : c.state === 'invalid' ? <Sub>The signature does not match, so the ID inside the token is ignored.</Sub>
          : <Sub>The website sent no customer token, so the customer is not logged in.</Sub>}
      </Step>
      {!ac.verified ? (
        <Step n={n + 1} title="No account lookup" pill={<Pill kind="info">general answer only</Pill>}><Sub>The bot gives the KB answer and asks the customer to log in, or offers an agent.</Sub></Step>
      ) : (
        <>
          <Step n={n + 1} title="Account lookup (tool call)" pill={<Pill kind="ok">read-only</Pill>}>
            <pre className="json">{ac.call}{'\n'}→ {rows}</pre>
            <div className="sub" style={{ marginTop: 3 }}>Merchant API. The customer_id is added by the bot code, so nobody can ask for another customer.</div>
          </Step>
          <Step n={n + 2} title={'Reply written (tone: ' + tone + ')'} pill={<Pill kind="ok">uses only the data</Pill>}><Sub>The reply uses only the returned data and the KB answer.</Sub></Step>
        </>
      )}
    </>
  );
}

function PickBrain({ t }: { t: PickTrace }) {
  const m = t.merchant, tone = m.tone;
  const what = t.pickKind === 'intent' ? <>intent_key = <Mono>{t.key}</Mono></> : t.pickKind === 'topic' ? <>topic = <Mono>{t.key}</Mono></> : <>agent requested</>;
  return (
    <>
      <div className="said">Customer tapped “{t.label}”</div>
      {t.pickKind === 'amt' ? (
        <>
          <Step n={1} title="Button tapped" pill={<Pill kind="ok">no guessing</Pill>}><Sub>Fixed values: action = <Mono>{t.key}</Mono>, amount = <Mono>{fmtAmt(t.amt ?? 0)}</Mono>.</Sub></Step>
          {t.key === 'check' && t.acct ? <AcctSteps ac={t.acct} n={2} tone={tone} />
            : <Step n={2} title="Limit check and steps" pill={<Pill kind="ok">from the KB</Pill>}><Sub>The amount is compared with {m.name}'s limits and the "{t.key}_how" answer is used. The bot does not move money.</Sub></Step>}
        </>
      ) : t.pickKind === 'status' ? (
        <>
          <Step n={1} title="Button tapped" pill={<Pill kind="ok">no guessing</Pill>}><Sub>The button sends a fixed value: status = <Mono>{t.key}</Mono>.</Sub></Step>
          {t.acct ? <AcctSteps ac={t.acct} n={2} tone={tone} /> : null}
        </>
      ) : (
        <>
          <Step n={1} title="Button tapped" pill={<Pill kind="ok">no guessing</Pill>}><Sub>The button sends a fixed value: {what}. Search is skipped.</Sub></Step>
          {t.pickKind === 'intent' ? (
            <>
              <Step n={2} title="Load the KB entry"><Sub>{m.name} · {t.key} · {LANGN[t.lang]}</Sub></Step>
              <Step n={3} title={'Reply written (tone: ' + tone + ')'} pill={<Pill kind="ok">KB answer only</Pill>}><Sub>Uses only the KB answer: “{t.extra}”</Sub></Step>
            </>
          ) : t.pickKind === 'topic' ? <Step n={2} title="Show the next buttons"><Sub>{t.extra}</Sub></Step>
            : <Step n={2} title="Transfer"><Sub>Chat goes to human group {m.handoffGroupId} with a short summary.</Sub></Step>}
        </>
      )}
    </>
  );
}

function MessageBrain({ t }: { t: MessageTrace }) {
  const m = t.merchant, tone = m.tone;
  let dec = DEC[t.decision] ?? ['info', t.decision];
  if (t.decision === 'ABUSE' && t.strike) dec = t.close ? ['bad', 'Close chat'] : ['warn', 'Reply kindly (' + t.strike + ' of ' + (t.limit || 'no limit') + ')'];
  const jobj: Record<string, unknown> = { decision: t.decision, kb_id: t.decision === 'ANSWER' ? t.top.id : null, intent_key: t.decision === 'ANSWER' ? t.top.intent : null, language: t.lang, confidence: +t.conf.toFixed(2) };
  if (t.decision === 'ACCOUNT') { delete jobj.kb_id; delete jobj.intent_key; jobj.topic = t.topic; }
  if (t.decision === 'AMOUNT') { delete jobj.kb_id; delete jobj.intent_key; jobj.amount = t.amt?.n; jobj.direction = t.dir || null; }
  if (t.decision === 'CHOICE' || t.decision === 'CLARIFY') { delete jobj.kb_id; delete jobj.intent_key; if (t.topic) jobj.topic = t.topic; jobj.options = t.options.map((o) => o.key); }
  const json = JSON.stringify(jobj, null, 1).replace(/\n\s*/g, ' ');
  const asked = t.ai && t.ai.picked !== undefined;
  const pills = (a: string[]) => (a.length ? a.map((x) => <span key={x}><Pill kind="info">{x}</Pill> </span>) : <Sub>none</Sub>);
  const normal = t.decision !== 'ABUSE' && !t.guard && t.decision !== 'SMALLTALK';
  const cands = t.cands.map((c, i) => (
    <div key={c.intent} className={'cand ' + (i === 0 ? 'top' : '')}><span className="nm" title={c.intent}>{c.intent}</span><span className="bar"><i style={{ width: Math.round(c.score * 100) + '%' }} /></span><span className="sc">{c.score.toFixed(2)}</span></div>
  ));
  return (
    <>
      <div className="said">“{t.raw}”</div>
      <Step n={1} title="Guard rules" pill={t.abuseHit.length ? <Pill kind="bad">abuse found</Pill> : t.guard ? <Pill kind="warn">{t.guard.kind}</Pill> : <Pill kind="ok">clean</Pill>}>
        {t.abuseHit.length ? <>Matched: <Mono>{t.abuseHit.join(', ')}</Mono></> : t.guard ? <>Matched: <Mono>{t.guard.hit.join(', ')}</Mono></> : <Sub>No blocked words. Continue.</Sub>}
      </Step>

      {t.decision === 'SMALLTALK' && (
        <>
          <Step n={2} title="Normalize" pill={<Pill kind="info">{LANGN[t.lang]}</Pill>}><div className="mono">{t.normalized}</div></Step>
          <Step n={3} title="Greeting check" pill={<Pill kind="info">{t.small}</Pill>}>
            {t.smallFallback ? <Sub>Starts with a greeting and the rest is too short to match anything, so it is treated as a greeting. No handoff.</Sub> : <Sub>Matches the greeting / call-out / thanks / goodbye list, so the KB search is skipped.</Sub>}
          </Step>
          <Step n={4} title="Decision"><pre className="json">{JSON.stringify({ decision: 'SMALLTALK', type: t.small, language: t.lang }).replace(/,/g, ', ')}</pre></Step>
        </>
      )}
      {normal && (
        <>
          <Step n={2} title="Normalize" pill={<Pill kind="info">{LANGN[t.lang]}</Pill>}>
            <div className="mono">{t.normalized}</div>
            <div style={{ marginTop: 4 }}>{t.hits.length ? t.hits.map(([a, b], i) => <span key={i}><Mono>{a}</Mono> <span className="arrow">→</span> <Mono>{b}</Mono> &nbsp; </span>) : <Sub>no short forms found</Sub>}</div>
          </Step>
          <Step n={3} title={'Keyword scan, then ' + m.name + ' KB'}>
            <div>Topic: {pills(t.ks.T)} &nbsp; Keyword: {pills(t.ks.A)}</div>
            {t.amt ? <div style={{ marginTop: 3 }}>Amount: <Pill kind="info">{fmtAmt(t.amt.n)}</Pill></div> : null}
            {t.via === 'keywords' ? <div className="sub" style={{ marginTop: 3 }}>The keywords decide. Words around them are ignored.</div>
              : <>{cands}{t.top.score > 0 ? <div className="sub">Closest example: “{t.top.example}”</div> : <div className="sub">No example is similar to this message.</div>}</>}
          </Step>
          {t.ai && t.ai.picked ? <Step n={4} title="Claude picks the entry" pill={<Pill kind="info">AI</Pill>}><Sub>No keyword matched, so Claude chose <Mono>{t.ai.picked}</Mono> ({Math.round((t.ai.confidence ?? 0) * 100)}% sure).</Sub></Step>
            : t.ai && t.ai.picked === null ? <Step n={4} title="Claude was asked" pill={<Pill kind="warn">not sure</Pill>}><Sub>No keyword matched. Claude {t.ai.confidence != null ? 'was only ' + Math.round(t.ai.confidence * 100) + '% sure' : 'found no entry'}, so it is not used.</Sub></Step> : null}
          <Step n={asked ? 5 : 4} title="Decision"><pre className="json">{json}</pre></Step>
        </>
      )}
      <Step n={t.decision === 'ABUSE' || t.guard ? 2 : asked ? 6 : t.decision === 'SMALLTALK' ? 5 : 5} title="Confidence gate" pill={<Pill kind={dec[0]}>{dec[1]}</Pill>}><Sub>{t.why}</Sub></Step>

      {t.decision === 'SMALLTALK' && <Step n={6} title={'Short reply (tone: ' + tone + ')'}><Sub>“{t.smallText}”{t.options.length ? ' Then shows topic buttons: ' + t.options.map((o) => o.label).join(' · ') : ''}</Sub></Step>}
      {(t.decision === 'ANSWER' || t.decision === 'ACCOUNT') && t.acct && <AcctSteps ac={t.acct} n={6} tone={tone} />}
      {t.decision === 'AMOUNT' && (
        <Step n={6} title={t.dir ? 'Limit check and steps' : 'Bot asks what to do'} pill={t.dir ? <Pill kind="ok">no handoff</Pill> : <Pill kind="warn">confirm first</Pill>}>
          {t.dir ? <Sub>Compares the amount with the merchant's limits, then gives the steps. The bot only guides, it does not move money.</Sub> : <Sub>Buttons: {(t.amtButtons || []).join(' · ')} · {t.agentLabel}</Sub>}
        </Step>
      )}
      {t.decision === 'REFUSE' ? <Step n={3} title="Polite refusal" pill={<Pill kind="warn">security</Pill>}><Sub>Fixed refusal message and an agent button. No lookup is made, and nothing is read out even for a verified customer.</Sub></Step>
        : t.decision === 'ANSWER' && !t.acct && t.ai?.written ? <Step n={6} title={'ChatGPT wrote the reply (tone: ' + tone + ')'} pill={<Pill kind="ok">checker passed</Pill>}><Sub>The checker confirmed it keeps every number and fact of the KB answer: “{t.kbAnswer}”</Sub></Step>
        : t.decision === 'ANSWER' && !t.acct && t.ai?.rejected ? <Step n={6} title={'Reply written (tone: ' + tone + ')'} pill={<Pill kind="warn">ChatGPT reply rejected</Pill>}><Sub>The checker refused ChatGPT's wording ({t.ai.rejected}), so the standard wording of the KB answer was used: “{t.kbAnswer}”</Sub></Step>
        : t.decision === 'ANSWER' && !t.acct ? <Step n={6} title={'Reply written (tone: ' + tone + ')'} pill={<Pill kind="ok">KB answer only</Pill>}><Sub>Uses only the KB answer: “{t.kbAnswer}”</Sub></Step> : null}
      {(t.decision === 'CHOICE' || t.decision === 'CLARIFY') && (
        <Step n={6} title="Bot shows buttons"><Sub>{t.options.map((o) => o.label).join(' · ')} · {t.agentLabel}</Sub><div className="sub" style={{ marginTop: 3 }}>A tap sends a fixed value, so the next step needs no guessing.</div></Step>
      )}
      {t.decision === 'REASK' && (
        <Step n={6} title="Bot asks again"><Sub>{t.options.map((o) => o.label).join(' · ')} · {t.agentLabel}</Sub><div className="sub" style={{ marginTop: 3 }}>This was the first miss. If the next message is also not understood, the chat goes to a human.</div></Step>
      )}
      {t.decision === 'HANDOFF' && <Step n={t.guard ? 3 : 6} title="Transfer"><Sub>Chat goes to human group {m.handoffGroupId} with a short summary.</Sub></Step>}
      {t.decision === 'ABUSE' && (
        <Step n={3} title={t.close ? 'Close' : 'Kind reply'} pill={t.close ? undefined : <Pill kind="ok">friendly tone</Pill>}>
          <Sub>{t.close ? 'The customer was rude ' + t.strike + ' times, so the closing message is sent and the chat is closed. Logged for review.'
            : 'A calm, friendly reply that asks for the problem and offers an agent. The chat stays open. It closes after ' + (t.limit ? t.limit : 'no') + ' rude messages.'}</Sub>
        </Step>
      )}
    </>
  );
}

/** The step-by-step panel: what the bot did with the last message. */
export default function Brain({ trace }: { trace: Trace | null }) {
  if (!trace) return <p className="note">Send a message to see the steps here.</p>;
  if (trace.kind === 'skipped') return <p className="note">{trace.note}</p>;
  return trace.kind === 'pick' ? <PickBrain t={trace} /> : <MessageBrain t={trace} />;
}
