BEGIN;

ALTER TABLE financial_accounts
  DROP CONSTRAINT ck_financial_accounts__account_type;

ALTER TABLE financial_accounts
  ADD COLUMN statement_closing_day smallint,
  ADD COLUMN statement_due_day smallint,
  ADD COLUMN credit_limit_amount numeric(14,2),
  ADD COLUMN statement_label varchar(120);

ALTER TABLE financial_accounts
  ADD CONSTRAINT ck_financial_accounts__account_type CHECK (
    account_type IN ('checking', 'savings', 'investment', 'payment', 'cash', 'other', 'wallet', 'manual', 'credit_card')
  ),
  ADD CONSTRAINT ck_financial_accounts__statement_closing_day CHECK (
    statement_closing_day IS NULL OR statement_closing_day BETWEEN 1 AND 31
  ),
  ADD CONSTRAINT ck_financial_accounts__statement_due_day CHECK (
    statement_due_day IS NULL OR statement_due_day BETWEEN 1 AND 31
  ),
  ADD CONSTRAINT ck_financial_accounts__credit_limit_amount CHECK (
    credit_limit_amount IS NULL OR credit_limit_amount >= 0
  );

CREATE INDEX idx_financial_accounts__user_id_account_type
  ON financial_accounts (user_id, account_type);

COMMIT;
