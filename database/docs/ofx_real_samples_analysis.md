# Analise Tecnica de OFX Reais - F04-E01

Data da analise local: 2026-08-02

Arquivos reais analisados localmente, sem versionamento:

- `NU_*******_01JUL2026_14JUL2026.ofx`
- `Extrato-15-06-2026-a-15-07-2026-OFX.ofx`

## Regras de protecao aplicadas

- os arquivos reais permaneceram fora do repositorio;
- nenhum OFX real foi copiado para fixtures;
- nenhum identificador de conta, FITID, saldo ou descricao sensivel foi registrado integralmente;
- nenhum arquivo real foi enviado ao Render;
- a validacao ocorreu apenas em ambiente local controlado.

## Comparativo mascarado

| Caracteristica | Nubank | Banco Inter |
|---|---|---|
| Formato | OFX SGML com varias tags em estilo XML fechado | OFX SGML com varias tags em estilo XML fechado |
| Versao | `102` | `102` |
| Encoding do cabecalho | `UTF-8` / `CHARSET:NONE` | `USASCII` / `CHARSET:1252` |
| Decodificacao local do parser | `utf8` | `utf8` sem perda detectada no arquivo analisado |
| Identificacao da instituicao | `ORG=NU PAGAMENTOS S.A.`, `FID=260`, `BANKID=0260` | `ORG=Banco Intermedium S/A`, `FID=077`, `BANKID=077` |
| Estrutura de conta | `BRANCHID` presente e `ACCTID` com mascara equivalente a `***0383` | `BRANCHID` presente e `ACCTID` com mascara equivalente a `*****2475` |
| ACCTTYPE | `CHECKING` | `CHECKING` |
| CURDEF | `BRL` | `BRL` |
| Periodo | datas com timezone `[-3:BRT]` | datas simples `YYYYMMDD`, sem timezone embutido |
| Saldo | `LEDGERBAL` presente; `AVAILBAL` nao identificado | `LEDGERBAL` presente; `AVAILBAL` nao identificado |
| Estrutura de datas das linhas | `DTPOSTED` com timezone `[-3:BRT]` | `DTPOSTED` simples `YYYYMMDD` |
| DTUSER | nao identificado nas linhas reais analisadas | nao identificado nas linhas reais analisadas |
| Identificador da transacao | `FITID` em formato UUID-like mascaravel como `aaaa...zzzz` | `FITID` numerico/alfanumerico compacto mascaravel como `2026...0771` |
| CHECKNUM | ausente nas linhas analisadas | presente nas linhas analisadas |
| REFNUM | ausente nas linhas analisadas | presente nas linhas analisadas |
| NAME | ausente nas linhas analisadas | presente na maior parte das linhas analisadas |
| MEMO | presente em todas as linhas analisadas | presente em todas as linhas analisadas |
| Sinal do valor | creditos positivos e debitos negativos coerentes | creditos positivos e debitos negativos coerentes |
| Tags adicionais | bloco `BALLIST/BAL/DESC/BALTYPE/VALUE` observado | `REFNUM` observado |
| Quantidade de lancamentos | validada localmente | validada localmente |

## Estrutura observada no Nubank

- arquivo com `OFXHEADER:100`, `DATA:OFXSGML` e `VERSION:102`;
- `DTSERVER` inclui timezone `GMT`, enquanto `DTSTART`, `DTEND` e `DTPOSTED` usam `[-3:BRT]`;
- transacoes dependem principalmente de:
  - `TRNTYPE`
  - `DTPOSTED`
  - `TRNAMT`
  - `FITID`
  - `MEMO`
- o campo `NAME` nao apareceu nas linhas reais observadas;
- o `MEMO` concentra a descricao operacional completa, incluindo contraparte e referencias bancarias;
- `CHECKNUM`, `REFNUM` e `DTUSER` nao apareceram nas linhas reais observadas;
- o parser local diferenciou corretamente o banco mesmo com `BANKID=0260`.

## Estrutura observada no Banco Inter

- arquivo com `OFXHEADER:100`, `DATA:OFXSGML` e `VERSION:102`;
- `DTSERVER`, `DTSTART`, `DTEND` e `DTPOSTED` vieram em formato compacto `YYYYMMDD`, sem timezone embutido;
- transacoes usam conjuntamente:
  - `TRNTYPE`
  - `DTPOSTED`
  - `TRNAMT`
  - `FITID`
  - `CHECKNUM`
  - `REFNUM`
  - `NAME`
  - `MEMO`
- `NAME` e `MEMO` coexistem e se complementam;
- foram observados cenarios de pagamento, compra em debito e Pix;
- o parser local diferenciou corretamente o banco por `ORG`, `FID` e `BANKID`.

## Diferencas estruturais relevantes

1. O Nubank observado concentra a descricao em `MEMO`, enquanto o Inter usa `NAME + MEMO`.
2. O Nubank observado usa `FITID` em formato UUID-like; o Inter usa identificador compacto.
3. O Inter observado fornece `CHECKNUM` e `REFNUM`; o Nubank observado nao.
4. O Nubank observado traz timezone explicito em parte das datas; o Inter observado nao.
5. O Inter observado manteve padrao mais tabular e repetitivo; o Nubank observado trouxe `MEMO` mais verboso e contextual.

## Resultado da validacao do parser local

- instituicao do Nubank: validada;
- instituicao do Banco Inter: validada;
- periodo do Nubank: validado;
- periodo do Banco Inter: validado;
- sinais de valores: validados em ambos;
- preservacao das descricoes: validada em ambos;
- leitura de FITID: validada em ambos;
- nenhuma linha reconhecivel foi perdida silenciosamente na execucao local observada.

## Ajustes derivados desta analise

- ampliacao do parser para expor `BRANCHID`, `REFNUM` e saldo disponivel quando presentes;
- ampliacao das fixtures sinteticas para cenarios de:
  - ausencia de FITID;
  - ausencia de MEMO;
  - caracteres especiais;
  - linhas duplicadas;
  - arquivo invalido;
- reforco do `.gitignore` do backend para `*.ofx` e amostras privadas locais.
