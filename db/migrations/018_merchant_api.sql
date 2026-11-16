-- Where the bot reads a logged-in customer's account (balance, points, deposits, withdrawals) from the merchant's own system.
-- The key is stored encrypted. A merchant without a row here uses the built-in sample customers (demo only).
CREATE TABLE merchant_api (
  merchant_id BIGINT NOT NULL PRIMARY KEY,
  base_url VARCHAR(300) NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  key_last4 VARCHAR(8) NOT NULL,
  checked_at TIMESTAMP NULL,
  check_error VARCHAR(300) NULL,
  updated_by VARCHAR(100) NULL,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE);
