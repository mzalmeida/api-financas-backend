const { adminSupabaseClient } = require("../config/supabaseClients");

class PortalServiceError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const ACCOUNT_TYPES = new Set(["checking", "savings", "investment", "payment", "cash", "other", "wallet", "manual", "credit_card"]);

const ENTITY_CONFIG = {
  accounts: {
    table: "financial_accounts",
    ownership: "user",
    defaultSort: { column: "name", ascending: true },
    select: "id,user_id,financial_institution_id,name,account_type,currency_code,external_identifier,masked_account_number,masked_branch_number,opening_balance,opening_balance_date,statement_closing_day,statement_due_day,credit_limit_amount,statement_label,is_active,created_at,updated_at,archived_at",
    searchColumns: ["name", "external_identifier", "masked_account_number"],
    normalize(payload) {
      return {
        name: String(payload?.name ?? "").trim(),
        financial_institution_id: optionalText(payload?.financial_institution_id ?? payload?.financialInstitutionId),
        account_type: String(payload?.account_type ?? payload?.accountType ?? "checking").trim(),
        currency_code: String(payload?.currency_code ?? payload?.currencyCode ?? "BRL").trim().toUpperCase() || "BRL",
        external_identifier: optionalText(payload?.external_identifier ?? payload?.externalIdentifier),
        masked_account_number: optionalText(payload?.masked_account_number ?? payload?.maskedAccountNumber),
        masked_branch_number: optionalText(payload?.masked_branch_number ?? payload?.maskedBranchNumber),
        opening_balance: normalizeNumber(payload?.opening_balance ?? payload?.openingBalance ?? 0),
        opening_balance_date: optionalText(payload?.opening_balance_date ?? payload?.openingBalanceDate),
        statement_closing_day: normalizeNullableInteger(payload?.statement_closing_day ?? payload?.statementClosingDay),
        statement_due_day: normalizeNullableInteger(payload?.statement_due_day ?? payload?.statementDueDay),
        credit_limit_amount: normalizeNullableNumber(payload?.credit_limit_amount ?? payload?.creditLimitAmount),
        statement_label: optionalText(payload?.statement_label ?? payload?.statementLabel),
        is_active: payload?.is_active ?? payload?.isActive ?? true,
      };
    },
    validate(payload) {
      if (!payload.name) {
        throw new PortalServiceError(400, "validation_error", "Informe o nome da conta.");
      }
      if (!payload.account_type) {
        throw new PortalServiceError(400, "validation_error", "Informe o tipo da conta.");
      }
      if (!ACCOUNT_TYPES.has(payload.account_type)) {
        throw new PortalServiceError(400, "validation_error", "Tipo de conta invalido.");
      }
      if (!["wallet", "manual"].includes(payload.account_type) && !payload.financial_institution_id) {
        throw new PortalServiceError(400, "validation_error", "Instituicao obrigatoria para este tipo de conta.");
      }
      if (payload.opening_balance_date && Number.isNaN(new Date(`${payload.opening_balance_date}T12:00:00Z`).getTime())) {
        throw new PortalServiceError(400, "validation_error", "Data do saldo inicial invalida.");
      }
      if (payload.account_type === "credit_card" && (!payload.statement_closing_day || !payload.statement_due_day)) {
        throw new PortalServiceError(400, "validation_error", "Informe fechamento e vencimento para conta de cartao.");
      }
    },
  },
  categories: {
    table: "categories",
    ownership: "shared_or_user",
    defaultSort: { column: "display_order", ascending: true },
    select: "id,user_id,parent_category_id,name,normalized_name,movement_type,color_hex,icon_name,display_order,is_active,created_at,updated_at,archived_at",
    searchColumns: ["name", "normalized_name", "icon_name"],
    normalize(payload) {
      const name = String(payload?.name ?? "").trim();
      return {
        name,
        normalized_name: normalizeText(name),
        parent_category_id: optionalText(payload?.parent_category_id ?? payload?.parentCategoryId),
        movement_type: String(payload?.movement_type ?? payload?.movementType ?? "expense").trim(),
        color_hex: normalizeColor(payload?.color_hex ?? payload?.colorHex),
        icon_name: optionalText(payload?.icon_name ?? payload?.iconName),
        display_order: normalizeInteger(payload?.display_order ?? payload?.displayOrder, 0),
        is_active: payload?.is_active ?? payload?.isActive ?? true,
      };
    },
    validate(payload) {
      if (!payload.name) {
        throw new PortalServiceError(400, "validation_error", "Informe o nome da categoria.");
      }
      if (!payload.movement_type) {
        throw new PortalServiceError(400, "validation_error", "Informe o tipo de movimento.");
      }
    },
  },
  cards: {
    table: "cards",
    ownership: "user",
    defaultSort: { column: "name", ascending: true },
    select: "id,user_id,financial_institution_id,paying_account_id,name,external_identifier,brand,last_four_digits,statement_closing_day,statement_due_day,is_active,created_at,updated_at,archived_at",
    searchColumns: ["name", "brand", "external_identifier", "last_four_digits"],
    normalize(payload) {
      return {
        name: String(payload?.name ?? "").trim(),
        financial_institution_id: optionalText(payload?.financial_institution_id ?? payload?.financialInstitutionId),
        paying_account_id: optionalText(payload?.paying_account_id ?? payload?.payingAccountId),
        external_identifier: optionalText(payload?.external_identifier ?? payload?.externalIdentifier),
        brand: optionalText(payload?.brand),
        last_four_digits: normalizeLastFour(payload?.last_four_digits ?? payload?.lastFourDigits),
        statement_closing_day: normalizeNullableInteger(payload?.statement_closing_day ?? payload?.statementClosingDay),
        statement_due_day: normalizeNullableInteger(payload?.statement_due_day ?? payload?.statementDueDay),
        is_active: payload?.is_active ?? payload?.isActive ?? true,
      };
    },
    validate(payload) {
      if (!payload.name) {
        throw new PortalServiceError(400, "validation_error", "Informe o nome do cartao.");
      }
    },
  },
  counterparties: {
    table: "counterparties",
    ownership: "user",
    defaultSort: { column: "display_name", ascending: true },
    select: "id,user_id,display_name,normalized_name,counterparty_type,external_identifier,masked_document,notes,created_at,updated_at,archived_at",
    searchColumns: ["display_name", "normalized_name", "masked_document", "external_identifier"],
    normalize(payload) {
      const displayName = String(payload?.display_name ?? payload?.displayName ?? "").trim();
      return {
        display_name: displayName,
        normalized_name: normalizeText(displayName),
        counterparty_type: String(payload?.counterparty_type ?? payload?.counterpartyType ?? "merchant").trim(),
        external_identifier: optionalText(payload?.external_identifier ?? payload?.externalIdentifier),
        masked_document: optionalText(payload?.masked_document ?? payload?.maskedDocument),
        notes: optionalText(payload?.notes),
      };
    },
    validate(payload) {
      if (!payload.display_name) {
        throw new PortalServiceError(400, "validation_error", "Informe o nome do fornecedor.");
      }
    },
  },
  institutions: {
    table: "financial_institutions",
    ownership: "global",
    defaultSort: { column: "name", ascending: true },
    select: "id,name,normalized_name,institution_type,external_code,country_code,is_active,created_at,updated_at",
    searchColumns: ["name", "normalized_name", "external_code"],
    normalize(payload) {
      const name = String(payload?.name ?? "").trim();
      return {
        name,
        normalized_name: normalizeText(name),
        institution_type: String(payload?.institution_type ?? payload?.institutionType ?? "bank").trim(),
        external_code: optionalText(payload?.external_code ?? payload?.externalCode),
        country_code: String(payload?.country_code ?? payload?.countryCode ?? "BR").trim().toUpperCase() || "BR",
        is_active: payload?.is_active ?? payload?.isActive ?? true,
      };
    },
    validate(payload) {
      if (!payload.name) {
        throw new PortalServiceError(400, "validation_error", "Informe o nome da instituicao financeira.");
      }
      if (!payload.institution_type) {
        throw new PortalServiceError(400, "validation_error", "Informe o tipo da instituicao.");
      }
    },
  },
};

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function normalizeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeNullableInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeColor(value) {
  const text = optionalText(value);
  if (!text) return null;
  return /^#[0-9A-Fa-f]{6}$/.test(text) ? text.toUpperCase() : null;
}

function normalizeLastFour(value) {
  const text = optionalText(value);
  if (!text) return null;
  const digits = text.replace(/\D/g, "").slice(-4);
  return digits.length === 4 ? digits : null;
}

function getEntityConfig(entityName) {
  const config = ENTITY_CONFIG[entityName];
  if (!config) {
    throw new PortalServiceError(404, "entity_not_found", "Cadastro solicitado nao existe.");
  }
  return config;
}

async function resolveCurrentAppUser(client, authUserId) {
  const { data, error } = await client
    .from("users")
    .select("id,email,display_name,profile_code,status_code,auth_subject")
    .eq("auth_provider", "supabase")
    .eq("auth_subject", authUserId)
    .single();

  if (error || !data) {
    throw new PortalServiceError(403, "forbidden", "Usuario autenticado sem vinculo ao dominio financeiro.");
  }

  return data;
}

async function ensureUserSettings(client, appUserId) {
  const { data, error } = await client
    .from("user_settings")
    .select("id,user_id,default_currency_code,time_zone,dashboard_preferences,import_preferences,created_at,updated_at")
    .eq("user_id", appUserId)
    .maybeSingle();

  if (error) {
    throw new PortalServiceError(502, "supabase_query_error", "Falha ao consultar configuracoes do usuario.");
  }

  if (data) return data;

  const { data: inserted, error: insertError } = await adminSupabaseClient
    .from("user_settings")
    .insert({
      user_id: appUserId,
      default_currency_code: "BRL",
      time_zone: "America/Sao_Paulo",
      dashboard_preferences: {},
      import_preferences: {},
    })
    .select("id,user_id,default_currency_code,time_zone,dashboard_preferences,import_preferences,created_at,updated_at")
    .single();

  if (insertError || !inserted) {
    throw new PortalServiceError(502, "supabase_insert_error", "Falha ao inicializar configuracoes do usuario.");
  }

  return inserted;
}

async function getOverview(client, authUserId) {
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const settings = await ensureUserSettings(client, appUser.id);
  const [
    transactionsResult,
    accountsResult,
    cardsResult,
    categoriesResult,
    importsResult,
    bankSummaryResult,
  ] = await Promise.all([
    client.from("vw_transacoes_base").select("*").limit(500),
    client.from("financial_accounts").select("id").eq("user_id", appUser.id).is("archived_at", null),
    client.from("cards").select("id").eq("user_id", appUser.id).is("archived_at", null),
    client.from("categories").select("id,user_id").or(`user_id.eq.${appUser.id},user_id.is.null`).is("archived_at", null),
    client.from("imports").select("id,status_code,finished_at,started_at,accepted_rows,duplicate_rows,total_rows").order("started_at", { ascending: false }).limit(10),
    client.from("vw_gastos_por_banco").select("*").limit(10),
  ]);

  if (
    transactionsResult.error
    || accountsResult.error
    || cardsResult.error
    || categoriesResult.error
    || importsResult.error
    || bankSummaryResult.error
  ) {
    throw new PortalServiceError(502, "supabase_query_error", "Falha ao montar o dashboard.");
  }

  const transactions = transactionsResult.data ?? [];
  const totalBalance = transactions.reduce((sum, row) => sum + Number(row.valor ?? 0), 0);
  const incomes = transactions.filter((row) => Number(row.valor) > 0).reduce((sum, row) => sum + Number(row.valor ?? 0), 0);
  const expenses = transactions.filter((row) => Number(row.valor) < 0).reduce((sum, row) => sum + Math.abs(Number(row.valor ?? 0)), 0);
  const transfers = transactions.filter((row) => row.tipo_movimento === "transfer").reduce((sum, row) => sum + Math.abs(Number(row.valor ?? 0)), 0);
  const latestImport = importsResult.data?.[0] ?? null;

  const categories = categoriesResult.data ?? [];
  const categoryBreakdown = new Map();
  const monthlyTrend = new Map();

  for (const row of transactions) {
    const category = row.categoria || "Sem categoria";
    const amount = Math.abs(Number(row.valor ?? 0));
    categoryBreakdown.set(category, (categoryBreakdown.get(category) ?? 0) + amount);

    const month = String(row.data || "").slice(0, 7) || "Sem data";
    const monthStats = monthlyTrend.get(month) ?? { month, income: 0, expense: 0 };
    if (Number(row.valor) >= 0) {
      monthStats.income += Number(row.valor ?? 0);
    } else {
      monthStats.expense += Math.abs(Number(row.valor ?? 0));
    }
    monthlyTrend.set(month, monthStats);
  }

  return {
    user: {
      id: appUser.id,
      email: appUser.email,
      display_name: appUser.display_name,
      profile_code: appUser.profile_code,
      status_code: appUser.status_code,
    },
    settings,
    metrics: {
      total_balance: totalBalance,
      total_income: incomes,
      total_expense: expenses,
      total_transfers: transfers,
      latest_import_at: latestImport?.finished_at ?? latestImport?.started_at ?? null,
      accounts_count: accountsResult.data?.length ?? 0,
      cards_count: cardsResult.data?.length ?? 0,
      categories_count: categories.length,
      transactions_count: transactions.length,
    },
    latest_transactions: transactions.slice(0, 8),
    bank_summary: bankSummaryResult.data ?? [],
    import_summary: importsResult.data ?? [],
    category_summary: [...categoryBreakdown.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8),
    monthly_trend: [...monthlyTrend.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-6),
  };
}

function applySearch(query, config, search) {
  if (!search) return query;
  const terms = config.searchColumns
    .map((column) => `${column}.ilike.%${search}%`);
  return query.or(terms.join(","));
}

async function listCatalog(client, authUserId, entityName, query = {}) {
  const config = getEntityConfig(entityName);
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const page = Math.max(1, normalizeInteger(query.page, 1));
  const pageSize = Math.min(100, Math.max(1, normalizeInteger(query.pageSize, 12)));
  const search = optionalText(query.search);
  const status = optionalText(query.status);
  const archived = query.archived === "true";
  const sortColumn = optionalText(query.sort) || config.defaultSort.column;
  const ascending = query.order === "desc" ? false : config.defaultSort.ascending;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let dbQuery = client
    .from(config.table)
    .select(config.select, { count: "exact" });

  if (config.ownership === "user") {
    dbQuery = dbQuery.eq("user_id", appUser.id);
  } else if (config.ownership === "shared_or_user") {
    dbQuery = dbQuery.or(`user_id.eq.${appUser.id},user_id.is.null`);
  }

  if (!archived && fieldExists(config.select, "archived_at")) {
    dbQuery = dbQuery.is("archived_at", null);
  }

  if (status === "active" && fieldExists(config.select, "is_active")) {
    dbQuery = dbQuery.eq("is_active", true);
  } else if (status === "inactive" && fieldExists(config.select, "is_active")) {
    dbQuery = dbQuery.eq("is_active", false);
  }

  dbQuery = applySearch(dbQuery, config, search);
  dbQuery = dbQuery.order(sortColumn, { ascending }).range(from, to);

  const { data, error, count } = await dbQuery;
  if (error) {
    throw new PortalServiceError(502, "supabase_query_error", "Falha ao consultar o cadastro solicitado.");
  }

  return {
    items: data ?? [],
    pagination: {
      page,
      page_size: pageSize,
      total: count ?? (data?.length ?? 0),
      total_pages: Math.max(1, Math.ceil((count ?? data?.length ?? 0) / pageSize)),
    },
  };
}

function fieldExists(select, field) {
  return select.split(",").map((item) => item.trim()).includes(field);
}

function mapDatabaseErrorToPortalError(error, entityName, action) {
  const message = String(error?.message ?? "").toLowerCase();
  const details = String(error?.details ?? "").toLowerCase();
  const combined = `${message} ${details}`;

  if (entityName === "accounts") {
    if (combined.includes("uidx_financial_accounts__user_id_name")) {
      return new PortalServiceError(409, "financial_account_already_exists", "Ja existe uma conta com esse nome.");
    }
    if (combined.includes("ck_financial_accounts__account_type")) {
      return new PortalServiceError(400, "invalid_account_type", "Tipo de conta invalido.");
    }
    if (combined.includes("fk_financial_accounts__financial_institutions")) {
      return new PortalServiceError(400, "invalid_financial_institution", "Instituicao obrigatoria ou invalida.");
    }
  }

  if (error?.code === "42501") {
    return new PortalServiceError(403, "forbidden", `Voce nao possui permissao para ${action} este registro.`);
  }

  return null;
}

async function createCatalogItem(client, authUserId, entityName, payload) {
  const config = getEntityConfig(entityName);
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const normalized = config.normalize(payload);
  config.validate(normalized);

  if (config.ownership === "user" || config.ownership === "shared_or_user") {
    normalized.user_id = appUser.id;
  }

  const writeClient = config.ownership === "global" ? adminSupabaseClient : client;
  const { data, error } = await writeClient
    .from(config.table)
    .insert(normalized)
    .select(config.select)
    .single();

  if (error || !data) {
    const mappedError = mapDatabaseErrorToPortalError(error, entityName, "criar");
    if (mappedError) {
      throw mappedError;
    }
    throw new PortalServiceError(502, "supabase_insert_error", "Falha ao criar o registro solicitado.");
  }

  return data;
}

async function updateCatalogItem(client, authUserId, entityName, itemId, payload) {
  const config = getEntityConfig(entityName);
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const normalized = config.normalize(payload);
  config.validate(normalized);

  let existingQuery = client.from(config.table).select(config.select).eq("id", itemId);
  if (config.ownership === "user") {
    existingQuery = existingQuery.eq("user_id", appUser.id);
  } else if (config.ownership === "shared_or_user") {
    existingQuery = existingQuery.eq("user_id", appUser.id);
  }

  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) {
    throw new PortalServiceError(502, "supabase_query_error", "Falha ao localizar o registro para atualizacao.");
  }
  if (!existing && config.ownership !== "global") {
    throw new PortalServiceError(404, "record_not_found", "Registro nao encontrado.");
  }

  if (config.ownership === "shared_or_user" && existing?.user_id == null) {
    throw new PortalServiceError(409, "shared_record_read_only", "Categorias padrao sao compartilhadas e nao podem ser alteradas. Crie uma categoria propria para edita-la.");
  }

  const writeClient = config.ownership === "global" ? adminSupabaseClient : client;
  const { data, error } = await writeClient
    .from(config.table)
    .update(normalized)
    .eq("id", itemId)
    .select(config.select)
    .single();

  if (error || !data) {
    const mappedError = mapDatabaseErrorToPortalError(error, entityName, "alterar");
    if (mappedError) {
      throw mappedError;
    }
    throw new PortalServiceError(502, "supabase_update_error", "Falha ao atualizar o registro solicitado.");
  }

  return data;
}

async function archiveCatalogItem(client, authUserId, entityName, itemId) {
  const config = getEntityConfig(entityName);
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const patch = fieldExists(config.select, "archived_at")
    ? { archived_at: new Date().toISOString() }
    : { is_active: false };

  if (fieldExists(config.select, "is_active")) {
    patch.is_active = false;
  }

  const writeClient = config.ownership === "global" ? adminSupabaseClient : client;
  let updateQuery = writeClient
    .from(config.table)
    .update(patch)
    .eq("id", itemId);

  if (config.ownership === "user" || config.ownership === "shared_or_user") {
    updateQuery = updateQuery.eq("user_id", appUser.id);
  }

  const { data, error } = await updateQuery.select(config.select).single();

  if (error || !data) {
    const mappedError = mapDatabaseErrorToPortalError(error, entityName, "arquivar");
    if (mappedError) {
      throw mappedError;
    }
    throw new PortalServiceError(502, "supabase_update_error", "Falha ao arquivar o registro solicitado.");
  }

  return data;
}

async function getProfile(client, authUserId) {
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const settings = await ensureUserSettings(client, appUser.id);
  return {
    user: appUser,
    settings,
    version: "1.0.0",
  };
}

async function updateProfile(client, authUserId, payload) {
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const displayName = String(payload?.display_name ?? payload?.displayName ?? "").trim();

  if (!displayName) {
    throw new PortalServiceError(400, "validation_error", "Informe o nome exibido do perfil.");
  }

  const { data, error } = await client
    .from("users")
    .update({ display_name: displayName })
    .eq("id", appUser.id)
    .select("id,email,display_name,profile_code,status_code,auth_subject")
    .single();

  if (error || !data) {
    throw new PortalServiceError(502, "supabase_update_error", "Falha ao atualizar o perfil.");
  }

  return data;
}

async function updateSettings(client, authUserId, payload) {
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const current = await ensureUserSettings(client, appUser.id);
  const patch = {
    default_currency_code: String(payload?.default_currency_code ?? payload?.defaultCurrencyCode ?? current.default_currency_code).trim().toUpperCase(),
    time_zone: String(payload?.time_zone ?? payload?.timeZone ?? current.time_zone).trim() || current.time_zone,
    dashboard_preferences: typeof payload?.dashboard_preferences === "object" && payload.dashboard_preferences !== null
      ? payload.dashboard_preferences
      : typeof payload?.dashboardPreferences === "object" && payload.dashboardPreferences !== null
        ? payload.dashboardPreferences
        : current.dashboard_preferences,
    import_preferences: typeof payload?.import_preferences === "object" && payload.import_preferences !== null
      ? payload.import_preferences
      : typeof payload?.importPreferences === "object" && payload.importPreferences !== null
        ? payload.importPreferences
        : current.import_preferences,
  };

  const { data, error } = await adminSupabaseClient
    .from("user_settings")
    .update(patch)
    .eq("id", current.id)
    .select("id,user_id,default_currency_code,time_zone,dashboard_preferences,import_preferences,created_at,updated_at")
    .single();

  if (error || !data) {
    throw new PortalServiceError(502, "supabase_update_error", "Falha ao atualizar configuracoes do usuario.");
  }

  return data;
}

module.exports = {
  PortalServiceError,
  getOverview,
  listCatalog,
  createCatalogItem,
  updateCatalogItem,
  archiveCatalogItem,
  getProfile,
  updateProfile,
  updateSettings,
};
