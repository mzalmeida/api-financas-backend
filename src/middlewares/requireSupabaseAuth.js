const { createSupabaseAuthClient } = require("../config/supabaseClients");

function readBearerToken(headerValue) {
  if (!headerValue) {
    return { error: { status: 401, message: "Token nao informado", code: "missing_token" } };
  }

  const parts = headerValue.trim().split(/\s+/);
  if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) {
    return { error: { status: 401, message: "Token mal formatado", code: "malformed_token" } };
  }

  return { token: parts[1] };
}

function decodeJwtPayloadWithoutTrust(token) {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function requireSupabaseAuth(req, res, next) {
  const { token, error: tokenError } = readBearerToken(req.headers.authorization);
  if (tokenError) {
    return res.status(tokenError.status).json({ erro: tokenError.message, codigo: tokenError.code });
  }

  const decodedPayload = decodeJwtPayloadWithoutTrust(token);
  if (decodedPayload?.exp && decodedPayload.exp <= Math.floor(Date.now() / 1000)) {
    return res.status(401).json({ erro: "Token expirado", codigo: "expired_token" });
  }

  try {
    const supabase = createSupabaseAuthClient();
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ erro: "Token invalido", codigo: "invalid_token" });
    }

    req.accessToken = token;
    req.user = {
      authUserId: data.user.id,
      email: data.user.email ?? null,
      role: data.user.role ?? null,
      appMetadata: data.user.app_metadata ?? {},
      userMetadata: data.user.user_metadata ?? {},
    };

    return next();
  } catch (error) {
    console.error("Falha ao validar token Supabase:", error.message);
    return res.status(502).json({ erro: "Falha ao validar autenticacao", codigo: "auth_integration_error" });
  }
}

module.exports = requireSupabaseAuth;
