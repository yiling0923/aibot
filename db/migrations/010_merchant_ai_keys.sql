-- A merchant's own AI provider keys (Claude = 'anthropic', ChatGPT = 'openai'), kept encrypted.
-- The panel shows only the last 4 characters. A merchant without its own key uses the shared key in .env.
CREATE TABLE merchant_ai_keys (
  merchant_id BIGINT NOT NULL,
  provider VARCHAR(20) NOT NULL,
  key_encrypted TEXT NOT NULL,
  key_last4 VARCHAR(4) NOT NULL,
  updated_by VARCHAR(100) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (merchant_id, provider),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE);
