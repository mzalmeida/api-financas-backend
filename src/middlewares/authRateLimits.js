const { rateLimit } = require("express-rate-limit");

function rateLimitHandler(req, res) {
  return res.status(429).json({
    erro: "Muitas tentativas. Aguarde e tente novamente.",
    codigo: "rate_limit_exceeded",
  });
}

const sharedOptions = {
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler,
};

const loginRateLimit = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
});

const refreshRateLimit = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60 * 1000,
  limit: 60,
});

module.exports = {
  loginRateLimit,
  refreshRateLimit,
};
