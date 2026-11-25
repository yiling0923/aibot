import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import { suggestTopic, topicList, topicWordMap } from '../model';
import { Modal } from '../ui';
import { useAssign } from './assign';
import { useT } from '../i18n';

type Row = { w: string; n: number; topic: string; hits: number; of: number };

/** For new words nobody has decided on yet: looks at the customer messages the word was written in, and suggests the topic whose words sit in the same messages. Nothing is saved until you press Add. */
export default function SuggestTopics({ words, onClose }: { words: { w: string; n: number }[]; onClose: () => void }) {
  const p = usePanel(); const { t } = useT(); const assign = useAssign();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({}); const [on, setOn] = useState<Set<string>>(new Set());
  const topics = useMemo(() => topicList(p.draft, p.merchant), [p.draft, p.merchant]);

  useEffect(() => {
    let dead = false; const map = topicWordMap(p.draft, p.merchant);
    Promise.all(words.map((x) => api<string[]>('/api/admin/keywords/samples?merchant=' + encodeURIComponent(p.merchant) + '&word=' + encodeURIComponent(x.w)).catch(() => [] as string[]).then((s): Row => { const g = suggestTopic(x.w, s, map); return { w: x.w, n: x.n, topic: g?.topic ?? '', hits: g?.hits ?? 0, of: g?.of ?? 0 }; })))
      .then((r) => { if (dead) return; setRows(r); setPick(Object.fromEntries(r.map((x) => [x.w, x.topic]))); setOn(new Set(r.filter((x) => x.topic).map((x) => x.w))); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chosen = (rows ?? []).filter((r) => on.has(r.w) && pick[r.w]);
  const add = () => {
    let done = 0;
    [...new Set(chosen.map((r) => pick[r.w]))].forEach((topic) => { const r = assign(chosen.filter((x) => pick[x.w] === topic).map((x) => x.w), 'topic', topic); done += r.done.length; });
    p.toast(t(done === 1 ? '1 keyword added to the draft' : '{n} keywords added to the draft', { n: done })); onClose();
  };
  return (
    <Modal label="Suggest topics" onClose={onClose}>
      <h2>{t('Suggest topics for new keywords')}</h2>
      <div className="sub">{t('For each new word, the bot looks at the customer messages it was written in. If a known topic is in the same messages, it is suggested. Check the list, change a topic if you want, then add. Nothing is saved until you press Add.')}</div>
      {!rows ? <div className="note" style={{ marginTop: 12 }}>{t('Looking at the chats…')}</div> : !rows.length ? <div className="note" style={{ marginTop: 12 }}>{t('No new words to decide.')}</div> :
        <div className="sglist">{rows.map((r) => <div className="sgrow" key={r.w}>
          <input type="checkbox" aria-label={t('Select {w}', { w: r.w })} checked={on.has(r.w)} disabled={!pick[r.w]} onChange={(e) => setOn((s) => { const n = new Set(s); if (e.target.checked) n.add(r.w); else n.delete(r.w); return n; })} />
          <div><b>{r.w}</b> <span className="sub">{r.n} {t(r.n === 1 ? 'time' : 'times')}</span>
            <div className="sub">{r.topic ? t('Seen with “{k}” in {a} of {b} chats', { k: r.topic, a: r.hits, b: r.of }) : t('No clear topic in its chats')}</div></div>
          <select aria-label={t('Topic for {w}', { w: r.w })} value={pick[r.w] ?? ''} onChange={(e) => { setPick((s) => ({ ...s, [r.w]: e.target.value })); setOn((s) => { const n = new Set(s); if (e.target.value) n.add(r.w); else n.delete(r.w); return n; }); }}>
            <option value="">{t('No topic')}</option>{topics.map((x) => <option key={x} value={x}>{x}</option>)}</select></div>)}</div>}
      <div className="tools" style={{ marginTop: 14, justifyContent: 'flex-end' }}><button className="btn" type="button" onClick={onClose}>{t('Close')}</button>
        <button className="btn pri" type="button" disabled={!chosen.length} onClick={add}>{t(chosen.length === 1 ? 'Add 1 keyword to its topic' : 'Add {n} keywords to their topics', { n: chosen.length })}</button></div>
    </Modal>
  );
}
