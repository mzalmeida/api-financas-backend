const express = require("express");

const router = express.Router();

function buildHealthPayload() {
  return {
    status: "ok",
    service: "api-financas",
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
