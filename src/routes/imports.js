const express = require("express");
const multer = require("multer");

const requireSupabaseAuth = require("../middlewares/requireSupabaseAuth");
const { createSupabaseUserClient } = require("../config/supabaseClients");
const {
  ImportFlowError,
  listImportOptions,
  createFinancialAccount,
  previewOfxImport,
  getImportList,
  getImportDetails,
  confirmImport,
  cancelImport,
} = require("../services/importsService");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
});

function buildClient(req) {
  return createSupabaseUserClient(req.accessToken);
}

function sendKnownError(res, error) {
  if (error instanceof ImportFlowError) {
    return res.status(error.status).json({
      erro: error.message,
      codigo: error.code,
      detalhes: error.details ?? undefined,
    });
  }

  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const code = error.code === "LIMIT_FILE_SIZE" ? "file_too_large" : "invalid_file";
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "O arquivo OFX excede o limite de 5 MB."
      : "Falha ao receber o arquivo enviado.";

    return res.status(status).json({
      erro: message,
      codigo: code,
    });
  }

  console.error("Erro no fluxo de importacao:", error.message);
  return res.status(500).json({
    erro: "Falha interna no fluxo de importacao.",
    codigo: "internal_error",
  });
}

async function run(handler, req, res) {
  try {
    await handler();
  } catch (error) {
    return sendKnownError(res, error);
  }
}

router.get("/options", requireSupabaseAuth, async (req, res) => run(async () => {
  const data = await listImportOptions(buildClient(req), req.user.authUserId);
  res.json({ status: "ok", ...data });
}, req, res));

router.post("/accounts", requireSupabaseAuth, async (req, res) => run(async () => {
  const account = await createFinancialAccount(buildClient(req), req.user.authUserId, req.body);
  res.status(201).json({ status: "ok", account });
}, req, res));

router.post("/ofx/preview", requireSupabaseAuth, (req, res) => {
  upload.single("file")(req, res, async (error) => {
    if (error) {
      return sendKnownError(res, error);
    }

    return run(async () => {
      const preview = await previewOfxImport(buildClient(req), req.user.authUserId, req.body, req.file);
      res.status(201).json({ status: "ok", preview });
    }, req, res);
  });
});

router.post("/ofx/confirm", requireSupabaseAuth, async (req, res) => run(async () => {
  const confirmation = await confirmImport(buildClient(req), req.user.authUserId, req.body);
  res.json({ status: "ok", confirmation });
}, req, res));

router.get("/", requireSupabaseAuth, async (req, res) => run(async () => {
  const imports = await getImportList(buildClient(req), req.user.authUserId, req.query);
  res.json({ status: "ok", total_registros: imports.length, imports });
}, req, res));

router.get("/:id", requireSupabaseAuth, async (req, res) => run(async () => {
  const data = await getImportDetails(buildClient(req), req.user.authUserId, req.params.id);
  res.json({ status: "ok", importacao: data });
}, req, res));

router.post("/:id/cancel", requireSupabaseAuth, async (req, res) => run(async () => {
  const cancellation = await cancelImport(buildClient(req), req.user.authUserId, req.params.id);
  res.json({ status: "ok", cancellation });
}, req, res));

module.exports = router;
