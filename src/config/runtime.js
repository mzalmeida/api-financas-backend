const LOCAL_FRONTEND_ORIGINS = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseCommaSeparated(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const allowedOrigins = unique([
  process.env.FRONTEND_URL,
  "https://api-financas-frontend.onrender.com",
  ...LOCAL_FRONTEND_ORIGINS,
  ...parseCommaSeparated(process.env.ADDITIONAL_FRONTEND_ORIGINS),
]);

function parseBooleanFlag(value) {
  return typeof value === "string" && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

const gmailIntegrationEnabled = parseBooleanFlag(process.env.GMAIL_INTEGRATION_ENABLED);
const gmailIntegrationMode = String(process.env.GMAIL_INTEGRATION_MODE || "oauth").trim().toLowerCase();

function isOriginAllowed(origin) {
  return allowedOrigins.includes(origin);
}

module.exports = {
  allowedOrigins,
  gmailIntegrationEnabled,
  gmailIntegrationMode,
  isOriginAllowed,
};
