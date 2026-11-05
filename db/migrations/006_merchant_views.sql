-- Read-only views for people who browse the database (phpMyAdmin).
-- Every view starts with the merchant, so open one and filter the "merchant_code" column to see a single merchant.
-- Words that apply to every merchant show merchant_code "(all merchants)".
-- Views hold no data of their own: change data in the control panel, not here.

CREATE OR REPLACE VIEW v_merchants AS
SELECT m.code AS merchant_code, m.name AS merchant_name, m.status, m.default_language, s.tone,
       (SELECT COUNT(*) FROM kb_entries e WHERE e.merchant_id = m.id) AS entries,
       (SELECT COUNT(*) FROM kb_entries e WHERE e.merchant_id = m.id AND e.status = 'live') AS live_entries,
       (SELECT COUNT(*) FROM keyword_store k WHERE k.merchant_id = m.id) AS keywords,
       (SELECT COUNT(*) FROM unmatched_messages u WHERE u.merchant_id = m.id) AS unmatched_messages,
       (SELECT COUNT(*) FROM chat_sessions c WHERE c.merchant_id = m.id) AS chats,
       m.handoff_group_id, m.livechat_group_id, m.created_at
FROM merchants m LEFT JOIN merchant_settings s ON s.merchant_id = m.id;

CREATE OR REPLACE VIEW v_answers AS
SELECT m.code AS merchant_code, m.name AS merchant_name, e.id AS entry_id, e.intent_key AS entry, e.topic, e.aspect, e.status,
       t.language, t.answer_text, t.question_examples, e.updated_at
FROM kb_entries e JOIN merchants m ON m.id = e.merchant_id LEFT JOIN kb_translations t ON t.kb_id = e.id;

CREATE OR REPLACE VIEW v_keywords AS
SELECT m.code AS merchant_code, m.name AS merchant_name, k.word, k.language, k.hits, k.status, k.note, k.guess, k.first_seen, k.last_seen
FROM keyword_store k JOIN merchants m ON m.id = k.merchant_id;

CREATE OR REPLACE VIEW v_unmatched AS
SELECT m.code AS merchant_code, m.name AS merchant_name, u.text, u.language, u.hits, u.resolved, u.suggestion, u.resolution, u.first_seen, u.last_seen
FROM unmatched_messages u JOIN merchants m ON m.id = u.merchant_id;

CREATE OR REPLACE VIEW v_settings AS
SELECT m.code AS merchant_code, m.name AS merchant_name, s.tone, s.answer_threshold, s.clarify_threshold, s.abuse_close_after,
       (SELECT GROUP_CONCAT(CONCAT(l.kind, ': ', IFNULL(l.min_amount, '-'), ' to ', IFNULL(l.max_amount, '-')) SEPARATOR ' | ') FROM merchant_limits l WHERE l.merchant_id = m.id) AS limits,
       (SELECT GROUP_CONCAT(CONCAT(t.tool, IF(t.enabled, ' on', ' off')) SEPARATOR ' | ') FROM merchant_tools t WHERE t.merchant_id = m.id) AS account_tools,
       s.business_hours, s.closing_msg, s.handoff_msg, s.kind_reply
FROM merchants m LEFT JOIN merchant_settings s ON s.merchant_id = m.id;

CREATE OR REPLACE VIEW v_words AS
SELECT 'short form' AS list, IFNULL(m.code, '(all merchants)') AS merchant_code, a.language, a.variant AS word, a.canonical AS meaning
FROM aliases a LEFT JOIN merchants m ON m.id = a.merchant_id
UNION ALL
SELECT CONCAT('block list: ', g.kind), IFNULL(m.code, '(all merchants)'), g.language, g.phrase, NULL
FROM guard_phrases g LEFT JOIN merchants m ON m.id = g.merchant_id
UNION ALL
SELECT CONCAT('greeting: ', p.kind), IFNULL(m.code, '(all merchants)'), p.language, p.phrase, NULL
FROM smalltalk_phrases p LEFT JOIN merchants m ON m.id = p.merchant_id;

CREATE OR REPLACE VIEW v_chats AS
SELECT m.code AS merchant_code, m.name AS merchant_name, c.id AS chat_id, c.started_at, c.status, c.language, c.customer_ref, c.closed_reason,
       x.created_at AS message_time, x.role, x.text
FROM chat_sessions c JOIN merchants m ON m.id = c.merchant_id LEFT JOIN chat_messages x ON x.session_id = c.id;

CREATE OR REPLACE VIEW v_logins AS
SELECT u.username, u.role, IFNULL(m.code, '(all merchants)') AS merchant_code, m.name AS merchant_name, u.created_at
FROM admin_users u LEFT JOIN merchants m ON m.id = u.merchant_id;
