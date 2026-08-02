const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const gmailCryptoPath = path.join(__dirname, "..", "src", "services", "gmailCrypto.js");

function loadCrypto(secret) {
  const previousTokenSecret = process.env.GMAIL_TOKEN_SECRET;
  const previousSyncSecret = process.env.GMAIL_SYNC_SECRET;

  if (secret == null) {
    delete process.env.GMAIL_TOKEN_SECRET;
    delete process.env.GMAIL_SYNC_SECRET;
  } else {
    process.env.GMAIL_TOKEN_SECRET = secret;
    delete process.env.GMAIL_SYNC_SECRET;
  }

  delete require.cache[gmailCryptoPath];
  const moduleExports = require(gmailCryptoPath);

  return {
    ...moduleExports,
    restore() {
      if (previousTokenSecret == null) {
        delete process.env.GMAIL_TOKEN_SECRET;
      } else {
        process.env.GMAIL_TOKEN_SECRET = previousTokenSecret;
      }

      if (previousSyncSecret == null) {
        delete process.env.GMAIL_SYNC_SECRET;
      } else {
        process.env.GMAIL_SYNC_SECRET = previousSyncSecret;
      }

      delete require.cache[gmailCryptoPath];
    },
  };
}

test("encrypt/decrypt usa AES-256-GCM com roundtrip valido", () => {
  const cryptoModule = loadCrypto("0123456789abcdef0123456789abcdef");
  try {
    const encrypted = cryptoModule.encryptRefreshToken("refresh-token-sintetico");
    assert.equal(encrypted.algorithm, "aes-256-gcm");
    assert.ok(encrypted.iv);
    assert.ok(encrypted.tag);
    assert.ok(encrypted.ciphertext);
    assert.equal(cryptoModule.decryptRefreshToken(encrypted), "refresh-token-sintetico");
  } finally {
    cryptoModule.restore();
  }
});

test("segredo diferente invalida payload criptografado anteriormente", () => {
  const writer = loadCrypto("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  let encrypted;
  try {
    encrypted = writer.encryptRefreshToken("refresh-token-sintetico");
  } finally {
    writer.restore();
  }

  const reader = loadCrypto("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  try {
    assert.throws(() => reader.decryptRefreshToken(encrypted));
  } finally {
    reader.restore();
  }
});

test("payload adulterado falha na descriptografia", () => {
  const cryptoModule = loadCrypto("cccccccccccccccccccccccccccccccc");
  try {
    const encrypted = cryptoModule.encryptRefreshToken("refresh-token-sintetico");
    encrypted.ciphertext = `${encrypted.ciphertext.slice(0, -2)}xx`;
    assert.throws(() => cryptoModule.decryptRefreshToken(encrypted));
  } finally {
    cryptoModule.restore();
  }
});

test("token ausente retorna null sem quebrar o fluxo", () => {
  const cryptoModule = loadCrypto("dddddddddddddddddddddddddddddddd");
  try {
    assert.equal(cryptoModule.decryptRefreshToken(null), null);
    assert.equal(cryptoModule.decryptRefreshToken({}), null);
  } finally {
    cryptoModule.restore();
  }
});

test("segredo curto deixa a criptografia do Gmail desconfigurada", () => {
  const cryptoModule = loadCrypto("short-secret");
  try {
    assert.equal(cryptoModule.gmailCryptoConfigured(), false);
  } finally {
    cryptoModule.restore();
  }
});
