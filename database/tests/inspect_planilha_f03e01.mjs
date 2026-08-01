import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "file:///C:/Users/mateu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const workbookPath = "C:\\temp\\Projeto_Financeiro\\Plano_Implantacao_Projeto_Financeiro.xlsx";
const outputDir = "C:\\Users\\mateu\\.codex\\visualizations\\2026\\07\\26\\019f9e6f-6a43-7131-ac21-c5bb1d78de0e\\planilha_f03e01";
const jsonPath = "C:\\temp\\Projeto_Financeiro\\extratos_pub\\api-financas-backend\\database\\docs\\f03e01_planilha_inspection.json";

const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);

async function renderSheet(sheetName, fileName) {
  const blob = await workbook.render({
    sheetName,
    autoCrop: "all",
    scale: 1,
    format: "png",
  });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, fileName), new Uint8Array(await blob.arrayBuffer()));
}

const ranges = [
  { label: "visao_geral", sheetName: "Visao_Geral", range: "A1:F12" },
  { label: "plano_implantacao", sheetName: "Plano_Implantacao", range: "A34:P37" },
  { label: "registro_alteracoes", sheetName: "Registro_Alteracoes", range: "A17:G20" },
  { label: "decisoes", sheetName: "Decisoes", range: "A52:G58" },
  { label: "riscos_pendencias", sheetName: "Riscos_Pendencias", range: "A55:H60" },
];

const inspection = {
  workbook: workbookPath,
  captured_at: new Date().toISOString(),
  ranges: [],
};

for (const item of ranges) {
  const sheet = workbook.worksheets.getItem(item.sheetName);
  inspection.ranges.push({
    label: item.label,
    sheet: item.sheetName,
    range: item.range,
    values: sheet.getRange(item.range).values,
  });
}

await renderSheet("Visao_Geral", "visao_geral_before.png");
await renderSheet("Plano_Implantacao", "plano_implantacao_before.png");
await renderSheet("Registro_Alteracoes", "registro_alteracoes_before.png");
await renderSheet("Decisoes", "decisoes_before.png");
await renderSheet("Riscos_Pendencias", "riscos_before.png");

await fs.writeFile(jsonPath, `${JSON.stringify(inspection, null, 2)}\n`, "utf8");

console.log(`Inspection written to ${jsonPath}`);
