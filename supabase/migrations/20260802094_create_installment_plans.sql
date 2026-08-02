BEGIN;

CREATE TABLE installment_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  financial_account_id uuid,
  counterparty_id uuid,
  category_id uuid,
  description varchar(220) NOT NULL,
  merchant_name varchar(160),
  total_amount numeric(14,2) NOT NULL,
  installment_count smallint NOT NULL,
  installment_amount numeric(14,2) NOT NULL,
  first_due_date date NOT NULL,
  status_code varchar(30) NOT NULL DEFAULT 'active',
  source_code varchar(30) NOT NULL DEFAULT 'manual',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT pk_installment_plans PRIMARY KEY (id),
  CONSTRAINT fk_installment_plans__users FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE RESTRICT,
  CONSTRAINT fk_installment_plans__financial_accounts FOREIGN KEY (financial_account_id, user_id)
    REFERENCES financial_accounts (id, user_id)
    ON DELETE SET NULL
    ON UPDATE RESTRICT,
  CONSTRAINT fk_installment_plans__counterparties FOREIGN KEY (counterparty_id)
    REFERENCES counterparties (id)
    ON DELETE SET NULL
    ON UPDATE RESTRICT,
  CONSTRAINT fk_installment_plans__categories FOREIGN KEY (category_id)
    REFERENCES categories (id)
    ON DELETE SET NULL
    ON UPDATE RESTRICT,
  CONSTRAINT ck_installment_plans__status_code CHECK (
    status_code IN ('active', 'completed', 'cancelled', 'archived')
  ),
  CONSTRAINT ck_installment_plans__source_code CHECK (
    source_code IN ('manual', 'import_inference')
  ),
  CONSTRAINT ck_installment_plans__installment_count CHECK (installment_count > 0),
  CONSTRAINT ck_installment_plans__installment_amount_positive CHECK (installment_amount > 0),
  CONSTRAINT ck_installment_plans__total_amount_positive CHECK (total_amount > 0)
);

CREATE INDEX idx_installment_plans__user_id_status_code
  ON installment_plans (user_id, status_code);

CREATE INDEX idx_installment_plans__financial_account_id
  ON installment_plans (financial_account_id);

CREATE TRIGGER trg_installment_plans__set_updated_at
BEFORE UPDATE ON installment_plans
FOR EACH ROW
EXECUTE FUNCTION fn_set_updated_at();

COMMIT;
