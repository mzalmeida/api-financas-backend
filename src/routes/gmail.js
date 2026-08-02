const express = require("express");

const requireSupabaseAuth = require("../middlewares/requireSupabaseAuth");
const {
  GmailIntegrationError,
  getGmailStatus,
  getGmailConnectUrl,
  completeGmailOauth,
  disconnectGmail,
  syncGmailImports,
} = require("../services/gmailService");

const router = express.Router();

function sendKnownError(res, error) {
  if (error instanceof GmailIntegrationError) {
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
  const data = await getGmailStatus(req.user.authUserId);
  res.json({ status: "ok", ...data });
}));

router.get("/connect", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const data = await getGmailConnectUrl(req.user.authUserId);
  res.json({ status: "ok", ...data });
}));

router.get("/callback", async (req, res) => run(res, async () => {
  const redirectUrl = await completeGmailOauth(req.query);
  res.redirect(302, redirectUrl);
}));

router.post("/disconnect", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const data = await disconnectGmail(req.user.authUserId);
  res.json({ status: "ok", ...data });
}));

router.post("/sync", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const data = await syncGmailImports(req.accessToken, req.user.authUserId, req.body);
  res.json({ status: "ok", ...data });
}));

module.exports = router;
