# Migração para LógosType

Os arquivos `index.cjs`, `schema-composer.cjs` e `private-vault.cjs` foram convertidos para `src/*.type`. Os arquivos da raiz preservam os imports anteriores e encaminham para `dist/*.cjs`; declarações `.d.cts` dos subpaths foram preservadas.

A base ThinkIac deve fixar `@thinkiac/module-db` no commit publicado e manter fachadas em `vendor/packages/modules/db`, incluindo os dois subpaths. A dependência `runtime-compat` também está fixada em commit, sem referências a diretórios de repositórios vizinhos.

A conversão não altera dados, schemas, semântica de autorização ou transporte dos keyrings. O parser de modelos continua no Scriba. Para voltar à versão anterior, restaure a referência e reinstale as dependências com o lockfile correspondente; não restaure nem substitua bancos de produção como parte dessa operação.

Validação: testes originais, comparação dos schemas gerados e erros, tenants/documentos, eventos, derivação de chaves, falha de keyring e SQLCipher real. A instalação isolada valida as entradas distribuídas fora da árvore de desenvolvimento. A suíte do Lógos deve ser executada após a integração.
