-- The main database (livechat_bot) keeps what is shared by all merchants:
-- the merchant list, the logins, the shared word lists and their version history.
-- Each merchant's own data lives in its own database (see db/merchant). Names look like <main>_m_<code>.
ALTER TABLE merchants ADD COLUMN db_name VARCHAR(64) NULL, ADD UNIQUE KEY merchants_db_name (db_name);

CREATE TABLE shared_aliases (id BIGINT AUTO_INCREMENT PRIMARY KEY, language VARCHAR(10), variant VARCHAR(200) NOT NULL, canonical VARCHAR(100) NOT NULL,
  weight DOUBLE NOT NULL DEFAULT 1, source VARCHAR(20) NOT NULL DEFAULT 'manual', approved BOOLEAN NOT NULL DEFAULT true);
CREATE TABLE shared_smalltalk (id BIGINT AUTO_INCREMENT PRIMARY KEY, kind VARCHAR(30) NOT NULL, language VARCHAR(10), phrase VARCHAR(255) NOT NULL);
CREATE TABLE shared_guard (id BIGINT AUTO_INCREMENT PRIMARY KEY, kind VARCHAR(30) NOT NULL, language VARCHAR(10), phrase VARCHAR(255) NOT NULL);
CREATE TABLE shared_versions (id BIGINT AUTO_INCREMENT PRIMARY KEY, version INT NOT NULL UNIQUE, actor VARCHAR(100) NOT NULL, summary VARCHAR(500) NOT NULL,
  snapshot LONGTEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);

INSERT INTO shared_aliases(id, language, variant, canonical, weight, source, approved) SELECT id, language, variant, canonical, weight, source, approved FROM aliases WHERE merchant_id IS NULL;
INSERT INTO shared_smalltalk(id, kind, language, phrase) SELECT id, kind, language, phrase FROM smalltalk_phrases WHERE merchant_id IS NULL;
INSERT INTO shared_guard(id, kind, language, phrase) SELECT id, kind, language, phrase FROM guard_phrases WHERE merchant_id IS NULL;
INSERT INTO shared_versions(version, actor, summary, snapshot, created_at) SELECT version, actor, summary, snapshot, created_at FROM kb_versions WHERE kind = 'shared';

-- Entry ids are handed out from here, so an id never repeats across merchants (the control panel finds entries by id).
CREATE TABLE kb_id_seq (id BIGINT AUTO_INCREMENT PRIMARY KEY);
