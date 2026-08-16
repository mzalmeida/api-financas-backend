const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const servicePath = path.join(__dirname, "..", "src", "services", "gmailImapService.js");
const clientsPath = path.join(__dirname, "..", "src", "config", "supabaseClients.js");
const importsPath = path.join(__dirname, "..", "src", "services", "importsService.js");

function loadService() {
  const snapshots = new Map([
    [servicePath, require.cache[servicePath] || null],
    [clientsPath, require.cache[clientsPath] || null],
    [importsPath, require.cache[importsPath] || null],
  ]);
  delete require.cache[servicePath];
  require.cache[clientsPath] = {
    id: clientsPath,
    filename: clientsPath,
    loaded: true,
    exports: { adminSupabaseClient: {} },
  };
  require.cache[importsPath] = {
    id: importsPath,
    filename: importsPath,
    loaded: true,
    exports: { previewOfxImport: async () => ({}) },
  };
  const service = require(servicePath);
  return {
    service,
    restore() {
      for (const [modulePath, cached] of snapshots) {
        if (cached) require.cache[modulePath] = cached;
        else delete require.cache[modulePath];
      }
    },
  };
}

test("somente remetentes permitidos sao associados a instituicoes", () => {
  const loaded = loadService();
  try {
    const allowed = loaded.service.parseAllowedSenders("");
    assert.equal(loaded.service.institutionFromSender("todomundo@nubank.com.br", allowed), "nubank");
    assert.equal(loaded.service.institutionFromSender("no-reply@inter.co", allowed), "inter");
    assert.equal(loaded.service.institutionFromSender("extrato@exemplo.com", allowed), null);
  } finally {
    loaded.restore();
  }
});

test("apenas anexos OFX nao vazios sao aceitos", () => {
  const loaded = loadService();
  try {
    assert.equal(loaded.service.isOfxAttachment({ filename: "extrato.OFX", content: Buffer.from("OFX") }), true);
    assert.equal(loaded.service.isOfxAttachment({ filename: "extrato.pdf", content: Buffer.from("PDF") }), false);
    assert.equal(loaded.service.isOfxAttachment({ filename: "extrato.ofx", content: Buffer.alloc(0) }), false);
    assert.equal(loaded.service.isOfxAttachment({ filename: "extrato.ofx", content: Buffer.alloc(5 * 1024 * 1024 + 1) }), false);
  } finally {
    loaded.restore();
  }
});

test("mensagem confiavel exige remetente autorizado e assunto de extrato", () => {
  const loaded = loadService();
  try {
    const allowed = loaded.service.parseAllowedSenders("");
    assert.equal(loaded.service.matchesTrustedMessage("todomundo@nubank.com.br", "Extrato da sua conta do Nubank", allowed), "nubank");
    assert.equal(loaded.service.matchesTrustedMessage("todomundo@nubank.com.br", "Promocao especial", allowed), null);
    assert.equal(loaded.service.matchesTrustedMessage("fraude@exemplo.com", "Seu extrato", allowed), null);
    assert.equal(
      loaded.service.matchesTrustedMessage("no-reply@inter.co", "Documento financeiro disponivel", allowed, ["documento financeiro"]),
      "inter",
    );
  } finally {
    loaded.restore();
  }
});

test("termos de assunto podem ser configurados por lista", () => {
  const loaded = loadService();
  try {
    assert.deepEqual(loaded.service.parseSubjectTerms("Extrato, Fatura disponivel"), ["extrato", "fatura disponivel"]);
    assert.deepEqual(loaded.service.parseSubjectTerms(""), ["extrato"]);
  } finally {
    loaded.restore();
  }
});

test("janela inicial segura usa um dia por padrao", () => {
  const previous = process.env.GMAIL_IMAP_LOOKBACK_DAYS;
  const loaded = loadService();
  try {
    delete process.env.GMAIL_IMAP_LOOKBACK_DAYS;
    assert.equal(loaded.service.getImapConfig().lookbackDays, 1);
  } finally {
    if (previous == null) delete process.env.GMAIL_IMAP_LOOKBACK_DAYS;
    else process.env.GMAIL_IMAP_LOOKBACK_DAYS = previous;
    loaded.restore();
  }
});

test("selecao de conta separa Nubank corrente de Nubank credito", () => {
  const loaded = loadService();
  try {
    const accounts = [
      { id: "checking", account_type: "checking", financial_institution_id: "nubank-id" },
      { id: "credit", account_type: "credit_card", financial_institution_id: "nubank-id" },
    ];
    const base = {
      accounts,
      integration: { account_mapping: {} },
      institutionSlug: "nubank",
    };
    const bankAccount = loaded.service.resolveFinancialAccount({
      ...base,
      parsed: { header: { statementKind: "bank_account", accountId: null }, detection: { institutionId: "nubank-id" } },
    });
    const creditCard = loaded.service.resolveFinancialAccount({
      ...base,
      parsed: { header: { statementKind: "credit_card", accountId: null }, detection: { institutionId: "nubank-id" } },
    });
    assert.equal(bankAccount.id, "checking");
    assert.equal(creditCard.id, "credit");
  } finally {
    loaded.restore();
  }
});

test("mapeamento explicito resolve ambiguidade entre contas compativeis", () => {
  const loaded = loadService();
  try {
    const selected = loaded.service.resolveFinancialAccount({
      accounts: [
        { id: "first", account_type: "checking", financial_institution_id: "inter-id" },
        { id: "second", account_type: "payment", financial_institution_id: "inter-id" },
      ],
      integration: { account_mapping: { inter_bank_account: "second" } },
      institutionSlug: "inter",
      parsed: { header: { statementKind: "bank_account", accountId: null }, detection: { institutionId: "inter-id" } },
    });
    assert.equal(selected.id, "second");
  } finally {
    loaded.restore();
  }
});

test("segredo do agendador exige ao menos 32 caracteres e comparacao exata", () => {
  const previous = process.env.GMAIL_SYNC_SECRET;
  const loaded = loadService();
  try {
    process.env.GMAIL_SYNC_SECRET = "12345678901234567890123456789012";
    assert.equal(loaded.service.validateScheduledSecret("12345678901234567890123456789012"), true);
    assert.equal(loaded.service.validateScheduledSecret("12345678901234567890123456789013"), false);
    assert.equal(loaded.service.validateScheduledSecret("short"), false);
  } finally {
    if (previous == null) delete process.env.GMAIL_SYNC_SECRET;
    else process.env.GMAIL_SYNC_SECRET = previous;
    loaded.restore();
  }
});
