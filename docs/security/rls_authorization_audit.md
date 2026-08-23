# Auditoria de RLS e autorizacao

Data da auditoria local: 2026-08-23

## Escopo e conclusao

A auditoria foi executada sobre as migrations e os fluxos locais do backend. Nenhuma policy foi alterada, nenhuma migration foi aplicada e nenhum banco remoto foi acessado. O desenho local mantem RLS nos dados financeiros e vincula o ownership ao `users.id` resolvido pelo `sub` do JWT por `current_app_user_id()`.

Nao foi identificado bypass P0/P1 no estado local. A liberacao para deploy permanece condicionada ao teste com dois usuarios reais no projeto Supabase, pois a existencia e a configuracao efetiva das policies no banco remoto nao foram verificadas nesta auditoria.

## Inventario por ownership

| Objeto | Proprietario | RLS | Operacoes autenticadas | Condicao principal | Grants locais | Acesso elevado relevante |
| --- | --- | --- | --- | --- | --- | --- |
| `users` | proprio registro via `auth_subject` | habilitada | SELECT; UPDATE limitado a `display_name,email` | `id = current_app_user_id()` | SELECT e UPDATE por coluna | resolucao interna de usuario |
| `user_settings` | `user_id` | habilitada | SELECT, INSERT, UPDATE, DELETE | `user_id = current_app_user_id()` em `USING`/`WITH CHECK` | CRUD | criacao/sincronizacao delimitada pelo usuario resolvido |
| `financial_accounts` | `user_id` | habilitada | SELECT, INSERT, UPDATE, DELETE | ownership direto | CRUD | Gmail/IMAP consulta com `.eq(user_id)` |
| `cards` | `user_id` | habilitada | SELECT, INSERT, UPDATE, DELETE | ownership direto | CRUD | nenhum fluxo elevado comum localizado |
| `counterparties` | `user_id` | habilitada | SELECT, INSERT, UPDATE, DELETE | ownership direto | CRUD | classificacao cria contraparte com `appUserId` resolvido |
| `categories` | `user_id`; categorias globais usam `NULL` | habilitada | SELECT, INSERT, UPDATE, DELETE | propria ou global na leitura; escrita somente propria | CRUD | busca elevada restrita a categoria global de salario |
| `imports` | `user_id` | habilitada | SELECT, INSERT, UPDATE | ownership direto | sem DELETE | confirmacao atualiza somente importacao previamente validada como propria |
| `import_files` | importacao pai | habilitada | SELECT, INSERT, UPDATE | `EXISTS` em `imports` do usuario | sem DELETE | IMAP verifica hash com importacao e usuario associados |
| `import_rows` | importacao pai | habilitada | SELECT, INSERT, UPDATE | `EXISTS` em `imports` do usuario | sem DELETE | confirmacao atualiza linhas obtidas da importacao propria |
| `transactions` | `user_id` | habilitada | SELECT, INSERT, UPDATE | ownership direto e referencias pertencentes ao usuario | sem DELETE | categorizacao/importacao sempre filtram `user_id` |
| `reconciliations` | `user_id` | habilitada | SELECT, INSERT, UPDATE | ownership direto | sem DELETE | nenhum fluxo elevado comum localizado |
| `reconciliation_items` | reconciliacao pai | habilitada | SELECT, INSERT, UPDATE | `EXISTS` em reconciliacao e transacao proprias | sem DELETE | nenhum fluxo elevado comum localizado |
| `audit_events` | `user_id` | habilitada | sem acesso direto autenticado | ownership direto para leitura prevista em policy | nenhum grant autenticado | service role apenas |
| `gmail_integrations` | `user_id` | habilitada | policies CRUD, sem grants diretos | ownership direto | apenas service role | automacao interna e rotas autenticadas delimitam usuario |
| `gmail_messages` | `user_id` | habilitada | policies CRUD, sem grants diretos | ownership + integracao/importacao do mesmo usuario | apenas service role | job interno usa owner configurado e filtros de usuario |
| `installment_plans` | `user_id` | habilitada | SELECT, INSERT, UPDATE | ownership direto | SELECT/INSERT/UPDATE | fluxo autenticado usa client do usuario |
| `installment_plan_items` | plano pai | habilitada | SELECT, INSERT, UPDATE | plano e transacao pertencentes ao usuario | SELECT/INSERT/UPDATE | fluxo autenticado usa client do usuario |
| `transaction_classification_rules` | `user_id` | habilitada | SELECT, INSERT, UPDATE | ownership direto | SELECT/INSERT/UPDATE | regra padrao e contraparte usam `appUserId` resolvido |
| `financial_institutions` | catalogo global | habilitada | SELECT | leitura global ativa; escrita administrativa | SELECT | escrita global via service role no cadastro administrativo |

As views financeiras possuem `security_invoker = true` e grant apenas de SELECT para `authenticated`/`service_role`, herdando as policies das tabelas base.

## Funcoes e privilegios

- `current_app_user_id()` e `SECURITY DEFINER`, possui `search_path = public, pg_temp`, resolve apenas usuario Supabase ativo pelo `sub` do JWT e teve EXECUTE revogado de `PUBLIC`/`anon`.
- `fn_set_updated_at()` possui `search_path` fixado por migration posterior e e usado somente em triggers de timestamp.
- Nao foram localizadas RPCs publicas de negocio que aceitem `user_id` arbitrario.
- A `service_role` permanece exclusiva do backend. Os fluxos elevados localizados delimitam o usuario antes das consultas/escritas; ela nao deve ser exposta ao frontend.

## Achados

| Objeto | Operacao | Risco/evidencia | Exploracao possivel | Correcao recomendada | Prioridade |
| --- | --- | --- | --- | --- | --- |
| Banco Supabase remoto | todas | policies/grants efetivos nao foram consultados nesta execucao | divergencia entre migrations locais e banco implantado | executar inventario read-only e teste A/B antes do deploy | P2 |
| Fluxos com `service_role` | escrita | RLS e contornada por definicao; seguranca depende dos filtros de ownership do servico | regressao futura pode omitir `.eq(user_id)` | manter testes de ownership e encapsular operacoes elevadas | P2 |
| `financial_institutions` | SELECT | policy global permite leitura por todos os autenticados | somente enumeracao do catalogo global aprovado | documentar natureza global e impedir dados pessoais nessa tabela | P3 |
| Gmail | CRUD | policies existem, mas authenticated nao recebe grants; acesso e intencionalmente mediado pelo backend | nenhum acesso direto; risco concentrado no backend | manter sem grants diretos e testar endpoints com usuario B | P3 |
| Tabelas F05 | DELETE | grants/policies de DELETE nao existem | usuario nao consegue excluir fisicamente | manter arquivamento por UPDATE ou documentar explicitamente | P3 |

## Teste conceitual A/B

Pelo desenho das policies, o usuario B nao deve conseguir selecionar, enumerar, atualizar ou referenciar IDs do usuario A. `INSERT` e `UPDATE` possuem `WITH CHECK` nas tabelas com ownership direto; tabelas filhas validam o ownership do pai e das referencias. O usuario A tambem nao deve conseguir gravar `user_id` de B.

O teste real ainda deve usar dois usuarios de teste e tokens distintos para cobrir GET, POST, PATCH e DELETE/arquivamento em contas, categorias, contrapartes, importacoes, transacoes, reconciliacoes, parcelamentos e regras. Para IDs de A, o resultado aceito para B e 403, 404 ou conjunto vazio, nunca dados ou alteracao.

## Migration corretiva

Nenhuma migration corretiva foi criada nesta auditoria porque nao foi encontrado defeito local que justifique alteracao de policy. Se o inventario remoto divergir das migrations, a correcao deve ser criada em uma nova migration, sem editar migrations anteriores.
