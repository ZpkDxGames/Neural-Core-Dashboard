BEGIN;
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','other')),
  body TEXT NOT NULL,
  written_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id,message_id)
);
CREATE TABLE IF NOT EXISTS memory_nodes (
  id TEXT PRIMARY KEY,
  node_type TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  confidence DOUBLE PRECISION CHECK (confidence BETWEEN 0 AND 1),
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memory_edges (
  source_id TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  confidence DOUBLE PRECISION CHECK (confidence BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(source_id,target_id,relation)
);
CREATE TABLE IF NOT EXISTS memory_evidence (
  node_id TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(node_id,conversation_id,message_id)
);
CREATE INDEX IF NOT EXISTS conversations_source_idx ON conversations(source_id);
CREATE INDEX IF NOT EXISTS messages_written_idx ON messages(written_at);
CREATE INDEX IF NOT EXISTS memory_edges_target_idx ON memory_edges(target_id);
INSERT INTO sources(id,display_name) VALUES
  ('chatgpt','ChatGPT'),('claude','Claude'),('gemini','Gemini'),('generic','Other')
ON CONFLICT (id) DO NOTHING;
COMMIT;
