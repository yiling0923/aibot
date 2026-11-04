-- Core tables. Every row that belongs to a merchant carries merchant_id.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE merchants (
  id BIGSERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', default_language TEXT NOT NULL DEFAULT 'en',
  livechat_group_id INT, handoff_group_id INT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE merchant_settings (
  merchant_id BIGINT PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
  tone TEXT NOT NULL DEFAULT 'friendly',            -- friendly | formal
  answer_threshold REAL NOT NULL DEFAULT 0.72, clarify_threshold REAL NOT NULL DEFAULT 0.45,
  abuse_close_after INT NOT NULL DEFAULT 3,         -- 0 = never close, 1 = close at the first rude message
  closing_msg JSONB NOT NULL DEFAULT '{}', handoff_msg JSONB NOT NULL DEFAULT '{}',
  kind_reply JSONB NOT NULL DEFAULT '{}',           -- optional custom kind reply per language
  business_hours JSONB);

CREATE TABLE merchant_limits (
  merchant_id BIGINT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                               -- deposit | withdraw
  min_amount NUMERIC NOT NULL, max_amount NUMERIC NOT NULL,
  PRIMARY KEY (merchant_id, kind));

CREATE TABLE merchant_tools (
  merchant_id BIGINT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,                               -- balance | transactions | points | deposit_status | withdraw_status
  enabled BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (merchant_id, tool));

-- Topic keywords. canonical = the topic name. merchant_id NULL = global (all merchants).
CREATE TABLE aliases (
  id BIGSERIAL PRIMARY KEY, merchant_id BIGINT REFERENCES merchants(id) ON DELETE CASCADE,
  language TEXT, variant TEXT NOT NULL, canonical TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'manual', approved BOOLEAN NOT NULL DEFAULT true);
CREATE INDEX aliases_merchant_idx ON aliases (merchant_id);

CREATE TABLE kb_categories (
  id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  parent_id BIGINT REFERENCES kb_categories(id), name TEXT NOT NULL);

CREATE TABLE kb_entries (
  id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  category_id BIGINT REFERENCES kb_categories(id), intent_key TEXT NOT NULL,
  title TEXT, tags TEXT[], topic TEXT NOT NULL DEFAULT '', aspect TEXT, topic_optional BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'live',              -- live | draft
  version INT NOT NULL DEFAULT 1, valid_from TIMESTAMPTZ, valid_to TIMESTAMPTZ,
  UNIQUE (merchant_id, intent_key));
CREATE INDEX kb_entries_merchant_idx ON kb_entries (merchant_id, status);

CREATE TABLE kb_translations (
  id BIGSERIAL PRIMARY KEY, kb_id BIGINT NOT NULL REFERENCES kb_entries(id) ON DELETE CASCADE,
  language TEXT NOT NULL, question_examples TEXT[] NOT NULL DEFAULT '{}', answer_text TEXT NOT NULL DEFAULT '',
  tsv TSVECTOR, UNIQUE (kb_id, language));
CREATE INDEX kb_translations_tsv_idx ON kb_translations USING gin (tsv);

-- Words the engine looks for ANYWHERE in a sentence. kind = time | limit | change | hours | how (global).
CREATE TABLE aspects (id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, language TEXT, keyword TEXT NOT NULL);

-- Greetings, thanks, goodbyes. kind = morning | greeting | callout | thanks | bye | ack. merchant_id NULL = global.
CREATE TABLE smalltalk_phrases (
  id BIGSERIAL PRIMARY KEY, merchant_id BIGINT REFERENCES merchants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, language TEXT, phrase TEXT NOT NULL);

-- Block lists. kind = abuse | abuse_soft | injection | reveal_verb | secret_object | secret_phrase | reveal_except.
CREATE TABLE guard_phrases (
  id BIGSERIAL PRIMARY KEY, merchant_id BIGINT REFERENCES merchants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, language TEXT, phrase TEXT NOT NULL);

-- Filler words (lah, loh, 啦): ignored when looking for keywords.
CREATE TABLE filler_words (id BIGSERIAL PRIMARY KEY, language TEXT, word TEXT NOT NULL);

-- Sample messages with the result the bot should give (the acceptance tests).
CREATE TABLE eval_cases (
  id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  message TEXT NOT NULL, language TEXT, expected_decision TEXT NOT NULL,
  expected_kb_id BIGINT REFERENCES kb_entries(id) ON DELETE SET NULL);

-- Conversation log (used from phase 4 on).
CREATE TABLE chat_sessions (
  id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  livechat_chat_id TEXT UNIQUE, customer_ref TEXT, language TEXT, status TEXT,
  clarify_count INT NOT NULL DEFAULT 0, closed_reason TEXT, started_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE chat_messages (
  id BIGSERIAL PRIMARY KEY, session_id BIGINT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  livechat_event_id TEXT UNIQUE, role TEXT, text TEXT, normalized_text TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE bot_decisions (
  id BIGSERIAL PRIMARY KEY, message_id BIGINT REFERENCES chat_messages(id) ON DELETE CASCADE,
  decision TEXT NOT NULL, matched_kb_id BIGINT REFERENCES kb_entries(id) ON DELETE SET NULL, confidence REAL,
  candidates JSONB, reply_text TEXT, claude_ms INT, gpt_ms INT, validator_ok BOOLEAN);

CREATE TABLE feedback (
  id BIGSERIAL PRIMARY KEY, decision_id BIGINT REFERENCES bot_decisions(id) ON DELETE CASCADE,
  agent_id TEXT, verdict TEXT, correct_kb_id BIGINT REFERENCES kb_entries(id) ON DELETE SET NULL, note TEXT);
