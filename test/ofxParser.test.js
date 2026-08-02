const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { parseOfxBuffer } = require("../src/services/ofxParser");

const fixtureDir = path.join(__dirname, "fixtures");
const institutions = [
  { id: "inst-nubank", name: "Nubank", normalized_name: "nubank" },
  { id: "inst-inter", name: "Banco Inter", normalized_name: "banco inter" },
];

test("parseia OFX SGML do Nubank com datas, valores e FITID", () => {
  const file = fs.readFileSync(path.join(fixtureDir, "nubank.ofx"));
  const result = parseOfxBuffer(file, institutions);

  assert.equal(result.encoding, "windows-1252");
  assert.equal(result.detection.slug, "nubank");
  assert.equal(result.header.startDate, "2026-07-01");
  assert.equal(result.header.endDate, "2026-07-31");
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[0].fitId, "nu-001");
  assert.equal(result.transactions[0].amount, -45.9);
  assert.equal(result.transactions[0].movementType, "expense");
  assert.match(result.transactions[0].description, /Padaria Central/i);
  assert.equal(result.transactions[1].amount, 1500);
  assert.equal(result.transactions[1].movementType, "income");
});

test("parseia OFX do Inter com TRNTYPE de transferencia", () => {
  const file = fs.readFileSync(path.join(fixtureDir, "inter.ofx"));
  const result = parseOfxBuffer(file, institutions);

  assert.equal(result.detection.slug, "inter");
  assert.equal(result.header.accountId, "00012345");
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].fitId, "inter-001");
  assert.equal(result.transactions[0].occurredOn, "2026-07-17");
  assert.equal(result.transactions[0].amount, -250);
  assert.equal(result.transactions[0].movementType, "transfer");
});

test("detecta OFX de cartao Nubank sem depender do nome do arquivo", () => {
  const file = fs.readFileSync(path.join(fixtureDir, "nubank-credit-card.ofx"));
  const result = parseOfxBuffer(file, institutions);

  assert.equal(result.encoding, "windows-1252");
  assert.equal(result.detection.slug, "nubank");
  assert.equal(result.header.statementKind, "credit_card");
  assert.equal(result.header.accountId, "card-synthetic-001");
  assert.equal(result.header.startDate, "2026-07-03");
  assert.equal(result.header.endDate, "2026-08-03");
  assert.equal(result.header.ledgerBalance, -1306.11);
  assert.equal(result.transactions.length, 3);
  assert.equal(result.transactions[0].movementType, "expense");
  assert.deepEqual(result.transactions[0].installment, { current: 2, total: 8 });
  assert.equal(result.transactions[1].movementType, "income");
  assert.match(result.warnings.join(" "), /cartao de credito/i);
});

test("mantem OFX sem FITID e usa apenas MEMO na descricao quando necessario", () => {
  const file = fs.readFileSync(path.join(fixtureDir, "nubank-missing-fitid.ofx"));
  const result = parseOfxBuffer(file, institutions);

  assert.equal(result.detection.slug, "nubank");
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].fitId, null);
  assert.match(result.transactions[0].description, /transferencia enviada pelo pix/i);
});

test("suporta OFX do Inter com REFNUM e MEMO ausente", () => {
  const file = fs.readFileSync(path.join(fixtureDir, "inter-memo-missing.ofx"));
  const result = parseOfxBuffer(file, institutions);

  assert.equal(result.detection.slug, "inter");
  assert.equal(result.header.branchId, "0099-1");
  assert.equal(result.transactions[0].refNum, "990");
  assert.equal(result.transactions[0].checkNum, "880");
  assert.equal(result.transactions[0].description, "Conta Telefonica Sintetica");
});

test("preserva caracteres especiais em arquivo UTF-8", () => {
  const file = fs.readFileSync(path.join(fixtureDir, "ofx-special-chars.ofx"));
  const result = parseOfxBuffer(file, institutions);

  assert.equal(result.encoding, "utf8");
  assert.match(result.transactions[0].memo, /Transferência recebida/i);
  assert.match(result.transactions[0].description, /Café São João/i);
  assert.equal(result.transactions[0].amount, 80.55);
});

test("interpreta linhas duplicadas sem perder nenhuma transacao", () => {
  const file = fs.readFileSync(path.join(fixtureDir, "inter-duplicate-rows.ofx"));
  const result = parseOfxBuffer(file, institutions);

  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[0].fitId, result.transactions[1].fitId);
  assert.equal(result.transactions[0].rowHash, result.transactions[1].rowHash);
});

test("retorna zero transacoes para arquivo invalido em vez de perder linhas silenciosamente", () => {
  const file = fs.readFileSync(path.join(fixtureDir, "invalid.ofx"));
  const result = parseOfxBuffer(file, institutions);

  assert.equal(result.transactions.length, 0);
  assert.equal(result.detection.slug, null);
  assert.match(result.warnings.join(" "), /instituicao/i);
});
