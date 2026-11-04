-- Every word customers type is saved here automatically (the "Keywords" screen in the control panel).
CREATE TABLE keyword_store (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, merchant_id BIGINT NOT NULL,
  word VARCHAR(100) NOT NULL, language VARCHAR(10), hits INT NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'new',          -- new | topic | keyword | ignored
  first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY keyword_store_unique (merchant_id, word),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE);

-- Messages the bot did not understand (the "Needs review" screen). The same text is counted, not repeated.
CREATE TABLE unmatched_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, merchant_id BIGINT NOT NULL,
  text VARCHAR(500) NOT NULL, language VARCHAR(10), hits INT NOT NULL DEFAULT 1, resolved BOOLEAN NOT NULL DEFAULT false,
  first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unmatched_unique (merchant_id, text),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE);
