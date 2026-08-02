import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  OWNER_EMAIL,
  OWNER_DISPLAY_NAME,
  OWNER_PROFILE_CODE = "owner",
  OWNER_STATUS_CODE = "active",
  FRONTEND_URL,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY sao obrigatorias.");
}

if (!OWNER_EMAIL || !OWNER_DISPLAY_NAME) {
  throw new Error("OWNER_EMAIL e OWNER_DISPLAY_NAME sao obrigatorias.");
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const sendMode = parseSendMode(process.argv.slice(2));
const PUBLIC_FRONTEND_URL = "https://api-financas-frontend.onrender.com";
const redirectTo = resolveRedirectTo();

function maskEmail(email) {
  const [localPart, domain] = email.split("@");
  const visible = localPart.slice(0, 2);
  return `${visible}***@${domain}`;
}

function parseSendMode(argv) {
  const entry = argv.find((item) => item.startsWith("--send="));
  const value = entry?.split("=")[1] ?? "auto";
  if (!["auto", "none", "invite", "recovery"].includes(value)) {
    throw new Error("Use --send=auto|none|invite|recovery.");
  }
  return value;
}

function resolveRedirectTo() {
  const normalized = FRONTEND_URL?.trim();
  if (normalized) {
    try {
      const parsed = new URL(normalized);
      if (
        (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        parsed.hostname !== "localhost" &&
        parsed.hostname !== "127.0.0.1"
      ) {
        return `${parsed.protocol}//${parsed.host}`;
      }
    } catch {
      // Fallback seguro para a URL publica canonica quando o valor recebido nao for uma URL valida.
    }
  }
  return PUBLIC_FRONTEND_URL;
}

function formatMaskedId(value) {
  return value ? `${value.slice(0, 8)}...` : null;
}

function deriveDisplayName(existingRows) {
  const persisted = existingRows.find((row) => row.display_name)?.display_name;
  return persisted || OWNER_DISPLAY_NAME;
}

async function findAuthUserByEmail() {
  const { data: listData, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listError) throw listError;

  return listData.users.find((user) => user.email?.toLowerCase() === OWNER_EMAIL.toLowerCase()) ?? null;
}

async function ensureAuthMetadata(authUser) {
  const nextMetadata = {
    ...(authUser.user_metadata ?? {}),
    bootstrap_marker: "F03-E02",
  };

  const { data, error } = await admin.auth.admin.updateUserById(authUser.id, {
    user_metadata: nextMetadata,
  });

  if (error) throw error;
  return data.user;
}

async function createInvitedAuthUser() {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(OWNER_EMAIL, {
    data: {
      bootstrap_marker: "F03-E02",
    },
    redirectTo,
  });

  if (error) throw error;
  return data.user;
}

async function sendRecoveryEmail() {
  const { error } = await auth.auth.resetPasswordForEmail(OWNER_EMAIL, {
    redirectTo,
  });

  if (error) throw error;
}

function shouldTreatAsConfirmed(authUser) {
  return Boolean(
    authUser.confirmed_at ||
    authUser.email_confirmed_at ||
    authUser.last_sign_in_at,
  );
}

async function ensureAuthUser() {
  const existing = await findAuthUserByEmail();
  if (existing) {
    const updated = await ensureAuthMetadata(existing);
    return {
      authUser: updated,
      authMethod: "found",
      dispatchMethod: null,
    };
  }

  const invited = await createInvitedAuthUser();
  return {
    authUser: invited,
    authMethod: "created_by_invite",
    dispatchMethod: "invite",
  };
}

async function upsertPublicUser(authUser) {
  const { data: existingRows, error: selectError } = await admin
    .from("users")
    .select("id,auth_subject,email,display_name,profile_code,status_code")
    .eq("auth_provider", "supabase")
    .or(`auth_subject.eq.${authUser.id},email.eq.${OWNER_EMAIL}`);

  if (selectError) throw selectError;

  if (existingRows.length > 1) {
    throw new Error("Duplicidade em public.users para o owner; correcao manual necessaria antes de prosseguir.");
  }

  const displayName = deriveDisplayName(existingRows);

  if (existingRows.length > 0) {
    const { data, error } = await admin
      .from("users")
      .update({
        email: OWNER_EMAIL,
        display_name: displayName,
        profile_code: OWNER_PROFILE_CODE,
        status_code: OWNER_STATUS_CODE,
        auth_subject: authUser.id,
        archived_at: null,
      })
      .eq("id", existingRows[0].id)
      .select("id,auth_subject,email,display_name,profile_code,status_code")
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await admin
    .from("users")
    .insert({
      auth_provider: "supabase",
      auth_subject: authUser.id,
      email: OWNER_EMAIL,
      display_name: displayName,
      profile_code: OWNER_PROFILE_CODE,
      status_code: OWNER_STATUS_CODE,
    })
    .select("id,auth_subject,email,display_name,profile_code,status_code")
    .single();

  if (error) throw error;
  return data;
}

async function dispatchOwnerEmail(authUser) {
  if (sendMode === "none") {
    return "none";
  }

  if (sendMode === "invite") {
    if (authUser) {
      throw new Error("Nao e seguro reenviar convite forcado para um usuario ja existente por este script.");
    }
    return "invite";
  }

  if (sendMode === "recovery") {
    await sendRecoveryEmail();
    return "recovery";
  }

  if (shouldTreatAsConfirmed(authUser)) {
    await sendRecoveryEmail();
    return "recovery";
  }

  return "none";
}

const ensured = await ensureAuthUser();
const publicUser = await upsertPublicUser(ensured.authUser);

let dispatched = ensured.dispatchMethod;
if (!dispatched) {
  dispatched = await dispatchOwnerEmail(ensured.authUser);
}

console.log(JSON.stringify({
  status: "ok",
  auth_provider: "supabase",
  owner_email_masked: maskEmail(OWNER_EMAIL),
  auth_user_id_masked: formatMaskedId(ensured.authUser.id),
  public_user_id_masked: formatMaskedId(publicUser.id),
  auth_subject_masked: formatMaskedId(publicUser.auth_subject),
  profile_code: publicUser.profile_code,
  status_code: publicUser.status_code,
  owner_auth_status: ensured.authMethod,
  email_dispatch: dispatched,
  redirect_to: redirectTo,
}, null, 2));
