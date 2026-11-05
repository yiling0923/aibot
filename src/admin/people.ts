import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';
import { hashPassword } from '../auth/passwords';
import { checkLogin, upsertUser } from '../auth/users';
import type { Bot } from '../bot/responder';
import { readSnapshot } from './snapshot';
import '../auth/types';

export interface PeopleCtx { pool: Pool; reloadBot: () => Promise<Bot> }

const q = async <T extends RowDataPacket = RowDataPacket>(pool: Pool, sql: string, p: unknown[] = []) => (await pool.query<T[]>(sql, p))[0];
const fail = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });
const TOOLS = ['deposit_status', 'withdraw_status', 'balance', 'transactions', 'points'];
const FALLBACK_MSG = {
  closing: { en: 'This chat has been closed due to inappropriate language. Thank you for understanding.', ms: 'Sembang ini ditutup kerana bahasa yang tidak sesuai. Terima kasih.', zh: '由于不当用语，本次对话已结束。感谢您的理解。' },
  handoff: { en: 'Let me connect you to our team who can help you better. Please wait a moment!', ms: 'Biar saya sambungkan anda kepada pasukan kami yang boleh membantu. Sila tunggu sebentar!', zh: '让我为您转接客服团队，请稍等片刻！' },
};

/** Merchants and logins. Only an admin may use these, except changing your own password. */
export function peopleRoutes(app: FastifyInstance, ctx: PeopleCtx) {
  const { pool } = ctx; const A = '/api/admin';
  const adminOnly = (req: { user?: { role: string } }, reply: FastifyReply) => (req.user?.role === 'admin' ? true : (fail(reply, 403, 'Only an admin can do this.'), false));

  app.get(`${A}/people`, async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const merchants = await q(pool, `SELECT m.code, m.name, m.default_language, m.livechat_group_id, m.handoff_group_id, s.tone,
      (SELECT COUNT(*) FROM kb_entries e WHERE e.merchant_id = m.id) AS entries FROM merchants m JOIN merchant_settings s ON s.merchant_id = m.id ORDER BY m.id`);
    const users = await q(pool, 'SELECT u.username, u.role, m.code AS merchant FROM admin_users u LEFT JOIN merchants m ON m.id = u.merchant_id ORDER BY u.role, u.username');
    return {
      merchants: merchants.map((m) => ({ code: m.code, name: m.name, language: m.default_language, tone: m.tone, entries: Number(m.entries), livechatGroup: m.livechat_group_id, handoffGroup: m.handoff_group_id,
        logins: users.filter((u) => u.merchant === m.code).map((u) => u.username) })),
      users: users.map((u) => ({ username: u.username, role: u.role, merchant: u.merchant })),
    };
  });

  /** Adds a merchant with an empty knowledge base. The first staff login can be created in the same step. */
  app.post<{ Body: { code: string; name: string; language?: string; tone?: string; handoffGroup?: number | null; livechatGroup?: number | null; login?: { username: string; password: string } } }>(`${A}/merchants`, async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const b = req.body ?? ({} as never);
    const code = String(b.code ?? '').trim().toUpperCase(), name = String(b.name ?? '').trim();
    if (!/^[A-Z0-9_]{2,30}$/.test(code)) return fail(reply, 400, 'Code: 2-30 letters, digits or underscore, for example W88.');
    if (!name || name.length > 100) return fail(reply, 400, 'Give the merchant a name.');
    const language = ['en', 'ms', 'zh'].includes(String(b.language)) ? String(b.language) : 'en';
    const tone = b.tone === 'formal' ? 'formal' : 'friendly';
    const group = (v: unknown) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Math.trunc(Number(v)));
    if (b.login && (!b.login.username || !b.login.password)) return fail(reply, 400, 'Login: enter a username and a password, or leave both empty.');

    // Fixed messages start from the first merchant's wording, so the new merchant works straight away.
    const [first] = await q(pool, 'SELECT closing_msg, handoff_msg FROM merchant_settings ORDER BY merchant_id LIMIT 1');
    const closing = first?.closing_msg ?? JSON.stringify(FALLBACK_MSG.closing), handoff = first?.handoff_msg ?? JSON.stringify(FALLBACK_MSG.handoff);
    const asText = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const id = (await c.query<ResultSetHeader>('INSERT INTO merchants(code, name, default_language, livechat_group_id, handoff_group_id) VALUES(?,?,?,?,?)', [code, name, language, group(b.livechatGroup), group(b.handoffGroup)]))[0].insertId;
      await c.query('INSERT INTO merchant_settings(merchant_id, tone, closing_msg, handoff_msg, kind_reply) VALUES(?,?,?,?,?)', [id, tone, asText(closing), asText(handoff), '{}']);
      for (const t of TOOLS) await c.query('INSERT INTO merchant_tools(merchant_id, tool, enabled) VALUES(?,?,?)', [id, t, t.endsWith('_status')]);
      await c.commit();
    } catch (e) {
      await c.rollback();
      if ((e as { code?: string }).code === 'ER_DUP_ENTRY') return fail(reply, 409, `A merchant with the code ${code} already exists.`);
      throw e;
    } finally { c.release(); }

    if (b.login) {
      try { await upsertUser(pool, { username: b.login.username, password: b.login.password, role: 'staff', merchant: code }); }
      catch (e) { return fail(reply, 400, `The merchant ${code} was added, but the login was not: ${(e as Error).message}`); }
    }
    const [ver] = await q(pool, 'SELECT COALESCE(MAX(version), 0) AS v FROM kb_versions');
    await pool.query('INSERT INTO kb_versions(version, actor, summary, snapshot) VALUES(?,?,?,?)', [Number(ver.v) + 1, req.user!.username, `Added merchant ${name} (${code})`, JSON.stringify(await readSnapshot(pool))]);
    await ctx.reloadBot();
    return { code, name };
  });

  app.post<{ Body: { username: string; password: string; role: 'admin' | 'staff'; merchant?: string } }>(`${A}/users`, async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const b = req.body ?? ({} as never);
    if (b.role !== 'admin' && b.role !== 'staff') return fail(reply, 400, 'Choose admin or staff.');
    const username = String(b.username ?? '').trim().toLowerCase();
    if ((await q(pool, 'SELECT 1 FROM admin_users WHERE username = ?', [username])).length) return fail(reply, 409, `The username ${username} is already used.`);
    try { await upsertUser(pool, { username, password: String(b.password ?? ''), role: b.role, merchant: b.merchant }); }
    catch (e) { return fail(reply, 400, (e as Error).message); }
    return { username };
  });

  app.post<{ Body: { username: string; password: string } }>(`${A}/users/password`, async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const { username, password } = req.body ?? ({} as never);
    if (String(password ?? '').length < 6) return fail(reply, 400, 'Password: at least 6 characters.');
    const r = (await pool.query<ResultSetHeader>('UPDATE admin_users SET password_hash = ? WHERE username = ?', [hashPassword(password), String(username).toLowerCase()]))[0];
    return r.affectedRows ? { ok: true } : fail(reply, 404, 'No such user.');
  });

  app.post<{ Body: { username: string } }>(`${A}/users/delete`, async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const username = String(req.body?.username ?? '').toLowerCase();
    if (username === req.user!.username) return fail(reply, 400, 'You cannot remove your own login.');
    const [target] = await q(pool, 'SELECT role FROM admin_users WHERE username = ?', [username]);
    if (!target) return fail(reply, 404, 'No such user.');
    if (target.role === 'admin' && Number((await q(pool, "SELECT COUNT(*) AS n FROM admin_users WHERE role = 'admin'"))[0].n) <= 1) return fail(reply, 400, 'There must be at least one admin.');
    await pool.query('DELETE FROM admin_users WHERE username = ?', [username]);
    return { ok: true };
  });

  /** Anyone can change their own password. */
  app.post<{ Body: { current: string; password: string } }>('/api/auth/password', async (req, reply) => {
    const { current, password } = req.body ?? ({} as never);
    if (String(password ?? '').length < 6) return fail(reply, 400, 'The new password needs at least 6 characters.');
    if (!(await checkLogin(pool, req.user!.username, String(current ?? '')))) return fail(reply, 403, 'The current password is wrong.');
    await pool.query('UPDATE admin_users SET password_hash = ? WHERE username = ?', [hashPassword(password), req.user!.username]);
    return { ok: true };
  });
}
