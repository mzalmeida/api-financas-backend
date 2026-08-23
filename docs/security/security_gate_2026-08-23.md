# Security gate pre-deploy

Data: 2026-08-23

## Recomendacao

**NAO APTO PARA DEPLOY automatico nesta execucao.** O codigo local passou nas validacoes automatizadas, mas o teste remoto de isolamento com dois usuarios reais e os fluxos reais de login, refresh, recovery e upload autenticado nao foram executados. Nenhum commit, push, deploy ou migration remota foi realizado.

## Itens aprovados

- Backend: Helmet, limites independentes de login/refresh, CORS restrito em producao, JSON de 256 KB, upload OFX em memoria com limite de 5 MB/um arquivo, validacao de extensao/MIME/conteudo, erros controlados e health check minimo.
- Frontend: CSP, versao exata do Supabase JS, remocao da persistencia duplicada do cliente Supabase, limpeza de URL, renderizacao segura por padrao e cache `no-store` para chamadas autenticadas.
- Repositorio: `.env` e logs ignorados; logs antes rastreados removidos somente do indice; nenhum JWT, `sb_secret`, connection string com senha ou chave privada localizado nos arquivos rastreados.
- Supabase local: RLS, policies de ownership, `WITH CHECK`, grants restritos, views com `security_invoker` e funcoes com `search_path` fixado.
- Dependencias backend: `npm audit` retornou 0 vulnerabilidades conhecidas para 178 dependencias analisadas.

## Testes realizados

- `node --test --test-isolation=none`: 58 testes do backend aprovados.
- Frontend `node --test --test-isolation=none test/security-static.test.mjs`: 4 testes aprovados.
- `node --check` nos arquivos JavaScript alterados: aprovado.
- `git diff --check` nos dois repositorios: aprovado; apenas avisos de conversao LF/CRLF.
- OFX: fixture valida, conteudo falso renomeado, deteccao de banco, cartao, caracteres, duplicidade e arquivo invalido.
- Entrada HTTP: origem oficial, origem localhost negada em producao e JSON acima do limite.
- Autenticacao estatica/local: rota protegida sem token, token invalido, health, feature Gmail e excesso de tentativas de login.
- Segredos: varredura de formatos de JWT, secret key, connection string com senha e chave privada em arquivos rastreados.

## Itens nao executados

- teste A/B no Supabase remoto com dois usuarios reais;
- login e refresh reais contra o Supabase publicado;
- token expirado real, logout e recovery por e-mail no ambiente publicado;
- upload autenticado real acima de 5 MB e envio multipart com multiplos arquivos;
- inspecao do console/CSP no frontend publicado;
- inventario read-only das policies e grants efetivamente aplicados no banco remoto.

## Riscos e prioridades

| Prioridade | Risco | Tratamento |
| --- | --- | --- |
| P2 | migrations locais podem divergir do Supabase remoto | executar inventario remoto read-only e teste A/B antes do deploy |
| P2 | `service_role` contorna RLS em jobs internos | manter filtros de ownership e adicionar testes de regressao por recurso |
| P2 | sessao manual ainda fica no `localStorage` | risco inerente aceito temporariamente; migracao para cookies exige arquitetura coordenada |
| P3 | frontend carrega Supabase JS via CDN | versao exata fixada; avaliar bundle local/Vite futuramente |
| P3 | frontend sem lockfile nao permite `npm audit` | projeto estatico sem arvore NPM; controlar CDN por pinagem/CSP |

## Evidencias

- Auditoria RLS: `docs/security/rls_authorization_audit.md`.
- Testes de hardening: `test/securityHardening.test.js`, `test/inputSecurity.test.js` e `test/financeExperienceService.test.js`.
- Testes estaticos do frontend: `api-financas-frontend/test/security-static.test.mjs`.

## Criterio para liberar

Executar os itens remotos pendentes com dois usuarios de teste, confirmar que B nunca le ou altera IDs de A e repetir os fluxos autenticados/upload no ambiente alvo. Somente depois desse resultado o gate pode ser alterado para **APTO PARA DEPLOY**.
