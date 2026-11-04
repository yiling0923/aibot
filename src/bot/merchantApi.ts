import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Tx { ref: string; type?: 'deposit' | 'withdraw'; amount: string; day: string; hm?: string; status: 'pending' | 'processing' | 'success' | 'failed' }
export interface Account { name: string; balance?: string; points?: number; level?: string; deposits?: Tx[]; withdrawals?: Tx[]; transactions?: Tx[] }

/** Stand-in for each merchant's own API (read only). Phase 8 replaces this with real HTTP calls. */
export interface MerchantApi { getAccount(merchant: string, customerId: string): Account | undefined }

export function fakeMerchantApi(file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/fake_accounts.json')): MerchantApi {
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Record<string, Account>>;
  return { getAccount: (m, id) => (m.startsWith('_') ? undefined : data[m]?.[id]) };
}
