const express = require("express");

const router = express.Router();

function buildHealthPayload() {
  return {
    status: "ok",
    service: "api-financas",
    revision: String(process.env.RENDER_GIT_COMMIT || process.env.APP_REVISION || "local").slice(0, 7),
    timestamp: new Date().toISOString(),
  };
}

router.get("/", (req, res) => {
  res.json(buildHealthPayload());
});

router.get("/health", (req, res) => {
  res.json(buildHealthPayload());
});

module.exports = router;
