/** The countries a merchant can be in: its timezone and the languages it usually needs follow from the country. */
export interface Country { code: string; name: string; zh: string; tz: string; utc: string; langs: string[]; currency: string }
export const COUNTRIES: Country[] = [
  { code: 'MY', name: 'Malaysia', zh: '马来西亚', tz: 'Asia/Kuala_Lumpur', utc: 'UTC+8', langs: ['en', 'ms', 'zh'], currency: 'RM' },
  { code: 'SG', name: 'Singapore', zh: '新加坡', tz: 'Asia/Singapore', utc: 'UTC+8', langs: ['en', 'zh', 'ms'], currency: 'SGD' },
  { code: 'VN', name: 'Vietnam', zh: '越南', tz: 'Asia/Ho_Chi_Minh', utc: 'UTC+7', langs: ['vi', 'en'], currency: '₫' },
  { code: 'TH', name: 'Thailand', zh: '泰国', tz: 'Asia/Bangkok', utc: 'UTC+7', langs: ['th', 'en'], currency: '฿' },
  { code: 'PH', name: 'Philippines', zh: '菲律宾', tz: 'Asia/Manila', utc: 'UTC+8', langs: ['tl', 'en'], currency: '₱' },
  { code: 'ID', name: 'Indonesia', zh: '印度尼西亚', tz: 'Asia/Jakarta', utc: 'UTC+7', langs: ['en', 'ms'], currency: 'Rp' },
  { code: 'HK', name: 'Hong Kong', zh: '香港', tz: 'Asia/Hong_Kong', utc: 'UTC+8', langs: ['zh', 'en'], currency: 'HK$' },
  { code: 'CN', name: 'China', zh: '中国', tz: 'Asia/Shanghai', utc: 'UTC+8', langs: ['zh', 'en'], currency: '¥' },
  { code: 'TW', name: 'Taiwan', zh: '台湾', tz: 'Asia/Taipei', utc: 'UTC+8', langs: ['zh', 'en'], currency: 'NT$' },
  { code: 'IN', name: 'India', zh: '印度', tz: 'Asia/Kolkata', utc: 'UTC+5:30', langs: ['en'], currency: '₹' },
];
export const countryOf = (code?: string | null): Country | undefined => COUNTRIES.find((c) => c.code === (code ?? '').toUpperCase());
/** A country guessed from the money sign, when none was chosen yet. */
export const guessCountry = (currency?: string | null): Country | undefined => {
  const c = (currency ?? '').trim().toUpperCase(); if (!c) return undefined;
  return COUNTRIES.find((x) => x.currency.toUpperCase() === c || (c === 'MYR' && x.code === 'MY') || (c === 'THB' && x.code === 'TH') || (c === 'VND' && x.code === 'VN') || (c === 'PHP' && x.code === 'PH') || (c === 'IDR' && x.code === 'ID'));
};
