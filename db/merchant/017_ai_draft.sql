-- A translation made by the AI and not yet touched by a person. The panel marks it "AI draft", and the AI never changes a text a person wrote.
ALTER TABLE kb_translations ADD COLUMN ai_draft TINYINT(1) NOT NULL DEFAULT 0;
