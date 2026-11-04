-- PostgreSQL schema (matches the planning PDF). Needs the pgvector extension.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE merchants (
  id BIGSERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  status TEXT DEFAULT 'active', default_language TEXT DEFAULT 'en',
  livechat_group_id INT, handoff_group_id INT, created_at TIMESTAMPTZ DEFAULT now());

CREATE TABLE merchant_settings (
  merchant_id BIGINT PRIMARY KEY REFERENCES merchants(id),
  tone TEXT DEFAULT 'friendly', answer_threshold REAL DEFAULT 0.80, clarify_threshold REAL DEFAULT 0.55,
  abuse_action TEXT DEFAULT 'close', closing_msg JSONB, handoff_msg JSONB, business_hours JSONB);

CREATE TABLE aliases (
  id BIGSERIAL PRIMARY KEY, merchant_id BIGINT REFERENCES merchants(id),  -- NULL = global
  language TEXT, variant TEXT NOT NULL, canonical TEXT NOT NULL,
  weight REAL DEFAULT 1, source TEXT DEFAULT 'manual', approved BOOLEAN DEFAULT true);

CREATE TABLE kb_categories (
  id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL REFERENCES merchants(id),
  parent_id BIGINT REFERENCES kb_categories(id), name TEXT NOT NULL);

CREATE TABLE kb_entries (
  id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL REFERENCES merchants(id),
  category_id BIGINT REFERENCES kb_categories(id), intent_key TEXT NOT NULL,
  title TEXT, tags TEXT[], topic TEXT, aspect TEXT, topic_optional BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'live', version INT DEFAULT 1,
  valid_from TIMESTAMPTZ, valid_to TIMESTAMPTZ, UNIQUE (merchant_id, intent_key));

CREATE TABLE kb_translations (
  id BIGSERIAL PRIMARY KEY, kb_id BIGINT NOT NULL REFERENCES kb_entries(id) ON DELETE CASCADE,
  language TEXT NOT NULL, question_examples TEXT[], answer_text TEXT NOT NULL,
  tsv TSVECTOR, embedding VECTOR(1024), UNIQUE (kb_id, language));
CREATE INDEX ON kb_translations USING gin (tsv);
-- add after embeddings are filled: CREATE INDEX ON kb_translations USING hnsw (embedding vector_cosine_ops);

CREATE TABLE eval_cases (
  id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL REFERENCES merchants(id),
  message TEXT NOT NULL, language TEXT, expected_decision TEXT NOT NULL,   -- ANSWER|CHOICE|CLARIFY|SMALLTALK|HANDOFF|ABUSE
  expected_kb_id BIGINT REFERENCES kb_entries(id));

CREATE TABLE chat_sessions (
  id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL REFERENCES merchants(id),
  livechat_chat_id TEXT UNIQUE, customer_ref TEXT, language TEXT, status TEXT,
  clarify_count INT DEFAULT 0, closed_reason TEXT, started_at TIMESTAMPTZ DEFAULT now());

CREATE TABLE chat_messages (
  id BIGSERIAL PRIMARY KEY, session_id BIGINT NOT NULL REFERENCES chat_sessions(id),
  livechat_event_id TEXT UNIQUE, role TEXT, text TEXT, normalized_text TEXT,
  created_at TIMESTAMPTZ DEFAULT now());

CREATE TABLE bot_decisions (
  id BIGSERIAL PRIMARY KEY, message_id BIGINT REFERENCES chat_messages(id),
  decision TEXT NOT NULL, matched_kb_id BIGINT REFERENCES kb_entries(id), confidence REAL,
  candidates JSONB, reply_text TEXT, claude_ms INT, gpt_ms INT, validator_ok BOOLEAN);

CREATE TABLE feedback (
  id BIGSERIAL PRIMARY KEY, decision_id BIGINT REFERENCES bot_decisions(id),
  agent_id TEXT, verdict TEXT, correct_kb_id BIGINT REFERENCES kb_entries(id), note TEXT);

-- Greetings, thanks and goodbyes. merchant_id NULL = global. kind: morning | greeting | callout | thanks | bye | ack
CREATE TABLE smalltalk_phrases (
  id BIGSERIAL PRIMARY KEY, merchant_id BIGINT REFERENCES merchants(id),
  kind TEXT NOT NULL, language TEXT, phrase TEXT NOT NULL);

-- Keywords found ANYWHERE in a sentence. kind = time | limit | change | hours | how (global).
CREATE TABLE aspects (
  id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, language TEXT, keyword TEXT NOT NULL);

-- Block lists. kind = abuse | injection. merchant_id NULL = global.
CREATE TABLE guard_phrases (
  id BIGSERIAL PRIMARY KEY, merchant_id BIGINT REFERENCES merchants(id),
  kind TEXT NOT NULL, language TEXT, phrase TEXT NOT NULL);

-- Filler words (语助词 such as lah, loh, 啦). Ignored when looking for keywords.
CREATE TABLE filler_words (
  id BIGSERIAL PRIMARY KEY, language TEXT, word TEXT NOT NULL);
