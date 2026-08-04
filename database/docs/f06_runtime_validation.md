# F06 Runtime Validation

Data da validacao: 2026-08-04

## Escopo validado

- backend publicado em `https://api-financas-backend1.onrender.com`
- frontend publicado em `https://api-financas-frontend.onrender.com`
- experiencia autenticada real do usuario proprietario
- revisoes tecnicas de duplicidade publicadas
- fornecedores como analise de gasto publicados
- saldo disponivel separado de cartao de credito no dashboard
- historico de importacoes com linguagem operacional
- responsividade revisada nas larguras 320, 360, 375, 390, 430, 768, 820, 1024, 1180, 1280, 1366 e 1440

## Resultado consolidado

- dashboard autenticado publicado abriu com menu `Revisoes` e `Fornecedores`
- `Saldo consolidado` publicado deixou de listar contas `credit_card`
- a secao `Cartao de credito` permaneceu separada do saldo disponivel
- `Importacoes recentes` passou a exibir status humanizado como `Concluida com registros ignorados`
- `Importacoes recentes` passou a exibir contadores como `novas`, `duplicadas` e `linhas analisadas`
- `Revisoes` publicado abriu sem erro e mostrou estado vazio coerente quando nao ha suspeitas ativas
- `Fornecedores` publicado abriu sem erro e consolidou o periodo real por fornecedor normalizado
- o fornecedor agrupado `Sem contraparte` apareceu com total, frequencia, maior compra, ultima compra, banco, conta/cartao e percentual das despesas
- o `app.js` publico confirmou a presenca de `importStatusLabel`, `previewStatusLabel`, `fetchSuppliers` e `renderSuppliers`
- a validacao estatica local permaneceu aprovada com `node --check`
- os testes diretos locais de parser, roteamento e `financeExperienceService` permaneceram aprovados

## Higienizacao administrativa executada

- `database/docs/f03e01_runtime_validation.json` teve `access_token` e `refresh_token` substituidos por `[REDACTED]`
- `database/docs/f03e01_render_rollout_validation.json` teve `access_token` e `refresh_token` substituidos por `[REDACTED]`

## Observacoes

- nenhum OFX real foi versionado nesta etapa
- nenhum secret novo foi adicionado ao Git
- a autenticacao publicada continuou funcionando apos o deploy corretivo da F06
