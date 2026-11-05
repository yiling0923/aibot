-- Everything belongs to a merchant.
-- 1. Rows that used to belong to a merchant only through another table now carry merchant_id themselves,
--    and a composite foreign key makes it impossible to attach a row to a different merchant than its parent.
-- 2. Versions (publish history) are kept per merchant, so each merchant publishes and rolls back on its own.
--    Words shared by all merchants have their own history ("shared").

-- (an earlier build added read-only views; they are not used any more)
DROP VIEW IF EXISTS v_merchants;  DROP VIEW IF EXISTS v_answers;  DROP VIEW IF EXISTS v_keywords;  DROP VIEW IF EXISTS v_unmatched;
DROP VIEW IF EXISTS v_settings;   DROP VIEW IF EXISTS v_words;    DROP VIEW IF EXISTS v_chats;     DROP VIEW IF EXISTS v_logins;

-- parents get a (id, merchant_id) key so children can point at the pair
ALTER TABLE kb_entries    ADD UNIQUE KEY kb_entries_id_merchant (id, merchant_id);
ALTER TABLE chat_sessions ADD UNIQUE KEY chat_sessions_id_merchant (id, merchant_id);

-- answers and examples
ALTER TABLE kb_translations ADD COLUMN merchant_id BIGINT NULL AFTER id;
UPDATE kb_translations t JOIN kb_entries e ON e.id = t.kb_id SET t.merchant_id = e.merchant_id;
ALTER TABLE kb_translations MODIFY merchant_id BIGINT NOT NULL,
  ADD CONSTRAINT kb_translations_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
  ADD CONSTRAINT kb_translations_entry_merchant FOREIGN KEY (kb_id, merchant_id) REFERENCES kb_entries(id, merchant_id) ON DELETE CASCADE,
  ADD KEY kb_translations_merchant_lang (merchant_id, language);

-- chat messages
ALTER TABLE chat_messages ADD COLUMN merchant_id BIGINT NULL AFTER id;
UPDATE chat_messages m JOIN chat_sessions s ON s.id = m.session_id SET m.merchant_id = s.merchant_id;
ALTER TABLE chat_messages MODIFY merchant_id BIGINT NOT NULL,
  ADD UNIQUE KEY chat_messages_id_merchant (id, merchant_id),
  ADD CONSTRAINT chat_messages_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
  ADD CONSTRAINT chat_messages_session_merchant FOREIGN KEY (session_id, merchant_id) REFERENCES chat_sessions(id, merchant_id) ON DELETE CASCADE,
  ADD KEY chat_messages_merchant_time (merchant_id, created_at);

-- what the bot decided (a decision without a message cannot belong to any merchant, so such leftovers are removed)
DELETE FROM bot_decisions WHERE message_id IS NULL;
ALTER TABLE bot_decisions ADD COLUMN merchant_id BIGINT NULL AFTER id;
UPDATE bot_decisions d JOIN chat_messages m ON m.id = d.message_id SET d.merchant_id = m.merchant_id;
ALTER TABLE bot_decisions MODIFY merchant_id BIGINT NOT NULL,
  ADD UNIQUE KEY bot_decisions_id_merchant (id, merchant_id),
  ADD CONSTRAINT bot_decisions_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
  ADD CONSTRAINT bot_decisions_message_merchant FOREIGN KEY (message_id, merchant_id) REFERENCES chat_messages(id, merchant_id) ON DELETE CASCADE;

-- agent feedback on a decision
DELETE FROM feedback WHERE decision_id IS NULL;
ALTER TABLE feedback ADD COLUMN merchant_id BIGINT NULL AFTER id;
UPDATE feedback f JOIN bot_decisions d ON d.id = f.decision_id SET f.merchant_id = d.merchant_id;
ALTER TABLE feedback MODIFY merchant_id BIGINT NOT NULL,
  ADD CONSTRAINT feedback_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
  ADD CONSTRAINT feedback_decision_merchant FOREIGN KEY (decision_id, merchant_id) REFERENCES bot_decisions(id, merchant_id) ON DELETE CASCADE;

-- versions: one history per merchant, one for the shared word lists.
-- Old rows are full copies of every merchant at once, so they are kept as "legacy" and no longer shown or rolled back to.
ALTER TABLE kb_versions DROP INDEX version;
ALTER TABLE kb_versions
  ADD COLUMN kind ENUM('merchant','shared','legacy') NOT NULL DEFAULT 'legacy' AFTER id,
  ADD COLUMN merchant_id BIGINT NULL AFTER kind,
  ADD CONSTRAINT kb_versions_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
  ADD UNIQUE KEY kb_versions_scope (kind, merchant_id, version);
ALTER TABLE kb_versions MODIFY kind ENUM('merchant','shared','legacy') NOT NULL DEFAULT 'merchant';
