# Contratos do db

## Biblioteca

`createDatabase(host)` retorna `loadScribaFrom`, `resolveDatabasePath`, `getScriba`, `addTenant`, `getProxy`, `getDocuments` e `install`.

O host fornece `applicationRoot()`, `dataDir()`, `composeSchema(dir)`, `appendLog(package, operation, error)`, `currentAuthority()`, `createVault(options)`, `openPrivateDatabase(filename, key)` e `log(message)`. O módulo adapta as portas do runtime para esse contrato, sem importar internals do Lógos.

`getProxy(tenant)` verifica autoridade na criação do proxy, como na versão anterior. `getDocuments(container, tenant)` verifica autoridade em cada chamada, valida a identidade e compartilha a abertura em andamento por tenant; falhas removem essa entrada para permitir nova tentativa. A instância Scriba é carregada uma vez, inclusive em caso de falha. Uma nova tentativa de carregamento exige outra instância de `createDatabase`.

Não há troca dinâmica do módulo (`swappable: false`). A posse e o encerramento das conexões continuam no Scriba; esta migração não acrescenta fechamento ou rollback que o original não tinha.

## Eventos

| Entrada | Efeito |
| --- | --- |
| `package:wiring` | Compõe schema e registra tenant uma única vez; prioridade 20 |
| `db:schema_changed` | Recompõe e chama `reloadTenantSchema`; prioridade 20 |
| `runtime:packages_wired` | Invoca `_injectGlobals` quando disponível |

Saídas: `db:schema_composed` contém `{pkg, sources}` com caminhos relativos ao pacote; falha de recarga emite `db:schema_compose_failed` com `{pkg, error}` e rejeita a chamada. Falhas de composição/abertura no wiring são registradas em log, preservando o comportamento anterior.

## Schemas

`composePackageSchema(dir)` retorna `{schema, outputPath, sources}` ou `null`. `schema.prisma` tem precedência; modelos são estendidos por campo e enums por valor. Fragmentos incompatíveis geram diagnóstico. Subdiretórios com `package.json` são limites de descoberta. A escrita usa arquivo temporário seguido de rename para `.logos/generated/db/schema.prisma`.

A composição é textual e preserva as limitações anteriores de comentários e gramática; não substitui o parser Scriba nem promete suporte completo ao Prisma.

## Isolamento

A capacidade `database(request, context)` exige `request.tenant === context.package`. Operação `index` exige strings `entity` e `key`, retorna apenas campos declarados do registro e aceita ausência de resultado. Demais operações exigem `entity`, `method` e array `args`. Métodos precisam existir. As verificações de autoridade permanecem no acesso ao proxy.

## Bancos privados

`PrivateVault` aceita `masterKeyProvider`, `passwordProvider`, `keyring` e `randomBytes`. O material mestre precisa ter pelo menos 32 bytes; HKDF SHA-256 deriva chaves por nome de pacote. Sem provedor ou keyring, falha com `PRIVATE_VAULT_UNAVAILABLE`. Windows exige adaptador explícito. Linux usa `secret-tool`; macOS usa `security`.

O adaptador macOS preserva a chamada anterior, que passa o valor de gravação ao argumento `-w`; esta migração não altera o transporte de segredos do keyring. Linux envia o valor de gravação por stdin. Nenhum fallback grava a chave em arquivo plaintext.

`openSqlCipherDatabase(path, key)` configura SQLCipher e verifica a abertura antes de retornar. O buffer é zerado tanto no sucesso quanto na falha. O chamador deve continuar apagando sua própria cópia quando usar outra factory.
