# Migration Wave 08 - F05

## Escopo

Consolidacao da experiencia do RebeccaCash com extensoes estruturais para:

- contas financeiras ampliadas;
- leitura de cartao de credito;
- parcelamentos manuais;
- classificacao automatica de transacoes.

## Migrations

1. `database/migrations/20260802_093__expand_financial_accounts_for_f05.sql`
2. `database/migrations/20260802_094__create_installment_plans.sql`
3. `database/migrations/20260802_095__create_installment_plan_items.sql`
4. `database/migrations/20260802_096__create_transaction_classification_rules.sql`
5. `database/migrations/20260802_097__secure_f05_tables.sql`

## Espelhamento Supabase

1. `supabase/migrations/20260802093_expand_financial_accounts_for_f05.sql`
2. `supabase/migrations/20260802094_create_installment_plans.sql`
3. `supabase/migrations/20260802095_create_installment_plan_items.sql`
4. `supabase/migrations/20260802096_create_transaction_classification_rules.sql`
5. `supabase/migrations/20260802097_secure_f05_tables.sql`

## Relacao com o dominio

- `financial_accounts`
  - passa a suportar `wallet`, `manual` e `credit_card`
  - recebe colunas de fechamento, vencimento, limite e rotulo de fatura

- `installment_plans`
  - formaliza o compromisso parcelado como entidade propria

- `installment_plan_items`
  - formaliza as parcelas individuais e o vinculo futuro com `transactions`

- `transaction_classification_rules`
  - prepara classificacao automatica extensivel por texto e prioridade

- `secure_f05_tables`
  - aplica RLS, policies e grants minimos nas estruturas novas

## Validacao local executada

- `node --check` nos arquivos principais alterados do backend e frontend
- `npm test` no backend com 20 testes aprovados
- fixture sintetica nova:
  - `test/fixtures/nubank-credit-card.ofx`

## Pendencias dependentes de banco real

- aplicacao das migrations F05 no Supabase
- validacao runtime de RLS nas tabelas novas
- validacao publica completa do dashboard F05 apos deploy e dados reais
