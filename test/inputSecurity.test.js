const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

process.env.SUPABASE_URL ||= "https://security-test.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "synthetic-anon-key-for-local-tests";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "synthetic-service-key-for-local-tests";

const {
  ImportFlowError,
  sanitizeUploadedFileName,
  validateUploadedFile,
} = require("../src/services/importsService");

async function withServer(app, callback) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("valida conteudo OFX real e rejeita arquivo falso renomeado", () => {
  const validBuffer = fs.readFileSync(path.join(__dirname, "fixtures", "nubank.ofx"));
  const validFile = {
    originalname: "extrato.ofx",
    mimetype: "application/octet-stream",
    buffer: validBuffer,
    size: validBuffer.length,
  };
  assert.doesNotThrow(() => validateUploadedFile(validFile));

  const invalidBuffer = Buffer.from("conteudo arbitrario sem estrutura financeira");
  assert.throws(() => validateUploadedFile({
    originalname: "imagem-renomeada.ofx",
    mimetype: "application/octet-stream",
    buffer: invalidBuffer,
    size: invalidBuffer.length,
  }), (error) => error instanceof ImportFlowError && error.code === "invalid_file");
});

test("remove caminhos e caracteres de controle do nome recebido", () => {
  assert.equal(sanitizeUploadedFileName("../../privado/extrato.ofx"), "extrato.ofx");
  assert.equal(sanitizeUploadedFileName("C:\\temp\\extrato\u0000.ofx"), "extrato.ofx");
});

test("producao aceita apenas a origem oficial e limita JSON", async () => {
  process.env.NODE_ENV = "production";
  process.env.FRONTEND_URL = "https://api-financas-frontend.onrender.com";
  const runtimePath = require.resolve("../src/config/runtime");
  const appPath = require.resolve("../src/app");
  delete require.cache[runtimePath];
  delete require.cache[appPath];
  const app = require("../src/app");

  await withServer(app, async (baseUrl) => {
    const official = await fetch(`${baseUrl}/auth`, {
      headers: { Origin: "https://api-financas-frontend.onrender.com" },
    });
    assert.equal(official.status, 200);
    assert.equal(official.headers.get("access-control-allow-origin"), "https://api-financas-frontend.onrender.com");
    assert.equal(Object.hasOwn(await official.json(), "allowed_origins"), false);

    const denied = await fetch(`${baseUrl}/auth`, {
      headers: { Origin: "http://localhost:8080" },
    });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).codigo, "cors_not_allowed");

    const health = await fetch(`${baseUrl}/health`);
    const healthBody = await health.json();
    assert.equal(health.status, 200);
    assert.equal(Object.hasOwn(healthBody, "supabase"), false);
    assert.equal(Object.hasOwn(healthBody, "version"), false);

    const oversized = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(300 * 1024) }),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).codigo, "payload_too_large");
  });
});
