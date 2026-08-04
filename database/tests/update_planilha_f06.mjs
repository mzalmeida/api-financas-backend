import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "file:///C:/Users/mateu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const workbookPath = "C:\\temp\\Projeto_Financeiro\\Plano_Implantacao_Projeto_Financeiro.xlsx";
const backupPath = "C:\\temp\\Projeto_Financeiro\\Plano_Implantacao_Projeto_Financeiro.f06.backup.xlsx";
const outputDir = "C:\\Users\\mateu\\.codex\\visualizations\\2026\\07\\26\\019f9e6f-6a43-7131-ac21-c5bb1d78de0e\\planilha_f06";

function toExcelSerial(date) {
  const epoch = Date.UTC(1899, 11, 30);
  return (date.getTime() - epoch) / 86400000;
}

function nextUsedRow(sheet) {
  return sheet.getUsedRange().values.length + 1;
}

async function renderSheet(workbook, sheetName, fileName) {
  const blob = await workbook.render({
    sheetName,
    autoCrop: "all",
    scale: 1,
    format: "png",
  });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, fileName), new Uint8Array(await blob.arrayBuffer()));
}

const stamp = toExcelSerial(new Date("2026-08-04T21:45:00Z"));
await fs.copyFile(workbookPath, backupPath);
const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);

const overview = workbook.worksheets.getItem("Visao_Geral");
const plan = workbook.worksheets.getItem("Plano_Implantacao");
const changelog = workbook.worksheets.getItem("Registro_Alteracoes");
const decisions = workbook.worksheets.getItem("Decisoes");
const risks = workbook.worksheets.getItem("Riscos_Pendencias");

overview.getRange("E5").values = [[20]];
overview.getRange("E8").values = [[20 / 33]];
overview.getRange("B10").values = [[
  "F06 concluida: experiencia publicada consolidada com revisoes tecnicas, fornecedores como analise principal de gasto, saldo disponivel separado de cartao, status de importacao humanizados, responsividade reforcada e higienizacao de tokens historicos em evidencias runtime.",
]];

plan.getRange("F42").values = [["Concluido"]];
plan.getRange("J42").values = [[stamp]];
plan.getRange("K42").values = [["100%"]];
plan.getRange("M42").values = [[
  "Versao publicada validada com login real do proprietario; menu `Revisoes` homologado; `Fornecedores` exibindo agregacao por descricao normalizada; dashboard sem conta `credit_card` no saldo disponivel; importacoes recentes com linguagem operacional; runtime historico higienizado com redacao de tokens.",
]];
plan.getRange("N42").values = [[
  "api-financas-backend/src/routes/portal.js; api-financas-backend/src/services/financeExperienceService.js; api-financas-backend/src/services/importsService.js; api-financas-backend/database/docs/f03e01_runtime_validation.json; api-financas-backend/database/docs/f03e01_render_rollout_validation.json; api-financas-backend/database/docs/f06_runtime_validation.md; api-financas-backend/database/docs/f06_runtime_validation.json; api-financas-backend/database/tests/update_planilha_f06.mjs; api-financas-backend/README.md; api-financas-frontend/app.js; api-financas-frontend/index.html; api-financas-frontend/style.css; api-financas-frontend/README.md; README.md; docs/roadmap.md; docs/decisoes.md; docs/governanca.md; docs/ofx_importacao.md; docs/parcelamentos.md; Plano_Implantacao_Projeto_Financeiro.xlsx",
]];
plan.getRange("O42").values = [[stamp]];

const nextChangeRow = nextUsedRow(changelog);
changelog.getRange(`A${nextChangeRow}:G${nextChangeRow}`).values = [[
  stamp,
  "F06",
  "Consolidacao operacional publicada do RebeccaCash com revisoes tecnicas, fornecedores como analise principal, responsividade reforcada, saldo disponivel separado de cartao e higienizacao de tokens historicos.",
  "api-financas-backend/src/routes/portal.js; api-financas-backend/src/services/financeExperienceService.js; api-financas-backend/src/services/importsService.js; api-financas-backend/database/docs/f06_runtime_validation.md; api-financas-backend/database/docs/f06_runtime_validation.json; api-financas-backend/database/docs/f03e01_runtime_validation.json; api-financas-backend/database/docs/f03e01_render_rollout_validation.json; api-financas-frontend/app.js; api-financas-frontend/index.html; api-financas-frontend/style.css",
  "README.md; api-financas-backend/README.md; api-financas-frontend/README.md; docs/roadmap.md; docs/decisoes.md; docs/governanca.md; docs/ofx_importacao.md; docs/parcelamentos.md; Plano_Implantacao_Projeto_Financeiro.xlsx",
  "node --check; testes diretos; validacao autenticada no navegador interno; deploy Render frontend; health backend 200; app.js publico conferido",
  "Concluido",
]];

const nextDecisionRow = nextUsedRow(decisions);
decisions.getRange(`A${nextDecisionRow}:G${nextDecisionRow}`).values = [[
  "DEC-072",
  stamp,
  "Reposicionar duplicidades como revisoes tecnicas e promover fornecedores como leitura principal de gasto.",
  "O uso real do portal mostrou que duplicidades ocupavam a navegacao principal enquanto a analise de gasto por fornecedor ainda nao tinha protagonismo.",
  "Manter a area `Duplicidades` como leitura principal e depender somente de `counterparty_id` para analise de gasto.",
  "Ajustar a UX para `Revisoes` e consolidar fornecedores por descricao normalizada aproxima o portal das decisoes de negocio aprovadas e melhora a leitura operacional imediata.",
  "A experiencia publicada passa a separar melhor controle tecnico de importacao e analise financeira do dia a dia.",
]];

const nextRiskRow = nextUsedRow(risks);
risks.getRange(`A${nextRiskRow}:H${nextRiskRow}`).values = [[
  "P-006",
  "Pendencia",
  "Consolidar novas regras de normalizacao de fornecedores e futura classificacao automatica de pagamento de fatura.",
  "Medio",
  "Media",
  "Media",
  "Abrir etapa especifica para ampliar normalizacao, conciliacao de fatura e analise por banco sem perder segregacao entre caixa e cartao.",
  "Mateus + Codex",
]];

await renderSheet(workbook, "Visao_Geral", "visao_geral_after.png");
await renderSheet(workbook, "Plano_Implantacao", "plano_implantacao_after.png");
await renderSheet(workbook, "Registro_Alteracoes", "registro_alteracoes_after.png");
await renderSheet(workbook, "Decisoes", "decisoes_after.png");
await renderSheet(workbook, "Riscos_Pendencias", "riscos_after.png");

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(workbookPath);

console.log("Workbook updated for F06");
