-- Optional: meaning-based search. Skipped automatically if the pgvector extension is not installed.
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE kb_translations ADD COLUMN IF NOT EXISTS embedding vector(1024);
