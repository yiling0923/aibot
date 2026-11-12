-- The key a merchant's LiveChat uses to call the bot (POST /api/v1/ai/ask, header "Authorization: Bearer <key>").
-- Only a hash of the key is kept, so a key can be shown once when it is made and never again.
-- The key tells the bot which merchant is asking.
CREATE TABLE bot_api_keys (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  merchant_id BIGINT NOT NULL,
  key_prefix VARCHAR(12) NOT NULL,                  -- the first characters, to recognise a key in a list
  key_hash CHAR(64) NOT NULL,                       -- SHA-256 of the whole key
  label VARCHAR(100) NULL,
  created_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP NULL,
  revoked_at TIMESTAMP NULL,
  UNIQUE KEY bot_api_keys_hash (key_hash),
  KEY bot_api_keys_merchant (merchant_id),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE);
