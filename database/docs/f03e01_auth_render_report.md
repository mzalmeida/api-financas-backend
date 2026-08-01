# F03-E01 - Adaptacao de autenticacao, acesso ao Supabase e preparacao de deploy

## Escopo implementado localmente

- substituicao do JWT proprio nas rotas financeiras por token do Supabase Auth;
- consolidacao dos clientes Supabase em contexto de usuario, autenticacao e administracao;
- remocao do uso funcional de `service_role` em `/gastos/*`;
- ajuste do frontend para sessao baseada em `access_token` e `refresh_token`;
- rota canonica `/health` com compatibilidade temporaria em `/health/health`;
- validacao local automatizada do fluxo completo.

## Estrategia escolhida

O login permaneceu mediado pelo backend.

Justificativa:
- reduz mudanca estrutural no frontend estatico;
- evita expor dependencias adicionais do Supabase no bundle;
- preserva o contrato visual existente com o menor impacto funcional;
- permite controlar melhor respostas, erros e restauracao de sessao sem criar dois fluxos de autenticacao paralelos.

## Clientes Supabase finais

- `createSupabaseAuthClient()` usa `SUPABASE_ANON_KEY` para autenticar e renovar sessao.
- `createSupabaseUserClient(accessToken)` usa `SUPABASE_ANON_KEY` e propaga `Authorization: Bearer <access_token>`, deixando o RLS decidir o acesso.
- `adminSupabaseClient` usa `SUPABASE_SERVICE_ROLE_KEY` e ficou restrito a rotinas administrativas controladas e scripts.

## Middleware final

Arquivo oficial:
- `src/middlewares/requireSupabaseAuth.js`

Comportamentos:
- `401 missing_token` para ausencia de bearer token;
- `401 invalid_token` para token malformado ou invalido;
- `401 expired_token` para expiracao detectada;
- `502 auth_integration_error` para falha de integracao com Supabase Auth;
- `req.user` contem apenas `authUserId`, `email`, `role`, `appMetadata` e `userMetadata`.

## Health check

- oficial: `/health`
- legado temporario: `/health/health`

Os dois retornam apenas:
- `status`
- `service`
- `timestamp`
- `version`
- `supabase`

## Validacao local executada

Artefato principal:
- `database/docs/f03e01_runtime_validation.json`

Resultado consolidado:
- login valido: aprovado;
- login invalido: `401 invalid_credentials`;
- token ausente: `401 missing_token`;
- token malformado: `401 invalid_token`;
- token expirado: `401 expired_token`;
- logout: aprovado;
- refresh/restauracao: aprovados;
- CORS permitido e bloqueado: aprovados;
- usuario sintetico A e usuario sintetico B: isolamento comprovado em todas as rotas `/gastos/*`;
- `/health` e `/health/health`: aprovados;
- varredura no frontend: sem `service_role`.

## Bootstrap do usuario proprietario real

Script preparado:
- `database/tests/f03e01_bootstrap_owner_user.mjs`

Objetivo:
- criar ou alinhar o usuario proprietario real no Supabase Auth;
- sincronizar o registro correspondente em `public.users`;
- evitar senha em migration, seed, codigo funcional ou documentacao.

## Pendencias externas a este repositorio

- confirmar ou ajustar as variaveis reais do servico backend no Render;
- confirmar ou ajustar `health check path=/health` no painel do Render;
- disparar e validar o deploy publico do backend e do frontend;
- criar o usuario proprietario real, se ainda inexistente.

## Evidencia publica observada em 2026-08-01

- os commits da F03-E01 foram enviados para `main` nos repositorios oficiais de backend e frontend;
- a URL publica do backend continuou respondendo `/` com `200`, `/health` com `404` e `/health/health` com `200`;
- a URL publica do frontend continuou servindo o HTML antigo com campo `linkedin`;
- portanto, o push foi concluido, mas a implantacao publica do Render nao ficou comprovada dentro da janela observada nesta etapa.
