import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "file:///C:/Users/mateu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const workbookPath = "C:\\temp\\Projeto_Financeiro\\Plano_Implantacao_Projeto_Financeiro.xlsx";
const outputDir = "C:\\Users\\mateu\\.codex\\visualizations\\2026\\07\\26\\019f9e6f-6a43-7131-ac21-c5bb1d78de0e\\planilha_f03e02";

function toExcelSerial(date) {
  const epoch = Date.UTC(1899, 11, 30);
  return (date.getTime() - epoch) / 86400000;
}

const stamp = toExcelSerial(new Date("2026-08-02T13:30:00Z"));
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

const overview = workbook.worksheets.getItem("Visao_Geral");
const plan = workbook.worksheets.getItem("Plano_Implantacao");
const changelog = workbook.worksheets.getItem("Registro_Alteracoes");
const decisions = workbook.worksheets.getItem("Decisoes");
const risks = workbook.worksheets.getItem("Riscos_Pendencias");

overview.getRange("E5").values = [[18]];
overview.getRange("E8").values = [[18 / 33]];
overview.getRange("B10").values = [[
  "F03-E02 concluida: owner real validado, redirect corrigido no Supabase Auth, senha definida pelo proprietario e login publico confirmado no painel com /gastos/banco respondendo normalmente.",
]];

plan.getRange("A38:P38").copyTo(plan.getRange("A39:P39"), "all");
plan.getRange("A37:P37").copyTo(plan.getRange("A38:P38"), "all");
plan.getRange("A38:O38").values = [[
  "F03-E02",
  "Aplicacao",
  "Consolidar o usuario proprietario e implementar recuperacao de senha por e-mail",
  "Consolidar o owner real no Supabase Auth e em public.users, remover OWNER_PASSWORD do fluxo oficial, publicar no frontend o fluxo de primeiro acesso e de recuperacao/redefinicao por e-mail, validar localmente e no Render sem expor senha, token ou secrets, e concluir somente apos confirmacao do proprietario real.",
  "Frontend publico com Esqueci minha senha, solicitacao neutra, tela de nova senha e tratamento de PASSWORD_RECOVERY; owner real validado no Supabase Auth e em public.users; OWNER_PASSWORD removida do fluxo oficial e do .env.example; Site URL do Supabase corrigida para a URL publica canonica; novo e-mail real reenviado; senha definida pelo proprietario; login publico abriu o painel e /gastos/banco respondeu sem erro com a mensagem Nenhum dado encontrado.",
  "Concluido",
  "Alta",
  "Codex",
  stamp,
  stamp,
  "100%",
  "F03-E01",
  "A implementacao oficial manteve o login mediado pelo backend e moveu apenas o fluxo sensivel de recuperacao/redefinicao para o frontend com supabase-js, expondo somente SUPABASE_URL e SUPABASE_ANON_KEY. O script administrativo do owner deixou de depender de OWNER_PASSWORD e passou a sanitizar qualquer FRONTEND_URL invalida. Durante a validacao final, o campo Site URL do Supabase Auth foi corrigido manualmente porque continha texto literal indevido; depois disso um unico novo e-mail de recuperacao foi reenviado, o proprietario definiu a senha e o login publico foi confirmado no painel.",
  "api-financas-frontend/index.html; api-financas-frontend/app.js; api-financas-frontend/style.css; api-financas-frontend/README.md; api-financas-backend/database/tests/f03e01_bootstrap_owner_user.mjs; api-financas-backend/database/docs/f03e02_password_recovery_status.md; api-financas-backend/.env.example; api-financas-backend/README.md; README.md; docs/arquitetura.md; docs/decisoes.md; docs/governanca.md; docs/roadmap.md; Plano_Implantacao_Projeto_Financeiro.xlsx",
  stamp,
]];
plan.getRange("P38").clear({ applyTo: "contents" });

changelog.getRange("A21:G21").copyTo(changelog.getRange("A22:G22"), "all");
changelog.getRange("A20:G20").copyTo(changelog.getRange("A21:G21"), "all");
changelog.getRange("A21:G21").values = [[
  stamp,
  "F03-E02",
  "Conclusao da recuperacao e redefinicao de senha do owner real, com correcao do redirect publico no Supabase Auth e validacao do login publico no painel.",
  "api-financas-frontend/index.html; api-financas-frontend/app.js; api-financas-frontend/style.css; api-financas-frontend/README.md; api-financas-backend/database/tests/f03e01_bootstrap_owner_user.mjs; api-financas-backend/database/docs/f03e02_password_recovery_status.md; api-financas-backend/.env.example; api-financas-backend/README.md",
  "README.md; docs/arquitetura.md; docs/decisoes.md; docs/governanca.md; docs/roadmap.md; Plano_Implantacao_Projeto_Financeiro.xlsx",
  "Redirect corrigido; e-mail real reenviado uma unica vez; senha definida pelo proprietario; painel publico carregado; /gastos/banco respondeu sem erro; nenhum secret registrado",
  "Concluido",
]];

decisions.getRange("A63:G63").copyTo(decisions.getRange("A64:G64"), "all");
decisions.getRange("A60:G60").copyTo(decisions.getRange("A61:G61"), "all");
decisions.getRange("A60:G60").copyTo(decisions.getRange("A62:G62"), "all");
decisions.getRange("A60:G60").copyTo(decisions.getRange("A63:G63"), "all");
decisions.getRange("A61:G64").values = [
  ["DEC-060", stamp, "A recuperacao e a redefinicao de senha devem acontecer no frontend com supabase-js, mantendo o login mediado pelo backend.", "A F03-E02 precisava adicionar Esqueci minha senha e primeiro acesso por e-mail sem enviar a nova senha ao backend.", "Criar endpoints proprios de forgot/reset no backend; mover todo o login para o frontend; usar supabase-js apenas no trecho sensivel.", "Reduz o caminho sensivel da senha, evita duplicar logica de token de recuperacao e segue o fluxo suportado pelo Supabase Auth.", "O frontend passa a tratar PASSWORD_RECOVERY e a conviver com login mediado e reset direto no Supabase."],
  ["DEC-061", stamp, "OWNER_PASSWORD deixa de existir no fluxo oficial do usuario proprietario.", "O bootstrap da F03-E01 ainda mantinha OWNER_PASSWORD como opcional de operacao.", "Manter senha fixa fora do Git; exigir definicao manual de senha via backend; substituir por convite administrativo ou recuperacao por e-mail.", "Preserva o principio de nunca criar, exibir, documentar ou armazenar a senha real do proprietario.", "O script administrativo passa a depender da URL Configuration correta do Supabase Auth para gerar links publicos validos."],
  ["DEC-062", stamp, "A F03-E02 so pode ser concluida apos ajuste hospedado da URL Configuration do Supabase Auth e confirmacao manual do proprietario.", "A validacao local e a publicacao do frontend foram concluidas, mas convites/recuperacoes administrativos ainda podem cair no redirect legado local.", "Marcar a etapa como concluida apenas com HTTP 200; contornar o e-mail com senha temporaria; pausar formalmente ate corrigir o painel.", "A exigencia da etapa inclui redirect publico correto e conclusao segura do primeiro acesso.", "O bloqueio foi encerrado somente apos a correcao manual do Site URL e a validacao do login publico real do proprietario."],
  ["DEC-063", stamp, "O redirect de recuperacao em producao deve ser fixado na URL publica canonica do frontend.", "Durante a conclusao da F03-E02, o valor hospedado do Site URL contaminou o redirect_to com texto literal indevido.", "Continuar montando o redirect a partir de window.location.href; depender so de configuracao externa.", "Reduz a superficie de erro operacional e estabiliza o fluxo de recuperacao publicado.", "O frontend publicado em producao passa a usar explicitamente https://api-financas-frontend.onrender.com no reset de senha."],
];

const riskCopy = risks.getRange("A60:H60");
riskCopy.copyTo(risks.getRange("A61:H61"), "all");
riskCopy.copyTo(risks.getRange("A62:H62"), "all");
risks.getRange("A61:H62").values = [
  ["R-035", "Risco", "Configuracoes hospedadas do Supabase Auth podem contaminar o redirect de recuperacao mesmo quando o codigo local estiver correto.", "Medio", "Media", "Media", "Manter revisao administrativa do painel do Supabase sempre que houver mudanca de dominio, template ou fluxo de reset.", "Codex"],
  ["P-026", "Pendencia", "Nao ha pendencia operacional aberta da F03-E02; a observacao remanescente e apenas manter o fluxo documentado para futuras manutencoes.", "Baixo", "Baixa", "Baixa", "Prosseguir para a proxima etapa somente apos usar esta etapa concluida como baseline operacional da autenticacao publica.", "Codex"],
];

await renderSheet("Visao_Geral", "visao_geral_after.png");
await renderSheet("Plano_Implantacao", "plano_implantacao_after.png");
await renderSheet("Registro_Alteracoes", "registro_alteracoes_after.png");
await renderSheet("Decisoes", "decisoes_after.png");
await renderSheet("Riscos_Pendencias", "riscos_after.png");

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(workbookPath);

console.log("Workbook updated for F03-E02");
