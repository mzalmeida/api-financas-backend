const express = require("express");

const requireSupabaseAuth = require("../middlewares/requireSupabaseAuth");
const { gmailIntegrationMode } = require("../config/runtime");
const {
  GmailIntegrationError,
  getGmailStatus,
  getGmailConnectUrl,
  completeGmailOauth,
  disconnectGmail,
  syncGmailImports,
} = require("../services/gmailService");
const {
  GmailImapError,
  getImapStatus,
  syncImapImports,
  syncScheduledImapImports,
  validateScheduledSecret,
} = require("../services/gmailImapService");

const router = express.Router();

function sendKnownError(res, error) {
  if (error instanceof GmailIntegrationError || error instanceof GmailImapError) {
    return res.status(error.status).json({
      erro: error.message,
      codigo: error.code,
      detalhes: error.details ?? undefined,
    });
  }

  console.error("Erro na integracao Gmail:", error.message);
  return res.status(500).json({
    erro: "Falha interna na integracao Gmail.",
    codigo: "internal_error",
  });
}

async function run(res, handler) {
  try {
    await handler();
  } catch (error) {
    return sendKnownError(res, error);
  }
}

router.get("/status", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const data = gmailIntegrationMode === "imap"
    ? await getImapStatus(req.user.authUserId)
    : await getGmailStatus(req.user.authUserId);
  res.json({ status: "ok", ...data });
}));

router.get("/connect", requireSupabaseAuth, async (req, res) => run(res, async () => {
  if (gmailIntegrationMode === "imap") {
    throw new GmailImapError(409, "gmail_oauth_disabled", "A integracao atual usa IMAP e nao requer autorizacao OAuth.");
  }
  const data = await getGmailConnectUrl(req.user.authUserId);
  res.json({ status: "ok", ...data });
}));

router.get("/callback", async (req, res) => run(res, async () => {
  if (gmailIntegrationMode === "imap") {
    throw new GmailImapError(409, "gmail_oauth_disabled", "O callback OAuth esta desabilitado no modo IMAP.");
  }
  const redirectUrl = await completeGmailOauth(req.query);
  res.redirect(302, redirectUrl);
}));

router.post("/disconnect", requireSupabaseAuth, async (req, res) => run(res, async () => {
  if (gmailIntegrationMode === "imap") {
    throw new GmailImapError(409, "gmail_imap_managed_by_environment", "A credencial IMAP deve ser removida diretamente do ambiente seguro.");
  }
  const data = await disconnectGmail(req.user.authUserId);
  res.json({ status: "ok", ...data });
}));

router.post("/sync", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const data = gmailIntegrationMode === "imap"
    ? await syncImapImports(req.user.authUserId)
    : await syncGmailImports(req.accessToken, req.user.authUserId, req.body);
  res.json({ status: "ok", ...data });
}));

router.post("/scheduled-sync", async (req, res) => run(res, async () => {
  if (gmailIntegrationMode !== "imap") {
    throw new GmailImapError(409, "gmail_imap_disabled", "A sincronizacao IMAP nao esta habilitada.");
  }
  if (!validateScheduledSecret(req.get("x-gmail-sync-secret"))) {
    throw new GmailImapError(401, "invalid_sync_secret", "Credencial de sincronizacao invalida.");
  }
  const data = await syncScheduledImapImports();
  res.json({ status: "ok", ...data });
}));

module.exports = router;
