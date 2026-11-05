import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../pool';
import { Tenants, ident } from '../tenants';

/** One-time move: every merchant's rows leave the shared tables and go into the merchant's own database.
 *  Ids are kept, so history and tests still point at the same things. Safe on an empty database (nothing to move). */
export async function splitIntoMerchantDatabases(pool: Pool): Promise<void> {
  const tenants = new Tenants(pool);
  const legacy = ['merchant_settings', 'merchant_limits', 'merchant_tools', 'aliases', 'kb_categories', 'kb_entries', 'kb_translations', 'eval_cases', 'keyword_store', 'keyword_daily',
    'unmatched_messages', 'chat_sessions', 'chat_messages', 'bot_decisions', 'feedback', 'smalltalk_phrases', 'guard_phrases', 'kb_versions'];
  const exists = async (t: string) => (await pool.query<RowDataPacket[]>('SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [t]))[0].length > 0;
  if (!(await exists('kb_entries'))) return;

  for (const m of await tenants.list(true)) {
    const db = ident(await tenants.ensure(m.code)); const id = m.id;
    const c = await pool.getConnection();
    try {
      await c.query('SET FOREIGN_KEY_CHECKS = 0');
      const copy = (table: string, cols: string, where = 'merchant_id = ?', target = table, source = table) =>
        c.query(`INSERT INTO ${db}.${target}(${cols}) SELECT ${cols} FROM ${ident(source)} WHERE ${where} ORDER BY 1`, where.includes('?') ? [id] : []);
      await c.query(`DELETE FROM ${db}.settings`);
      await c.query(`INSERT INTO ${db}.settings(id, tone, answer_threshold, clarify_threshold, abuse_close_after, closing_msg, handoff_msg, kind_reply, business_hours)
        SELECT 1, tone, answer_threshold, clarify_threshold, abuse_close_after, closing_msg, handoff_msg, kind_reply, business_hours FROM merchant_settings WHERE merchant_id = ?`, [id]);
      await copy('limits', 'kind, min_amount, max_amount', 'merchant_id = ?', 'limits', 'merchant_limits');
      await copy('tools', 'tool, enabled', 'merchant_id = ?', 'tools', 'merchant_tools');
      await copy('aliases', 'id, language, variant, canonical, weight, source, approved');
      await copy('kb_categories', 'id, parent_id, name');
      await copy('kb_entries', 'id, category_id, intent_key, title, tags, topic, aspect, topic_optional, status, version, valid_from, valid_to, updated_at');
      await copy('kb_translations', 'id, kb_id, language, question_examples, answer_text');
      await copy('eval_cases', 'id, message, language, expected_decision, expected_kb_id, expected_intent');
      await copy('keyword_store', 'id, word, language, hits, status, first_seen, last_seen, source, note, guess');
      await copy('keyword_daily', 'word, day, hits');
      await copy('unmatched_messages', 'id, text, language, hits, resolved, first_seen, last_seen, suggestion, resolution');
      await copy('chat_sessions', 'id, livechat_chat_id, customer_ref, language, status, clarify_count, closed_reason, started_at');
      await copy('chat_messages', 'id, session_id, livechat_event_id, role, text, normalized_text, created_at');
      await copy('bot_decisions', 'id, message_id, decision, matched_kb_id, confidence, candidates, reply_text, claude_ms, gpt_ms, validator_ok, why, reviewed, created_at');
      await copy('feedback', 'id, decision_id, agent_id, verdict, correct_kb_id, note');
      await copy('versions', 'version, actor, summary, snapshot, created_at', "kind = 'merchant' AND merchant_id = ?", 'versions', 'kb_versions');
      await c.query('SET FOREIGN_KEY_CHECKS = 1');
    } finally { c.release(); }
  }

  // new entries get ids after the highest one that exists
  const [mx] = (await pool.query<RowDataPacket[]>('SELECT COALESCE(MAX(id), 0) AS m FROM kb_entries'))[0];
  await pool.query(`ALTER TABLE kb_id_seq AUTO_INCREMENT = ${Number(mx.m) + 1}`);

  // the old shared tables are not needed any more
  const c = await pool.getConnection();
  try {
    await c.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of legacy) await c.query(`DROP TABLE IF EXISTS ${ident(t)}`);
    await c.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally { c.release(); }
}
