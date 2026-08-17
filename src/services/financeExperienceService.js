const { adminSupabaseClient } = require("../config/supabaseClients");
const { learnedPatternFromDescription, learnClassificationRule } = require("./transactionClassificationService");

class FinanceExperienceError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeSupplierName(value) {
  const text = normalizeText(value)
    .replace(/\b(?:pix|debito|credito|compra|pgto|pagamento|transf|transferencia|transferência)\b/g, " ")
    .replace(/\bparcela\s+\d+\s*\/\s*\d+\b/g, " ")
    .replace(/\b\d{2,}\b/g, " ")
    .replace(/\s*[-–—|]+\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || "sem fornecedor";
}

function supplierSourceForRow(row) {
  const counterparty = normalizeText(row?.contraparte);
  const genericCounterparty = !counterparty || ["sem contraparte", "sem fornecedor", "nao informado"].includes(counterparty);
  return genericCounterparty
    ? row?.descricao_normalizada || row?.descricao || null
    : row?.contraparte;
}

function supplierKeyForRow(row) {
  return normalizeSupplierName(supplierSourceForRow(row));
}

function isOwnSupplier(value, appUser) {
  const normalized = normalizeText(value);
  if (!normalized || ["eu", "proprio", "propria", "sem fornecedor"].includes(normalized)) return true;

  const ownValues = [
    appUser?.display_name,
    appUser?.email,
    String(appUser?.email || "").split("@")[0],
  ].map(normalizeText).filter(Boolean);

  return ownValues.some((ownValue) => normalized === ownValue || normalized.includes(ownValue) || ownValue.includes(normalized));
}

function classifyTransactionForTotals(row, appUser) {
  const amount = Number(row?.valor ?? row?.amount ?? 0);
  const description = normalizeText(row?.descricao ?? row?.original_description);
  const accountType = row?.tipo_conta ?? row?.account_type;

  if (!amount) return "adjustment";

  const isCardPayment = /pagamento recebido|pagamento (?:da )?fatura|debito automatico.*fatura|pagamento.*cartao/.test(description);
  if (isCardPayment) return "transfer";

  const isPixOrTransfer = /\bpix\b|transfer/.test(description);
  if (isPixOrTransfer && isOwnSupplier(description, appUser)) return "transfer";

  if (accountType === "credit_card" && amount > 0) return "expense_refund";
  return amount < 0 ? "expense" : "income";
}

function summarizeTransactionTotals(transactions, appUser) {
  return transactions.reduce((summary, row) => {
    const amount = Number(row?.valor ?? row?.amount ?? 0);
    const classification = row?.tipo_movimento_calculado || classifyTransactionForTotals(row, appUser);

    if (classification === "income") summary.income += Math.max(0, amount);
    if (classification === "expense") summary.expense += Math.abs(Math.min(0, amount));
    if (classification === "expense_refund") summary.expense -= Math.max(0, amount);
    return summary;
  }, { income: 0, expense: 0 });
}

function summarizeRawAccountFlow(transactions, accountIds) {
  const allowedAccountIds = new Set(accountIds);
  return transactions.reduce((summary, row) => {
    if (!allowedAccountIds.has(row.conta_financeira_id)) return summary;

    const amount = Number(row?.valor ?? row?.amount ?? 0);
    if (amount > 0) summary.income += amount;
    if (amount < 0) summary.expense += Math.abs(amount);
    return summary;
  }, { income: 0, expense: 0 });
}

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeMovementIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(optionalText).filter(Boolean))];
}

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function startOfMonthIso(date = new Date()) {
  return formatDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
}

function shiftMonthIso(isoDate, monthOffset) {
  const date = parseDate(isoDate);
  if (!date) return null;
  return formatDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + monthOffset, 1)));
}

async function resolveCurrentAppUser(client, authUserId) {
  const { data, error } = await client
    .from("users")
    .select("id,email,display_name,profile_code,status_code")
    .eq("auth_provider", "supabase")
    .eq("auth_subject", authUserId)
    .single();

  if (error || !data) {
    throw new FinanceExperienceError(403, "forbidden", "Usuario autenticado sem vinculo ao dominio financeiro.");
  }

  return data;
}

async function ensureOwnedTransaction(client, appUserId, transactionId) {
  if (!transactionId) return null;
  const { data, error } = await client
    .from("transactions")
    .select("id,user_id,original_description,normalized_description,movement_type")
    .eq("id", transactionId)
    .eq("user_id", appUserId)
    .maybeSingle();

  if (error) {
    throw new FinanceExperienceError(502, "supabase_query_error", "Falha ao localizar a movimentacao informada.");
  }

  if (!data?.id) {
    throw new FinanceExperienceError(404, "transaction_not_found", "Movimentacao informada nao foi localizada.");
  }

  return data;
}

async function ensureOwnedCategory(client, appUserId, categoryId) {
  if (!categoryId) return null;
  const { data, error } = await client
    .from("categories")
    .select("id,user_id")
    .eq("id", categoryId)
    .or(`user_id.eq.${appUserId},user_id.is.null`)
    .maybeSingle();

  if (error) {
    throw new FinanceExperienceError(502, "supabase_query_error", "Falha ao localizar a categoria informada.");
  }

  if (!data?.id) {
    throw new FinanceExperienceError(404, "category_not_found", "Categoria informada nao foi localizada.");
  }

  return data;
}

function buildFilters(query = {}) {
  const allPeriod = String(query.allPeriod ?? query.all_period ?? "") === "true";
  const competence = allPeriod ? null : optionalText(query.competence) || startOfMonthIso().slice(0, 7);
  return {
    competence,
    allPeriod,
    bank: optionalText(query.bank),
    financialAccountId: optionalText(query.financialAccountId ?? query.accountId),
    category: optionalText(query.category),
    movementType: optionalText(query.movementType ?? query.type),
    duplicateOnly: String(query.duplicateOnly ?? "") === "true",
    installmentOnly: String(query.installmentOnly ?? "") === "true",
    creditCardOnly: String(query.creditCardOnly ?? "") === "true",
    supplierKey: optionalText(query.supplierKey ?? query.supplier_key),
    search: optionalText(query.search),
    page: Math.max(1, Number.parseInt(query.page, 10) || 1),
    pageSize: Math.min(1000, Math.max(1, Number.parseInt(query.pageSize, 10) || 20)),
  };
}

function accountTypeLabel(value) {
  const labels = {
    checking: "Conta corrente",
    savings: "Poupanca",
    payment: "Conta de pagamento",
    wallet: "Carteira",
    manual: "Conta manual",
    credit_card: "Cartao de credito",
    investment: "Investimento",
    cash: "Dinheiro",
    other: "Outra conta",
  };

  return labels[value] || "Conta financeira";
}

function applyTransactionFilters(rows, filters) {
  return rows.filter((row) => {
    if (filters.competence && String(row.data_competencia || row.data || "").slice(0, 7) !== filters.competence) {
      return false;
    }
    if (filters.bank && normalizeText(row.banco) !== normalizeText(filters.bank)) {
      return false;
    }
    if (filters.financialAccountId && row.conta_financeira_id !== filters.financialAccountId) {
      return false;
    }
    if (filters.category && normalizeText(row.categoria) !== normalizeText(filters.category)) {
      return false;
    }
    if (filters.movementType && row.tipo_movimento !== filters.movementType) {
      return false;
    }
    if (filters.duplicateOnly && !row.grupo_duplicidade && !row.hash_deduplicacao) {
      return false;
    }
    if (filters.installmentOnly && !/parcela\s+\d+\s*\/\s*\d+/i.test(row.descricao || "")) {
      return false;
    }
    if (filters.creditCardOnly && row.tipo_conta !== "credit_card") {
      return false;
    }
    if (filters.supplierKey && supplierKeyForRow(row) !== filters.supplierKey) {
      return false;
    }
    if (filters.search) {
      const haystack = normalizeText([
        row.descricao,
        row.descricao_normalizada,
        row.categoria,
        row.contraparte,
        row.banco,
        row.origem_financeira,
      ].join(" "));
      if (!haystack.includes(normalizeText(filters.search))) {
        return false;
      }
    }
    return true;
  });
}

function latestLedgerBalances(imports) {
  const balances = new Map();
  imports
    .filter((item) => String(item.status_code || "").startsWith("completed"))
    .forEach((item) => {
      const balance = Number(item.processing_summary?.ledger_balance);
      const balanceDate = item.processing_summary?.ledger_balance_date
        || item.processing_summary?.period?.end_date
        || null;
      if (!item.financial_account_id || !Number.isFinite(balance) || !balanceDate) return;

      const current = balances.get(item.financial_account_id);
      if (!current || String(balanceDate).localeCompare(String(current.balance_date)) > 0) {
        balances.set(item.financial_account_id, { balance, balance_date: balanceDate });
      }
    });
  return balances;
}

function computeAccountBalances(accounts, transactions, imports = []) {
  const importedBalances = latestLedgerBalances(imports);
  return accounts.map((account) => {
    const calculatedBalance = transactions
      .filter((row) => row.conta_financeira_id === account.id)
      .reduce((sum, row) => sum + Number(row.valor ?? 0), Number(account.opening_balance ?? 0));
    const importedBalance = account.account_type === "credit_card" ? null : importedBalances.get(account.id);
    const balance = importedBalance?.balance ?? calculatedBalance;

    return {
      id: account.id,
      name: account.name,
      account_type: account.account_type,
      account_type_label: accountTypeLabel(account.account_type),
      institution_name: account.financial_institution?.name ?? "Sem instituicao",
      current_balance: Number(balance.toFixed(2)),
      balance_as_of: importedBalance?.balance_date ?? null,
      balance_source: importedBalance ? "ofx_ledger" : "transactions",
      statement_closing_day: account.statement_closing_day,
      statement_due_day: account.statement_due_day,
      credit_limit_amount: account.credit_limit_amount,
      is_active: account.is_active,
    };
  });
}

function getCycleWindow(referenceDate, closingDay) {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const day = referenceDate.getUTCDate();
  const safeClosingDay = Math.min(Math.max(Number(closingDay || 1), 1), 28);

  const currentClosing = day > safeClosingDay
    ? new Date(Date.UTC(year, month, safeClosingDay))
    : new Date(Date.UTC(year, month - 1, safeClosingDay));
  const nextClosing = new Date(Date.UTC(currentClosing.getUTCFullYear(), currentClosing.getUTCMonth() + 1, safeClosingDay));
  const previousClosing = new Date(Date.UTC(currentClosing.getUTCFullYear(), currentClosing.getUTCMonth() - 1, safeClosingDay));
  const openStart = new Date(Date.UTC(currentClosing.getUTCFullYear(), currentClosing.getUTCMonth(), currentClosing.getUTCDate() + 1));
  const closedStart = new Date(Date.UTC(previousClosing.getUTCFullYear(), previousClosing.getUTCMonth(), previousClosing.getUTCDate() + 1));

  return {
    openStart: formatDate(openStart),
    openEnd: formatDate(new Date(nextClosing.getTime() - 86400000)),
    closedStart: formatDate(closedStart),
    closedEnd: formatDate(currentClosing),
    currentClosing,
  };
}

function buildSafeMonthDate(baseDate, monthOffset) {
  const year = baseDate.getUTCFullYear();
  const month = baseDate.getUTCMonth() + monthOffset;
  const targetMonthStart = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(baseDate.getUTCDate(), lastDay);
  return new Date(Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth(), day));
}

function amountsReconcile(expectedAmount, transactionAmount, tolerance = 0.1) {
  return Math.abs(Math.abs(Number(transactionAmount ?? 0)) - Math.abs(Number(expectedAmount ?? 0))) <= tolerance;
}

function merchantFamilyKey(value) {
  const normalized = normalizeText(value);
  if (/mercado\s+(?:livre|pago)/.test(normalized)) return "mercado";
  if (/nubank|nu\s+pagamentos/.test(normalized)) return "nubank";
  if (/banco\s+inter|cartao\s+inter/.test(normalized)) return "inter";
  return normalizeSupplierName(normalized);
}

function findCommitmentPayment(transactions, commitmentName, amount, dueDate) {
  const dueMonth = String(dueDate || "").slice(0, 7);
  const familyKey = merchantFamilyKey(commitmentName);
  if (!dueMonth || !familyKey || Number(amount) <= 0) return null;

  return transactions.find((transaction) => {
    const transactionMonth = String(transaction.occurred_on || transaction.data || "").slice(0, 7);
    return transactionMonth === dueMonth
      && Number(transaction.valor ?? transaction.amount ?? 0) < 0
      && merchantFamilyKey(transaction.descricao || transaction.original_description) === familyKey
      && amountsReconcile(amount, transaction.valor ?? transaction.amount);
  }) ?? null;
}

function findCardPayment(transactions, card, amount, dueDate) {
  const dueMonth = String(dueDate || "").slice(0, 7);
  if (!dueMonth || Number(amount) <= 0) return null;
  const cardText = normalizeText(`${card.name} ${card.institution_name}`);

  return transactions.find((transaction) => {
    if (transaction.conta_financeira_id !== card.id) return false;
    const transactionMonth = String(transaction.occurred_on || transaction.data || "").slice(0, 7);
    if (transactionMonth !== dueMonth) return false;
    const description = normalizeText(transaction.descricao || transaction.original_description);
    const value = Number(transaction.valor ?? transaction.amount ?? 0);

    if (card.is_manual_card) {
      return value < 0
        && /fatura|cartao/.test(description)
        && (!/inter/.test(cardText) || /inter/.test(description))
        && amountsReconcile(amount, value);
    }

    return value > 0 && /pagamento/.test(description) && amountsReconcile(amount, value);
  }) ?? null;
}

function buildCardSummary(accounts, transactions, competence, installmentPlans = []) {
  const cards = accounts.filter((account) => account.account_type === "credit_card");
  const cardAccountIds = new Set(cards.map((account) => account.id));
  const manualCardAccounts = accounts.filter((account) => {
    const accountText = normalizeText(`${account.name} ${account.institution_name}`);
    return !cardAccountIds.has(account.id)
      && installmentPlans.some((plan) => plan.financial_account_id === account.id)
      && /nubank|inter/.test(accountText);
  });
  const summaryAccounts = [...cards, ...manualCardAccounts.map((account) => ({
    ...account,
    name: /inter/.test(normalizeText(`${account.name} ${account.institution_name}`))
      ? "Banco Inter - Cartao de credito"
      : `${account.name} - Cartao de credito`,
    account_type: "credit_card",
    is_manual_card: true,
  }))];
  const manualCardAccountIds = new Set(manualCardAccounts.map((account) => account.id));

  const commitmentMap = new Map();
  installmentPlans.forEach((plan) => {
    const label = plan.merchant_name || plan.description || "Compromisso";
    const key = normalizeSupplierName(label);
    if (manualCardAccountIds.has(plan.financial_account_id)) return;
    const items = (plan.installment_plan_items ?? []).filter((item) => String(item.due_date || "").slice(0, 7) === competence
      && !["paid", "completed", "cancelled"].includes(String(item.status_code || "").toLowerCase()));
    if (!items.length) return;

    const current = commitmentMap.get(key) ?? {
      id: `commitment-${key}`,
      name: label,
      amount: 0,
      due_dates: [],
    };
    current.amount += items.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
    current.due_dates.push(...items.map((item) => item.due_date).filter(Boolean));
    commitmentMap.set(key, current);
  });
  const commitments = [...commitmentMap.values()].map((item) => {
    const amount = Number(item.amount.toFixed(2));
    const dueDate = [...item.due_dates].sort()[0] ?? null;
    const payment = findCommitmentPayment(transactions, item.name, amount, dueDate);
    return {
      id: item.id,
      name: item.name,
      amount,
      due_date: dueDate,
      billing_status: payment ? "paid" : "pending",
      payment_date: payment?.occurred_on || payment?.data || null,
      payment_amount: payment ? Math.abs(Number(payment.valor ?? payment.amount ?? 0)) : null,
      competence,
    };
  });

  if (!summaryAccounts.length && !commitments.length) {
    return {
      open_amount: 0,
      closed_amount: 0,
      next_due_date: null,
      utilized_limit_amount: 0,
      utilized_limit_ratio: null,
      cards: [],
      commitments: [],
    };
  }

  const rows = summaryAccounts.map((card) => {
    const cardText = normalizeText(`${card.name} ${card.institution_name}`);
    const effectiveClosingDay = /nubank/.test(cardText) ? 3 : card.statement_closing_day;
    const cardTransactions = card.is_manual_card
      ? []
      : transactions.filter((transaction) => transaction.conta_financeira_id === card.id);
    // Card transaction competence identifies the purchase cycle; the dashboard
    // competence identifies the month in which that statement is due.
    const statementCompetence = shiftMonthIso(`${competence}-01`, -1)?.slice(0, 7);
    const previousStatementCompetence = shiftMonthIso(`${competence}-01`, -2)?.slice(0, 7);
    const currentStatementRows = cardTransactions.filter((transaction) => String(transaction.data_competencia || transaction.data || "").slice(0, 7) === statementCompetence);
    const previousStatementRows = cardTransactions.filter((transaction) => String(transaction.data_competencia || transaction.data || "").slice(0, 7) === previousStatementCompetence);
    const currentStatementTotals = summarizeTransactionTotals(currentStatementRows, null);
    const previousStatementTotals = summarizeTransactionTotals(previousStatementRows, null);
    const manualItems = installmentPlans
      .filter((plan) => plan.financial_account_id === card.id)
      .flatMap((plan) => plan.installment_plan_items ?? [])
      .filter((item) => !["paid", "completed", "cancelled"].includes(String(item.status_code || "").toLowerCase()));
    const manualCurrentItems = manualItems.filter((item) => String(item.due_date || "").slice(0, 7) === competence);
    const manualAmount = manualCurrentItems.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
    const currentLiability = card.is_manual_card
      ? Number(manualAmount.toFixed(2))
      : Math.max(0, roundCurrency(currentStatementTotals.expense));
    const previousLiability = card.is_manual_card ? 0 : Math.max(0, roundCurrency(previousStatementTotals.expense));
    const utilized = card.credit_limit_amount ? Number(((currentLiability / card.credit_limit_amount) * 100).toFixed(1)) : null;
    const statementDueMonth = competence;

    const dueDate = card.is_manual_card
      ? manualCurrentItems[0]?.due_date ?? null
      : card.statement_due_day && effectiveClosingDay && statementDueMonth
        ? `${statementDueMonth}-${String(Math.min(Number(card.statement_due_day), 28)).padStart(2, "0")}`
        : null;
    const payment = findCardPayment(transactions, card, currentLiability, dueDate);

    return {
      id: card.id,
      name: card.name,
      open_amount: currentLiability,
      closed_amount: previousLiability,
      statement_amount: currentLiability,
      next_due_date: dueDate,
      credit_limit_amount: card.credit_limit_amount,
      utilized_limit_ratio: utilized,
      billing_status: payment ? "paid" : "pending",
      payment_date: payment?.occurred_on || payment?.data || null,
      payment_amount: payment ? Math.abs(Number(payment.valor ?? payment.amount ?? 0)) : null,
      competence,
    };
  });

  return {
    open_amount: rows.reduce((sum, row) => sum + row.open_amount, 0),
    closed_amount: rows.reduce((sum, row) => sum + row.closed_amount, 0),
    next_due_date: rows.find((row) => row.next_due_date)?.next_due_date ?? null,
    utilized_limit_amount: rows.reduce((sum, row) => sum + (row.credit_limit_amount ?? 0), 0),
    utilized_limit_ratio: rows.some((row) => row.utilized_limit_ratio != null)
      ? Number((rows.reduce((sum, row) => sum + (row.utilized_limit_ratio ?? 0), 0) / rows.filter((row) => row.utilized_limit_ratio != null).length).toFixed(1))
      : null,
    cards: rows,
    commitments,
  };
}

function buildCurrentCardSummary(accounts, transactions, installmentPlans = [], referenceDate = new Date()) {
  const currentDueCompetence = startOfMonthIso(referenceDate)?.slice(0, 7);
  const nextDueCompetence = shiftMonthIso(`${currentDueCompetence}-01`, 1)?.slice(0, 7);
  const currentSummary = buildCardSummary(accounts, transactions, currentDueCompetence, installmentPlans);
  const nextSummary = buildCardSummary(accounts, transactions, nextDueCompetence, installmentPlans);
  const importedCardIds = new Set(accounts
    .filter((account) => account.account_type === "credit_card")
    .map((account) => account.id));
  const nextCardsById = new Map(nextSummary.cards.map((card) => [card.id, card]));
  const cards = currentSummary.cards.map((currentCard) => {
    const nextCard = nextCardsById.get(currentCard.id) ?? null;
    const primaryCard = importedCardIds.has(currentCard.id) ? nextCard ?? currentCard : currentCard;
    return {
      ...primaryCard,
      current_statement: currentCard,
      next_statement: nextCard,
    };
  });
  const currentCommitmentsById = new Map(currentSummary.commitments.map((item) => [item.id, item]));
  const nextCommitmentsById = new Map(nextSummary.commitments.map((item) => [item.id, item]));
  const commitmentIds = new Set([...currentCommitmentsById.keys(), ...nextCommitmentsById.keys()]);
  const commitments = [...commitmentIds].map((id) => {
    const currentCommitment = currentCommitmentsById.get(id) ?? null;
    const nextCommitment = nextCommitmentsById.get(id) ?? null;
    return {
      ...(currentCommitment ?? nextCommitment),
      current_statement: currentCommitment,
      next_statement: nextCommitment,
    };
  });

  return {
    open_amount: roundCurrency(cards.reduce((sum, card) => sum + Number(card.open_amount ?? 0), 0)),
    closed_amount: roundCurrency(cards.reduce((sum, card) => sum + Number(card.closed_amount ?? 0), 0)),
    next_due_date: cards.map((card) => card.next_due_date).filter(Boolean).sort()[0] ?? null,
    utilized_limit_amount: roundCurrency(cards.reduce((sum, card) => sum + Number(card.credit_limit_amount ?? 0), 0)),
    utilized_limit_ratio: cards.some((card) => card.utilized_limit_ratio != null)
      ? roundCurrency(cards.reduce((sum, card) => sum + Number(card.utilized_limit_ratio ?? 0), 0)
        / cards.filter((card) => card.utilized_limit_ratio != null).length)
      : null,
    cards,
    commitments,
    reference_competence: currentDueCompetence,
  };
}

function buildCategorySummary(transactions, appUser) {
  const map = new Map();
  transactions
    .filter((row) => classifyTransactionForTotals(row, appUser) === "expense")
    .forEach((row) => {
      const key = row.categoria || "Sem categoria";
      map.set(key, (map.get(key) ?? 0) + Math.abs(Number(row.valor ?? 0)));
    });

  return [...map.entries()]
    .map(([name, total]) => ({ name, total: Number(total.toFixed(2)) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
}

function buildMonthlyTrend(transactions, appUser) {
  const trend = new Map();
  transactions.forEach((row) => {
    const month = String(row.data_competencia || row.data || "").slice(0, 7);
    if (!month) return;
    const current = trend.get(month) ?? { month, income: 0, expense: 0 };
    const totals = summarizeTransactionTotals([row], appUser);
    current.income += totals.income;
    current.expense += totals.expense;
    trend.set(month, current);
  });
  return [...trend.values()]
    .map((item) => ({ ...item, income: roundCurrency(item.income), expense: roundCurrency(item.expense) }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12);
}

function buildRawMonthlyTrend(transactions, accountIds) {
  const allowedAccountIds = new Set(accountIds);
  const trend = new Map();
  transactions.forEach((row) => {
    if (!allowedAccountIds.has(row.conta_financeira_id)) return;

    const month = String(row.data_competencia || row.data || "").slice(0, 7);
    if (!month) return;
    const amount = Number(row?.valor ?? row?.amount ?? 0);
    const current = trend.get(month) ?? { month, income: 0, expense: 0 };
    if (amount > 0) current.income += amount;
    if (amount < 0) current.expense += Math.abs(amount);
    trend.set(month, current);
  });

  return [...trend.values()]
    .map((item) => ({ ...item, income: roundCurrency(item.income), expense: roundCurrency(item.expense) }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12);
}

function buildSupplierInsights(transactions, appUser) {
  const expenseRows = transactions.filter((row) => classifyTransactionForTotals(row, appUser) === "expense");
  const totalExpenses = expenseRows.reduce((sum, row) => sum + Math.abs(Number(row.valor ?? 0)), 0);
  const map = new Map();

  expenseRows.forEach((row) => {
    const sourceName = supplierSourceForRow(row);
    const normalizedName = normalizeSupplierName(sourceName);
    if (isOwnSupplier(normalizedName, appUser)) return;
    const label = sourceName || "Sem fornecedor";
    const amount = Math.abs(Number(row.valor ?? 0));
    const accountName = row.conta_nome || row.origem_financeira || "Sem conta";
    const institutionName = row.banco || "Sem banco";
    const date = String(row.data || "").slice(0, 10) || null;
    const month = String(row.data_competencia || row.data || "").slice(0, 7) || "Sem competencia";

    const current = map.get(normalizedName) ?? {
      supplier_key: normalizedName,
      supplier_name: label,
      total_spent: 0,
      purchase_count: 0,
      average_spent: 0,
      highest_spent: 0,
      last_purchase_at: null,
      institution_name: institutionName,
      financial_account_name: accountName,
      primary_category: row.categoria || "Sem categoria",
      percentage_of_expenses: 0,
      monthly_series: new Map(),
      category_totals: new Map(),
    };

    current.total_spent += amount;
    current.purchase_count += 1;
    current.highest_spent = Math.max(current.highest_spent, amount);
    current.last_purchase_at = !current.last_purchase_at || date > current.last_purchase_at ? date : current.last_purchase_at;
    current.institution_name = institutionName;
    current.financial_account_name = accountName;
    current.monthly_series.set(month, roundCurrency((current.monthly_series.get(month) ?? 0) + amount));
    current.category_totals.set(row.categoria || "Sem categoria", roundCurrency((current.category_totals.get(row.categoria || "Sem categoria") ?? 0) + amount));
    map.set(normalizedName, current);
  });

  return [...map.values()]
    .map((item) => {
      const primaryCategory = [...item.category_totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Sem categoria";
      return {
        supplier_key: item.supplier_key,
        supplier_name: item.supplier_name,
        total_spent: roundCurrency(item.total_spent),
        purchase_count: item.purchase_count,
        average_spent: roundCurrency(item.total_spent / item.purchase_count),
        highest_spent: roundCurrency(item.highest_spent),
        last_purchase_at: item.last_purchase_at,
        institution_name: item.institution_name,
        financial_account_name: item.financial_account_name,
        primary_category: primaryCategory,
        percentage_of_expenses: totalExpenses > 0 ? roundCurrency((item.total_spent / totalExpenses) * 100) : 0,
        monthly_series: [...item.monthly_series.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([month, total]) => ({ month, total })),
      };
    })
    .sort((a, b) => {
      if (b.total_spent !== a.total_spent) return b.total_spent - a.total_spent;
      if (b.purchase_count !== a.purchase_count) return b.purchase_count - a.purchase_count;
      return String(b.last_purchase_at || "").localeCompare(String(a.last_purchase_at || ""));
    });
}

async function loadInstallmentsSummary(client, appUserId, competence) {
  const monthStart = `${competence}-01`;
  const nextMonth = shiftMonthIso(monthStart, 1);
  const monthEnd = nextMonth
    ? formatDate(new Date(`${nextMonth}T12:00:00Z`).getTime() - 86400000)
    : null;

  const { data, error } = await client
    .from("installment_plan_items")
    .select("id,installment_number,due_date,amount,status_code,installment_plans!inner(id,user_id,description,status_code)")
    .gte("due_date", monthStart)
    .lte("due_date", monthEnd || monthStart)
    .eq("installment_plans.user_id", appUserId)
    .eq("installment_plans.status_code", "active")
    .neq("status_code", "paid")
    .neq("status_code", "cancelled");

  if (error) {
    return {
      count: 0,
      remaining_amount: 0,
      next_installment: null,
      items: [],
    };
  }

  const nextItem = [...(data ?? [])].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0] ?? null;
  return {
    count: data?.length ?? 0,
    remaining_amount: Number((data ?? []).reduce((sum, item) => sum + Number(item.amount ?? 0), 0).toFixed(2)),
    next_installment: nextItem ? {
      due_date: nextItem.due_date,
      amount: nextItem.amount,
      description: nextItem.installment_plans?.description ?? null,
      installment_number: nextItem.installment_number,
    } : null,
    items: data ?? [],
  };
}

async function getFinanceOverview(client, authUserId, query = {}) {
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const filters = buildFilters(query);
  const [transactionsResult, accountsResult, importsResult, duplicatesResult, installmentsSummary, installmentPlansResult] = await Promise.all([
    client.from("vw_transacoes_base").select("*").order("data", { ascending: false }).limit(3000),
    client
      .from("financial_accounts")
      .select("id,name,account_type,opening_balance,is_active,statement_closing_day,statement_due_day,credit_limit_amount,statement_label,financial_institution:financial_institutions(id,name)")
      .eq("user_id", appUser.id)
      .is("archived_at", null)
      .order("name"),
    client.from("imports").select("id,financial_account_id,status_code,processing_summary,finished_at,started_at,accepted_rows,duplicate_rows,total_rows").order("started_at", { ascending: false }).limit(500),
    client.from("view_transacoes_duplicadas").select("transacao_id").limit(500),
    loadInstallmentsSummary(client, appUser.id, filters.competence),
    client.from("installment_plans").select("id,description,merchant_name,financial_account_id,installment_plan_items(installment_number,due_date,amount,status_code)").eq("user_id", appUser.id).eq("status_code", "active").is("archived_at", null),
  ]);

  if (transactionsResult.error || accountsResult.error || importsResult.error || duplicatesResult.error || installmentPlansResult.error) {
    throw new FinanceExperienceError(502, "supabase_query_error", "Falha ao montar a experiencia financeira.");
  }

  const accounts = accountsResult.data ?? [];
  const typedTransactions = (transactionsResult.data ?? []).map((row) => {
    const account = accounts.find((item) => item.id === row.conta_financeira_id) ?? null;
    const accountType = account?.account_type ?? (row.cartao_id ? "credit_card" : "other");
    return {
      ...row,
      tipo_conta: accountType,
      conta_nome: account?.name ?? row.origem_financeira,
      tipo_movimento_calculado: classifyTransactionForTotals({ ...row, tipo_conta: accountType }, appUser),
    };
  });
  const filteredTransactions = applyTransactionFilters(typedTransactions, filters);
  const accountBalances = computeAccountBalances(accounts, typedTransactions, importsResult.data ?? []);
  const cashAccounts = accountBalances.filter((account) => account.account_type !== "credit_card");
  const cashBalance = cashAccounts.reduce((sum, account) => sum + Number(account.current_balance ?? 0), 0);
  // Os indicadores do dashboard dependem somente da competencia ativa. Filtros
  // usados em Movimentacoes nao podem alterar silenciosamente os totais gerais.
  const monthTransactions = typedTransactions.filter((row) => (
    !filters.competence || String(row.data_competencia || row.data || "").slice(0, 7) === filters.competence
  ));
  const interAccountIds = accountBalances
    .filter((account) => account.account_type !== "credit_card"
      && /\binter\b/.test(normalizeText(`${account.name} ${account.institution_name}`)))
    .map((account) => account.id);
  const monthlyTotals = summarizeRawAccountFlow(monthTransactions, interAccountIds);
  const monthlyIncome = monthlyTotals.income;
  const monthlyExpense = monthlyTotals.expense;
  const selectedCardSummary = buildCardSummary(accountBalances, typedTransactions, filters.competence, installmentPlansResult.data ?? []);
  const cardSummary = buildCurrentCardSummary(accountBalances, typedTransactions, installmentPlansResult.data ?? []);
  const latestImport = importsResult.data?.[0] ?? null;

  return {
    user: appUser,
    filters,
    filter_options: {
      banks: [...new Set(typedTransactions.map((row) => row.banco).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b))),
      categories: [...new Set(typedTransactions.map((row) => row.categoria).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b))),
      accounts: accountBalances.map((account) => ({
        id: account.id,
        name: account.name,
        account_type: account.account_type,
        account_type_label: account.account_type_label,
      })),
    },
    metrics: {
      overall_balance: Number(cashBalance.toFixed(2)),
      monthly_income: Number(monthlyIncome.toFixed(2)),
      monthly_expense: Number(monthlyExpense.toFixed(2)),
      monthly_result: Number((monthlyIncome - monthlyExpense).toFixed(2)),
      latest_import_at: latestImport?.finished_at ?? latestImport?.started_at ?? null,
      duplicate_candidates: duplicatesResult.data?.length ?? 0,
    },
    account_balances: accountBalances,
    card_summary: cardSummary,
    selected_card_summary: selectedCardSummary,
    installment_summary: installmentsSummary,
    latest_transactions: filteredTransactions.slice(0, 12),
    import_summary: importsResult.data ?? [],
    category_summary: buildCategorySummary(monthTransactions, appUser),
    monthly_trend: buildRawMonthlyTrend(typedTransactions, interAccountIds),
  };
}

async function listMovements(client, authUserId, query = {}) {
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const filters = buildFilters(query);
  const { data, error } = await client.from("vw_transacoes_base").select("*").order("data", { ascending: false }).limit(4000);
  if (error) {
    throw new FinanceExperienceError(502, "supabase_query_error", "Falha ao consultar movimentacoes.");
  }

  const accountsResult = await client
    .from("financial_accounts")
    .select("id,name,account_type")
    .eq("user_id", appUser.id)
    .is("archived_at", null);

  const accounts = accountsResult.data ?? [];
  const rows = applyTransactionFilters((data ?? []).map((row) => ({
    ...row,
    id: row.transacao_id,
    tipo_conta: accounts.find((item) => item.id === row.conta_financeira_id)?.account_type ?? "other",
    tipo_conta_label: accountTypeLabel(accounts.find((item) => item.id === row.conta_financeira_id)?.account_type ?? "other"),
    conta_nome: accounts.find((item) => item.id === row.conta_financeira_id)?.name ?? row.origem_financeira ?? null,
  })), filters);

  const total = rows.length;
  const from = (filters.page - 1) * filters.pageSize;
  return {
    filters,
    pagination: {
      page: filters.page,
      page_size: filters.pageSize,
      total,
      total_pages: Math.max(1, Math.ceil(total / filters.pageSize)),
    },
    items: rows.slice(from, from + filters.pageSize),
  };
}

async function listDuplicateMovements(client, authUserId, query = {}) {
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const filters = buildFilters(query);
  const [duplicatesResult, baseResult] = await Promise.all([
    client.from("view_transacoes_duplicadas").select("*").order("data", { ascending: false }).limit(1000),
    client.from("vw_transacoes_base").select("*").order("data", { ascending: false }).limit(4000),
  ]);

  if (duplicatesResult.error || baseResult.error) {
    throw new FinanceExperienceError(502, "supabase_query_error", "Falha ao consultar duplicidades.");
  }

  const accountsResult = await client
    .from("financial_accounts")
    .select("id,name,account_type")
    .eq("user_id", appUser.id)
    .is("archived_at", null);
  const accounts = accountsResult.data ?? [];

  const baseById = new Map((baseResult.data ?? []).map((row) => [row.transacao_id, row]));
  const merged = (duplicatesResult.data ?? []).map((row) => ({
    ...row,
    ...(baseById.get(row.transacao_id) ?? {}),
    id: row.transacao_id,
    tipo_conta: accounts.find((item) => item.id === (baseById.get(row.transacao_id) ?? {}).conta_financeira_id)?.account_type ?? "other",
    tipo_conta_label: accountTypeLabel(accounts.find((item) => item.id === (baseById.get(row.transacao_id) ?? {}).conta_financeira_id)?.account_type ?? "other"),
    conta_nome: accounts.find((item) => item.id === (baseById.get(row.transacao_id) ?? {}).conta_financeira_id)?.name
      ?? (baseById.get(row.transacao_id) ?? {}).origem_financeira
      ?? null,
    duplicate_group: row.grupo_duplicidade,
    duplicate_rule: row.motivo_flag,
    duplicate_score: row.score_duplicidade,
    status: (baseById.get(row.transacao_id) ?? {}).status_conciliacao ?? "pending",
  }));
  const filtered = applyTransactionFilters(merged, { ...filters, duplicateOnly: false });

  return {
    filters,
    total: filtered.length,
    items: filtered,
  };
}

async function listSupplierInsights(client, authUserId, query = {}) {
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const filters = buildFilters(query);
  const [baseResult, accountsResult] = await Promise.all([
    client.from("vw_transacoes_base").select("*").order("data", { ascending: false }).limit(4000),
    client
      .from("financial_accounts")
      .select("id,name,account_type")
      .eq("user_id", appUser.id)
      .is("archived_at", null),
  ]);

  if (baseResult.error || accountsResult.error) {
    throw new FinanceExperienceError(502, "supabase_query_error", "Falha ao consultar fornecedores.");
  }

  const accounts = accountsResult.data ?? [];
  const rows = (baseResult.data ?? []).map((row) => ({
    ...row,
    id: row.transacao_id,
    tipo_conta: accounts.find((item) => item.id === row.conta_financeira_id)?.account_type ?? "other",
    conta_nome: accounts.find((item) => item.id === row.conta_financeira_id)?.name ?? row.origem_financeira ?? null,
  }));
  const filtered = applyTransactionFilters(rows, filters);
  const items = buildSupplierInsights(filtered, appUser)
    .filter((item) => item.purchase_count > 1)
    .filter((item) => !filters.search || normalizeText(`${item.supplier_name} ${item.primary_category} ${item.institution_name} ${item.financial_account_name}`).includes(normalizeText(filters.search)));

  return {
    filters,
    total: items.length,
    items,
  };
}

async function ensureCounterparty(client, appUserId, payload) {
  const counterpartyId = optionalText(payload.counterpartyId);
  const supplierName = optionalText(payload.supplierName);
  if (counterpartyId) return counterpartyId;
  if (!supplierName) return null;

  const normalizedName = normalizeText(supplierName);
  const { data: existing } = await client
    .from("counterparties")
    .select("id")
    .eq("user_id", appUserId)
    .eq("normalized_name", normalizedName)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data, error } = await client
    .from("counterparties")
    .insert({
      user_id: appUserId,
      display_name: supplierName,
      normalized_name: normalizedName,
      counterparty_type: "merchant",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new FinanceExperienceError(502, "supabase_insert_error", "Falha ao criar o fornecedor do parcelamento.");
  }

  return data.id;
}

function generateInstallmentItems(firstDueDate, installmentCount, installmentAmount) {
  const base = parseDate(firstDueDate);
  if (!base) return [];
  return Array.from({ length: installmentCount }, (_, index) => {
    const dueDate = buildSafeMonthDate(base, index);
    return {
      installment_number: index + 1,
      due_date: formatDate(dueDate),
      amount: installmentAmount,
      status_code: "scheduled",
    };
  });
}

function distributeInstallmentAmounts(totalAmount, installmentCount, suggestedInstallmentAmount = null) {
  const safeTotal = roundCurrency(totalAmount);
  const safeCount = Number.parseInt(installmentCount, 10);
  if (!Number.isFinite(safeTotal) || !Number.isFinite(safeCount) || safeCount <= 0) {
    return [];
  }

  const baseAmount = suggestedInstallmentAmount != null
    ? roundCurrency(suggestedInstallmentAmount)
    : roundCurrency(safeTotal / safeCount);
  const amounts = [];
  let remaining = safeTotal;

  for (let index = 0; index < safeCount; index += 1) {
    const isLast = index === safeCount - 1;
    const amount = isLast ? roundCurrency(remaining) : roundCurrency(Math.min(baseAmount, remaining));
    amounts.push(amount);
    remaining = roundCurrency(remaining - amount);
  }

  return amounts;
}

async function listInstallmentPlans(client, authUserId) {
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const { data, error } = await client
    .from("installment_plans")
    .select("id,description,merchant_name,total_amount,installment_count,installment_amount,first_due_date,status_code,notes,financial_account_id,counterparty_id,category_id,created_at,updated_at,financial_account:financial_accounts(name),counterparty:counterparties(display_name),installment_plan_items(id,installment_number,due_date,amount,status_code,transaction_id)")
    .eq("user_id", appUser.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw new FinanceExperienceError(502, "supabase_query_error", "Falha ao consultar parcelamentos.");
  }

  return (data ?? []).map((plan) => ({
    ...plan,
    installment_plan_items: [...(plan.installment_plan_items ?? [])].sort((a, b) => {
      if (String(a.due_date || "") !== String(b.due_date || "")) {
        return String(a.due_date || "").localeCompare(String(b.due_date || ""));
      }
      return Number(a.installment_number ?? 0) - Number(b.installment_number ?? 0);
    }),
  }));
}

async function ensureOwnedInstallmentPlan(client, appUserId, planId) {
  const { data, error } = await client
    .from("installment_plans")
    .select("id,user_id,installment_count,total_amount,installment_amount,first_due_date,status_code")
    .eq("id", planId)
    .eq("user_id", appUserId)
    .is("archived_at", null)
    .maybeSingle();

  if (error) {
    throw new FinanceExperienceError(502, "supabase_query_error", "Falha ao localizar o parcelamento informado.");
  }

  if (!data?.id) {
    throw new FinanceExperienceError(404, "installment_plan_not_found", "Parcelamento nao encontrado.");
  }

  return data;
}

async function createInstallmentPlan(client, authUserId, payload) {
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const description = String(payload?.description ?? "").trim();
  const installmentCount = Number.parseInt(payload?.installmentCount, 10);
  const totalAmount = Number(payload?.totalAmount);
  const installmentAmount = Number(payload?.installmentAmount || (totalAmount / installmentCount));
  const firstDueDate = optionalText(payload?.firstDueDate);
  const categoryId = optionalText(payload?.categoryId);
  const financialAccountId = optionalText(payload?.financialAccountId);
  const notes = optionalText(payload?.notes);
  const statusCode = optionalText(payload?.statusCode) || "active";

  if (!description || !Number.isFinite(totalAmount) || !Number.isFinite(installmentCount) || !firstDueDate) {
    throw new FinanceExperienceError(400, "validation_error", "Preencha descricao, valor total, quantidade de parcelas e primeiro vencimento.");
  }
  if (installmentCount <= 0) {
    throw new FinanceExperienceError(400, "validation_error", "Informe uma quantidade valida de parcelas.");
  }
  if (roundCurrency(totalAmount) <= 0) {
    throw new FinanceExperienceError(400, "validation_error", "Informe um valor total maior que zero.");
  }

  const counterpartyId = await ensureCounterparty(client, appUser.id, payload);
  if (financialAccountId) {
    const { data: ownedAccount, error: accountError } = await client
      .from("financial_accounts")
      .select("id,user_id")
      .eq("id", financialAccountId)
      .eq("user_id", appUser.id)
      .maybeSingle();

    if (accountError) {
      throw new FinanceExperienceError(502, "supabase_query_error", "Falha ao localizar a conta do parcelamento.");
    }

    if (!ownedAccount?.id) {
      throw new FinanceExperienceError(403, "forbidden", "Voce nao possui permissao para usar esta conta no parcelamento.");
    }
  }
  await ensureOwnedCategory(client, appUser.id, categoryId);

  const itemAmounts = distributeInstallmentAmounts(totalAmount, installmentCount, installmentAmount);
  const { data: plan, error: planError } = await client
    .from("installment_plans")
    .insert({
      user_id: appUser.id,
      financial_account_id: financialAccountId,
      counterparty_id: counterpartyId,
      category_id: categoryId,
      description,
      merchant_name: optionalText(payload?.supplierName),
      total_amount: roundCurrency(totalAmount),
      installment_count: installmentCount,
      installment_amount: itemAmounts[0],
      first_due_date: firstDueDate,
      status_code: statusCode,
      source_code: "manual",
      notes,
    })
    .select("id,description,merchant_name,total_amount,installment_count,installment_amount,first_due_date,status_code")
    .single();

  if (planError || !plan) {
    throw new FinanceExperienceError(502, "supabase_insert_error", "Falha ao criar o parcelamento.");
  }

  const items = generateInstallmentItems(firstDueDate, installmentCount, itemAmounts[0]).map((item, index) => ({
    installment_plan_id: plan.id,
    amount: itemAmounts[index],
    ...item,
  }));

  const { error: itemsError } = await client.from("installment_plan_items").insert(items);
  if (itemsError) {
    throw new FinanceExperienceError(502, "supabase_insert_error", "Falha ao gerar as parcelas automaticamente.");
  }

  return plan;
}

async function linkInstallmentItem(client, authUserId, installmentPlanId, itemId, payload) {
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const transactionId = optionalText(payload?.transactionId);
  const statusCode = optionalText(payload?.statusCode);

  await ensureOwnedInstallmentPlan(client, appUser.id, installmentPlanId);

  const { data: item, error } = await client
    .from("installment_plan_items")
    .select("id,installment_plan_id,transaction_id,status_code")
    .eq("id", itemId)
    .eq("installment_plan_id", installmentPlanId)
    .single();

  if (error || !item) {
    throw new FinanceExperienceError(404, "installment_item_not_found", "Parcela nao encontrada.");
  }

  if (transactionId) {
    await ensureOwnedTransaction(client, appUser.id, transactionId);
    const { data: existingLink, error: existingLinkError } = await client
      .from("installment_plan_items")
      .select("id")
      .eq("transaction_id", transactionId)
      .neq("id", itemId)
      .maybeSingle();

    if (existingLinkError) {
      throw new FinanceExperienceError(502, "supabase_query_error", "Falha ao verificar vinculos existentes da parcela.");
    }

    if (existingLink?.id) {
      throw new FinanceExperienceError(409, "transaction_already_linked", "Esta movimentacao ja foi vinculada a outra parcela.");
    }
  }

  const nextStatus = transactionId
    ? "linked"
    : statusCode === "paid"
      ? "paid"
      : statusCode === "cancelled"
        ? "cancelled"
        : "scheduled";

  const { data: updated, error: updateError } = await client
    .from("installment_plan_items")
    .update({
      transaction_id: transactionId,
      status_code: nextStatus,
      paid_at: nextStatus === "paid" ? new Date().toISOString() : null,
    })
    .eq("id", itemId)
    .select("id,transaction_id,status_code,paid_at")
    .single();

  if (updateError || !updated) {
    throw new FinanceExperienceError(502, "supabase_update_error", "Falha ao vincular a parcela a movimentacao.");
  }

  return updated;
}

async function updateInstallmentPlan(client, authUserId, installmentPlanId, payload) {
  const appUser = await resolveCurrentAppUser(client, authUserId);
  await ensureOwnedInstallmentPlan(client, appUser.id, installmentPlanId);

  const patch = {};
  if (payload?.description != null) patch.description = String(payload.description).trim();
  if (payload?.notes !== undefined) patch.notes = optionalText(payload.notes);
  if (payload?.statusCode != null) patch.status_code = optionalText(payload.statusCode) || "active";
  if (payload?.archive === true) {
    patch.archived_at = new Date().toISOString();
    patch.status_code = "cancelled";
  }

  if (!Object.keys(patch).length) {
    throw new FinanceExperienceError(400, "validation_error", "Nenhuma alteracao valida foi informada para o parcelamento.");
  }

  const { data, error } = await client
    .from("installment_plans")
    .update(patch)
    .eq("id", installmentPlanId)
    .eq("user_id", appUser.id)
    .select("id,description,status_code,notes,updated_at,archived_at")
    .single();

  if (error || !data) {
    throw new FinanceExperienceError(502, "supabase_update_error", "Falha ao atualizar o parcelamento.");
  }

  return data;
}

async function updateMovement(client, authUserId, movementId, payload) {
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const categoryId = optionalText(payload?.categoryId);
  const notes = payload?.notes !== undefined ? optionalText(payload.notes) : undefined;

  const transaction = await ensureOwnedTransaction(client, appUser.id, movementId);
  await ensureOwnedCategory(client, appUser.id, categoryId);

  const patch = {};
  if (payload?.categoryId !== undefined) patch.category_id = categoryId;
  if (notes !== undefined) patch.notes = notes;

  if (!Object.keys(patch).length) {
    throw new FinanceExperienceError(400, "validation_error", "Nenhuma alteracao valida foi informada para a movimentacao.");
  }

  const { data, error } = await client
    .from("transactions")
    .update(patch)
    .eq("id", transaction.id)
    .eq("user_id", appUser.id)
    .select("id,category_id,notes,updated_at")
    .single();

  if (error || !data) {
    throw new FinanceExperienceError(502, "supabase_update_error", "Falha ao atualizar a movimentacao.");
  }

  let learnedRule = null;
  if (categoryId && payload?.learnRule !== false) {
    try {
      learnedRule = await learnClassificationRule(client, appUser.id, {
        description: transaction.normalized_description || transaction.original_description,
        movementType: transaction.movement_type,
      }, categoryId);
    } catch {
      // O aprendizado e complementar e nunca deve invalidar a categorizacao manual.
    }
  }

  return { ...data, learned_rule: learnedRule };
}

async function updateMovementsCategory(client, authUserId, payload) {
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const movementIds = normalizeMovementIds(payload?.movementIds);
  const categoryId = optionalText(payload?.categoryId);

  if (!movementIds.length || !categoryId) {
    throw new FinanceExperienceError(400, "validation_error", "Informe as movimentacoes e a categoria para atualizar o lote.");
  }
  if (movementIds.length > 500) {
    throw new FinanceExperienceError(400, "batch_too_large", "Selecione no maximo 500 movimentacoes por vez.");
  }

  await ensureOwnedCategory(client, appUser.id, categoryId);
  const { data: transactions, error: queryError } = await client
    .from("transactions")
    .select("id,original_description,normalized_description,movement_type")
    .eq("user_id", appUser.id)
    .in("id", movementIds);

  if (queryError) {
    throw new FinanceExperienceError(502, "supabase_query_error", "Falha ao localizar as movimentacoes selecionadas.");
  }

  if ((transactions ?? []).length !== movementIds.length) {
    throw new FinanceExperienceError(404, "transaction_not_found", "Uma ou mais movimentacoes selecionadas nao foram localizadas.");
  }

  const { data: updated, error: updateError } = await client
    .from("transactions")
    .update({ category_id: categoryId })
    .eq("user_id", appUser.id)
    .in("id", movementIds)
    .select("id,category_id,notes,updated_at");

  if (updateError || (updated ?? []).length !== movementIds.length) {
    throw new FinanceExperienceError(502, "supabase_update_error", "Falha ao categorizar todas as movimentacoes selecionadas.");
  }

  let learnedRules = 0;
  let learningFailures = 0;
  if (payload?.learnRule !== false) {
    const uniqueRuleCandidates = new Map();
    for (const transaction of transactions) {
      const description = transaction.normalized_description || transaction.original_description;
      const pattern = learnedPatternFromDescription(description);
      if (pattern.length >= 4 && !uniqueRuleCandidates.has(pattern)) {
        uniqueRuleCandidates.set(pattern, transaction);
      }
    }

    for (const transaction of uniqueRuleCandidates.values()) {
      try {
        const learned = await learnClassificationRule(client, appUser.id, {
          description: transaction.normalized_description || transaction.original_description,
          movementType: transaction.movement_type,
        }, categoryId);
        if (learned) learnedRules += 1;
      } catch {
        learningFailures += 1;
      }
    }
  }

  return {
    items: updated,
    updated_count: updated.length,
    learned_rules: learnedRules,
    learning_failures: learningFailures,
  };
}

async function updateDuplicateDecision(client, authUserId, movementId, payload) {
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const decision = optionalText(payload?.decision);
  const notes = optionalText(payload?.notes);

  const decisionMap = {
    keep: {
      reconciliation_status: "matched",
      note: "Marcada manualmente para manter este lancamento no grupo de duplicidade.",
    },
    not_duplicate: {
      reconciliation_status: "reviewed",
      note: "Marcada manualmente como nao duplicada.",
    },
    review_later: {
      reconciliation_status: "pending",
      note: "Mantida para revisao posterior.",
    },
  };

  if (!decisionMap[decision]) {
    throw new FinanceExperienceError(400, "validation_error", "Decisao de duplicidade invalida.");
  }

  const transaction = await ensureOwnedTransaction(client, appUser.id, movementId);
  const baseNote = decisionMap[decision].note;
  const finalNotes = [baseNote, notes].filter(Boolean).join(" ");

  const { data, error } = await client
    .from("transactions")
    .update({
      reconciliation_status: decisionMap[decision].reconciliation_status,
      notes: finalNotes || null,
    })
    .eq("id", transaction.id)
    .eq("user_id", appUser.id)
    .select("id,reconciliation_status,notes,updated_at")
    .single();

  if (error || !data) {
    throw new FinanceExperienceError(502, "supabase_update_error", "Falha ao registrar a decisao de duplicidade.");
  }

  return data;
}

module.exports = {
  FinanceExperienceError,
  accountTypeLabel,
  applyTransactionFilters,
  buildFilters,
  buildCardSummary,
  buildCurrentCardSummary,
  buildMonthlyTrend,
  buildRawMonthlyTrend,
  buildSupplierInsights,
  classifyTransactionForTotals,
  computeAccountBalances,
  distributeInstallmentAmounts,
  generateInstallmentItems,
  getFinanceOverview,
  listMovements,
  listDuplicateMovements,
  listSupplierInsights,
  normalizeMovementIds,
  summarizeTransactionTotals,
  summarizeRawAccountFlow,
  listInstallmentPlans,
  createInstallmentPlan,
  linkInstallmentItem,
  updateInstallmentPlan,
  updateMovement,
  updateMovementsCategory,
  updateDuplicateDecision,
};
