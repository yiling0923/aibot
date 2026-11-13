import { fold } from '../engine/engine';
import type { Button } from './responder';

/** Replying to the choices the bot offered, in the customer's own words: "2", "the second one", "deposit", "depo", or words of the choice itself.
 *  Accents and capitals do not matter. Returns null when the message is a new question. */
const NUMBER_WORDS: Record<string, number> = {
  first: 1, '1st': 1, one: 1, second: 2, '2nd': 2, two: 2, third: 3, '3rd': 3, three: 3, pertama: 1, kedua: 2, ketiga: 3, '第一': 1, '第二': 2, '第三': 3, '一': 1, '二': 2, '三': 3,
  mot: 1, hai: 2, ba: 3, nhat: 1, 'หนึ่ง': 1, 'สอง': 2, 'สาม': 3, una: 1, ikalawa: 2, pangalawa: 2, ikatlo: 3, pangatlo: 3,
};
const clean = (s: string) => fold(s.toLowerCase()).replace(/[.,!?;:'"()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();

export function matchChoice(text: string, choices: Button[]): Button | null {
  const t = clean(text); if (!t) return null;
  const num = /^(?:no\.?\s*|option\s+|pilihan\s+|lua chon\s+|so\s+|cai\s+|thu\s+|ข้อ\s*|ตัวเลือก\s*|opsyon\s+|ang\s+|yung\s+|选项\s*|第\s*)?#?(\d{1,2})(?:\s*(?:个|项|號|号))?$/.exec(t);
  if (num) { const i = Number(num[1]); return i >= 1 && i <= choices.length ? choices[i - 1] : null; }
  const ord = /^(?:the\s+|yang\s+|option\s+|pilihan\s+|lua chon\s+|so\s+|cai\s+|ข้อ\s*|ตัวเลือก\s*|ang\s+|yung\s+|opsyon\s+|选项\s*)?([a-z0-9฀-๿一二三第]+?)(?:\s+one|\s+yang|\s+thu|\s*個|\s*个|\s*项)?$/.exec(t);
  if (ord && NUMBER_WORDS[ord[1]] && NUMBER_WORDS[ord[1]] <= choices.length) return choices[NUMBER_WORDS[ord[1]] - 1];
  const labels = choices.map((c) => ({ c, l: clean(c.label) }));
  const exact = labels.filter((x) => x.l === t); if (exact.length === 1) return exact[0].c;
  if (t.length >= 3) {
    const hit = labels.filter((x) => x.l.includes(t) || (x.l.length >= 3 && t.includes(x.l)));
    if (hit.length === 1) return hit[0].c;
  }
  return null;
}
