const { adminSupabaseClient } = require("../config/supabaseClients");

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

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
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

function buildFilters(query = {}) {
  const competence = optionalText(query.competence) || startOfMonthIso().slice(0, 7);
  return {
    competence,
    bank: optionalText(query.bank),
    financialAccountId: optionalText(query.financialAccountId ?? query.accountId),
    category: optionalText(query.category),
    movementType: optionalText(query.movementType ?? query.type),
    duplicateOnly: String(query.duplicateOnly ?? "") === "true",
    installmentOnly: String(query.installmentOnly ?? "") === "true",
    creditCardOnly: String(query.creditCardOnly ?? "") === "true",
    search: optionalText(query.search),
    page: Math.max(1, Number.parseInt(query.page, 10) || 1),
    pageSize: Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 20)),
  };
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

function computeAccountBalances(accounts, transactions) {
  return accounts.map((account) => {
    const balance = transactions
      .filter((row) => row.conta_financeira_id === account.id)
      .reduce((sum, row) => sum + Number(row.valor ?? 0), Number(account.opening_balance ?? 0));

    return {
      id: account.id,
      name: account.name,
      account_type: account.account_type,
      institution_name: account.financial_institution?.name ?? "Sem instituicao",
      current_balance: Number(balance.toFixed(2)),
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
  const previousClosing = new Date(Date.UTC(currentClosing.getUTCFullYear(), currentClosing.getUTCMonth() - 1, safeClosingDay));
  const openStart = new Date(Date.UTC(currentClosing.getUTCFullYear(), currentClosing.getUTCMonth(), currentClosing.getUTCDate() + 1));
  const closedStart = new Date(Date.UTC(previousClosing.getUTCFullYear(), previousClosing.getUTCMonth(), previousClosing.getUTCDate() + 1));

  return {
    openStart: formatDate(openStart),
    openEnd: null,
    closedStart: formatDate(closedStart),
    closedEnd: formatDate(currentClosing),
  };
}

function buildCardSummary(accounts, transactions, competence) {
  const referenceDate = parseDate(`${competence}-01`) || new Date();
  const cards = accounts.filter((account) => account.account_type === "credit_card");

  if (!cards.length) {
    return {
      open_amount: 0,
      closed_amount: 0,
      next_due_date: null,
      utilized_limit_amount: 0,
      utilized_limit_ratio: null,
      cards: [],
    };
  }

  const rows = cards.map((card) => {
    const window = getCycleWindow(referenceDate, card.statement_closing_day || 1);
    const cardTransactions = transactions.filter((transaction) => transaction.conta_financeira_id === card.id);
    const openAmount = cardTransactions
      .filter((transaction) => String(transaction.data || "").slice(0, 10) >= window.openStart)
      .reduce((sum, transaction) => sum + Number(transaction.valor ?? 0), 0);
    const closedAmount = cardTransactions
      .filter((transaction) => {
        const date = String(transaction.data || "").slice(0, 10);
        return date >= window.closedStart && date <= window.closedEnd;
      })
      .reduce((sum, transaction) => sum + Number(transaction.valor ?? 0), 0);
    const currentLiability = Math.max(0, -Number(openAmount.toFixed(2)));
    const previousLiability = Math.max(0, -Number(closedAmount.toFixed(2)));
    const utilized = card.credit_limit_amount ? Number(((currentLiability / card.credit_limit_amount) * 100).toFixed(1)) : null;

    return {
      id: card.id,
      name: card.name,
      open_amount: currentLiability,
      closed_amount: previousLiability,
      next_due_date: card.statement_due_day ? `${competence}-${String(card.statement_due_day).padStart(2, "0")}` : null,
      credit_limit_amount: card.credit_limit_amount,
      utilized_limit_ratio: utilized,
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
  };
}

function buildCategorySummary(transactions) {
  const map = new Map();
  transactions
    .filter((row) => Number(row.valor ?? 0) < 0)
    .forEach((row) => {
      const key = row.categoria || "Sem categoria";
      map.set(key, (map.get(key) ?? 0) + Math.abs(Number(row.valor ?? 0)));
    });

  return [...map.entries()]
    .map(([name, total]) => ({ name, total: Number(total.toFixed(2)) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
}

function buildMonthlyTrend(transactions) {
  const trend = new Map();
  transactions.forEach((row) => {
    const month = String(row.data || "").slice(0, 7);
    const current = trend.get(month) ?? { month, income: 0, expense: 0 };
    const amount = Number(row.valor ?? 0);
    if (amount >= 0) current.income += amount;
    if (amount < 0) current.expense += Math.abs(amount);
    trend.set(month, current);
  });
  return [...trend.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
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
    .eq("installment_plans.user_id", appUserId);

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
  const [transactionsResult, accountsResult, importsResult, duplicatesResult, installmentsSummary] = await Promise.all([
    client.from("vw_transacoes_base").select("*").order("data", { ascending: false }).limit(3000),
    client
      .from("financial_accounts")
      .select("id,name,account_type,opening_balance,is_active,statement_closing_day,statement_due_day,credit_limit_amount,statement_label,financial_institution:financial_institutions(id,name)")
      .eq("user_id", appUser.id)
      .is("archived_at", null)
      .order("name"),
    client.from("imports").select("id,status_code,finished_at,started_at,accepted_rows,duplicate_rows,total_rows").order("started_at", { ascending: false }).limit(12),
    client.from("view_transacoes_duplicadas").select("transacao_id").limit(500),
    loadInstallmentsSummary(client, appUser.id, filters.competence),
  ]);

  if (transactionsResult.error || accountsResult.error || importsResult.error || duplicatesResult.error) {
    throw new FinanceExperienceError(502, "supabase_query_error", "Falha ao montar a experiencia financeira.");
  }

  const accounts = accountsResult.data ?? [];
  const typedTransactions = (transactionsResult.data ?? []).map((row) => {
    const account = accounts.find((item) => item.id === row.conta_financeira_id) ?? null;
    return {
      ...row,
      tipo_conta: account?.account_type ?? (row.cartao_id ? "credit_card" : "other"),
      conta_nome: account?.name ?? row.origem_financeira,
    };
  });
  const filteredTransactions = applyTransactionFilters(typedTransactions, filters);
  const accountBalances = computeAccountBalances(accounts, typedTransactions);
  const cashAccounts = accountBalances.filter((account) => account.account_type !== "credit_card");
  const cashBalance = cashAccounts.reduce((sum, account) => sum + Number(account.current_balance ?? 0), 0);
  const monthTransactions = filteredTransactions;
  const monthlyIncome = monthTransactions.filter((row) => Number(row.valor ?? 0) > 0).reduce((sum, row) => sum + Number(row.valor ?? 0), 0);
  const monthlyExpense = monthTransactions.filter((row) => Number(row.valor ?? 0) < 0).reduce((sum, row) => sum + Math.abs(Number(row.valor ?? 0)), 0);
  const cardSummary = buildCardSummary(accountBalances, typedTransactions, filters.competence);
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
    installment_summary: installmentsSummary,
    latest_transactions: filteredTransactions.slice(0, 12),
    import_summary: importsResult.data ?? [],
    category_summary: buildCategorySummary(monthTransactions),
    monthly_trend: buildMonthlyTrend(typedTransactions),
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
    tipo_conta: accounts.find((item) => item.id === row.conta_financeira_id)?.account_type ?? "other",
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
    tipo_conta: accounts.find((item) => item.id === (baseById.get(row.transacao_id) ?? {}).conta_financeira_id)?.account_type ?? "other",
    conta_nome: accounts.find((item) => item.id === (baseById.get(row.transacao_id) ?? {}).conta_financeira_id)?.name
      ?? (baseById.get(row.transacao_id) ?? {}).origem_financeira
      ?? null,
  }));
  const filtered = applyTransactionFilters(merged, { ...filters, duplicateOnly: false });

  return {
    filters,
    total: filtered.length,
    items: filtered,
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
    const dueDate = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + index, base.getUTCDate()));
    return {
      installment_number: index + 1,
      due_date: formatDate(dueDate),
      amount: installmentAmount,
      status_code: "scheduled",
    };
  });
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

  return data ?? [];
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

  const counterpartyId = await ensureCounterparty(client, appUser.id, payload);
  const { data: plan, error: planError } = await client
    .from("installment_plans")
    .insert({
      user_id: appUser.id,
      financial_account_id: financialAccountId,
      counterparty_id: counterpartyId,
      category_id: categoryId,
      description,
      merchant_name: optionalText(payload?.supplierName),
      total_amount: totalAmount,
      installment_count: installmentCount,
      installment_amount: Number(installmentAmount.toFixed(2)),
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

  const items = generateInstallmentItems(firstDueDate, installmentCount, Number(installmentAmount.toFixed(2))).map((item) => ({
    installment_plan_id: plan.id,
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

  const { data: item, error } = await client
    .from("installment_plan_items")
    .select("id,installment_plan_id")
    .eq("id", itemId)
    .eq("installment_plan_id", installmentPlanId)
    .single();

  if (error || !item) {
    throw new FinanceExperienceError(404, "installment_item_not_found", "Parcela nao encontrada.");
  }

  if (transactionId) {
    const { data: transaction } = await client
      .from("transactions")
      .select("id,user_id")
      .eq("id", transactionId)
      .eq("user_id", appUser.id)
      .maybeSingle();

    if (!transaction?.id) {
      throw new FinanceExperienceError(404, "transaction_not_found", "Movimentacao informada nao foi localizada.");
    }
  }

  const { data: updated, error: updateError } = await client
    .from("installment_plan_items")
    .update({
      transaction_id: transactionId,
      status_code: transactionId ? "linked" : "scheduled",
    })
    .eq("id", itemId)
    .select("id,transaction_id,status_code")
    .single();

  if (updateError || !updated) {
    throw new FinanceExperienceError(502, "supabase_update_error", "Falha ao vincular a parcela a movimentacao.");
  }

  return updated;
}

module.exports = {
  FinanceExperienceError,
  getFinanceOverview,
  listMovements,
  listDuplicateMovements,
  listInstallmentPlans,
  createInstallmentPlan,
  linkInstallmentItem,
};
