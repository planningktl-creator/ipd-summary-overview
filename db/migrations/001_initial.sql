CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_cases (
  case_ref text PRIMARY KEY,
  status text NOT NULL,
  payload_ciphertext text NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  event_id uuid PRIMARY KEY,
  case_ref text NOT NULL,
  event_type text NOT NULL,
  actor_id text NOT NULL,
  payload_ciphertext text NOT NULL,
  occurred_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_case_ref_idx ON audit_events (case_ref, occurred_at DESC);

CREATE TABLE IF NOT EXISTS ai_artifacts (
  artifact_id text PRIMARY KEY,
  case_ref text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  input_hash text NOT NULL,
  output_ciphertext text NOT NULL,
  synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_artifacts_case_ref_idx ON ai_artifacts (case_ref, created_at DESC);

CREATE TABLE IF NOT EXISTS attachments (
  attachment_id uuid PRIMARY KEY,
  case_ref text NOT NULL,
  filename text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes >= 0),
  sha256 text NOT NULL,
  uploaded_by text NOT NULL,
  content_ciphertext text NOT NULL,
  uploaded_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_case_ref_idx ON attachments (case_ref, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS access_logs (
  access_id uuid PRIMARY KEY,
  actor_id text NOT NULL,
  action text NOT NULL,
  case_hash text,
  occurred_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'error')),
  correlation_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS access_logs_occurred_at_idx ON access_logs (occurred_at DESC);
