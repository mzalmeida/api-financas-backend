const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "src", "app.js");
const runtimePath = path.join(__dirname, "..", "src", "config", "runtime.js");
const middlewarePath = path.join(__dirname, "..", "src", "middlewares", "requireSupabaseAuth.js");
const gmailServicePath = path.join(__dirname, "..", "src", "services", "gmailService.js");
const gmailRoutePath = path.join(__dirname, "..", "src", "routes", "gmail.js");
const authRoutePath = path.join(__dirname, "..", "src", "routes", "auth.js");
const gastosRoutePath = path.join(__dirname, "..", "src", "routes", "gastos.js");
const importsRoutePath = path.join(__dirname, "..", "src", "routes", "imports.js");
const portalRoutePath = path.join(__dirname, "..", "src", "routes", "portal.js");

function buildPassThroughRouter() {
  const router = httpRouterFactory();
  router.get("/", (req, res) => {
    res.json({ status: "ok" });
  });
  return router;
}

function httpRouterFactory() {
  return require("express").Router();
}

function setMockModule(modulePath, exportsValue) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsValue,
  };
}

function restoreModules(snapshot) {
  for (const [modulePath, cached] of snapshot.entries()) {
    if (cached) {
      require.cache[modulePath] = cached;
    } else {
      delete require.cache[modulePath];
    }
  }
}

function loadApp({ gmailEnabled }) {
  const touchedPaths = [
    appPath,
    runtimePath,
    middlewarePath,
    gmailServicePath,
    gmailRoutePath,
    authRoutePath,
    gastosRoutePath,
    importsRoutePath,
    portalRoutePath,
  ];
  const snapshot = new Map(touchedPaths.map((modulePath) => [modulePath, require.cache[modulePath] || null]));

  touchedPaths.forEach((modulePath) => delete require.cache[modulePath]);

  setMockModule(runtimePath, {
    allowedOrigins: ["https://api-financas-frontend.onrender.com"],
    gmailIntegrationEnabled: gmailEnabled,
    isOriginAllowed: () => true,
  });

  setMockModule(middlewarePath, (req, res, next) => {
    const header = req.headers.authorization || "";
    if (!header) {
      return res.status(401).json({ erro: "Token nao informado", codigo: "missing_token" });
    }

    if (header !== "Bearer valid-token") {
      return res.status(401).json({ erro: "Token invalido", codigo: "invalid_token" });
    }

    req.accessToken = "valid-token";
    req.user = {
      authUserId: "auth-user-1",
      email: "owner@example.com",
    };
    return next();
  });

  setMockModule(gmailServicePath, {
    GmailIntegrationError: class GmailIntegrationError extends Error {
      constructor(status, code, message, details = null) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
      }
    },
    getGmailStatus: async () => ({
      integration: {
        connected: true,
        gmail_email_masked: "m***@gmail.com",
        last_sync_status: "connected",
      },
      accounts: [],
      institutions: [],
      messages: [],
    }),
    getGmailConnectUrl: async () => ({
      authorization_url: "https://accounts.google.com/o/oauth2/v2/auth?state=masked",
    }),
    completeGmailOauth: async () => "https://api-financas-frontend.onrender.com?gmail_oauth=connected",
    disconnectGmail: async () => ({ connected: false }),
    syncGmailImports: async () => ({
      last_sync_status: "synced",
      summary: { imports_created: 1 },
      messages: [],
    }),
  });

  setMockModule(authRoutePath, buildPassThroughRouter());
  setMockModule(gastosRoutePath, buildPassThroughRouter());
  setMockModule(importsRoutePath, buildPassThroughRouter());
  setMockModule(portalRoutePath, buildPassThroughRouter());

  const app = require(appPath);

  return {
    app,
    cleanup() {
      restoreModules(snapshot);
    },
  };
}

async function request(app, pathname, options = {}) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options);
    const bodyText = await response.text();
    let body = null;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = bodyText;
    }

    return { response, body };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("GET /health retorna 200", async () => {
  const { app, cleanup } = loadApp({ gmailEnabled: true });
  try {
    const { response, body } = await request(app, "/health");
    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
  } finally {
    cleanup();
  }
});

test("GET /health/health preserva compatibilidade legada", async () => {
  const { app, cleanup } = loadApp({ gmailEnabled: true });
  try {
    const { response, body } = await request(app, "/health/health");
    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
  } finally {
    cleanup();
  }
});

test("GET /integrations/gmail/status sem token retorna 401", async () => {
  const { app, cleanup } = loadApp({ gmailEnabled: true });
  try {
    const { response, body } = await request(app, "/integrations/gmail/status");
    assert.equal(response.status, 401);
    assert.deepEqual(body, {
      erro: "Token nao informado",
      codigo: "missing_token",
    });
  } finally {
    cleanup();
  }
});

test("GET /integrations/gmail/status com token valido retorna status da integracao", async () => {
  const { app, cleanup } = loadApp({ gmailEnabled: true });
  try {
    const { response, body } = await request(app, "/integrations/gmail/status", {
      headers: { Authorization: "Bearer valid-token" },
    });
    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.integration.connected, true);
  } finally {
    cleanup();
  }
});

test("GET /integrations/gmail/status com token invalido retorna 401", async () => {
  const { app, cleanup } = loadApp({ gmailEnabled: true });
  try {
    const { response, body } = await request(app, "/integrations/gmail/status", {
      headers: { Authorization: "Bearer invalid-token" },
    });
    assert.equal(response.status, 401);
    assert.deepEqual(body, {
      erro: "Token invalido",
      codigo: "invalid_token",
    });
  } finally {
    cleanup();
  }
});

test("GET /rota-inexistente retorna 404 controlado", async () => {
  const { app, cleanup } = loadApp({ gmailEnabled: true });
  try {
    const { response, body } = await request(app, "/rota-inexistente");
    assert.equal(response.status, 404);
    assert.deepEqual(body, {
      erro: "Rota nao encontrada",
      codigo: "route_not_found",
    });
  } finally {
    cleanup();
  }
});

test("feature Gmail desativada remove o router e retorna 404", async () => {
  const { app, cleanup } = loadApp({ gmailEnabled: false });
  try {
    const { response, body } = await request(app, "/integrations/gmail/status");
    assert.equal(response.status, 404);
    assert.deepEqual(body, {
      erro: "Rota nao encontrada",
      codigo: "route_not_found",
    });
  } finally {
    cleanup();
  }
});
