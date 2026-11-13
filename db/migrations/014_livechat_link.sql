-- How the bot talks to a merchant's LiveChat account, to keep the "ask for a person after N bot replies" number the same in both.
-- LiveChat is the source of truth: the bot copies the number from there, and a change made in the bot panel is sent to LiveChat first.
CREATE TABLE merchant_livechat (
  merchant_id BIGINT NOT NULL PRIMARY KEY,
  base_url VARCHAR(300) NOT NULL,
  email VARCHAR(200) NOT NULL,
  password_encrypted TEXT NOT NULL,
  handoff_after_replies INT NULL,
  synced_at TIMESTAMP NULL,
  sync_error VARCHAR(300) NULL,
  updated_by VARCHAR(100) NULL,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE);
