# @thinkiac/module-db

Capacidade de persistência Scriba do Lógos, implementada em três fontes LógosType `.type`. Migração do módulo incorporado do ThinkIac, preservando seus contratos e entradas CommonJS.

```sh
npm install ThinkIac/db#main
```

Em produção, fixe um commit. A instalação Git compila `src/*.type` para `dist/*.cjs` usando [LogosType](https://github.com/ThinkIac/LogosType). O artefato npm inclui o código compilado; consumidores não precisam carregar o compilador.

## Recursos preservados

- Carregamento preguiçoso de Scriba a partir da aplicação e validação de sua API.
- Banco por pacote, no diretório do pacote ou em `<dataDir>/db/<pacote>/.database`.
- Composição de `.scriba`, `.schema` e `.prisma`, respeitando limites de pacotes aninhados.
- Registro inicial e recarga de schemas por eventos.
- Proxies de entidades e documentos, com verificação de autoridade.
- Capacidade mediada para pacotes isolados, limitada ao banco do próprio pacote.
- Bancos privados com SQLCipher, chave derivada por pacote e limpeza dos buffers.

## Composição

O host Lógos seleciona o módulo com `externalModules: ['@thinkiac/module-db']`. A aplicação deve instalar uma versão compatível de `scriba`, que fornece `addTenant`, `entity`, `tenants` e, para documentos, `documents`. O pacote npm homônimo pode ter API diferente; valide o provedor Scriba da sua distribuição.

O registro declarativo `module db` está preservado no código compilado. `provideDb(host)`, `createRuntimeModule(host)` e `createHost(...)` continuam disponíveis para consumidores anteriores.

```js
const { createDatabase } = require('@thinkiac/module-db');
const db = createDatabase(host);
db.addTenant({ packageName: 'customers', dir: '/workspace/customers' });
const users = db.getProxy('customers').User;
```

O `host` injeta caminhos, composição de schema, autoridade, vault e logs; veja [contratos](docs/contracts.md). Em arquivos `.type` executados pelo Lógos, a resolução transparente de `User[ID]` pertence à integração de modelos do launcher e continua usando esta capacidade de persistência.

## Desenvolvimento

```sh
npm ci
npm test
npm run test:isolated
```

Os testes comparam comportamento com os três arquivos anteriores preservados em `test/reference/` e exercitam SQLCipher real. Esses arquivos de referência não fazem parte do artefato publicado.

Node mínimo declarado: 22, conforme o driver `better-sqlite3-multiple-ciphers` 13 já usado pelo módulo de origem. A CI verifica Node 22 e 24.

Esta migração mantém `fs`, `path`, processos do keyring, Buffer, criptografia Node e driver SQLite nativo. Não demonstra portabilidade para QuickJS/ESP32. Nenhum schema ou banco da aplicação é migrado durante a instalação do pacote.

Veja [contratos e limites](docs/contracts.md) e [migração](docs/migration.md). Licença MIT.
