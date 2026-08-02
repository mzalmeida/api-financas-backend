BEGIN;

ALTER TABLE installment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE installment_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_classification_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_installment_plans__select_own
  ON installment_plans
  FOR SELECT
  TO authenticated
  USING (user_id = current_app_user_id());

CREATE POLICY pol_installment_plans__insert_own
  ON installment_plans
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = current_app_user_id());

CREATE POLICY pol_installment_plans__update_own
  ON installment_plans
  FOR UPDATE
  TO authenticated
  USING (user_id = current_app_user_id())
  WITH CHECK (user_id = current_app_user_id());

CREATE POLICY pol_installment_plan_items__select_own
  ON installment_plan_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM installment_plans ip
      WHERE ip.id = installment_plan_id
        AND ip.user_id = current_app_user_id()
    )
  );

CREATE POLICY pol_installment_plan_items__insert_own
  ON installment_plan_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM installment_plans ip
      WHERE ip.id = installment_plan_id
        AND ip.user_id = current_app_user_id()
    )
    AND (
      transaction_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM transactions t
        WHERE t.id = transaction_id
          AND t.user_id = current_app_user_id()
      )
    )
  );

CREATE POLICY pol_installment_plan_items__update_own
  ON installment_plan_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM installment_plans ip
      WHERE ip.id = installment_plan_id
        AND ip.user_id = current_app_user_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM installment_plans ip
      WHERE ip.id = installment_plan_id
        AND ip.user_id = current_app_user_id()
    )
    AND (
      transaction_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM transactions t
        WHERE t.id = transaction_id
          AND t.user_id = current_app_user_id()
      )
    )
  );

CREATE POLICY pol_transaction_classification_rules__select_own
  ON transaction_classification_rules
  FOR SELECT
  TO authenticated
  USING (user_id = current_app_user_id());

CREATE POLICY pol_transaction_classification_rules__insert_own
  ON transaction_classification_rules
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = current_app_user_id());

CREATE POLICY pol_transaction_classification_rules__update_own
  ON transaction_classification_rules
  FOR UPDATE
  TO authenticated
  USING (user_id = current_app_user_id())
  WITH CHECK (user_id = current_app_user_id());

GRANT SELECT, INSERT, UPDATE ON TABLE installment_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE installment_plan_items TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE transaction_classification_rules TO authenticated;

GRANT ALL PRIVILEGES ON TABLE installment_plans, installment_plan_items, transaction_classification_rules TO service_role;

COMMIT;
