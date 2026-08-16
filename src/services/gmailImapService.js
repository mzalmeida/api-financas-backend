const crypto = require("crypto");

const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

const { adminSupabaseClient } = require("../config/supabaseClients");
const { normalizeText, parseOfxBuffer } = require("./ofxParser");
const { previewOfxImport } = require("./importsService");

const DEFAULT_ALLOWED_SENDERS = [
  "todomundo@nubank.com.br",
  "no-reply@inter.co",
];
const DEFAULT_LOOKBACK_DAYS = 1;
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const SYNC_OVERLAP_MINUTES = 30;

class GmailImapError extends Error {
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

function maskEmail(email) {
  if (!email || !email.includes("@")) return null;
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function parsePositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function parseAllowedSenders(value = process.env.GMAIL_IMAP_ALLOWED_SENDERS) {
  const configured = String(value || "")
    .split(",")
    .map((item) => normalizeText(item))
    .filter(Boolean);
  return new Set(configured.length ? configured : DEFAULT_ALLOWED_SENDERS);
}

function parseSubjectTerms(value = process.env.GMAIL_IMAP_SUBJECT_TERMS) {
  const configured = String(value || "")
    .split(",")
    .map((item) => normalizeText(item))
    .filter(Boolean);
  return configured.length ? configured : ["extrato"];
}

function getImapConfig() {
  return {
    host: process.env.GMAIL_IMAP_HOST || "imap.gmail.com",
    port: parsePositiveInteger(process.env.GMAIL_IMAP_PORT, 993, 65535),
    secure: String(process.env.GMAIL_IMAP_SECURE || "true").toLowerCase() !== "false",
    user: String(process.env.GMAIL_IMAP_USER || "").trim().toLowerCase(),
    password: String(process.env.GMAIL_IMAP_APP_PASSWORD || "").replace(/\s+/g, ""),
    mailbox: String(process.env.GMAIL_IMAP_MAILBOX || "INBOX").trim() || "INBOX",
    allowedSenders: parseAllowedSenders(),
    subjectTerms: parseSubjectTerms(),
    lookbackDays: parsePositiveInteger(process.env.GMAIL_IMAP_LOOKBACK_DAYS, DEFAULT_LOOKBACK_DAYS, 365),
    messageLimit: parsePositiveInteger(process.env.GMAIL_IMAP_MESSAGE_LIMIT, DEFAULT_MESSAGE_LIMIT, 250),
  };
}

function imapConfigured(config = getImapConfig()) {
  return Boolean(config.host && config.port && config.user && config.password);
}

function ensureImapConfigured(config) {
  if (!imapConfigured(config)) {
    throw new GmailImapError(409, "gmail_imap_not_configured", "A leitura IMAP ainda nao esta configurada no ambiente.");
  }
}

function institutionFromSender(sender, allowedSenders = parseAllowedSenders()) {
  const normalized = normalizeText(sender);
  if (!allowedSenders.has(normalized)) return null;
  if (normalized.endsWith("@nubank.com.br")) return "nubank";
  if (normalized.endsWith("@inter.co")) return "inter";
  return null;
}

function matchesTrustedMessage(
  sender,
  subject,
  allowedSenders = parseAllowedSenders(),
  subjectTerms = parseSubjectTerms(),
) {
  const institutionSlug = institutionFromSender(sender, allowedSenders);
  const normalizedSubject = normalizeText(subject);
  const subjectAllowed = subjectTerms.some((term) => normalizedSubject.includes(term));
  return institutionSlug && subjectAllowed ? institutionSlug : null;
}

function isOfxAttachment(attachment) {
  const fileName = String(attachment?.filename || "").trim();
  return fileName.toLowerCase().endsWith(".ofx")
    && Buffer.isBuffer(attachment?.content)
    && attachment.content.length > 0
    && attachment.content.length <= MAX_ATTACHMENT_BYTES;
}

function accountMappingKey(institutionSlug, statementKind) {
  return `${institutionSlug}_${statementKind === "credit_card" ? "credit_card" : "bank_account"}`;
}

function normalizedIdentifier(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

function resolveFinancialAccount({ accounts, integration, institutionSlug, parsed }) {
  const statementKind = parsed.header.statementKind;
  const requiredCreditCard = statementKind === "credit_card";
  const mapping = integration?.account_mapping || {};
  const mappedId = mapping[accountMappingKey(institutionSlug, statementKind)] || mapping[institutionSlug];
  const institutionId = parsed.detection.institutionId;

  const compatible = accounts.filter((account) => {
    const accountIsCreditCard = account.account_type === "credit_card";
    const sameType = requiredCreditCard ? accountIsCreditCard : !accountIsCreditCard;
    const sameInstitution = institutionId
      ? account.financial_institution_id === institutionId
      : normalizeText(account.financial_institution?.name).includes(institutionSlug === "inter" ? "inter" : "nubank");
    return sameType && sameInstitution;
  });

  const mapped = compatible.find((account) => account.id === mappedId);
  if (mapped) return mapped;

  const detectedAccountId = normalizedIdentifier(parsed.header.accountId);
  if (detectedAccountId) {
    const exact = compatible.find((account) => {
      const identifiers = [account.external_identifier, account.masked_account_number]
        .map(normalizedIdentifier)
        .filter(Boolean);
      return identifiers.some((identifier) => detectedAccountId.endsWith(identifier) || identifier.endsWith(detectedAccountId));
    });
    if (exact) return exact;
  }

  return compatible.length === 1 ? compatible[0] : null;
}

function safeMessageKey(message, parsedMessage) {
  const messageId = String(parsedMessage.messageId || message.envelope?.messageId || "").trim();
  return messageId ? messageId.slice(0, 255) : `imap-uid-${message.uid}`;
}

async function resolveAppUser(authUserId) {
  const { data, error } = await adminSupabaseClient
    .from("users")
    .select("id,email,display_name,auth_subject")
    .eq("auth_provider", "supabase")
    .eq("auth_subject", authUserId)
    .single();

  if (error || !data) {
    throw new GmailImapError(403, "forbidden", "Usuario autenticado sem vinculo ao dominio financeiro.");
  }
  return data;
}

async function resolveScheduledOwner() {
  const ownerEmail = String(process.env.OWNER_EMAIL || "").trim().toLowerCase();
  if (!ownerEmail) {
    throw new GmailImapError(409, "owner_email_missing", "O proprietario da sincronizacao ainda nao foi configurado.");
  }

  const { data, error } = await adminSupabaseClient
    .from("users")
    .select("id,email,display_name,auth_subject")
    .eq("email", ownerEmail)
    .eq("auth_provider", "supabase")
    .single();

  if (error || !data?.auth_subject) {
    throw new GmailImapError(409, "owner_not_found", "O proprietario configurado nao foi localizado no dominio financeiro.");
  }
  return data;
}

async function ensureIntegration(appUser, config) {
  const { data: existing, error: selectError } = await adminSupabaseClient
    .from("gmail_integrations")
    .select("*")
    .eq("user_id", appUser.id)
    .maybeSingle();

  if (selectError) {
    throw new GmailImapError(502, "supabase_query_error", "Falha ao consultar a integracao de e-mail.");
  }

  if (existing) return existing;

  const { data, error } = await adminSupabaseClient
    .from("gmail_integrations")
    .insert({
      user_id: appUser.id,
      gmail_email: config.user,
      connected_at: new Date().toISOString(),
      last_sync_status: "connected",
      last_sync_summary: { mode: "imap", message: "Integracao IMAP preparada." },
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new GmailImapError(502, "supabase_insert_error", "Falha ao preparar a integracao de e-mail.");
  }
  return data;
}

async function loadImportContext(appUser) {
  const [institutionsResult, accountsResult] = await Promise.all([
    adminSupabaseClient
      .from("financial_institutions")
      .select("id,name,normalized_name")
      .eq("is_active", true),
    adminSupabaseClient
      .from("financial_accounts")
      .select("id,name,account_type,external_identifier,masked_account_number,financial_institution_id,financial_institution:financial_institutions(name,normalized_name)")
      .eq("user_id", appUser.id)
      .eq("is_active", true)
      .is("archived_at", null),
  ]);

  if (institutionsResult.error || accountsResult.error) {
    throw new GmailImapError(502, "supabase_query_error", "Falha ao carregar contas para a importacao automatica.");
  }

  return { institutions: institutionsResult.data, accounts: accountsResult.data };
}

async function findMessageRecord(userId, messageId, attachmentId) {
  const { data, error } = await adminSupabaseClient
    .from("gmail_messages")
    .select("*")
    .eq("user_id", userId)
    .eq("gmail_message_id", messageId)
    .eq("gmail_attachment_id", attachmentId)
    .maybeSingle();
  if (error) throw new GmailImapError(502, "supabase_query_error", "Falha ao verificar anexo ja processado.");
  return data;
}

async function saveMessageRecord(existing, payload) {
  const query = existing
    ? adminSupabaseClient.from("gmail_messages").update(payload).eq("id", existing.id)
    : adminSupabaseClient.from("gmail_messages").insert(payload);
  const { data, error } = await query.select("*").single();
  if (error || !data) throw new GmailImapError(502, "supabase_write_error", "Falha ao registrar o anexo localizado.");
  return data;
}

async function findImportedFileHash(userId, fileHash) {
  const { data: importedFiles, error: importedFilesError } = await adminSupabaseClient
    .from("import_files")
    .select("id,import_id,imports!inner(id,user_id,status_code)")
    .eq("file_hash", fileHash)
    .eq("imports.user_id", userId)
    .limit(1);
  if (importedFilesError) {
    throw new GmailImapError(502, "supabase_query_error", "Falha ao verificar o hash no historico de importacoes.");
  }
  if (importedFiles[0]) {
    return {
      id: `import-file:${importedFiles[0].id}`,
      import_id: importedFiles[0].import_id,
      status_code: importedFiles[0].imports.status_code,
    };
  }

  const { data, error } = await adminSupabaseClient
    .from("gmail_messages")
    .select("id,import_id,status_code")
    .eq("user_id", userId)
    .eq("file_hash", fileHash)
    .not("import_id", "is", null)
    .limit(1);
  if (error) throw new GmailImapError(502, "supabase_query_error", "Falha ao verificar duplicidade do anexo.");
  return data[0] || null;
}

async function processAttachment({ appUser, integration, context, message, parsedMessage, attachment, institutionSlug }) {
  const buffer = attachment.content;
  const fileHash = sha256(buffer);
  const messageId = safeMessageKey(message, parsedMessage);
  const attachmentId = sha256(`${messageId}:${attachment.filename}:${fileHash}`);
  const existing = await findMessageRecord(appUser.id, messageId, attachmentId);

  if (existing?.import_id || ["duplicate", "ignored", "imported", "pending_confirmation"].includes(existing?.status_code)) {
    return { status: "already_processed", import_id: existing.import_id, file_name: existing.file_name };
  }

  const baseRecord = {
    user_id: appUser.id,
    gmail_integration_id: integration.id,
    gmail_message_id: messageId,
    gmail_thread_id: null,
    gmail_attachment_id: attachmentId,
    sender_email: normalizeText(parsedMessage.from?.value?.[0]?.address),
    subject: String(parsedMessage.subject || "").slice(0, 255),
    received_at: parsedMessage.date?.toISOString?.() || message.internalDate?.toISOString?.() || null,
    file_name: String(attachment.filename || "extrato.ofx").slice(0, 255),
    file_hash: fileHash,
    institution_slug: institutionSlug,
    metadata: { source: "gmail_imap", imap_uid: message.uid },
  };

  const previousHash = await findImportedFileHash(appUser.id, fileHash);
  if (previousHash && previousHash.id !== existing?.id) {
    await saveMessageRecord(existing, {
      ...baseRecord,
      status_code: "duplicate",
      processed_at: new Date().toISOString(),
      error_summary: "Anexo identico ja registrado anteriormente.",
    });
    return { status: "duplicate", import_id: previousHash.import_id, file_name: baseRecord.file_name };
  }

  let parsed;
  try {
    parsed = parseOfxBuffer(buffer, context.institutions);
  } catch {
    await saveMessageRecord(existing, {
      ...baseRecord,
      status_code: "failed",
      processed_at: new Date().toISOString(),
      error_summary: "O anexo nao pode ser interpretado como OFX.",
    });
    return { status: "failed", import_id: null, file_name: baseRecord.file_name };
  }

  if (parsed.detection.slug !== institutionSlug || !parsed.transactions.length) {
    await saveMessageRecord(existing, {
      ...baseRecord,
      status_code: "failed",
      processed_at: new Date().toISOString(),
      error_summary: "O anexo nao corresponde a um OFX valido da instituicao remetente.",
    });
    return { status: "failed", import_id: null, file_name: baseRecord.file_name };
  }

  const account = resolveFinancialAccount({
    accounts: context.accounts,
    integration,
    institutionSlug,
    parsed,
  });

  if (!account) {
    await saveMessageRecord(existing, {
      ...baseRecord,
      status_code: "failed",
      processed_at: new Date().toISOString(),
      error_summary: `Nenhuma conta financeira inequivoca foi localizada para ${accountMappingKey(institutionSlug, parsed.header.statementKind)}.`,
    });
    return { status: "failed", import_id: null, file_name: baseRecord.file_name };
  }

  try {
    const preview = await previewOfxImport(adminSupabaseClient, appUser.auth_subject, {
      financialAccountId: account.id,
      financialInstitutionId: account.financial_institution_id,
      importSource: "integration",
    }, {
      originalname: baseRecord.file_name,
      mimetype: attachment.contentType || "application/x-ofx",
      size: buffer.length,
      buffer,
    });

    const statusCode = preview.status === "pending_confirmation" ? "pending_confirmation" : "failed";
    await saveMessageRecord(existing, {
      ...baseRecord,
      status_code: statusCode,
      import_id: preview.import_id || null,
      processed_at: new Date().toISOString(),
      error_summary: statusCode === "failed" ? "O preview nao gerou uma importacao pendente." : null,
      metadata: {
        ...baseRecord.metadata,
        account_mapping_key: accountMappingKey(institutionSlug, parsed.header.statementKind),
        financial_account_id: account.id,
      },
    });
    return { status: statusCode, import_id: preview.import_id || null, file_name: baseRecord.file_name };
  } catch (error) {
    await saveMessageRecord(existing, {
      ...baseRecord,
      status_code: "failed",
      processed_at: new Date().toISOString(),
      error_summary: error?.message || "Falha ao registrar o preview da importacao.",
    });
    return { status: "failed", import_id: null, file_name: baseRecord.file_name };
  }
}

async function syncImapForAppUser(appUser) {
  const config = getImapConfig();
  ensureImapConfigured(config);
  const integration = await ensureIntegration(appUser, config);
  const context = await loadImportContext(appUser);
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });
  const summary = {
    messages_scanned: 0,
    attachments_found: 0,
    imports_created: 0,
    duplicates: 0,
    ignored: 0,
    failed: 0,
  };
  const results = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock(config.mailbox);
    try {
      const configuredSince = Date.now() - config.lookbackDays * 24 * 60 * 60 * 1000;
      const lastSyncSince = integration.last_sync_at
        ? new Date(integration.last_sync_at).getTime() - SYNC_OVERLAP_MINUTES * 60 * 1000
        : Number.NaN;
      const since = new Date(Number.isFinite(lastSyncSince) ? Math.max(configuredSince, lastSyncSince) : configuredSince);
      const senderQueries = [...config.allowedSenders].map((sender) => ({ from: sender }));
      const senderFilter = senderQueries.length > 1
        ? { or: senderQueries }
        : senderQueries[0] || { all: true };
      const matchedUids = await client.search({
        since,
        smaller: MAX_ATTACHMENT_BYTES + 2 * 1024 * 1024,
        ...senderFilter,
      }, { uid: true });
      const uids = matchedUids.slice(-config.messageLimit);
      if (uids.length) {
        for await (const message of client.fetch(uids, { uid: true, envelope: true, internalDate: true, source: true }, { uid: true })) {
          summary.messages_scanned += 1;
          const parsedMessage = await simpleParser(message.source);
          const sender = normalizeText(parsedMessage.from?.value?.[0]?.address);
          const institutionSlug = matchesTrustedMessage(
            sender,
            parsedMessage.subject,
            config.allowedSenders,
            config.subjectTerms,
          );
          if (!institutionSlug) {
            summary.ignored += 1;
            continue;
          }

          const attachments = (parsedMessage.attachments || []).filter(isOfxAttachment);
          summary.attachments_found += attachments.length;
          for (const attachment of attachments) {
            const result = await processAttachment({
              appUser,
              integration,
              context,
              message,
              parsedMessage,
              attachment,
              institutionSlug,
            });
            results.push(result);
            if (result.status === "pending_confirmation") summary.imports_created += 1;
            else if (result.status === "duplicate") summary.duplicates += 1;
            else if (result.status === "failed") summary.failed += 1;
            else summary.ignored += 1;
          }
        }
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    if (error instanceof GmailImapError) throw error;
    throw new GmailImapError(502, "gmail_imap_connection_failed", "Nao foi possivel consultar a caixa de e-mail por IMAP.");
  } finally {
    if (client.usable) await client.logout().catch(() => {});
  }

  const finalStatus = summary.failed > 0 ? (summary.imports_created > 0 ? "partial" : "failed") : "synced";
  const syncedAt = new Date().toISOString();
  const { error: updateError } = await adminSupabaseClient
    .from("gmail_integrations")
    .update({
      gmail_email: config.user,
      connected_at: integration.connected_at || syncedAt,
      disconnected_at: null,
      last_sync_at: syncedAt,
      last_sync_status: finalStatus,
      last_sync_summary: { ...summary, mode: "imap" },
    })
    .eq("id", integration.id);
  if (updateError) throw new GmailImapError(502, "supabase_update_error", "Falha ao atualizar o resultado da sincronizacao.");

  return { last_sync_at: syncedAt, last_sync_status: finalStatus, summary, messages: results };
}

async function syncImapImports(authUserId) {
  return syncImapForAppUser(await resolveAppUser(authUserId));
}

async function syncScheduledImapImports() {
  return syncImapForAppUser(await resolveScheduledOwner());
}

async function getImapStatus(authUserId) {
  const config = getImapConfig();
  const appUser = await resolveAppUser(authUserId);
  const { data: integration, error } = await adminSupabaseClient
    .from("gmail_integrations")
    .select("gmail_email,connected_at,last_sync_at,last_sync_status,last_sync_summary")
    .eq("user_id", appUser.id)
    .maybeSingle();
  if (error) throw new GmailImapError(502, "supabase_query_error", "Falha ao consultar o status da integracao.");

  return {
    integration: {
      mode: "imap",
      configured: imapConfigured(config),
      connected: Boolean(imapConfigured(config) && integration?.connected_at),
      gmail_email_masked: maskEmail(config.user || integration?.gmail_email),
      connected_at: integration?.connected_at || null,
      last_sync_at: integration?.last_sync_at || null,
      last_sync_status: integration?.last_sync_status || "never",
      last_sync_summary: integration?.last_sync_summary || {},
    },
  };
}

function validateScheduledSecret(receivedSecret) {
  const expected = String(process.env.GMAIL_SYNC_SECRET || "");
  const received = String(receivedSecret || "");
  if (expected.length < 32 || received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

module.exports = {
  GmailImapError,
  accountMappingKey,
  getImapConfig,
  getImapStatus,
  imapConfigured,
  institutionFromSender,
  isOfxAttachment,
  matchesTrustedMessage,
  parseAllowedSenders,
  parseSubjectTerms,
  resolveFinancialAccount,
  syncImapImports,
  syncScheduledImapImports,
  validateScheduledSecret,
};
