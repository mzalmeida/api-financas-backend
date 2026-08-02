const { adminSupabaseClient } = require("../config/supabaseClients");

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function matchRule(rule, transaction) {
  const sourceMap = {
    description: transaction.description,
    memo: transaction.memo,
    name: transaction.name,
    fitid: transaction.fitId,
  };

  const haystack = normalizeText(sourceMap[rule.match_field] ?? transaction.description);
  const pattern = normalizeText(rule.pattern_text);

  if (!haystack || !pattern) return false;

  switch (rule.match_operator) {
    case "equals":
      return haystack === pattern;
    case "starts_with":
      return haystack.startsWith(pattern);
    case "ends_with":
      return haystack.endsWith(pattern);
    case "regex":
      try {
        return new RegExp(rule.pattern_text, "i").test(sourceMap[rule.match_field] ?? transaction.description ?? "");
      } catch {
        return false;
      }
    case "contains":
    default:
      return haystack.includes(pattern);
  }
}

async function loadClassificationRules(client, appUserId) {
  const { data, error } = await client
    .from("transaction_classification_rules")
    .select("id,rule_name,match_field,match_operator,pattern_text,priority,target_movement_type,category_id,counterparty_id,is_active")
    .eq("user_id", appUserId)
    .eq("is_active", true)
    .is("archived_at", null)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return [];
  }

  return data ?? [];
}

async function ensureCounterpartyForRule(appUserId, displayName) {
  const normalizedName = normalizeText(displayName);

  const { data: existing } = await adminSupabaseClient
    .from("counterparties")
    .select("id")
    .eq("user_id", appUserId)
    .eq("normalized_name", normalizedName)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data } = await adminSupabaseClient
    .from("counterparties")
    .insert({
      user_id: appUserId,
      display_name: displayName,
      normalized_name: normalizedName,
      counterparty_type: "merchant",
    })
    .select("id")
    .single();

  return data?.id ?? null;
}

async function applyClassificationRuleSet(client, appUserId, transaction) {
  const rules = await loadClassificationRules(client, appUserId);
  const matchedRule = rules.find((rule) => matchRule(rule, transaction));

  if (!matchedRule) {
    return {
      category_id: null,
      counterparty_id: null,
      movement_type: transaction.movementType,
      matched_rule_id: null,
      matched_rule_name: null,
    };
  }

  let counterpartyId = matchedRule.counterparty_id ?? null;
  if (!counterpartyId && transaction.description) {
    counterpartyId = await ensureCounterpartyForRule(appUserId, transaction.description.slice(0, 160));
  }

  return {
    category_id: matchedRule.category_id ?? null,
    counterparty_id: counterpartyId,
    movement_type: matchedRule.target_movement_type || transaction.movementType,
    matched_rule_id: matchedRule.id,
    matched_rule_name: matchedRule.rule_name,
  };
}

module.exports = {
  applyClassificationRuleSet,
};
