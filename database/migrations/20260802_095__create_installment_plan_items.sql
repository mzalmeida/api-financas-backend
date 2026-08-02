BEGIN;

CREATE TABLE installment_plan_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  installment_plan_id uuid NOT NULL,
  transaction_id uuid,
  installment_number smallint NOT NULL,
  due_date date NOT NULL,
  amount numeric(14,2) NOT NULL,
  status_code varchar(30) NOT NULL DEFAULT 'scheduled',
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_installment_plan_items PRIMARY KEY (id),
  CONSTRAINT fk_installment_plan_items__installment_plans FOREIGN KEY (installment_plan_id)
    REFERENCES installment_plans (id)
    ON DELETE CASCADE
    ON UPDATE RESTRICT,
  CONSTRAINT fk_installment_plan_items__transactions FOREIGN KEY (transaction_id)
    REFERENCES transactions (id)
    ON DELETE SET NULL
    ON UPDATE RESTRICT,
  CONSTRAINT uq_installment_plan_items__plan_id_number UNIQUE (installment_plan_id, installment_number),
  CONSTRAINT ck_installment_plan_items__installment_number CHECK (installment_number > 0),
  CONSTRAINT ck_installment_plan_items__amount_positive CHECK (amount > 0),
  CONSTRAINT ck_installment_plan_items__status_code CHECK (
    status_code IN ('scheduled', 'linked', 'paid', 'skipped', 'cancelled')
  )
);

CREATE INDEX idx_installment_plan_items__transaction_id
  ON installment_plan_items (transaction_id);

CREATE INDEX idx_installment_plan_items__due_date
  ON installment_plan_items (due_date);

CREATE TRIGGER trg_installment_plan_items__set_updated_at
BEFORE UPDATE ON installment_plan_items
FOR EACH ROW
EXECUTE FUNCTION fn_set_updated_at();

COMMIT;
