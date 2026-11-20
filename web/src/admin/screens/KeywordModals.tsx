import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import { LANGS, LN, addOwnTopic, pushUnique, slug, topicNames, unassign, guessLang } from '../model';
import { Modal, Pill } from '../ui';
import { useT, tStatus } from '../i18n';

export const RANK_TYPES: Record<string, [string, string]> = { filler: ['Filler', 'info'], slang: ['Abbreviation', 'info'], topic: ['Topic', 'ok'], question: ['Question word', 'ok'], rude: ['Rude word', 'bad'], greeting: ['Greeting', 'info'], negation: ['Negation', ''], other: ['Not classified', ''] };
const SAMPLES: Record<string, string[]> = { lh: ['tolong lah', 'cepat lah', 'boleh lah bos', 'lh lh lh'], tolonglh: ['tolonglh', 'tolonglh dh lama', 'tolonglh bantu saya'], nk: ['nk wd', 'nk tanya sikit', 'nk depo mcm mana'], dh: ['dh 2 jam', 'dh bayar tak masuk', 'dh try banyak kali'], sial: ['sial tak masuk lagi', 'sial la apa ni', 'sial duit hilang'], duit: ['duit tak masuk', 'duit saya mana', 'nk tarik duit'], xde: ['xde response', 'xde duit masuk', 'xde id'], babi: ['babi punya sistem', 'babi lah lambat'], bodoh: ['bodoh sistem ni', 'bodoh betul'], buka: ['x boleh buka akaun', 'cs buka pukul berapa', 'buka game x boleh'] };
const SW_OPTS: Record<string, [string, string]> = {
  newtopic: ['Make it a new topic', 'Creates a new topic word from this keyword. Then assign the topic to entries in the Knowledge base.'],
  filler: ['Filler', 'Ignored when looking for keywords. A message of only fillers gets a friendly reply, not a human.'],
  alias: ['Add to an existing topic', 'Becomes another way to write that topic, for example wd → withdraw.'],
  aspect: ['Question word', 'Tells the bot what the customer wants to know: time, limit, how, change, hours.'],
  greeting: ['Greeting or thanks', 'Gets a friendly reply and topic buttons.'],
  rude_mild: ['Rude word (mild)', 'Counts as rude only when it is the whole message, or comes with another rude word.'],
  rude_strong: ['Rude word', 'The bot replies kindly first. The chat closes only if the customer keeps being rude.'],
  none: ['Leave as it is', 'Nothing changes.'],
};

/** "What is this word?" dialog: puts a keyword into one of the lists (as a draft change). */
export function SetKeywordModal({ word, preset, onClose }: { word: string; preset?: string; onClose: () => void }) {
  const p = usePanel(); const { t: T } = useT(); const lock = !p.isAdmin; const d = p.draft;
  const row = p.kwMap[word]; const typeKey = p.typeOf(word); const st = p.status(word);
  const lg = row?.lg || guessLang(word);
  const dflt = lock ? 'alias' : preset || ({ filler: 'filler', slang: 'alias', topic: 'newtopic', question: p.adv ? 'aspect' : 'none', rude: 'rude_strong', greeting: 'greeting' } as Record<string, string>)[typeKey] || 'none';
  const [t, setTy] = useState(dflt); const [l, setL] = useState(lg);
  const [name, setName] = useState(/^[a-z0-9 _-]+$/i.test(word) ? slug(word) : '');
  const opts = ({ alias: [topicNames(d, p.merchant), 'Topic'], aspect: [Object.keys(d.aspects), 'Question type'], greeting: [Object.keys(d.smalltalk), 'Greeting type'] } as Record<string, [string[], string]>)[t];
  const [v, setV] = useState('');
  const vv = opts && opts[0].includes(v) ? v : opts?.[0][0] || '';

  const apply = () => {
    const w = word.toLowerCase(); const n = slug(name);
    if (t === 'newtopic') { if (!n) return p.toast(T('Type a name for the topic first')); if (topicNames(d, p.merchant).includes(n)) return p.toast(T('A topic named "{n}" already exists. Choose "Add to an existing topic" instead.', { n })); }
    p.edit((x, note) => {
      if (t !== 'none' && p.status(word).t !== 'Not set yet' && !(t === 'newtopic' && topicNames(x, p.merchant).includes(n))) unassign(x, p.merchant, w);
      if (t === 'newtopic') { addOwnTopic(x, p.merchant, n, w !== n ? [w] : [], l); note('Made "' + w + '" a new topic: ' + n + ' (' + p.M.name + ')'); }
      if (t === 'filler') { pushUnique(x.fillers, l, w); note('Marked "' + w + '" as a filler word'); }
      if (t === 'alias') { (x.mAliases[p.merchant] = x.mAliases[p.merchant] || []).push({ language: l, variant: w, canonical: vv }); note('Added short form "' + w + '" → ' + vv + ' (' + p.M.name + ')'); }      // a keyword belongs to this merchant; an admin adds shared ones on the Topics page
      if (t === 'aspect') { pushUnique(x.aspects[vv], l, w); note('Added question word "' + w + '" (' + vv + ')'); }
      if (t === 'greeting') { pushUnique(x.smalltalk[vv], l, w); note('Added greeting phrase "' + w + '" (' + vv + ')'); }
      if (t === 'rude_strong') { pushUnique(x.guard.abuse, l, w); note('Added rude word "' + w + '"'); }
      if (t === 'rude_mild') { pushUnique(x.guard.abuse_soft, l, w); note('Added mild rude word "' + w + '"'); }
    });
    onClose(); p.toast(t === 'none' ? T('No change') : t === 'newtopic' ? T('"{w}" is now a topic. Press Publish to make it live.', { w }) : T('Added "{w}" to the draft. Press Publish to make it live.', { w }));
  };

  return (
    <Modal small label={T('Set keyword')} onClose={onClose}>
      <h2>{T('What is “{w}”?', { w: word })}</h2><div className="sub">{T('Now:')} {tStatus(T, st.t)}{row?.h ? ' · ' + row.h : ''}</div>
      <div className="form">
        <label className="fld full"><span>{T('It is a')}</span><select value={t} onChange={(e) => setTy(e.target.value)}>
          {Object.entries(SW_OPTS).filter(([k]) => p.adv || k !== 'aspect').map(([k, o]) => <option key={k} value={k} disabled={lock && k !== 'alias' && k !== 'none'}>{T(o[0])}</option>)}</select></label>
        {t === 'newtopic' && <label className="fld"><span>{T('Topic name (one word, lowercase)')}</span><input type="text" placeholder={T('e.g. refund')} value={name} onChange={(e) => setName(e.target.value)} /></label>}
        {opts && <label className="fld"><span>{T(opts[1])}</span><select value={vv} onChange={(e) => setV(e.target.value)}>{opts[0].map((x) => <option key={x}>{x}</option>)}</select></label>}
        <label className="fld"><span>{T('Language')}</span><select value={l} onChange={(e) => setL(e.target.value)}>{LANGS.map((x) => <option key={x} value={x}>{LN[x]}</option>)}</select></label></div>
      <div className="note">{T(SW_OPTS[t][1])}</div>{lock && <div className="lock">{T('Staff can only add short forms for their own merchant.')}</div>}
      <div className="head"><button className="btn" type="button" onClick={onClose}>{T('Cancel')}</button><button className="btn pri" type="button" onClick={apply}>{T('Add to draft')}</button></div>
    </Modal>
  );
}

/** The side panel with real customer messages that used this word. */
export function KeywordDrawer({ word, count, share, onClose, onSet }: { word: string; count: number; share?: number; onClose: () => void; onSet?: () => void }) {
  const p = usePanel(); const { t: T } = useT(); const [real, setReal] = useState<string[]>([]);
  useEffect(() => { api<string[]>('/api/admin/keywords/samples?merchant=' + encodeURIComponent(p.merchant) + '&word=' + encodeURIComponent(word)).then(setReal).catch(() => setReal([])); }, [word, p.merchant]);
  const ty = RANK_TYPES[p.typeOf(word)] || RANK_TYPES.other; const st = p.status(word); const h = p.kwMap[word]?.h || '';
  const samples = real.length ? real : SAMPLES[word] || [word, '… ' + word + ' …', 'boss ' + word];
  return (
    <Modal label={T('Keyword chats')} onClose={onClose}>
      <div className="head"><h2>“{word}”</h2><button className="btn sm" type="button" onClick={onClose}>{T('Close')}</button></div>
      <div className="kv"><Pill c={ty[1]}>{T(ty[0])}</Pill><Pill c={st.c}>{tStatus(T, st.t)}</Pill><span className="sub">{count} {T('times')}{share !== undefined ? ' · ' + share.toFixed(2) + '%' : ''}</span></div><div className="sub">{tStatus(T, h)}</div>
      <div><h3>{T('Recent chats with this word (sample)')}</h3>
        {samples.map((s, i) => <div className="q" key={i}><div className="t">“{s}”</div><span className="sub">{T('Customer {n}', { n: i + 1 })} · {T(['Today', 'Today', 'Yesterday', '2 days ago'][i % 4])}</span></div>)}</div>
      {onSet && <div className="head" style={{ marginTop: 'auto' }}><span className="sub">{T('Tell the bot what this word is.')}</span><button className="btn pri" type="button" onClick={onSet}>{T('Set…')}</button></div>}
    </Modal>
  );
}
