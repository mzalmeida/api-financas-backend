const crypto = require("crypto");

const GMAIL_TOKEN_SECRET = process.env.GMAIL_TOKEN_SECRET || process.env.GMAIL_SYNC_SECRET || "";
const ALGORITHM = "aes-256-gcm";

function isConfigured() {
  return GMAIL_TOKEN_SECRET.trim().length >= 32;
}

function deriveKey() {
  if (!isConfigured()) {
    throw new Error("Gmail token secret is not configured.");
  }

  return crypto.createHash("sha256").update(GMAIL_TOKEN_SECRET, "utf8").digest();
}

function encryptRefreshToken(refreshToken) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    algorithm: ALGORITHM,
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

function decryptRefreshToken(payload) {
  if (!payload?.ciphertext || !payload?.iv || !payload?.tag) {
    return null;
  }

  const decipher = crypto.createDecipheriv(
    payload.algorithm || ALGORITHM,
    deriveKey(),
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

module.exports = {
  decryptRefreshToken,
  encryptRefreshToken,
  gmailCryptoConfigured: isConfigured,
};
