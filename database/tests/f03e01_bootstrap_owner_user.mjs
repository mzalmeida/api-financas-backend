import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  OWNER_DISPLAY_NAME,
  OWNER_PROFILE_CODE = "owner",
  OWNER_STATUS_CODE = "active",
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorias.");
}

if (!OWNER_EMAIL || !OWNER_PASSWORD || !OWNER_DISPLAY_NAME) {
  throw new Error("OWNER_EMAIL, OWNER_PASSWORD e OWNER_DISPLAY_NAME sao obrigatorias.");
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function maskEmail(email) {
  const [localPart, domain] = email.split("@");
  const visible = localPart.slice(0, 2);
  return `${visible}***@${domain}`;
}

async function upsertAuthUser() {
  const { data: listData, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listError) throw listError;

  const existing = listData.users.find((user) => user.email?.toLowerCase() === OWNER_EMAIL.toLowerCase());
  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
      password: OWNER_PASSWORD,
      email_confirm: true,
      user_metadata: {
        ...(existing.user_metadata ?? {}),
        bootstrap_marker: "F03-E01",
      },
    });
    if (error) throw error;
    return data.user;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    email_confirm: true,
    user_metadata: {
      bootstrap_marker: "F03-E01",
    },
  });
  if (error) throw error;
  return data.user;
}

async function upsertPublicUser(authUser) {
  const { data: existingRows, error: selectError } = await admin
    .from("users")
    .select("id,auth_subject,email")
    .eq("auth_provider", "supabase")
    .eq("auth_subject", authUser.id)
    .limit(1);

  if (selectError) throw selectError;

  if (existingRows.length > 0) {
    const { data, error } = await admin
      .from("users")
      .update({
        email: OWNER_EMAIL,
        display_name: OWNER_DISPLAY_NAME,
        profile_code: OWNER_PROFILE_CODE,
        status_code: OWNER_STATUS_CODE,
        archived_at: null,
      })
      .eq("id", existingRows[0].id)
      .select("id")
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
      display_name: OWNER_DISPLAY_NAME,
      profile_code: OWNER_PROFILE_CODE,
      status_code: OWNER_STATUS_CODE,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

const authUser = await upsertAuthUser();
const publicUser = await upsertPublicUser(authUser);

console.log(JSON.stringify({
  status: "ok",
  auth_provider: "supabase",
  owner_email_masked: maskEmail(OWNER_EMAIL),
  auth_user_id_masked: `${authUser.id.slice(0, 8)}...`,
  public_user_id_masked: `${publicUser.id.slice(0, 8)}...`,
  profile_code: OWNER_PROFILE_CODE,
  status_code: OWNER_STATUS_CODE,
}, null, 2));
