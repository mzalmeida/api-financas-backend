BEGIN;

CREATE TABLE transaction_classification_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category_id uuid,
  counterparty_id uuid,
  rule_name varchar(120) NOT NULL,
  match_field varchar(30) NOT NULL DEFAULT 'description',
  match_operator varchar(30) NOT NULL DEFAULT 'contains',
  pattern_text varchar(220) NOT NULL,
  priority smallint NOT NULL DEFAULT 100,
  target_movement_type varchar(20),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT pk_transaction_classification_rules PRIMARY KEY (id),
  CONSTRAINT fk_transaction_classification_rules__users FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE RESTRICT,
  CONSTRAINT fk_transaction_classification_rules__categories FOREIGN KEY (category_id)
    REFERENCES categories (id)
    ON DELETE SET NULL
    ON UPDATE RESTRICT,
  CONSTRAINT fk_transaction_classification_rules__counterparties FOREIGN KEY (counterparty_id)
    REFERENCES counterparties (id)
    ON DELETE SET NULL
    ON UPDATE RESTRICT,
  CONSTRAINT ck_transaction_classification_rules__match_field CHECK (
    match_field IN ('description', 'memo', 'name', 'fitid')
  ),
  CONSTRAINT ck_transaction_classification_rules__match_operator CHECK (
    match_operator IN ('contains', 'equals', 'starts_with', 'ends_with', 'regex')
  ),
  CONSTRAINT ck_transaction_classification_rules__target_movement_type CHECK (
    target_movement_type IS NULL OR target_movement_type IN ('expense', 'income', 'transfer', 'adjustment')
  )
);

CREATE INDEX idx_transaction_classification_rules__user_id_priority
  ON transaction_classification_rules (user_id, priority, is_active);

CREATE TRIGGER trg_transaction_classification_rules__set_updated_at
BEFORE UPDATE ON transaction_classification_rules
FOR EACH ROW
EXECUTE FUNCTION fn_set_updated_at();

COMMIT;
