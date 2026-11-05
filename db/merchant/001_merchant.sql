-- The tables inside ONE merchant's own database (for example livechat_bot_m_luckypay).
-- Everything here belongs to that merchant, so there is no merchant_id column: the database itself is the merchant.
-- Words shared by all merchants, the merchant list and the logins live in the main database (livechat_bot).

CREATE TABLE settings (
  id TINYINT PRIMARY KEY DEFAULT 1,                 -- always one row
  tone VARCHAR(20) NOT NULL DEFAULT 'friendly',     -- friendly | formal
  answer_threshold DOUBLE NOT NULL DEFAULT 0.72, clarify_threshold DOUBLE NOT NULL DEFAULT 0.45,
  abuse_close_after INT NOT NULL DEFAULT 3,         -- 0 = never close, 1 = close at the first rude message
  closing_msg JSON NOT NULL, handoff_msg JSON NOT NULL,
  kind_reply JSON NOT NULL,                         -- optional custom kind reply per language
  business_hours JSON NULL,
  CONSTRAINT settings_one_row CHECK (id = 1));

CREATE TABLE limits (
  kind VARCHAR(20) PRIMARY KEY,                     -- deposit | withdraw
  min_amount DECIMAL(18,2) NOT NULL, max_amount DECIMAL(18,2) NOT NULL);

CREATE TABLE tools (
  tool VARCHAR(50) PRIMARY KEY,                     -- balance | transactions | points | deposit_status | withdraw_status
  enabled BOOLEAN NOT NULL DEFAULT true);

-- This merchant's own short forms for topic words (canonical = the topic name).
CREATE TABLE aliases (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  language VARCHAR(10), variant VARCHAR(200) NOT NULL, canonical VARCHAR(100) NOT NULL,
  weight DOUBLE NOT NULL DEFAULT 1, source VARCHAR(20) NOT NULL DEFAULT 'manual', approved BOOLEAN NOT NULL DEFAULT true);

-- Knowledge base
CREATE TABLE kb_categories (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, parent_id BIGINT NULL, name VARCHAR(200) NOT NULL, UNIQUE KEY kb_categories_name (name),
  FOREIGN KEY (parent_id) REFERENCES kb_categories(id));

CREATE TABLE kb_entries (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, category_id BIGINT NULL, intent_key VARCHAR(100) NOT NULL,
  title VARCHAR(255), tags JSON NULL, topic VARCHAR(100) NOT NULL DEFAULT '', aspect VARCHAR(50), topic_optional BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(20) NOT NULL DEFAULT 'live',       -- live | draft
  version INT NOT NULL DEFAULT 1, valid_from TIMESTAMP NULL, valid_to TIMESTAMP NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY kb_entries_unique (intent_key), INDEX kb_entries_status_idx (status),
  FOREIGN KEY (category_id) REFERENCES kb_categories(id));

CREATE TABLE kb_translations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, kb_id BIGINT NOT NULL,
  language VARCHAR(10) NOT NULL, question_examples JSON NOT NULL, answer_text TEXT NOT NULL,
  UNIQUE KEY kb_translations_unique (kb_id, language),
  FOREIGN KEY (kb_id) REFERENCES kb_entries(id) ON DELETE CASCADE);

-- Sample messages with the result the bot should give (the tests). The expected answer is also kept by name.
CREATE TABLE eval_cases (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, message TEXT NOT NULL, language VARCHAR(10), expected_decision VARCHAR(20) NOT NULL,
  expected_kb_id BIGINT NULL, expected_intent VARCHAR(100) NULL,
  FOREIGN KEY (expected_kb_id) REFERENCES kb_entries(id) ON DELETE SET NULL);

-- Every word customers type, saved automatically.
CREATE TABLE keyword_store (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, word VARCHAR(100) NOT NULL, language VARCHAR(10), hits INT NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'new',          -- new | topic | keyword | ignored
  first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source VARCHAR(20) NOT NULL DEFAULT 'live',         -- live | test
  note VARCHAR(200) NULL, guess VARCHAR(20) NULL,
  UNIQUE KEY keyword_store_unique (word));

-- Words per day, for the Keyword ranking screen.
CREATE TABLE keyword_daily (
  word VARCHAR(100) NOT NULL, day DATE NOT NULL, hits INT NOT NULL DEFAULT 0, PRIMARY KEY (word, day));

-- Messages the bot did not understand. The same text is counted, not repeated.
CREATE TABLE unmatched_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, text VARCHAR(500) NOT NULL, language VARCHAR(10), hits INT NOT NULL DEFAULT 1, resolved BOOLEAN NOT NULL DEFAULT false,
  first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  suggestion VARCHAR(300) NULL, resolution VARCHAR(100) NULL,
  UNIQUE KEY unmatched_unique (text));

-- Conversations
CREATE TABLE chat_sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, livechat_chat_id VARCHAR(100) UNIQUE, customer_ref VARCHAR(200), language VARCHAR(10), status VARCHAR(20),
  clarify_count INT NOT NULL DEFAULT 0, closed_reason VARCHAR(100), started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE chat_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, session_id BIGINT NOT NULL,
  livechat_event_id VARCHAR(100) UNIQUE, role VARCHAR(20), text TEXT, normalized_text TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX chat_messages_time (created_at),
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE);

CREATE TABLE bot_decisions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, message_id BIGINT NULL,
  decision VARCHAR(20) NOT NULL, matched_kb_id BIGINT NULL, confidence DOUBLE,
  candidates JSON NULL, reply_text TEXT, claude_ms INT, gpt_ms INT, validator_ok BOOLEAN,
  why VARCHAR(500) NULL, reviewed VARCHAR(100) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (matched_kb_id) REFERENCES kb_entries(id) ON DELETE SET NULL);

CREATE TABLE feedback (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, decision_id BIGINT NULL,
  agent_id VARCHAR(100), verdict VARCHAR(20), correct_kb_id BIGINT NULL, note TEXT,
  FOREIGN KEY (decision_id) REFERENCES bot_decisions(id) ON DELETE CASCADE,
  FOREIGN KEY (correct_kb_id) REFERENCES kb_entries(id) ON DELETE SET NULL);

-- Every published version of this merchant, with a full copy so it can be rolled back to.
CREATE TABLE versions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, version INT NOT NULL UNIQUE,
  actor VARCHAR(100) NOT NULL, summary VARCHAR(500) NOT NULL, snapshot LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
