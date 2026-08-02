const test = require("node:test");
const assert = require("node:assert/strict");

const {
  accountTypeLabel,
  distributeInstallmentAmounts,
  generateInstallmentItems,
} = require("../src/services/financeExperienceService");
const { matchRule } = require("../src/services/transactionClassificationService");

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
