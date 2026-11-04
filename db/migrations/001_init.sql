-- Core tables (MySQL 8). Every row that belongs to a merchant carries merchant_id.

CREATE TABLE merchants (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(50) NOT NULL UNIQUE, name VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active', default_language VARCHAR(10) NOT NULL DEFAULT 'en',
  livechat_group_id INT, handoff_group_id INT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE merchant_settings (
  merchant_id BIGINT PRIMARY KEY,
  tone VARCHAR(20) NOT NULL DEFAULT 'friendly',     -- friendly | formal
  answer_threshold DOUBLE NOT NULL DEFAULT 0.72, clarify_threshold DOUBLE NOT NULL DEFAULT 0.45,
  abuse_close_after INT NOT NULL DEFAULT 3,         -- 0 = never close, 1 = close at the first rude message
  closing_msg JSON NOT NULL, handoff_msg JSON NOT NULL,
  kind_reply JSON NOT NULL,                         -- optional custom kind reply per language
  business_hours JSON NULL,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE);

CREATE TABLE merchant_limits (
  merchant_id BIGINT NOT NULL,
  kind VARCHAR(20) NOT NULL,                        -- deposit | withdraw
  min_amount DECIMAL(18,2) NOT NULL, max_amount DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (merchant_id, kind),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE);

CREATE TABLE merchant_tools (
  merchant_id BIGINT NOT NULL,
  tool VARCHAR(50) NOT NULL,                        -- balance | transactions | points | deposit_status | withdraw_status
  enabled BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (merchant_id, tool),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE);

-- Topic keywords. canonical = the topic name. merchant_id NULL = global (all merchants).
CREATE TABLE aliases (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, merchant_id BIGINT NULL,
  language VARCHAR(10), variant VARCHAR(200) NOT NULL, canonical VARCHAR(100) NOT NULL,
  weight DOUBLE NOT NULL DEFAULT 1, source VARCHAR(20) NOT NULL DEFAULT 'manual', approved BOOLEAN NOT NULL DEFAULT true,
  INDEX aliases_merchant_idx (merchant_id),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE);

CREATE TABLE kb_categories (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, merchant_id BIGINT NOT NULL,
  parent_id BIGINT NULL, name VARCHAR(200) NOT NULL,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES kb_categories(id));

CREATE TABLE kb_entries (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, merchant_id BIGINT NOT NULL,
  category_id BIGINT NULL, intent_key VARCHAR(100) NOT NULL,
  title VARCHAR(255), tags JSON NULL, topic VARCHAR(100) NOT NULL DEFAULT '', aspect VARCHAR(50), topic_optional BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(20) NOT NULL DEFAULT 'live',       -- live | draft
  version INT NOT NULL DEFAULT 1, valid_from TIMESTAMP NULL, valid_to TIMESTAMP NULL,
  UNIQUE KEY kb_entries_unique (merchant_id, intent_key),
  INDEX kb_entries_merchant_idx (merchant_id, status),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES kb_categories(id));

CREATE TABLE kb_translations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, kb_id BIGINT NOT NULL,
  language VARCHAR(10) NOT NULL, question_examples JSON NOT NULL, answer_text TEXT NOT NULL,
  UNIQUE KEY kb_translations_unique (kb_id, language),
  FOREIGN KEY (kb_id) REFERENCES kb_entries(id) ON DELETE CASCADE);

-- Words the engine looks for ANYWHERE in a sentence. kind = time | limit | change | hours | how (global).
CREATE TABLE aspects (id BIGINT AUTO_INCREMENT PRIMARY KEY, kind VARCHAR(30) NOT NULL, language VARCHAR(10), keyword VARCHAR(200) NOT NULL);

-- Greetings, thanks, goodbyes. kind = morning | greeting | callout | thanks | bye | ack. merchant_id NULL = global.
CREATE TABLE smalltalk_phrases (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, merchant_id BIGINT NULL,
  kind VARCHAR(30) NOT NULL, language VARCHAR(10), phrase VARCHAR(255) NOT NULL,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE);

-- Block lists. kind = abuse | abuse_soft | injection | reveal_verb | secret_object | secret_phrase | reveal_except.
CREATE TABLE guard_phrases (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, merchant_id BIGINT NULL,
  kind VARCHAR(30) NOT NULL, language VARCHAR(10), phrase VARCHAR(255) NOT NULL,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE);

-- Filler words (lah, loh, 啦): ignored when looking for keywords.
CREATE TABLE filler_words (id BIGINT AUTO_INCREMENT PRIMARY KEY, language VARCHAR(10), word VARCHAR(100) NOT NULL);

-- Sample messages with the result the bot should give (the acceptance tests).
CREATE TABLE eval_cases (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, merchant_id BIGINT NOT NULL,
  message TEXT NOT NULL, language VARCHAR(10), expected_decision VARCHAR(20) NOT NULL,
  expected_kb_id BIGINT NULL,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
  FOREIGN KEY (expected_kb_id) REFERENCES kb_entries(id) ON DELETE SET NULL);

-- Conversation log (used from phase 4 on).
CREATE TABLE chat_sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, merchant_id BIGINT NOT NULL,
  livechat_chat_id VARCHAR(100) UNIQUE, customer_ref VARCHAR(200), language VARCHAR(10), status VARCHAR(20),
  clarify_count INT NOT NULL DEFAULT 0, closed_reason VARCHAR(100), started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE);

CREATE TABLE chat_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, session_id BIGINT NOT NULL,
  livechat_event_id VARCHAR(100) UNIQUE, role VARCHAR(20), text TEXT, normalized_text TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE);

CREATE TABLE bot_decisions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, message_id BIGINT NULL,
  decision VARCHAR(20) NOT NULL, matched_kb_id BIGINT NULL, confidence DOUBLE,
  candidates JSON NULL, reply_text TEXT, claude_ms INT, gpt_ms INT, validator_ok BOOLEAN,
  FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (matched_kb_id) REFERENCES kb_entries(id) ON DELETE SET NULL);

CREATE TABLE feedback (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, decision_id BIGINT NULL,
  agent_id VARCHAR(100), verdict VARCHAR(20), correct_kb_id BIGINT NULL, note TEXT,
  FOREIGN KEY (decision_id) REFERENCES bot_decisions(id) ON DELETE CASCADE,
  FOREIGN KEY (correct_kb_id) REFERENCES kb_entries(id) ON DELETE SET NULL);
