-- What the bot learned while it only listened: a customer question and the staff reply that followed it (personal details masked).
CREATE TABLE learned_pairs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  session_key VARCHAR(80) NOT NULL,
  pair_hash CHAR(40) NOT NULL,
  customer_text VARCHAR(600) NOT NULL,
  staff_text TEXT NULL,
  lang VARCHAR(10) NULL,
  customer_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY learned_pairs_unique (session_key, pair_hash),
  KEY learned_pairs_created (created_at)
);
