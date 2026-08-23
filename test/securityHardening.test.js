const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");

const { loginRateLimit, refreshRateLimit } = require("../src/middlewares/authRateLimits");

async function withServer(app, callback) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("Helmet adiciona headers sem bloquear CORS ou health check", async () => {
  process.env.SUPABASE_URL ||= "https://security-test.supabase.co";
  process.env.SUPABASE_ANON_KEY ||= "synthetic-anon-key-for-local-tests";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "synthetic-service-key-for-local-tests";
  const app = require("../src/app");
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://api-financas-frontend.onrender.com" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("access-control-allow-origin"), "https://api-financas-frontend.onrender.com");
  });
});

test("limite de login bloqueia excesso com resposta controlada", async () => {
  const app = express();
  app.post("/login", loginRateLimit, (req, res) => res.status(401).json({ codigo: "invalid_credentials" }));

  await withServer(app, async (baseUrl) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await fetch(`${baseUrl}/login`, { method: "POST" });
      assert.equal(response.status, 401);
    }

    const blocked = await fetch(`${baseUrl}/login`, { method: "POST" });
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), {
      erro: "Muitas tentativas. Aguarde e tente novamente.",
      codigo: "rate_limit_exceeded",
    });
  });
});

test("limite de refresh permite uso normal e bloqueia abuso", async () => {
  const app = express();
  app.post("/refresh", refreshRateLimit, (req, res) => res.status(401).json({ codigo: "invalid_refresh_token" }));

  await withServer(app, async (baseUrl) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await fetch(`${baseUrl}/refresh`, { method: "POST" });
      assert.equal(response.status, 401);
    }

    const blocked = await fetch(`${baseUrl}/refresh`, { method: "POST" });
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).codigo, "rate_limit_exceeded");
  });
});
