-- Real customer question -> staff reply pairs, loaded on the Study screen to measure the bot and to find the answers that are missing.
-- Personal details were removed before a pair is saved. split: "learn" pairs may be used to write answers; "test" pairs (about 20%) are held back to measure the bot.
CREATE TABLE study_pairs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pair_hash CHAR(40) NOT NULL,
  question TEXT NOT NULL,
  reply TEXT NOT NULL,
  split VARCHAR(5) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY study_pairs_hash (pair_hash),
  KEY study_pairs_split (split));
