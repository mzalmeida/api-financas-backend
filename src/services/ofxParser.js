const crypto = require("crypto");

const INSTITUTION_RULES = [
  {
    slug: "nubank",
    normalizedNames: ["nubank"],
    names: ["nubank", "nu pagamentos", "nu bank"],
    codes: ["260"],
  },
  {
    slug: "inter",
    normalizedNames: ["banco inter", "inter"],
    names: ["banco inter", "inter"],
    codes: ["077"],
  },
];

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function decodeOfxBuffer(buffer) {
  const utf8 = Buffer.from(buffer).toString("utf8");
  const replacementCount = (utf8.match(/\uFFFD/g) || []).length;
  if (replacementCount > 3) {
    return {
      text: Buffer.from(buffer).toString("latin1"),
      encoding: "latin1",
    };
  }

  return {
    text: utf8,
    encoding: "utf8",
  };
}

function normalizeOfxText(rawText) {
  return rawText.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function extractTagValue(source, tagName) {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)(?=<\\/?[A-Z0-9_]+>|$)`, "i");
  const match = regex.exec(source);
  if (!match) return null;
  return match[1].trim();
}

function extractAllBlocks(source, tagName) {
  const blocks = [];
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\/${tagName}>`, "gi");
  let match = regex.exec(source);

  while (match) {
    blocks.push(match[1]);
    match = regex.exec(source);
  }

  if (blocks.length > 0) {
    return blocks;
  }

  const startRegex = new RegExp(`<${tagName}>`, "gi");
  let startMatch = startRegex.exec(source);
  while (startMatch) {
    const startIndex = startMatch.index + startMatch[0].length;
    const remainder = source.slice(startIndex);
    const nextTagMatch = /<\/?STMTTRN>|<\/BANKTRANLIST>|<\/?LEDGERBAL>|<\/?BANKMSGSRSV1>|<\/?CREDITCARDMSGSRSV1>/i.exec(remainder);
    const endIndex = nextTagMatch ? startIndex + nextTagMatch.index : source.length;
    blocks.push(source.slice(startIndex, endIndex));
    startMatch = startRegex.exec(source);
  }

  return blocks;
}

function parseOfxDate(rawValue) {
  if (!rawValue) return null;
  const trimmed = String(rawValue).trim();
  const digits = trimmed.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!digits) return null;
  const [, year, month, day] = digits;
  return `${year}-${month}-${day}`;
}

function parseNumericAmount(rawValue) {
  if (rawValue == null) return null;
  const normalized = String(rawValue).replace(/,/g, ".").trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function compactDescription(name, memo) {
  const parts = [name, memo]
    .map((value) => String(value ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return parts.join(" - ").slice(0, 500);
}

function inferMovementType(trnType, amount, description) {
  const normalizedType = normalizeText(trnType);
  const normalizedDescription = normalizeText(description);
  const isTransfer = ["xfer", "transfer", "xferdep", "xferwd"].includes(normalizedType)
    || normalizedDescription.includes("transfer")
    || normalizedDescription.includes("ted")
    || normalizedDescription.includes("pix");

  if (isTransfer) return "transfer";
  if (amount == null || amount === 0) return "adjustment";
  return amount < 0 ? "expense" : "income";
}

function buildRowHash(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function detectInstitution(rawText, header, institutions = []) {
  const normalizedOrg = normalizeText(header.org);
  const normalizedFid = String(header.fid ?? "").trim();
  const normalizedBankId = String(header.bankId ?? "").trim();
  const textEvidence = normalizeText([
    header.org,
    header.accountId,
    header.accountType,
    header.curDef,
    rawText.slice(0, 4000),
  ].filter(Boolean).join(" "));

  const matchedRule = INSTITUTION_RULES.find((rule) => (
    rule.codes.includes(normalizedFid)
    || rule.codes.includes(normalizedBankId)
    || rule.names.some((matcher) => normalizedOrg.includes(normalizeText(matcher)))
    || rule.names.some((matcher) => textEvidence.includes(normalizeText(matcher)))
  ));
  if (!matchedRule) {
    return {
      institutionId: null,
      slug: null,
      label: null,
      confidence: "low",
    };
  }

  const institution = institutions.find((item) => matchedRule.normalizedNames.includes(normalizeText(item.normalized_name || item.name)));
  return {
    institutionId: institution?.id ?? null,
    slug: matchedRule.slug,
    label: institution?.name ?? (matchedRule.slug === "inter" ? "Banco Inter" : "Nubank"),
    confidence: institution ? "high" : "medium",
  };
}

function parseTransactions(blocks) {
  return blocks.map((block, index) => {
    const trnType = extractTagValue(block, "TRNTYPE");
    const name = extractTagValue(block, "NAME");
    const memo = extractTagValue(block, "MEMO");
    const refNum = extractTagValue(block, "REFNUM");
    const description = compactDescription(name, memo);
    const amount = parseNumericAmount(extractTagValue(block, "TRNAMT"));
    const postedOn = parseOfxDate(extractTagValue(block, "DTPOSTED"));
    const userDate = parseOfxDate(extractTagValue(block, "DTUSER"));
    const transaction = {
      rowNumber: index + 1,
      trnType,
      amount,
      postedOn,
      occurredOn: userDate || postedOn,
      fitId: extractTagValue(block, "FITID"),
      checkNum: extractTagValue(block, "CHECKNUM"),
      refNum,
      name,
      memo,
      description,
      movementType: inferMovementType(trnType, amount, description),
      rawData: {
        trnType,
        trnAmt: extractTagValue(block, "TRNAMT"),
        dtPosted: extractTagValue(block, "DTPOSTED"),
        dtUser: extractTagValue(block, "DTUSER"),
        fitId: extractTagValue(block, "FITID"),
        checkNum: extractTagValue(block, "CHECKNUM"),
        refNum,
        name,
        memo,
      },
    };

    transaction.rowHash = buildRowHash(transaction.rawData);
    return transaction;
  });
}

function parseOfxBuffer(buffer, institutions = []) {
  const decoded = decodeOfxBuffer(buffer);
  const text = normalizeOfxText(decoded.text);
  const transactionBlocks = extractAllBlocks(text, "STMTTRN");
  const transactions = parseTransactions(transactionBlocks);

  const header = {
    org: extractTagValue(text, "ORG"),
    fid: extractTagValue(text, "FID"),
    bankId: extractTagValue(text, "BANKID"),
    branchId: extractTagValue(text, "BRANCHID"),
    accountId: extractTagValue(text, "ACCTID"),
    accountType: extractTagValue(text, "ACCTTYPE"),
    curDef: extractTagValue(text, "CURDEF") || "BRL",
    startDate: parseOfxDate(extractTagValue(text, "DTSTART")),
    endDate: parseOfxDate(extractTagValue(text, "DTEND")),
    ledgerBalance: parseNumericAmount(extractTagValue(text, "BALAMT")),
    ledgerAsOf: parseOfxDate(extractTagValue(text, "DTASOF")),
    availableBalance: parseNumericAmount(extractTagValue(text, "AVAILBAL")),
    availableAsOf: parseOfxDate(extractTagValue(text, "DTASOF")),
  };

  const detection = detectInstitution(text, header, institutions);
  const warnings = [];

  if (!header.startDate || !header.endDate) {
    warnings.push("Periodo do extrato nao foi identificado integralmente.");
  }

  if (!detection.institutionId) {
    warnings.push("Instituicao nao detectada automaticamente.");
  }

  return {
    encoding: decoded.encoding,
    header,
    detection,
    warnings,
    transactions,
    rawText: text,
  };
}

module.exports = {
  normalizeText,
  parseOfxBuffer,
  parseOfxDate,
  parseNumericAmount,
  compactDescription,
  inferMovementType,
};
