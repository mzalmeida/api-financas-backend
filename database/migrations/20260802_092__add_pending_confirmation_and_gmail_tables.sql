BEGIN;

ALTER TABLE imports
  DROP CONSTRAINT ck_imports__status_code;

ALTER TABLE imports
  ADD CONSTRAINT ck_imports__status_code CHECK (
    status_code IN ('pending', 'pending_confirmation', 'processing', 'completed', 'completed_with_errors', 'failed', 'cancelled')
  );

CREATE TABLE gmail_integrations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  gmail_email varchar(255),
  encrypted_refresh_token text,
  refresh_token_iv varchar(64),
  refresh_token_tag varchar(64),
  token_algorithm varchar(40) NOT NULL DEFAULT 'aes-256-gcm',
  token_scopes text[] NOT NULL DEFAULT '{}'::text[],
  account_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  oauth_state_hash char(64),
  oauth_state_expires_at timestamptz,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_sync_at timestamptz,
  last_sync_status varchar(30) NOT NULL DEFAULT 'never',
  last_sync_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_gmail_integrations PRIMARY KEY (id),
  CONSTRAINT uq_gmail_integrations__user_id UNIQUE (user_id),
  CONSTRAINT fk_gmail_integrations__users FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE RESTRICT,
  CONSTRAINT ck_gmail_integrations__last_sync_status CHECK (
    last_sync_status IN ('never', 'connected', 'synced', 'partial', 'failed', 'disconnected')
  )
);

CREATE INDEX idx_gmail_integrations__oauth_state_hash
  ON gmail_integrations (oauth_state_hash);

CREATE TRIGGER trg_gmail_integrations__set_updated_at
BEFORE UPDATE ON gmail_integrations
FOR EACH ROW
EXECUTE FUNCTION fn_set_updated_at();

CREATE TABLE gmail_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  gmail_integration_id uuid NOT NULL,
  gmail_message_id varchar(255) NOT NULL,
  gmail_thread_id varchar(255),
  gmail_attachment_id varchar(255) NOT NULL,
  sender_email varchar(255),
  subject varchar(255),
  received_at timestamptz,
  file_name varchar(255) NOT NULL,
  file_hash char(64),
  institution_slug varchar(50),
  status_code varchar(40) NOT NULL DEFAULT 'discovered',
  import_id uuid,
  error_summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ignored_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_gmail_messages PRIMARY KEY (id),
  CONSTRAINT fk_gmail_messages__users FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE RESTRICT,
  CONSTRAINT fk_gmail_messages__gmail_integrations FOREIGN KEY (gmail_integration_id)
    REFERENCES gmail_integrations (id)
    ON DELETE CASCADE
    ON UPDATE RESTRICT,
  CONSTRAINT fk_gmail_messages__imports FOREIGN KEY (import_id)
    REFERENCES imports (id)
    ON DELETE SET NULL
    ON UPDATE RESTRICT,
  CONSTRAINT uq_gmail_messages__user_message_attachment UNIQUE (user_id, gmail_message_id, gmail_attachment_id),
  CONSTRAINT ck_gmail_messages__status_code CHECK (
    status_code IN ('discovered', 'pending_confirmation', 'duplicate', 'imported', 'ignored', 'failed')
  )
);

CREATE INDEX idx_gmail_messages__user_id_received_at_desc
  ON gmail_messages (user_id, received_at DESC NULLS LAST, created_at DESC);

CREATE INDEX idx_gmail_messages__status_code
  ON gmail_messages (status_code);

CREATE INDEX idx_gmail_messages__file_hash
  ON gmail_messages (file_hash);

CREATE TRIGGER trg_gmail_messages__set_updated_at
BEFORE UPDATE ON gmail_messages
FOR EACH ROW
EXECUTE FUNCTION fn_set_updated_at();

ALTER TABLE gmail_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gmail_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_gmail_integrations__select_own
  ON gmail_integrations
  FOR SELECT
  TO authenticated
  USING (user_id = current_app_user_id());

CREATE POLICY pol_gmail_integrations__insert_own
  ON gmail_integrations
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = current_app_user_id());

CREATE POLICY pol_gmail_integrations__update_own
  ON gmail_integrations
  FOR UPDATE
  TO authenticated
  USING (user_id = current_app_user_id())
  WITH CHECK (user_id = current_app_user_id());

CREATE POLICY pol_gmail_integrations__delete_own
  ON gmail_integrations
  FOR DELETE
  TO authenticated
  USING (user_id = current_app_user_id());

CREATE POLICY pol_gmail_messages__select_own
  ON gmail_messages
  FOR SELECT
  TO authenticated
  USING (user_id = current_app_user_id());

CREATE POLICY pol_gmail_messages__insert_own
  ON gmail_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = current_app_user_id()
    AND EXISTS (
      SELECT 1
      FROM gmail_integrations gi
      WHERE gi.id = gmail_integration_id
        AND gi.user_id = current_app_user_id()
    )
    AND (
      import_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM imports i
        WHERE i.id = import_id
          AND i.user_id = current_app_user_id()
      )
    )
  );

CREATE POLICY pol_gmail_messages__update_own
  ON gmail_messages
  FOR UPDATE
  TO authenticated
  USING (user_id = current_app_user_id())
  WITH CHECK (
    user_id = current_app_user_id()
    AND EXISTS (
      SELECT 1
      FROM gmail_integrations gi
      WHERE gi.id = gmail_integration_id
        AND gi.user_id = current_app_user_id()
    )
    AND (
      import_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM imports i
        WHERE i.id = import_id
          AND i.user_id = current_app_user_id()
      )
    )
  );

CREATE POLICY pol_gmail_messages__delete_own
  ON gmail_messages
  FOR DELETE
  TO authenticated
  USING (user_id = current_app_user_id());

GRANT ALL PRIVILEGES ON TABLE gmail_integrations, gmail_messages TO service_role;

COMMIT;
