const express = require("express");

const requireSupabaseAuth = require("../middlewares/requireSupabaseAuth");
const { createSupabaseUserClient } = require("../config/supabaseClients");
const {
  PortalServiceError,
  listCatalog,
  createCatalogItem,
  updateCatalogItem,
  archiveCatalogItem,
  getProfile,
  updateProfile,
  updateSettings,
} = require("../services/portalService");
const {
  FinanceExperienceError,
  getFinanceOverview,
  listMovements,
  listDuplicateMovements,
  listSupplierInsights,
  listInstallmentPlans,
  createInstallmentPlan,
  linkInstallmentItem,
  updateInstallmentPlan,
  updateMovement,
  updateMovementsCategory,
  updateDuplicateDecision,
} = require("../services/financeExperienceService");

const router = express.Router();

function buildClient(req) {
  return createSupabaseUserClient(req.accessToken);
}

function sendKnownError(res, error) {
  if (error instanceof PortalServiceError) {
    return res.status(error.status).json({
      erro: error.message,
      codigo: error.code,
      detalhes: error.details ?? undefined,
    });
  }

  if (error instanceof FinanceExperienceError) {
    return res.status(error.status).json({
      erro: error.message,
      codigo: error.code,
      detalhes: error.details ?? undefined,
    });
  }

  console.error("Erro no portal:", error.message);
  return res.status(500).json({
    erro: "Falha interna no portal.",
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

router.get("/overview", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const data = await getFinanceOverview(buildClient(req), req.user.authUserId, req.query);
  res.json({ status: "ok", ...data });
}));

router.get("/movements", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const data = await listMovements(buildClient(req), req.user.authUserId, req.query);
  res.json({ status: "ok", ...data });
}));

router.patch("/movements/:id", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const item = await updateMovement(buildClient(req), req.user.authUserId, req.params.id, req.body);
  res.json({ status: "ok", item });
}));

router.patch("/movements", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const result = await updateMovementsCategory(buildClient(req), req.user.authUserId, req.body);
  res.json({ status: "ok", ...result });
}));

router.get("/duplicates", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const data = await listDuplicateMovements(buildClient(req), req.user.authUserId, req.query);
  res.json({ status: "ok", ...data });
}));

router.get("/suppliers", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const data = await listSupplierInsights(buildClient(req), req.user.authUserId, req.query);
  res.json({ status: "ok", ...data });
}));

router.patch("/duplicates/:id", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const item = await updateDuplicateDecision(buildClient(req), req.user.authUserId, req.params.id, req.body);
  res.json({ status: "ok", item });
}));

router.get("/installments", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const items = await listInstallmentPlans(buildClient(req), req.user.authUserId);
  res.json({ status: "ok", items });
}));

router.post("/installments", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const item = await createInstallmentPlan(buildClient(req), req.user.authUserId, req.body);
  res.status(201).json({ status: "ok", item });
}));

router.patch("/installments/:planId", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const item = await updateInstallmentPlan(buildClient(req), req.user.authUserId, req.params.planId, req.body);
  res.json({ status: "ok", item });
}));

router.delete("/installments/:planId", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const item = await updateInstallmentPlan(buildClient(req), req.user.authUserId, req.params.planId, { archive: true });
  res.json({ status: "ok", item });
}));

router.post("/installments/:planId/items/:itemId/link", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const item = await linkInstallmentItem(buildClient(req), req.user.authUserId, req.params.planId, req.params.itemId, req.body);
  res.json({ status: "ok", item });
}));

router.get("/profile", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const data = await getProfile(buildClient(req), req.user.authUserId);
  res.json({ status: "ok", ...data });
}));

router.put("/profile", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const user = await updateProfile(buildClient(req), req.user.authUserId, req.body);
  res.json({ status: "ok", user });
}));

router.put("/settings", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const settings = await updateSettings(buildClient(req), req.user.authUserId, req.body);
  res.json({ status: "ok", settings });
}));

router.get("/catalog/:entity", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const data = await listCatalog(buildClient(req), req.user.authUserId, req.params.entity, req.query);
  res.json({ status: "ok", ...data });
}));

router.post("/catalog/:entity", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const item = await createCatalogItem(buildClient(req), req.user.authUserId, req.params.entity, req.body);
  res.status(201).json({ status: "ok", item });
}));

router.put("/catalog/:entity/:id", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const item = await updateCatalogItem(buildClient(req), req.user.authUserId, req.params.entity, req.params.id, req.body);
  res.json({ status: "ok", item });
}));

router.delete("/catalog/:entity/:id", requireSupabaseAuth, async (req, res) => run(res, async () => {
  const item = await archiveCatalogItem(buildClient(req), req.user.authUserId, req.params.entity, req.params.id);
  res.json({ status: "ok", item });
}));

module.exports = router;
