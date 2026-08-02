# F05 Runtime Validation

Data da validacao: 2026-08-02

## Escopo validado

- backend publicado em `https://api-financas-backend1.onrender.com`
- frontend publicado em `https://api-financas-frontend.onrender.com`
- migrations 093-097 ja aplicadas no Supabase real
- OFX real de cartao Nubank usado apenas localmente para homologacao autorizada
- OFX sintetico de conta Nubank e OFX sintetico do Inter usados para regressao controlada

## Resultado consolidado

- OFX real de cartao Nubank: preview `201`, 29 linhas, 28 validas, 1 duplicada
- confirmacao do OFX real: `completed_with_errors`, 28 transacoes criadas, 1 duplicidade mantida
- reimportacao do mesmo OFX real: 29 linhas reconhecidas como duplicadas no preview e confirmacao idempotente
- OFX sintetico de conta Nubank: preview `201`, confirmacao `200`, regra inicial de salario aplicada com categoria compartilhada `Salario`
- OFX sintetico do Inter: preview `201`, confirmacao `200`
- incompatibilidade cartao x conta: retorno `400` com codigo `credit_card_account_required`
- overview autenticado: `200`
- movements autenticado: `200`
- categorizacao manual em movements: `PATCH` retornando `200`
- parcelamento manual: criacao `201`, listagem `200`, vinculo `200`, marcacao de parcela paga `200`
- duplicidades sintéticas controladas: listagem com 2 registros e decisao manual retornando `200`
- isolamento por ownership: usuario sintetico B recebeu apenas seu proprio escopo vazio

## Observacoes

- nenhum OFX real foi versionado, copiado para fixtures ou gravado em documentacao
- nenhum token, secret, FITID completo ou valor real foi registrado neste relatorio
- o frontend publicado passou a expor acoes de categorizacao, decisao de duplicidade e operacao de parcelamentos somente apos o deploy corretivo de 2026-08-02
