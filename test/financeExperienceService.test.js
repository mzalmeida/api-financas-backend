const test = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });

const {
  accountTypeLabel,
  applyTransactionFilters,
  buildFilters,
  buildMonthlyTrend,
  buildRawMonthlyTrend,
  buildCardSummary,
  buildCurrentCardSummary,
  classifyTransactionForTotals,
  computeAccountBalances,
  distributeInstallmentAmounts,
  generateInstallmentItems,
  normalizeMovementIds,
  summarizeRawAccountFlow,
  summarizeTransactionTotals,
} = require("../src/services/financeExperienceService");
const { buildDuplicateGroupKey, statementCompetenceFromProcessingSummary } = require("../src/services/importsService");
const { learnedPatternFromDescription, matchRule } = require("../src/services/transactionClassificationService");

const appUser = { display_name: "Mateus Zilio de Almeida", email: "mateus@example.com" };

test("normaliza a selecao em lote sem repetir movimentos", () => {
  assert.deepEqual(normalizeMovementIds([" movement-1 ", "movement-2", "movement-1", "", null]), [
    "movement-1",
    "movement-2",
  ]);
  assert.deepEqual(normalizeMovementIds("movement-1"), []);
});

test("mantem a competencia ativa nos filtros de movimentacoes e fornecedores", () => {
  assert.equal(buildFilters({ competence: "2026-08" }).competence, "2026-08");
  assert.equal(buildFilters({ competence: "2026-08", allPeriod: "true" }).competence, null);

  const rows = [
    { id: "august", data_competencia: "2026-08-01", descricao: "Loja Exemplo" },
    { id: "july", data_competencia: "2026-07-01", descricao: "Loja Exemplo" },
  ];
  assert.deepEqual(
    applyTransactionFilters(rows, buildFilters({ competence: "2026-08" })).map((row) => row.id),
    ["august"],
  );
});

test("filtra fornecedor pela chave normalizada sem depender da pesquisa textual", () => {
  const rows = [
    { id: "match", data_competencia: "2026-08-01", descricao: "Shopee *Loja - Parcela 2/6" },
    { id: "other", data_competencia: "2026-08-01", descricao: "Mercado Bairro" },
  ];
  const filters = buildFilters({ competence: "2026-08", supplierKey: "shopee *loja" });
  assert.deepEqual(applyTransactionFilters(rows, filters).map((row) => row.id), ["match"]);
});

test("distribui arredondamento de parcelas preservando o valor total", () => {
  const amounts = distributeInstallmentAmounts(100, 3);

  assert.deepEqual(amounts, [33.33, 33.33, 33.34]);
  assert.equal(amounts.reduce((sum, value) => sum + value, 0), 100);
});

test("gera vencimentos mensais seguros mesmo em datas altas do mes", () => {
  const items = generateInstallmentItems("2026-01-31", 3, 50);

  assert.deepEqual(items.map((item) => item.due_date), [
    "2026-01-31",
    "2026-02-28",
    "2026-03-31",
  ]);
});

test("humaniza tipos de conta exibidos no portal", () => {
  assert.equal(accountTypeLabel("credit_card"), "Cartao de credito");
  assert.equal(accountTypeLabel("payment"), "Conta de pagamento");
});

test("regra textual de salario reconhece portabilidade e folha", () => {
  const rule = {
    match_field: "description",
    match_operator: "regex",
    pattern_text: "(sal[aá]rio|portabilidade|folha|pagamento\\s+de\\s+sal[aá]rio)",
  };

  assert.equal(matchRule(rule, { description: "Salario recebido - Portabilidade" }), true);
  assert.equal(matchRule(rule, { description: "Credito folha mensal" }), true);
  assert.equal(matchRule(rule, { description: "Compra mercado" }), false);
});

test("regra aprendida ignora numero da parcela e reconhece a proxima compra", () => {
  const pattern = learnedPatternFromDescription("Shopee *Loja Exemplo - Parcela 3/10");
  assert.equal(pattern, "shopee *loja exemplo");
  assert.equal(matchRule({
    match_field: "description",
    match_operator: "contains",
    pattern_text: pattern,
  }, {
    description: "SHOPEE *LOJA EXEMPLO - Parcela 4/10",
  }), true);
});

test("classifies only transfers to the account owner as internal", () => {
  assert.equal(classifyTransactionForTotals({ valor: -500, descricao: "Pix enviado para Mateus Zilio de Almeida", tipo_conta: "checking" }, appUser), "transfer");
  assert.equal(classifyTransactionForTotals({ valor: -80, descricao: "Pix enviado para Mercado Pago", tipo_conta: "checking" }, appUser), "expense");
  assert.equal(classifyTransactionForTotals({ valor: 200, descricao: "Pix recebido de cliente", tipo_conta: "checking" }, appUser), "income");
});

test("does not count card payments as income or expense", () => {
  const rows = [
    { valor: -100, descricao: "Compra no cartao", tipo_conta: "credit_card" },
    { valor: 100, descricao: "Pagamento recebido", tipo_conta: "credit_card" },
    { valor: -62.6, descricao: "Pagamento Fatura - Debito Automatico Fatura Cartao Inter", tipo_conta: "payment" },
  ];

  assert.deepEqual(summarizeTransactionTotals(rows, appUser), { income: 0, expense: 100 });
});

test("card credits reduce expenses without becoming income", () => {
  const rows = [
    { valor: -300, descricao: "Compra", tipo_conta: "credit_card" },
    { valor: 50, descricao: "Credito de loja", tipo_conta: "credit_card" },
  ];

  assert.deepEqual(summarizeTransactionTotals(rows, appUser), { income: 0, expense: 250 });
});

test("Inter cash-flow totals include every incoming and outgoing movement", () => {
  const rows = [
    { conta_financeira_id: "inter", valor: 4301.85, descricao: "Entrada" },
    { conta_financeira_id: "inter", valor: -3012.33, descricao: "Contas" },
    { conta_financeira_id: "inter", valor: -726, descricao: "Pix para conta propria" },
    { conta_financeira_id: "nubank", valor: -55, descricao: "Outra conta" },
    { conta_financeira_id: "card", valor: -962.74, descricao: "Cartao" },
  ];

  assert.deepEqual(summarizeRawAccountFlow(rows, ["inter"]), {
    income: 4301.85,
    expense: 3738.33,
  });
});

test("uses the latest confirmed OFX ledger balance for cash accounts", () => {
  const accounts = [{ id: "cash", name: "Conta", account_type: "checking", opening_balance: 0 }];
  const transactions = [{ conta_financeira_id: "cash", valor: 999 }];
  const imports = [
    { financial_account_id: "cash", status_code: "completed", processing_summary: { ledger_balance: 120, ledger_balance_date: "2026-07-31" } },
    { financial_account_id: "cash", status_code: "completed_with_errors", processing_summary: { ledger_balance: 209.65, ledger_balance_date: "2026-08-12" } },
  ];

  const [balance] = computeAccountBalances(accounts, transactions, imports);
  assert.equal(balance.current_balance, 209.65);
  assert.equal(balance.balance_source, "ofx_ledger");
});

test("monthly trend keeps all eight imported competences", () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({
    data: `2026-${String(index + 1).padStart(2, "0")}-10`,
    valor: -10,
    descricao: "Compra",
    tipo_conta: "checking",
  }));

  const trend = buildMonthlyTrend(rows, appUser);
  assert.equal(trend.length, 8);
  assert.deepEqual(trend[0], { month: "2026-01", income: 0, expense: 10 });
  assert.deepEqual(trend[7], { month: "2026-08", income: 0, expense: 10 });
});

test("Inter trend includes every movement and excludes other accounts", () => {
  const rows = [
    { conta_financeira_id: "inter", data: "2026-07-10", valor: 1000 },
    { conta_financeira_id: "inter", data: "2026-07-11", valor: -700 },
    { conta_financeira_id: "inter", data: "2026-08-10", valor: 1200 },
    { conta_financeira_id: "inter", data: "2026-08-11", valor: -900 },
    { conta_financeira_id: "nubank", data: "2026-08-12", valor: -500 },
  ];

  assert.deepEqual(buildRawMonthlyTrend(rows, ["inter"]), [
    { month: "2026-07", income: 1000, expense: 700 },
    { month: "2026-08", income: 1200, expense: 900 },
  ]);
});

test("does not confuse recurring credit card installments that reuse the FITID", () => {
  const julyInstallment = {
    fitId: "purchase-123",
    occurredOn: "2026-07-03",
    amount: -53.62,
    description: "Shopee - Parcela 4/8",
  };
  const augustInstallment = {
    ...julyInstallment,
    occurredOn: "2026-08-03",
    description: "Shopee - Parcela 5/8",
  };

  assert.notEqual(buildDuplicateGroupKey(julyInstallment), buildDuplicateGroupKey(augustInstallment));
  assert.equal(buildDuplicateGroupKey(julyInstallment), buildDuplicateGroupKey({ ...julyInstallment }));
});

test("card summary maps purchase-cycle competence to the statement due month", () => {
  const accounts = [{
    id: "card",
    name: "Nubank",
    institution_name: "Nubank",
    account_type: "credit_card",
    statement_closing_day: 3,
    statement_due_day: 10,
  }];
  const transactions = [
    { conta_financeira_id: "card", data: "2026-01-10", data_competencia: "2026-01-01", valor: -120, tipo_conta: "credit_card", descricao: "Compra" },
    { conta_financeira_id: "card", data: "2026-01-15", data_competencia: "2026-01-01", valor: 20, tipo_conta: "credit_card", descricao: "Credito de loja" },
    { conta_financeira_id: "card", data: "2026-02-10", data_competencia: "2026-02-01", valor: -200, tipo_conta: "credit_card", descricao: "Compra" },
  ];

  const summary = buildCardSummary(accounts, transactions, "2026-02");
  assert.equal(summary.cards[0].open_amount, 100);
  assert.equal(summary.cards[0].statement_amount, 100);
  assert.equal(summary.cards[0].next_due_date, "2026-02-10");
});

test("current card summary combines the open Nubank cycle with commitments due now", () => {
  const accounts = [
    {
      id: "nubank-card",
      name: "Nubank Credito",
      institution_name: "Nubank",
      account_type: "credit_card",
      statement_closing_day: 3,
      statement_due_day: 10,
    },
    {
      id: "inter",
      name: "Banco Inter",
      institution_name: "Banco Inter",
      account_type: "payment",
      statement_due_day: 25,
    },
  ];
  const transactions = [
    { conta_financeira_id: "nubank-card", data_competencia: "2026-07-01", valor: -1306.12, tipo_conta: "credit_card", descricao: "Fatura paga" },
    { conta_financeira_id: "nubank-card", data_competencia: "2026-08-01", valor: -962.74, tipo_conta: "credit_card", descricao: "Fatura aberta" },
  ];
  const plans = [
    {
      financial_account_id: "inter",
      merchant_name: "FlexPag(CPFL)",
      description: "FlexPag(CPFL)",
      installment_plan_items: [{ due_date: "2026-08-25", amount: 62.6, status_code: "scheduled" }],
    },
    {
      financial_account_id: null,
      merchant_name: "Mercado Livre",
      description: "Mercado Livre",
      installment_plan_items: [{ due_date: "2026-08-20", amount: 659.87, status_code: "scheduled" }],
    },
  ];

  const summary = buildCurrentCardSummary(accounts, transactions, plans, new Date("2026-08-15T12:00:00Z"));
  assert.equal(summary.cards.find((card) => card.id === "nubank-card").open_amount, 962.74);
  assert.equal(summary.cards.find((card) => card.id === "nubank-card").next_due_date, "2026-09-10");
  assert.equal(summary.cards.find((card) => card.id === "inter").open_amount, 62.6);
  assert.deepEqual(summary.commitments, [{
    id: "commitment-mercado livre",
    name: "Mercado Livre",
    amount: 659.87,
    due_date: "2026-08-20",
  }]);
});

test("derives card competence from the month before statement closing", () => {
  assert.equal(statementCompetenceFromProcessingSummary({
    statement_kind: "credit_card",
    period: { end_date: "2026-09-03" },
  }), "2026-08-01");
  assert.equal(statementCompetenceFromProcessingSummary({
    statement_kind: "bank_account",
    period: { end_date: "2026-09-03" },
  }), null);
});
