-- Guided answers: up to 3 questions asked after the answer (JSON: [{ kind, ask: { en, ms, zh } }]); the chat then goes to a person with the details as a note.
ALTER TABLE kb_entries ADD COLUMN steps TEXT NULL;
