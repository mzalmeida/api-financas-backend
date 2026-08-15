const crypto = require("crypto");
const { adminSupabaseClient } = require("../config/supabaseClients");
const { parseOfxBuffer, normalizeText, inferMovementType } = require("./ofxParser");
const { applyClassificationRuleSet } = require("./transactionClassificationService");

const MAX_PREVIEW_ROWS = 50;
const HISTORY_LIMIT = 20;
const PREVIEW_STAGE = "pending_confirmation";
const SUPPORTED_ACCOUNT_TYPES = new Set(["checking", "savings", "investment", "payment", "cash", "other", "wallet", "manual", "credit_card"]);
const SUPPORTED_IMPORT_STATUSES = new Set(["pending", "pending_confirmation", "processing", "completed", "completed_with_errors", "completed_with_duplicates", "failed", "cancelled"]);

class ImportFlowError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function maskHash(hash) {
  if (!hash || hash.length < 12) return hash ?? null;
  return `${hash.slice(0, 8)}...${hash.slice(-4)}`;
}

function chunk(values, size = 100) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function buildDuplicateGroupKey(transaction) {
  if (transaction.fitId) {
    const fitIdDescriptor = [
      `fitid:${normalizeText(transaction.fitId)}`,
      transaction.occurredOn,
      transaction.amount?.toFixed?.(2) ?? transaction.amount,
      normalizeText(transaction.description).slice(0, 40),
    ].filter(Boolean).join("|");
    return fitIdDescriptor.slice(0, 120);
  }

  const descriptor = [
    transaction.occurredOn,
    transaction.amount?.toFixed?.(2) ?? transaction.amount,
    normalizeText(transaction.description).slice(0, 40),
  ].filter(Boolean).join("|");

  return descriptor.slice(0, 120) || null;
}

function buildTransactionDedupHash(accountId, transaction) {
  return sha256(JSON.stringify({
    accountId,
    occurredOn: transaction.occurredOn,
    postedOn: transaction.postedOn,
    amount: Number(transaction.amount?.toFixed?.(2) ?? transaction.amount ?? 0),
    description: normalizeText(transaction.description),
    fitId: normalizeText(transaction.fitId),
    movementType: inferMovementType(transaction.trnType, transaction.amount, transaction.description),
  }));
}

function sanitizeRowForPreview(row) {
  return {
    row_number: row.rowNumber,
    occurred_on: row.occurredOn,
    posted_on: row.postedOn,
    description: row.description,
    amount: row.amount,
    movement_type: row.movementType,
    fit_id: row.fitId ?? null,
    status: row.previewStatus,
    warning: row.previewWarning ?? null,
    duplicate_reason: row.duplicateReason ?? null,
  };
}

function summarizeRows(rows) {
  return rows.reduce((summary, row) => {
    summary.total += 1;
    if (row.amount > 0) summary.income_count += 1;
    if (row.amount < 0) summary.expense_count += 1;

    if (row.previewStatus === "accepted") {
      summary.valid_count += 1;
    } else if (row.previewStatus === "duplicate") {
      summary.duplicate_count += 1;
    } else {
      summary.invalid_count += 1;
    }

    summary.total_income += row.amount > 0 ? row.amount : 0;
    summary.total_expense += row.amount < 0 ? Math.abs(row.amount) : 0;
    return summary;
  }, {
    total: 0,
    income_count: 0,
    expense_count: 0,
    valid_count: 0,
    invalid_count: 0,
    duplicate_count: 0,
    total_income: 0,
    total_expense: 0,
  });
}

function resolvePreviewImportOutcome(rowSummary) {
  const hasAcceptedRows = rowSummary.valid_count > 0;
  const hasOnlyDuplicates = rowSummary.valid_count === 0
    && rowSummary.duplicate_count > 0
    && rowSummary.invalid_count === 0;

  if (hasAcceptedRows) {
    return {
      importStatus: PREVIEW_STAGE,
      errorSummary: null,
      outcomeWarning: null,
    };
  }

  if (hasOnlyDuplicates) {
    return {
      importStatus: PREVIEW_STAGE,
      errorSummary: "Todas as linhas do arquivo ja existem no historico desta conta.",
      outcomeWarning: "Nenhuma movimentacao nova foi encontrada: todas as linhas do arquivo ja estavam importadas.",
    };
  }

  return {
    importStatus: "failed",
    errorSummary: "Nenhuma linha valida foi encontrada no preview.",
    outcomeWarning: null,
  };
}

async function resolveCurrentAppUser(client, authUserId) {
  const { data, error } = await client
    .from("users")
    .select("id,email,display_name,profile_code,status_code")
    .eq("auth_provider", "supabase")
    .eq("auth_subject", authUserId)
    .single();

  if (error || !data) {
    throw new ImportFlowError(403, "forbidden", "Usuario autenticado sem vinculo ao dominio financeiro.");
  }

  return data;
}

async function listImportOptions(client, authUserId) {
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const [institutionsResult, accountsResult] = await Promise.all([
    client
      .from("financial_institutions")
      .select("id,name,normalized_name,external_code,institution_type")
      .eq("is_active", true)
      .order("name"),
    client
      .from("financial_accounts")
      .select("id,name,account_type,currency_code,external_identifier,masked_account_number,masked_branch_number,financial_institution_id,is_active,opening_balance,statement_closing_day,statement_due_day,credit_limit_amount,statement_label")
      .eq("user_id", appUser.id)
      .eq("is_active", true)
      .is("archived_at", null)
      .order("name"),
  ]);

  if (institutionsResult.error || accountsResult.error) {
    throw new ImportFlowError(502, "supabase_query_error", "Falha ao consultar instituicoes e contas.");
  }

  return {
    user: {
      id: appUser.id,
      email: appUser.email,
      display_name: appUser.display_name,
    },
    institutions: institutionsResult.data,
    accounts: accountsResult.data,
  };
}

async function createFinancialAccount(client, authUserId, payload) {
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const name = String(payload?.name ?? "").trim();
  const financialInstitutionId = String(payload?.financialInstitutionId ?? "").trim();
  const accountType = String(payload?.accountType ?? "payment").trim();
  const externalIdentifier = String(payload?.externalIdentifier ?? "").trim() || null;
  const maskedAccountNumber = String(payload?.maskedAccountNumber ?? "").trim() || null;
  const maskedBranchNumber = String(payload?.maskedBranchNumber ?? "").trim() || null;
  const statementClosingDay = payload?.statementClosingDay ? Number.parseInt(payload.statementClosingDay, 10) : null;
  const statementDueDay = payload?.statementDueDay ? Number.parseInt(payload.statementDueDay, 10) : null;
  const creditLimitAmount = payload?.creditLimitAmount != null && payload.creditLimitAmount !== ""
    ? Number(payload.creditLimitAmount)
    : null;
  const statementLabel = String(payload?.statementLabel ?? "").trim() || null;

  if (!name) {
    throw new ImportFlowError(400, "financial_account_required", "Informe um nome para a conta financeira.");
  }

  if (!financialInstitutionId) {
    throw new ImportFlowError(400, "institution_not_detected", "Selecione a instituicao financeira da conta.");
  }

  if (!SUPPORTED_ACCOUNT_TYPES.has(accountType)) {
    throw new ImportFlowError(400, "invalid_account_type", "Tipo de conta financeira invalido.");
  }

  if (accountType === "credit_card" && (!statementClosingDay || !statementDueDay)) {
    throw new ImportFlowError(400, "credit_card_statement_required", "Informe fechamento e vencimento para contas de cartao de credito.");
  }

  const { data: existingByName, error: existingByNameError } = await client
    .from("financial_accounts")
    .select("id,name,external_identifier")
    .eq("user_id", appUser.id)
    .eq("name", name)
    .maybeSingle();

  if (existingByNameError) {
    throw new ImportFlowError(502, "supabase_query_error", "Falha ao verificar duplicidade de conta.");
  }

  if (existingByName) {
    throw new ImportFlowError(409, "financial_account_already_exists", "Ja existe uma conta com esse nome.");
  }

  if (externalIdentifier) {
    const { data: existingByExternal, error: existingByExternalError } = await client
      .from("financial_accounts")
      .select("id,name,external_identifier")
      .eq("user_id", appUser.id)
      .eq("external_identifier", externalIdentifier)
      .maybeSingle();

    if (existingByExternalError) {
      throw new ImportFlowError(502, "supabase_query_error", "Falha ao verificar identificador externo da conta.");
    }

    if (existingByExternal) {
      throw new ImportFlowError(409, "financial_account_already_exists", "Ja existe uma conta com esse identificador externo.");
    }
  }

  const { data, error } = await client
    .from("financial_accounts")
    .insert({
      user_id: appUser.id,
      financial_institution_id: financialInstitutionId,
      name,
      account_type: accountType,
      external_identifier: externalIdentifier,
      masked_account_number: maskedAccountNumber,
      masked_branch_number: maskedBranchNumber,
      opening_balance: 0,
      currency_code: "BRL",
      statement_closing_day: statementClosingDay,
      statement_due_day: statementDueDay,
      credit_limit_amount: Number.isFinite(creditLimitAmount) ? creditLimitAmount : null,
      statement_label: statementLabel,
      is_active: true,
    })
    .select("id,name,account_type,currency_code,external_identifier,masked_account_number,masked_branch_number,financial_institution_id,is_active,opening_balance,statement_closing_day,statement_due_day,credit_limit_amount,statement_label")
    .single();

  if (error || !data) {
    throw new ImportFlowError(502, "supabase_insert_error", "Falha ao criar a conta financeira.");
  }

  return data;
}

async function resolvePreviewContext(client, authUserId, payload) {
  const options = await listImportOptions(client, authUserId);
  const appUser = options.user;
  const institutions = options.institutions;
  const accountId = String(payload?.financialAccountId ?? "").trim();
  const account = options.accounts.find((item) => item.id === accountId);

  if (!account) {
    throw new ImportFlowError(400, "financial_account_required", "Selecione uma conta financeira valida antes do preview.");
  }

  const requestedInstitutionId = String(payload?.financialInstitutionId ?? "").trim() || null;
  const institution = institutions.find((item) => item.id === requestedInstitutionId)
    || institutions.find((item) => item.id === account.financial_institution_id)
    || null;

  return {
    appUser,
    institutions,
    account,
    requestedInstitutionId,
    requestedInstitution: institution,
  };
}

function validateUploadedFile(file) {
  if (!file) {
    throw new ImportFlowError(400, "invalid_file", "Nenhum arquivo OFX foi enviado.");
  }

  if (!file.originalname?.toLowerCase().endsWith(".ofx")) {
    throw new ImportFlowError(400, "unsupported_format", "Apenas arquivos com extensao .ofx sao aceitos nesta etapa.");
  }

  if (!file.buffer || file.size <= 0) {
    throw new ImportFlowError(400, "invalid_file", "O arquivo enviado esta vazio.");
  }
}

async function findExistingFileImports(client, appUserId, accountId, fileHash) {
  const { data, error } = await client
    .from("import_files")
    .select("id,file_hash,original_file_name,status_code,received_at,imports!inner(id,user_id,financial_account_id,status_code,started_at,finished_at)")
    .eq("file_hash", fileHash)
    .eq("imports.user_id", appUserId)
    .eq("imports.financial_account_id", accountId)
    .order("received_at", { ascending: false })
    .limit(10);

  if (error) {
    throw new ImportFlowError(502, "supabase_query_error", "Falha ao verificar arquivos ja importados.");
  }

  return data.map((row) => ({
    import_id: row.imports.id,
    import_status: row.imports.status_code,
    original_file_name: row.original_file_name,
    received_at: row.received_at,
    finished_at: row.imports.finished_at,
  }));
}

async function fetchExistingTransactionsByKeys(client, accountId, dedupHashes, duplicateKeys) {
  const existingTransactions = [];

  for (const group of chunk(dedupHashes.filter(Boolean))) {
    if (group.length === 0) continue;
    const { data, error } = await client
      .from("transactions")
      .select("id,dedup_hash,duplicate_group_key,occurred_on,amount,original_description,import_row_id")
      .eq("financial_account_id", accountId)
      .in("dedup_hash", group);

    if (error) {
      throw new ImportFlowError(502, "supabase_query_error", "Falha ao verificar duplicidade por hash de transacao.");
    }

    existingTransactions.push(...data);
  }

  for (const group of chunk(duplicateKeys.filter(Boolean))) {
    if (group.length === 0) continue;
    const { data, error } = await client
      .from("transactions")
      .select("id,dedup_hash,duplicate_group_key,occurred_on,amount,original_description,import_row_id")
      .eq("financial_account_id", accountId)
      .in("duplicate_group_key", group);

    if (error) {
      throw new ImportFlowError(502, "supabase_query_error", "Falha ao verificar duplicidade por identificador externo.");
    }

    existingTransactions.push(...data);
  }

  const byHash = new Map();
  const byKey = new Map();
  existingTransactions.forEach((item) => {
    if (item.dedup_hash) byHash.set(item.dedup_hash, item);
    if (item.duplicate_group_key) byKey.set(item.duplicate_group_key, item);
  });

  return { byHash, byKey };
}

function enrichTransactionsForPreview(parsed, accountId) {
  const seenRowHashes = new Set();
  const seenFitIds = new Set();

  return parsed.transactions.map((transaction) => {
    const duplicateGroupKey = buildDuplicateGroupKey(transaction);
    const dedupHash = buildTransactionDedupHash(accountId, transaction);
    const normalizedDescription = normalizeText(transaction.description);
    let previewStatus = "accepted";
    let duplicateReason = null;

    if (!transaction.occurredOn || typeof transaction.amount !== "number" || transaction.amount === 0 || !transaction.description) {
      previewStatus = "rejected";
      duplicateReason = "Linha sem data, descricao ou valor valido.";
    }

    if (previewStatus === "accepted" && seenRowHashes.has(transaction.rowHash)) {
      previewStatus = "duplicate";
      duplicateReason = "Linha repetida dentro do mesmo arquivo.";
    }

    if (previewStatus === "accepted" && transaction.fitId && seenFitIds.has(normalizeText(transaction.fitId))) {
      previewStatus = "duplicate";
      duplicateReason = "FITID repetido dentro do mesmo arquivo.";
    }

    seenRowHashes.add(transaction.rowHash);
    if (transaction.fitId) seenFitIds.add(normalizeText(transaction.fitId));

    return {
      ...transaction,
      normalizedDescription,
      duplicateGroupKey,
      dedupHash,
      previewStatus,
      duplicateReason,
    };
  });
}

function attachExistingDuplicateSignals(rows, existingTransactions) {
  return rows.map((row) => {
    if (row.previewStatus !== "accepted") {
      return row;
    }

    const match = existingTransactions.byHash.get(row.dedupHash)
      || (row.duplicateGroupKey ? existingTransactions.byKey.get(row.duplicateGroupKey) : null);

    if (!match) {
      return row;
    }

    return {
      ...row,
      previewStatus: "duplicate",
      duplicateReason: "Lancamento ja registrado anteriormente para esta conta.",
      existingTransactionId: match.id,
    };
  });
}

async function insertPreviewImport(client, context, file, parsed, rows, fileHash, warnings) {
  const rowSummary = summarizeRows(rows);
  const processingSummary = {
    stage: PREVIEW_STAGE,
    warnings,
    institution_detection: parsed.detection,
    period: {
      start_date: parsed.header.startDate,
      end_date: parsed.header.endDate,
    },
    currency_code: parsed.header.curDef || "BRL",
    ledger_balance: parsed.header.ledgerBalance,
    ledger_balance_date: parsed.header.ledgerAsOf,
    detected_account_identifier: parsed.header.accountId || null,
  };

  const previewOutcome = resolvePreviewImportOutcome(rowSummary);
  const importStatus = previewOutcome.importStatus;
  const fileStatus = rowSummary.valid_count > 0 || rowSummary.duplicate_count > 0 ? "processed" : "failed";

  const { data: importRow, error: importError } = await client
    .from("imports")
    .insert({
      user_id: context.appUser.id,
      financial_institution_id: context.requestedInstitutionId || parsed.detection.institutionId || context.account.financial_institution_id,
      financial_account_id: context.account.id,
      import_format: "ofx",
      import_source: "file_upload",
      status_code: importStatus,
      batch_hash: fileHash,
      total_rows: rowSummary.total,
      processed_rows: rowSummary.total,
      accepted_rows: rowSummary.valid_count,
      rejected_rows: rowSummary.invalid_count,
      duplicate_rows: rowSummary.duplicate_count,
      processing_summary: processingSummary,
      error_summary: previewOutcome.errorSummary,
    })
    .select("id,status_code,total_rows,processed_rows,accepted_rows,rejected_rows,duplicate_rows,processing_summary,started_at,finished_at,financial_account_id,financial_institution_id")
    .single();

  if (importError || !importRow) {
    throw new ImportFlowError(502, "supabase_insert_error", "Falha ao registrar o preview da importacao.");
  }

  const { data: importFile, error: importFileError } = await client
    .from("import_files")
    .insert({
      import_id: importRow.id,
      original_file_name: file.originalname,
      mime_type: file.mimetype || "application/octet-stream",
      file_extension: "ofx",
      file_size_bytes: file.size,
      file_hash: fileHash,
      file_encoding: parsed.encoding,
      status_code: fileStatus,
      processed_at: fileStatus === "processed" ? new Date().toISOString() : null,
    })
    .select("id,original_file_name,mime_type,file_extension,file_size_bytes,file_hash,file_encoding,status_code,received_at,processed_at")
    .single();

  if (importFileError || !importFile) {
    throw new ImportFlowError(502, "supabase_insert_error", "Falha ao registrar os metadados do arquivo importado.");
  }

  const importRowsPayload = rows.map((row) => ({
    import_file_id: importFile.id,
    source_order: row.rowNumber,
    raw_payload: row.rawData,
    source_hash: row.rowHash,
    processing_status: row.previewStatus,
    processing_error_code: row.previewStatus === "rejected"
      ? "invalid_row"
      : row.previewStatus === "duplicate"
        ? "duplicate_row"
        : null,
    processing_error_message: row.previewStatus === "accepted" ? null : row.duplicateReason,
    extracted_occurrence_date: row.occurredOn,
    extracted_description: row.description,
    extracted_amount: row.amount,
    extracted_external_identifier: row.fitId ?? null,
    normalized_payload: {
      movement_type: row.movementType,
      duplicate_group_key: row.duplicateGroupKey,
      dedup_hash: row.dedupHash,
      normalized_description: row.normalizedDescription,
      posted_on: row.postedOn,
      institution_slug: parsed.detection.slug,
    },
  }));

  const { data: insertedRows, error: importRowsError } = await client
    .from("import_rows")
    .insert(importRowsPayload)
    .select("id,source_order,processing_status,processing_error_code,processing_error_message,extracted_occurrence_date,extracted_description,extracted_amount,extracted_external_identifier,normalized_payload,linked_transaction_id");

  if (importRowsError) {
    throw new ImportFlowError(502, "supabase_insert_error", "Falha ao registrar as linhas do preview OFX.");
  }

  return {
    importRow,
    importFile,
    insertedRows,
    rowSummary,
  };
}

function buildPreviewResponse(context, parsed, previewRows, insertedImport, existingFileImports, previewWarnings = []) {
  const { rowSummary } = insertedImport;
  return {
    import_id: insertedImport.importRow.id,
    status: insertedImport.importRow.status_code,
    file: {
      name: insertedImport.importFile.original_file_name,
      size_bytes: insertedImport.importFile.file_size_bytes,
      mime_type: insertedImport.importFile.mime_type,
      extension: insertedImport.importFile.file_extension,
      hash_masked: maskHash(insertedImport.importFile.file_hash),
      encoding: insertedImport.importFile.file_encoding,
    },
    institution: {
      id: context.requestedInstitutionId || parsed.detection.institutionId || context.account.financial_institution_id,
      detected_slug: parsed.detection.slug,
      detected_label: parsed.detection.label,
      confidence: parsed.detection.confidence,
    },
    financial_account: {
      id: context.account.id,
      name: context.account.name,
      account_type: context.account.account_type,
      external_identifier_masked: context.account.external_identifier ? maskHash(sha256(context.account.external_identifier)) : null,
      masked_account_number: context.account.masked_account_number,
      masked_branch_number: context.account.masked_branch_number,
    },
    period: {
      start_date: parsed.header.startDate,
      end_date: parsed.header.endDate,
    },
    currency_code: parsed.header.curDef || "BRL",
    ledger_balance: parsed.header.ledgerBalance,
    ledger_balance_date: parsed.header.ledgerAsOf,
    totals: {
      total_rows: rowSummary.total,
      valid_rows: rowSummary.valid_count,
      invalid_rows: rowSummary.invalid_count,
      duplicate_rows: rowSummary.duplicate_count,
      income_count: rowSummary.income_count,
      expense_count: rowSummary.expense_count,
      total_income: Number(rowSummary.total_income.toFixed(2)),
      total_expense: Number(rowSummary.total_expense.toFixed(2)),
    },
    warnings: [...parsed.warnings, ...previewWarnings],
    file_duplicates: existingFileImports,
    preview_rows: previewRows.slice(0, MAX_PREVIEW_ROWS).map(sanitizeRowForPreview),
    preview_rows_truncated: previewRows.length > MAX_PREVIEW_ROWS,
  };
}

async function previewOfxImport(client, authUserId, payload, file) {
  validateUploadedFile(file);
  const context = await resolvePreviewContext(client, authUserId, payload);
  const parsed = parseOfxBuffer(file.buffer, context.institutions);

  if (parsed.header.statementKind === "credit_card" && context.account.account_type !== "credit_card") {
    throw new ImportFlowError(400, "credit_card_account_required", "Extratos de cartao de credito devem ser vinculados a uma conta do tipo cartao de credito.");
  }

  if (parsed.header.statementKind === "bank_account" && context.account.account_type === "credit_card") {
    throw new ImportFlowError(400, "bank_account_required", "Extratos bancarios nao podem ser vinculados a uma conta de cartao de credito.");
  }

  if (!parsed.transactions.length) {
    throw new ImportFlowError(400, "no_transactions_found", "Nenhum lancamento OFX foi encontrado no arquivo enviado.");
  }

  const selectedInstitutionId = context.requestedInstitutionId || parsed.detection.institutionId || context.account.financial_institution_id;
  if (!selectedInstitutionId) {
    throw new ImportFlowError(400, "institution_not_detected", "Nao foi possivel identificar a instituicao do extrato e nenhuma foi selecionada.");
  }

  const fileHash = sha256(file.buffer);
  const existingFileImports = await findExistingFileImports(client, context.appUser.id, context.account.id, fileHash);
  const initialPreviewRows = enrichTransactionsForPreview(parsed, context.account.id);
  const existingTransactions = await fetchExistingTransactionsByKeys(
    client,
    context.account.id,
    initialPreviewRows.map((row) => row.dedupHash),
    initialPreviewRows.map((row) => row.duplicateGroupKey),
  );
  const previewRows = attachExistingDuplicateSignals(initialPreviewRows, existingTransactions);
  const rowSummary = summarizeRows(previewRows);
  const previewOutcome = resolvePreviewImportOutcome(rowSummary);
  const previewWarnings = [];

  if (existingFileImports.length > 0) {
    previewWarnings.push("Arquivo identico ja apareceu anteriormente no historico desta conta.");
  }
  if (previewOutcome.outcomeWarning) {
    previewWarnings.push(previewOutcome.outcomeWarning);
  }

  const insertedImport = await insertPreviewImport(client, {
    ...context,
    requestedInstitutionId: selectedInstitutionId,
  }, file, parsed, previewRows, fileHash, previewWarnings);

  return buildPreviewResponse({
    ...context,
    requestedInstitutionId: selectedInstitutionId,
  }, parsed, previewRows, insertedImport, existingFileImports, previewWarnings);
}

async function getImportList(client, authUserId, query = {}) {
  await resolveCurrentAppUser(client, authUserId);
  const limit = Number.parseInt(query.limit, 10);
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : HISTORY_LIMIT;

  const { data: imports, error } = await client
    .from("imports")
    .select("id,status_code,total_rows,processed_rows,accepted_rows,rejected_rows,duplicate_rows,processing_summary,error_summary,started_at,finished_at,financial_account_id,financial_institution_id")
    .order("started_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new ImportFlowError(502, "supabase_query_error", "Falha ao consultar o historico de importacoes.");
  }

  const importIds = imports.map((item) => item.id);
  const accountIds = [...new Set(imports.map((item) => item.financial_account_id).filter(Boolean))];
  const institutionIds = [...new Set(imports.map((item) => item.financial_institution_id).filter(Boolean))];

  const [filesResult, accountsResult, institutionsResult] = await Promise.all([
    importIds.length
      ? client.from("import_files").select("id,import_id,original_file_name,file_size_bytes,file_hash,status_code,received_at,processed_at").in("import_id", importIds)
      : Promise.resolve({ data: [], error: null }),
    accountIds.length
      ? client.from("financial_accounts").select("id,name,account_type,masked_account_number").in("id", accountIds)
      : Promise.resolve({ data: [], error: null }),
    institutionIds.length
      ? client.from("financial_institutions").select("id,name,normalized_name").in("id", institutionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (filesResult.error || accountsResult.error || institutionsResult.error) {
    throw new ImportFlowError(502, "supabase_query_error", "Falha ao montar o historico de importacoes.");
  }

  const fileByImportId = new Map();
  filesResult.data.forEach((item) => {
    if (!fileByImportId.has(item.import_id)) {
      fileByImportId.set(item.import_id, item);
    }
  });

  const accountById = new Map(accountsResult.data.map((item) => [item.id, item]));
  const institutionById = new Map(institutionsResult.data.map((item) => [item.id, item]));

  return imports.map((item) => {
    const file = fileByImportId.get(item.id) ?? null;
    const account = item.financial_account_id ? accountById.get(item.financial_account_id) ?? null : null;
    const institution = item.financial_institution_id ? institutionById.get(item.financial_institution_id) ?? null : null;

    return {
      id: item.id,
      status: item.status_code,
      started_at: item.started_at,
      finished_at: item.finished_at,
      totals: {
        total_rows: item.total_rows,
        processed_rows: item.processed_rows,
        accepted_rows: item.accepted_rows,
        rejected_rows: item.rejected_rows,
        duplicate_rows: item.duplicate_rows,
      },
      file: file
        ? {
          id: file.id,
          name: file.original_file_name,
          size_bytes: file.file_size_bytes,
          hash_masked: maskHash(file.file_hash),
          status: file.status_code,
          received_at: file.received_at,
          processed_at: file.processed_at,
        }
        : null,
      financial_account: account,
      institution,
      phase: item.processing_summary?.stage ?? null,
      error_summary: item.error_summary,
    };
  });
}

async function getImportDetails(client, authUserId, importId) {
  await resolveCurrentAppUser(client, authUserId);
  const { data: importRow, error } = await client
    .from("imports")
    .select("id,status_code,total_rows,processed_rows,accepted_rows,rejected_rows,duplicate_rows,processing_summary,error_summary,started_at,finished_at,financial_account_id,financial_institution_id")
    .eq("id", importId)
    .single();

  if (error || !importRow) {
    throw new ImportFlowError(404, "import_not_found", "Importacao nao encontrada.");
  }

  const [filesResult, accountResult, institutionResult] = await Promise.all([
    client.from("import_files").select("id,original_file_name,mime_type,file_extension,file_size_bytes,file_hash,file_encoding,status_code,received_at,processed_at").eq("import_id", importId).order("received_at", { ascending: true }),
    importRow.financial_account_id
      ? client.from("financial_accounts").select("id,name,account_type,masked_account_number,masked_branch_number").eq("id", importRow.financial_account_id).single()
      : Promise.resolve({ data: null, error: null }),
    importRow.financial_institution_id
      ? client.from("financial_institutions").select("id,name,normalized_name").eq("id", importRow.financial_institution_id).single()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (filesResult.error || accountResult.error || institutionResult.error) {
    throw new ImportFlowError(502, "supabase_query_error", "Falha ao consultar detalhes da importacao.");
  }

  const fileIds = filesResult.data.map((item) => item.id);
  let rows = [];
  if (fileIds.length > 0) {
    const { data, error: rowsError } = await client
      .from("import_rows")
      .select("id,import_file_id,source_order,processing_status,processing_error_code,processing_error_message,extracted_occurrence_date,extracted_description,extracted_amount,extracted_external_identifier,normalized_payload,linked_transaction_id")
      .in("import_file_id", fileIds)
      .order("source_order", { ascending: true });

    if (rowsError) {
      throw new ImportFlowError(502, "supabase_query_error", "Falha ao consultar linhas da importacao.");
    }
    rows = data;
  }

  return {
    id: importRow.id,
    status: importRow.status_code,
    started_at: importRow.started_at,
    finished_at: importRow.finished_at,
    totals: {
      total_rows: importRow.total_rows,
      processed_rows: importRow.processed_rows,
      accepted_rows: importRow.accepted_rows,
      rejected_rows: importRow.rejected_rows,
      duplicate_rows: importRow.duplicate_rows,
    },
    processing_summary: importRow.processing_summary,
    error_summary: importRow.error_summary,
    financial_account: accountResult.data,
    institution: institutionResult.data,
    files: filesResult.data.map((item) => ({
      id: item.id,
      name: item.original_file_name,
      size_bytes: item.file_size_bytes,
      hash_masked: maskHash(item.file_hash),
      encoding: item.file_encoding,
      status: item.status_code,
      received_at: item.received_at,
      processed_at: item.processed_at,
    })),
    rows: rows.slice(0, 200).map((row) => ({
      id: row.id,
      row_number: row.source_order,
      status: row.processing_status,
      occurred_on: row.extracted_occurrence_date,
      description: row.extracted_description,
      amount: row.extracted_amount,
      fit_id: row.extracted_external_identifier,
      error_code: row.processing_error_code,
      error_message: row.processing_error_message,
      linked_transaction_id: row.linked_transaction_id,
    })),
    rows_truncated: rows.length > 200,
  };
}

async function buildTransactionPayload(client, appUserId, importRow, importRecord) {
  const normalizedPayload = importRow.normalized_payload || {};
  const amount = Number(importRow.extracted_amount);
  const description = importRow.extracted_description;
  const movementType = normalizedPayload.movement_type || inferMovementType(null, amount, description);
  const classification = await applyClassificationRuleSet(client, appUserId, {
    description,
    memo: importRow.raw_payload?.memo,
    name: importRow.raw_payload?.name,
    fitId: importRow.extracted_external_identifier,
    movementType,
  });

  return {
    user_id: appUserId,
    financial_account_id: importRecord.financial_account_id,
    card_id: null,
    counterparty_id: classification.counterparty_id,
    category_id: classification.category_id,
    import_row_id: importRow.id,
    linked_transaction_id: null,
    transaction_source: "import",
    movement_type: classification.movement_type,
    posting_status: "posted",
    reconciliation_status: "pending",
    occurred_on: importRow.extracted_occurrence_date,
    competence_on: null,
    posted_on: normalizedPayload.posted_on || importRow.extracted_occurrence_date,
    original_description: description,
    normalized_description: normalizedPayload.normalized_description || normalizeText(description).slice(0, 500),
    amount,
    currency_code: importRecord.processing_summary?.currency_code || "BRL",
    dedup_hash: normalizedPayload.dedup_hash,
    duplicate_group_key: normalizedPayload.duplicate_group_key,
    notes: classification.matched_rule_name ? `Classificado automaticamente por regra: ${classification.matched_rule_name}` : null,
  };
}

async function confirmImport(client, authUserId, payload) {
  const appUser = await resolveCurrentAppUser(client, authUserId);
  const importId = String(payload?.importId ?? "").trim();

  if (!importId) {
    throw new ImportFlowError(400, "import_not_found", "Identificador da importacao nao informado.");
  }

  const { data: importRecord, error: importError } = await client
    .from("imports")
    .select("id,status_code,total_rows,processed_rows,accepted_rows,rejected_rows,duplicate_rows,processing_summary,error_summary,started_at,finished_at,financial_account_id,financial_institution_id")
    .eq("id", importId)
    .single();

  if (importError || !importRecord) {
    throw new ImportFlowError(404, "import_not_found", "Importacao nao encontrada.");
  }

  if (!SUPPORTED_IMPORT_STATUSES.has(importRecord.status_code)) {
    throw new ImportFlowError(409, "confirmation_already_completed", "Importacao em estado incompativel com a confirmacao.");
  }

  if (
    importRecord.status_code === "completed"
    || importRecord.status_code === "completed_with_errors"
    || importRecord.status_code === "completed_with_duplicates"
  ) {
    return {
      import_id: importRecord.id,
      status: importRecord.status_code,
      already_confirmed: true,
      totals: {
        total_rows: importRecord.total_rows,
        processed_rows: importRecord.processed_rows,
        accepted_rows: importRecord.accepted_rows,
        rejected_rows: importRecord.rejected_rows,
        duplicate_rows: importRecord.duplicate_rows,
      },
    };
  }

  if (!importRecord.financial_account_id) {
    throw new ImportFlowError(400, "financial_account_required", "A importacao nao possui conta financeira vinculada.");
  }

  const { data: importFiles, error: filesError } = await client
    .from("import_files")
    .select("id,status_code")
    .eq("import_id", importId)
    .order("received_at", { ascending: true });

  if (filesError) {
    throw new ImportFlowError(502, "supabase_query_error", "Falha ao consultar arquivos da importacao.");
  }

  const fileIds = importFiles.map((item) => item.id);
  const { data: importRows, error: rowsError } = await client
    .from("import_rows")
    .select("id,source_order,processing_status,processing_error_code,processing_error_message,extracted_occurrence_date,extracted_description,extracted_amount,extracted_external_identifier,normalized_payload,raw_payload,linked_transaction_id")
    .in("import_file_id", fileIds)
    .order("source_order", { ascending: true });

  if (rowsError) {
    throw new ImportFlowError(502, "supabase_query_error", "Falha ao consultar linhas da importacao.");
  }

  const candidateRows = importRows.filter((row) => row.processing_status === "accepted" && !row.linked_transaction_id);
  if (candidateRows.length === 0) {
    if (importRecord.accepted_rows === 0 && importRecord.duplicate_rows > 0) {
      const { error: duplicateOnlyUpdateError } = await adminSupabaseClient
        .from("imports")
        .update({
          status_code: "completed_with_errors",
          finished_at: new Date().toISOString(),
          processing_summary: {
            ...(importRecord.processing_summary || {}),
            stage: "confirmed",
            confirmation: {
              created_transactions: 0,
              duplicate_at_confirmation: importRecord.duplicate_rows,
            },
          },
          error_summary: "Nenhuma movimentacao nova foi encontrada nesta confirmacao.",
        })
        .eq("id", importId);

      if (duplicateOnlyUpdateError) {
        throw new ImportFlowError(502, "supabase_update_error", "Falha ao finalizar o status da importacao duplicada.");
      }

      return {
        import_id: importRecord.id,
        status: "completed_with_errors",
        already_confirmed: true,
        totals: {
          total_rows: importRecord.total_rows,
          processed_rows: importRecord.processed_rows,
          accepted_rows: importRecord.accepted_rows,
          rejected_rows: importRecord.rejected_rows,
          duplicate_rows: importRecord.duplicate_rows,
        },
      };
    }

    throw new ImportFlowError(409, "no_transactions_found", "Nao existem linhas validas pendentes para confirmar nesta importacao.");
  }

  const existingTransactions = await fetchExistingTransactionsByKeys(
    client,
    importRecord.financial_account_id,
    candidateRows.map((row) => row.normalized_payload?.dedup_hash).filter(Boolean),
    candidateRows.map((row) => row.normalized_payload?.duplicate_group_key).filter(Boolean),
  );

  const toInsert = [];
  const duplicateRows = [];

  for (const row of candidateRows) {
    const payloadRow = await buildTransactionPayload(client, appUser.id, row, importRecord);
    const duplicateMatch = payloadRow.dedup_hash && existingTransactions.byHash.get(payloadRow.dedup_hash)
      ? existingTransactions.byHash.get(payloadRow.dedup_hash)
      : payloadRow.duplicate_group_key && existingTransactions.byKey.get(payloadRow.duplicate_group_key)
        ? existingTransactions.byKey.get(payloadRow.duplicate_group_key)
        : null;

    if (duplicateMatch) {
      duplicateRows.push({ row, duplicateMatch });
      continue;
    }

    toInsert.push(payloadRow);
  }

  let insertedTransactions = [];
  if (toInsert.length > 0) {
    const { data, error } = await client
      .from("transactions")
      .insert(toInsert)
      .select("id,import_row_id,dedup_hash,duplicate_group_key");

    if (error) {
      throw new ImportFlowError(502, "supabase_insert_error", "Falha ao criar as transacoes da importacao confirmada.");
    }

    insertedTransactions = data;
  }

  for (const transaction of insertedTransactions) {
    if (!transaction.import_row_id) {
      throw new ImportFlowError(502, "supabase_insert_error", "A transacao inserida nao retornou o vinculo esperado com a linha de importacao.");
    }

    const { error } = await adminSupabaseClient
      .from("import_rows")
      .update({
        processing_status: "accepted",
        linked_transaction_id: transaction.id,
        processing_error_code: null,
        processing_error_message: null,
      })
      .eq("id", transaction.import_row_id);

    if (error) {
      throw new ImportFlowError(502, "supabase_update_error", "Falha ao vincular a linha importada a transacao criada.");
    }
  }

  for (const item of duplicateRows) {
    const { error } = await adminSupabaseClient
      .from("import_rows")
      .update({
        processing_status: "duplicate",
        processing_error_code: "duplicate_row",
        processing_error_message: "Lancamento ignorado na confirmacao por duplicidade detectada no historico.",
      })
      .eq("id", item.row.id);

    if (error) {
      throw new ImportFlowError(502, "supabase_update_error", "Falha ao atualizar a linha marcada como duplicada na confirmacao.");
    }
  }

  const finalAcceptedRows = Math.max(
    0,
    importRows.filter((row) => row.processing_status === "accepted").length - duplicateRows.length,
  );
  const finalRejectedRows = importRows.filter((row) => row.processing_status === "rejected").length;
  const previewDuplicateRows = importRows.filter((row) => row.processing_status === "duplicate").length;
  const finalDuplicateRows = previewDuplicateRows + duplicateRows.length;
  const createdCount = insertedTransactions.length;
  const completionStatus = finalRejectedRows > 0 || finalDuplicateRows > 0
      ? "completed_with_errors"
      : "completed";

  const { error: updateImportError } = await adminSupabaseClient
    .from("imports")
    .update({
      status_code: completionStatus,
      processed_rows: importRows.length,
      accepted_rows: finalAcceptedRows,
      rejected_rows: finalRejectedRows,
      duplicate_rows: finalDuplicateRows,
      finished_at: new Date().toISOString(),
      processing_summary: {
        ...(importRecord.processing_summary || {}),
        stage: "confirmed",
        confirmation: {
          created_transactions: createdCount,
          duplicate_at_confirmation: duplicateRows.length,
        },
      },
      error_summary: finalAcceptedRows === 0 && finalDuplicateRows > 0 && finalRejectedRows === 0
        ? "Nenhuma movimentacao nova foi encontrada nesta confirmacao."
        : finalAcceptedRows > 0 && finalDuplicateRows > 0 && finalRejectedRows === 0
          ? "Importacao concluida com linhas novas e duplicidades ignoradas."
          : finalRejectedRows > 0 || finalDuplicateRows > 0
            ? "Importacao concluida com rejeicoes ou duplicidades."
            : null,
    })
    .eq("id", importId);

  if (updateImportError) {
    throw new ImportFlowError(502, "supabase_update_error", "Falha ao finalizar o status da importacao.");
  }

  return {
    import_id: importId,
    status: completionStatus,
    already_confirmed: false,
    summary: {
      created_transactions: createdCount,
      duplicate_rows: finalDuplicateRows,
      rejected_rows: finalRejectedRows,
      accepted_rows: finalAcceptedRows,
      processed_rows: importRows.length,
      total_rows: importRows.length,
    },
  };
}

async function cancelImport(client, authUserId, importId) {
  await resolveCurrentAppUser(client, authUserId);
  const { data: importRow, error } = await client
    .from("imports")
    .select("id,status_code")
    .eq("id", importId)
    .single();

  if (error || !importRow) {
    throw new ImportFlowError(404, "import_not_found", "Importacao nao encontrada.");
  }

  if (importRow.status_code === "completed" || importRow.status_code === "completed_with_errors") {
    throw new ImportFlowError(409, "forbidden", "Importacoes confirmadas nao podem ser canceladas nesta etapa.");
  }

  const { error: updateError } = await client
    .from("imports")
    .update({
      status_code: "cancelled",
      finished_at: new Date().toISOString(),
      processing_summary: {
        stage: "cancelled",
      },
    })
    .eq("id", importId);

  if (updateError) {
    throw new ImportFlowError(502, "supabase_update_error", "Falha ao cancelar a importacao.");
  }

  return {
    import_id: importId,
    status: "cancelled",
  };
}

module.exports = {
  ImportFlowError,
  buildDuplicateGroupKey,
  listImportOptions,
  createFinancialAccount,
  previewOfxImport,
  getImportList,
  getImportDetails,
  confirmImport,
  cancelImport,
};
