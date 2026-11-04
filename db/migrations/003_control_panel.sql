-- Control panel: edit times, version history, daily keyword counts, review flags.
ALTER TABLE kb_entries ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE keyword_store ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'live';   -- live | test

ALTER TABLE bot_decisions
  ADD COLUMN why VARCHAR(500) NULL, ADD COLUMN reviewed VARCHAR(100) NULL,
  ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE unmatched_messages ADD COLUMN suggestion VARCHAR(300) NULL, ADD COLUMN resolution VARCHAR(100) NULL;

-- Every published version, with a full copy so it can be rolled back to.
CREATE TABLE kb_versions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, version INT NOT NULL UNIQUE,
  actor VARCHAR(100) NOT NULL, summary VARCHAR(500) NOT NULL, snapshot LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);

-- Words per day, for the Keyword ranking screen.
CREATE TABLE keyword_daily (
  merchant_id BIGINT NOT NULL, word VARCHAR(100) NOT NULL, day DATE NOT NULL, hits INT NOT NULL DEFAULT 0,
  PRIMARY KEY (merchant_id, word, day),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE);

ALTER TABLE keyword_store ADD COLUMN note VARCHAR(200) NULL;

-- Keep the expected answer by name, so a test still makes sense after an entry is edited or removed.
ALTER TABLE eval_cases ADD COLUMN expected_intent VARCHAR(100) NULL;
UPDATE eval_cases ec JOIN kb_entries e ON e.id = ec.expected_kb_id SET ec.expected_intent = e.intent_key;
