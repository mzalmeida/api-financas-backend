const express = require("express");
const pkg = require("../../package.json");

const router = express.Router();

function buildHealthPayload() {
  return {
    status: "ok",
    service: "api-financas",
    timestamp: new Date().toISOString(),
    version: pkg.version,
    supabase: process.env.SUPABASE_URL ? "configured" : "missing",
  };
}

router.get("/", (req, res) => {
  res.json(buildHealthPayload());
});

router.get("/health", (req, res) => {
  res.json(buildHealthPayload());
});

module.exports = router;
