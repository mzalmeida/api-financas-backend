const crypto = require("crypto");

const { adminSupabaseClient, createSupabaseUserClient } = require("../config/supabaseClients");
const { parseOfxBuffer, normalizeText } = require("./ofxParser");
const { previewOfxImport } = require("./importsService");
const { decryptRefreshToken, encryptRefreshToken, gmailCryptoConfigured } = require("./gmailCrypto");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://api-financas-frontend.onrender.com";
const EXPECTED_PUBLIC_GOOGLE_REDIRECT_URI = "https://api-financas-backend1.onrender.com/integrations/gmail/callback";
const STATE_TTL_MINUTES = 15;
const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

const FILTERS = {
  nubank: {
    sender: "todomundo@nubank.com.br",
    subject: "Extrato da sua conta do Nubank",
    query: 'from:todomundo@nubank.com.br subject:"Extrato da sua conta do Nubank" has:attachment newer_than:90d',
    label: "Nubank",
  },
  inter: {
    sender: "no-reply@inter.co",
    subject: "Seu extrato esta disponivel",
    query: 'from:no-reply@inter.co subject:"Seu extrato esta disponivel" has:attachment newer_than:90d',
    label: "Banco Inter",
  },
};

class GmailIntegrationError extends Error {
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

function ensureGoogleConfigured() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new GmailIntegrationError(409, "google_oauth_not_configured", "A integracao Gmail ainda nao esta configurada no ambiente.");
  }

  if (
    String(process.env.NODE_ENV || "").toLowerCase() === "production"
    && GOOGLE_REDIRECT_URI !== EXPECTED_PUBLIC_GOOGLE_REDIRECT_URI
  ) {
    throw new GmailIntegrationError(409, "invalid_google_redirect_uri", "A URL publica de callback do Gmail esta divergente da configuracao esperada.");
  }

  if (!gmailCryptoConfigured()) {
    throw new GmailIntegrationError(409, "gmail_token_secret_missing", "A chave de criptografia do Gmail ainda nao foi configurada no ambiente.");
  }
}

async function resolveCurrentAppUser(authUserId) {
  const { data, error } = await adminSupabaseClient
    .from("users")
    .select("id,email,display_name")
    .eq("auth_provider", "supabase")
    .eq("auth_subject", authUserId)
    .single();

  if (error || !data) {
    throw new GmailIntegrationError(403, "forbidden", "Usuario autenticado sem vinculo ao dominio financeiro.");
  }

  return data;
}

async function getIntegrationByUserId(userId) {
  const { data, error } = await adminSupabaseClient
    .from("gmail_integrations")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new GmailIntegrationError(502, "supabase_query_error", "Falha ao consultar a integracao Gmail.");
  }

  return data;
}

async function ensureIntegrationRow(userId) {
  const existing = await getIntegrationByUserId(userId);
  if (existing) return existing;

  const { data, error } = await adminSupabaseClient
    .from("gmail_integrations")
    .insert({ user_id: userId })
    .select("*")
    .single();

  if (error || !data) {
    throw new GmailIntegrationError(502, "supabase_insert_error", "Falha ao preparar a integracao Gmail.");
  }

  return data;
}

function buildOauthState(userId) {
  const plain = crypto.randomBytes(24).toString("base64url");
  return {
    plain,
    hash: sha256(`${userId}:${plain}`),
    expiresAt: new Date(Date.now() + STATE_TTL_MINUTES * 60 * 1000).toISOString(),
  };
}

function buildFrontendRedirect(status) {
  const url = new URL(FRONTEND_URL);
  url.searchParams.set("gmail_oauth", status);
  return url.toString();
}

function buildGoogleAuthUrl(state) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", GOOGLE_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

async function getGmailStatus(authUserId) {
  ensureGoogleConfigured();
  const appUser = await resolveCurrentAppUser(authUserId);
  const integration = await getIntegrationByUserId(appUser.id);
  const { data: accounts, error: accountsError } = await adminSupabaseClient
    .from("financial_accounts")
    .select("id,name,account_type,financial_institution_id,is_active")
    .eq("user_id", appUser.id)
    .eq("is_active", true)
    .is("archived_at", null)
    .order("name");

  const { data: institutions, error: institutionsError } = await adminSupabaseClient
    .from("financial_institutions")
    .select("id,name,normalized_name")
    .eq("is_active", true)
    .order("name");

  const { data: messages, error: messagesError } = await adminSupabaseClient
    .from("gmail_messages")
    .select("id,gmail_message_id,gmail_attachment_id,sender_email,subject,received_at,file_name,file_hash,institution_slug,status_code,import_id,error_summary,ignored_at,processed_at,metadata")
    .eq("user_id", appUser.id)
    .order("received_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(20);

  if (accountsError || institutionsError || messagesError) {
    throw new GmailIntegrationError(502, "supabase_query_error", "Falha ao montar o status da integracao Gmail.");
  }

  const filteredInstitutions = institutions.filter((item) => {
    const normalized = normalizeText(item.normalized_name || item.name);
    return normalized.includes("nubank") || normalized.includes("inter");
  });

  return {
    integration: integration
      ? {
        connected: Boolean(integration.connected_at && integration.encrypted_refresh_token),
        gmail_email_masked: maskEmail(integration.gmail_email),
        connected_at: integration.connected_at,
        disconnected_at: integration.disconnected_at,
        last_sync_at: integration.last_sync_at,
        last_sync_status: integration.last_sync_status,
        last_sync_summary: integration.last_sync_summary,
        account_mapping: integration.account_mapping || {},
        scopes: integration.token_scopes || [],
      }
      : {
        connected: false,
        gmail_email_masked: null,
        connected_at: null,
        disconnected_at: null,
        last_sync_at: null,
        last_sync_status: "never",
        last_sync_summary: {},
        account_mapping: {},
        scopes: [],
      },
    accounts,
    institutions: filteredInstitutions,
    messages: messages.map((message) => ({
      id: message.id,
      sender_email_masked: maskEmail(message.sender_email),
      subject: message.subject,
      received_at: message.received_at,
      file_name: message.file_name,
      file_hash_masked: message.file_hash ? `${message.file_hash.slice(0, 8)}...${message.file_hash.slice(-4)}` : null,
      institution_slug: message.institution_slug,
      status: message.status_code,
      import_id: message.import_id,
      error_summary: message.error_summary,
      ignored_at: message.ignored_at,
      processed_at: message.processed_at,
    })),
  };
}

async function getGmailConnectUrl(authUserId) {
  ensureGoogleConfigured();
  const appUser = await resolveCurrentAppUser(authUserId);
  const integration = await ensureIntegrationRow(appUser.id);
  const state = buildOauthState(appUser.id);

  const { error } = await adminSupabaseClient
    .from("gmail_integrations")
    .update({
      oauth_state_hash: state.hash,
      oauth_state_expires_at: state.expiresAt,
    })
    .eq("id", integration.id);

  if (error) {
    throw new GmailIntegrationError(502, "supabase_update_error", "Falha ao iniciar a conexao OAuth do Gmail.");
  }

  return {
    authorization_url: buildGoogleAuthUrl(`${appUser.id}.${state.plain}`),
    redirect_uri: GOOGLE_REDIRECT_URI,
    scopes: OAUTH_SCOPES,
  };
}

async function exchangeGoogleCode(code) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new GmailIntegrationError(502, "google_token_exchange_failed", "Falha ao concluir a autorizacao do Google.");
  }

  return payload;
}

async function refreshGoogleAccessToken(integration) {
  const refreshToken = decryptRefreshToken({
    algorithm: integration.token_algorithm,
    ciphertext: integration.encrypted_refresh_token,
    iv: integration.refresh_token_iv,
    tag: integration.refresh_token_tag,
  });

  if (!refreshToken) {
    throw new GmailIntegrationError(409, "gmail_not_connected", "Nao existe token valido armazenado para a integracao Gmail.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new GmailIntegrationError(502, "google_refresh_failed", "Falha ao renovar o acesso ao Gmail.");
  }

  return { accessToken: payload.access_token, refreshToken };
}

async function fetchGoogleProfile(accessToken) {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const payload = await response.json();
  if (!response.ok || !payload.email) {
    throw new GmailIntegrationError(502, "google_profile_failed", "Falha ao consultar o perfil autorizado do Google.");
  }

  return payload;
}

async function completeGmailOauth(query) {
  ensureGoogleConfigured();

  if (typeof query?.error === "string" && query.error) {
    return buildFrontendRedirect("error");
  }

  const state = String(query?.state ?? "");
  const code = String(query?.code ?? "");
  const separatorIndex = state.indexOf(".");

  if (!state || !code || separatorIndex <= 0) {
    throw new GmailIntegrationError(400, "invalid_oauth_callback", "O retorno OAuth do Google esta incompleto.");
  }

  const userId = state.slice(0, separatorIndex);
  const rawState = state.slice(separatorIndex + 1);
  const expectedHash = sha256(`${userId}:${rawState}`);

  const { data: integration, error } = await adminSupabaseClient
    .from("gmail_integrations")
    .select("*")
    .eq("user_id", userId)
    .eq("oauth_state_hash", expectedHash)
    .maybeSingle();

  if (error) {
    throw new GmailIntegrationError(502, "supabase_query_error", "Falha ao validar o estado OAuth do Gmail.");
  }

  if (!integration || !integration.oauth_state_expires_at || new Date(integration.oauth_state_expires_at).getTime() < Date.now()) {
    throw new GmailIntegrationError(409, "invalid_oauth_state", "A solicitacao OAuth do Gmail expirou ou nao foi reconhecida.");
  }

  const tokenPayload = await exchangeGoogleCode(code);
  const profile = await fetchGoogleProfile(tokenPayload.access_token);
  const refreshToken = tokenPayload.refresh_token
    ? encryptRefreshToken(tokenPayload.refresh_token)
    : null;

  const { error: updateError } = await adminSupabaseClient
    .from("gmail_integrations")
    .update({
      gmail_email: profile.email,
      encrypted_refresh_token: refreshToken?.ciphertext ?? integration.encrypted_refresh_token,
      refresh_token_iv: refreshToken?.iv ?? integration.refresh_token_iv,
      refresh_token_tag: refreshToken?.tag ?? integration.refresh_token_tag,
      token_algorithm: refreshToken?.algorithm ?? integration.token_algorithm,
      token_scopes: tokenPayload.scope ? tokenPayload.scope.split(/\s+/).filter(Boolean) : integration.token_scopes,
      oauth_state_hash: null,
      oauth_state_expires_at: null,
      connected_at: new Date().toISOString(),
      disconnected_at: null,
      last_sync_status: "connected",
      last_sync_summary: {
        message: "OAuth concluido com sucesso.",
      },
    })
    .eq("id", integration.id);

  if (updateError) {
    throw new GmailIntegrationError(502, "supabase_update_error", "Falha ao persistir a conexao Gmail.");
  }

  return buildFrontendRedirect("connected");
}

async function disconnectGmail(authUserId) {
  const appUser = await resolveCurrentAppUser(authUserId);
  const integration = await getIntegrationByUserId(appUser.id);

  if (!integration) {
    return { connected: false };
  }

  try {
    const refreshToken = decryptRefreshToken({
      algorithm: integration.token_algorithm,
      ciphertext: integration.encrypted_refresh_token,
      iv: integration.refresh_token_iv,
      tag: integration.refresh_token_tag,
    });

    if (refreshToken) {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }),
      });
    }
  } catch {
    // A revogacao remota e melhor esforco.
  }

  const { error } = await adminSupabaseClient
    .from("gmail_integrations")
    .update({
      encrypted_refresh_token: null,
      refresh_token_iv: null,
      refresh_token_tag: null,
      oauth_state_hash: null,
      oauth_state_expires_at: null,
      disconnected_at: new Date().toISOString(),
      last_sync_status: "disconnected",
      last_sync_summary: { message: "Integracao desconectada pelo usuario." },
    })
    .eq("id", integration.id);

  if (error) {
    throw new GmailIntegrationError(502, "supabase_update_error", "Falha ao desconectar a integracao Gmail.");
  }

  return { connected: false };
}

async function fetchGmailJson(accessToken, pathname) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${pathname}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new GmailIntegrationError(502, "gmail_api_error", "Falha ao consultar a Gmail API.");
  }
  return payload;
}

function headerValue(headers, name) {
  const header = headers.find((item) => String(item.name || "").toLowerCase() === name.toLowerCase());
  return header?.value ?? "";
}

function extractSenderEmail(rawFrom) {
  const match = rawFrom.match(/<([^>]+)>/);
  return normalizeText(match?.[1] || rawFrom);
}

function listAttachments(node, attachments = []) {
  if (!node) return attachments;

  if (node.filename && node.body?.attachmentId) {
    attachments.push({
      attachmentId: node.body.attachmentId,
      filename: node.filename,
      mimeType: node.mimeType || "application/octet-stream",
    });
  }

  (node.parts || []).forEach((part) => listAttachments(part, attachments));
  return attachments;
}

function pickInstitutionByEmail(senderEmail, subject) {
  const normalizedSender = normalizeText(senderEmail);
  const normalizedSubject = normalizeText(subject);

  for (const [slug, filter] of Object.entries(FILTERS)) {
    if (normalizedSender === normalizeText(filter.sender) && normalizedSubject === normalizeText(filter.subject)) {
      return slug;
    }
  }

  return null;
}

async function upsertGmailMessageRecord(payload) {
  const { data: existing, error: selectError } = await adminSupabaseClient
    .from("gmail_messages")
    .select("*")
    .eq("user_id", payload.user_id)
    .eq("gmail_message_id", payload.gmail_message_id)
    .eq("gmail_attachment_id", payload.gmail_attachment_id)
    .maybeSingle();

  if (selectError) {
    throw new GmailIntegrationError(502, "supabase_query_error", "Falha ao consultar mensagens Gmail ja registradas.");
  }

  if (!existing) {
    const { data, error } = await adminSupabaseClient
      .from("gmail_messages")
      .insert(payload)
      .select("*")
      .single();

    if (error || !data) {
      throw new GmailIntegrationError(502, "supabase_insert_error", "Falha ao registrar metadados do Gmail.");
    }
    return data;
  }

  const { data, error } = await adminSupabaseClient
    .from("gmail_messages")
    .update(payload)
    .eq("id", existing.id)
    .select("*")
    .single();

  if (error || !data) {
    throw new GmailIntegrationError(502, "supabase_update_error", "Falha ao atualizar metadados do Gmail.");
  }

  return data;
}

async function syncGmailImports(accessToken, authUserId, payload = {}) {
  ensureGoogleConfigured();

  const appUser = await resolveCurrentAppUser(authUserId);
  const integration = await ensureIntegrationRow(appUser.id);

  if (!integration.encrypted_refresh_token) {
    throw new GmailIntegrationError(409, "gmail_not_connected", "Conecte o Gmail antes de iniciar a sincronizacao.");
  }

  const accountMapping = {
    ...(integration.account_mapping || {}),
    ...(payload.accountMappings || {}),
  };

  const { error: mappingError } = await adminSupabaseClient
    .from("gmail_integrations")
    .update({ account_mapping: accountMapping })
    .eq("id", integration.id);

  if (mappingError) {
    throw new GmailIntegrationError(502, "supabase_update_error", "Falha ao persistir o mapeamento de contas do Gmail.");
  }

  const { accessToken: gmailAccessToken } = await refreshGoogleAccessToken(integration);
  const institutionsResult = await adminSupabaseClient
    .from("financial_institutions")
    .select("id,name,normalized_name")
    .eq("is_active", true);

  if (institutionsResult.error) {
    throw new GmailIntegrationError(502, "supabase_query_error", "Falha ao carregar o catalogo de instituicoes.");
  }

  const institutions = institutionsResult.data.filter((item) => {
    const normalized = normalizeText(item.normalized_name || item.name);
    return normalized.includes("nubank") || normalized.includes("inter");
  });

  const userClient = createSupabaseUserClient(accessToken);
  const summary = {
    searched_messages: 0,
    attachments_found: 0,
    imports_created: 0,
    duplicates: 0,
    ignored: 0,
    failed: 0,
  };
  const processedMessages = [];

  for (const [slug, filter] of Object.entries(FILTERS)) {
    const listing = await fetchGmailJson(
      gmailAccessToken,
      `/messages?q=${encodeURIComponent(filter.query)}&maxResults=10`,
    );

    const messages = listing.messages || [];
    summary.searched_messages += messages.length;

    for (const messageRef of messages) {
      const message = await fetchGmailJson(gmailAccessToken, `/messages/${messageRef.id}?format=full`);
      const headers = message.payload?.headers || [];
      const from = extractSenderEmail(headerValue(headers, "From"));
      const subject = headerValue(headers, "Subject");
      const institutionSlug = pickInstitutionByEmail(from, subject);

      if (institutionSlug !== slug) {
        continue;
      }

      const attachments = listAttachments(message.payload).filter((item) => item.filename.toLowerCase().endsWith(".ofx"));
      if (!attachments.length) {
        continue;
      }

      for (const attachment of attachments) {
        summary.attachments_found += 1;

        const baseRecord = {
          user_id: appUser.id,
          gmail_integration_id: integration.id,
          gmail_message_id: message.id,
          gmail_thread_id: message.threadId || null,
          gmail_attachment_id: attachment.attachmentId,
          sender_email: from,
          subject,
          received_at: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
          file_name: attachment.filename,
          institution_slug: institutionSlug,
          metadata: {
            gmail_label_ids: message.labelIds || [],
            source: "gmail_api",
          },
        };

        const existing = await upsertGmailMessageRecord({
          ...baseRecord,
          status_code: "discovered",
          error_summary: null,
        });

        if (existing.import_id || existing.status_code === "ignored") {
          summary.ignored += 1;
          processedMessages.push({
            id: existing.id,
            status: existing.status_code,
            file_name: existing.file_name,
            institution_slug: existing.institution_slug,
            import_id: existing.import_id,
          });
          continue;
        }

        const mappedAccountId = accountMapping[institutionSlug];
        if (!mappedAccountId) {
          await upsertGmailMessageRecord({
            ...baseRecord,
            status_code: "failed",
            error_summary: `Nenhuma conta configurada para ${FILTERS[institutionSlug].label}.`,
          });
          summary.failed += 1;
          continue;
        }

        const attachmentPayload = await fetchGmailJson(
          gmailAccessToken,
          `/messages/${message.id}/attachments/${attachment.attachmentId}`,
        );

        const buffer = Buffer.from(String(attachmentPayload.data || ""), "base64url");
        const parsed = parseOfxBuffer(buffer, institutions);
        const detectedSlug = parsed.detection?.slug || institutionSlug;

        if (detectedSlug !== institutionSlug || !parsed.transactions.length) {
          await upsertGmailMessageRecord({
            ...baseRecord,
            file_hash: sha256(buffer),
            status_code: "failed",
            error_summary: "O anexo nao corresponde a um OFX valido da instituicao esperada.",
          });
          summary.failed += 1;
          continue;
        }

        const preview = await previewOfxImport(userClient, authUserId, {
          financialAccountId: mappedAccountId,
          financialInstitutionId: institutions.find((item) => normalizeText(item.name).includes(institutionSlug === "inter" ? "inter" : "nubank"))?.id,
        }, {
          originalname: attachment.filename,
          mimetype: attachment.mimeType,
          size: buffer.length,
          buffer,
        });

        const statusCode = preview.status === "pending_confirmation"
          ? "pending_confirmation"
          : preview.totals.valid_rows === 0 && preview.totals.duplicate_rows > 0
            ? "duplicate"
            : "failed";

        if (statusCode === "pending_confirmation") {
          summary.imports_created += 1;
        } else if (statusCode === "duplicate") {
          summary.duplicates += 1;
        } else {
          summary.failed += 1;
        }

        const messageRow = await upsertGmailMessageRecord({
          ...baseRecord,
          file_hash: sha256(buffer),
          status_code: statusCode,
          import_id: preview.import_id || null,
          processed_at: new Date().toISOString(),
          error_summary: statusCode === "failed"
            ? "O anexo foi processado, mas nao gerou linhas validas pendentes."
            : null,
        });

        processedMessages.push({
          id: messageRow.id,
          status: messageRow.status_code,
          file_name: messageRow.file_name,
          institution_slug: messageRow.institution_slug,
          import_id: messageRow.import_id,
        });
      }
    }
  }

  const finalStatus = summary.failed > 0 ? (summary.imports_created > 0 ? "partial" : "failed") : "synced";
  const syncedAt = new Date().toISOString();

  const { error: integrationUpdateError } = await adminSupabaseClient
    .from("gmail_integrations")
    .update({
      account_mapping: accountMapping,
      last_sync_at: syncedAt,
      last_sync_status: finalStatus,
      last_sync_summary: summary,
    })
    .eq("id", integration.id);

  if (integrationUpdateError) {
    throw new GmailIntegrationError(502, "supabase_update_error", "Falha ao atualizar o status da sincronizacao Gmail.");
  }

  return {
    last_sync_at: syncedAt,
    last_sync_status: finalStatus,
    summary,
    messages: processedMessages,
  };
}

module.exports = {
  GmailIntegrationError,
  completeGmailOauth,
  disconnectGmail,
  getGmailConnectUrl,
  getGmailStatus,
  syncGmailImports,
};
