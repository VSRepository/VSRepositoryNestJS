# Changelog

All notable changes to this project will be documented in this file.

(Português) Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

---

## [Unreleased]

First release of `@vsrepo/nestjs`, the NestJS module for [VSRepository v3](https://github.com/VSRepository/VSRepository).

### Added

- **`VSRepositoryModule`** with `forRoot`, `forRootAsync` (`useFactory`, `useClass` and `useExisting`) and `forFeature`. `forRoot`/`forRootAsync` register a context (its db client and adapter class) as a global module, and `forFeature` provides the adapter of each entity, either named (`forFeature(entityName, config)`) or as the single unnamed adapter of the module (`forFeature(config)`)
- **Multiple contexts.** Every entry point accepts a `contextName`, so several databases can live in the same application. The default context has no name
- **`lazyConfig`.** By default the module applies its config through the static `VSRepository.setGlobalConfig()` and the adapter's `setGlobalConfig()`. With `lazyConfig: true` nothing static is touched, so contexts don't override each other: the `VSRepository` config is injected with `@InjectVSRepoConfig()` and `adapterConfig` is merged into each adapter created by `forFeature`
- **`VSRepositoryBase`**, a base class for repositories that injects the adapter and the `VSRepository` config of the context, merges the options passed to it over the module config, never lets the options replace the injected adapter, and resolves the dynamic and query methods on `onModuleInit` when `lazyDynamicMethods` is on
- **`@Transactional`** and **`VSRepoTransactionManager`**. Repositories of a context share the transaction opened by a `@Transactional` method, without passing `{ db: tx }`, and keep working with `select`, `relations` and the other options. A nested `@Transactional` method joins the active transaction, `repository.transaction()` joins it too, and an explicit `db` still wins. Transactions are tracked per async flow (`AsyncLocalStorage`), and each context has its own manager, injectable with `@InjectTransactionManager()`
- **Injection helpers:** `InjectAdapter`, `InjectDbClient`, `InjectVSRepoConfig` and `InjectTransactionManager`, with the matching token functions (`getAdapterToken`, `getAdapterClassToken`, `getVSRepoModuleOptionsToken`, `getDbClientToken`, `getVSRepoConfigToken` and `getTransactionManagerToken`)
- **Typed options.** `dbClient` and `adapterConfig` are typed from the adapter class given to the module
- JSDoc (`@publicApi`) on the whole public API, README (EN and pt-BR) and unit tests for `@Transactional` and `VSRepositoryBase`

---

## [Unreleased] (Português)

Primeira release do `@vsrepo/nestjs`, o módulo NestJS do [VSRepository v3](https://github.com/VSRepository/VSRepository).

### Adicionado

- **`VSRepositoryModule`** com `forRoot`, `forRootAsync` (`useFactory`, `useClass` e `useExisting`) e `forFeature`. O `forRoot`/`forRootAsync` registram um contexto (o db client e a classe do adapter) como um módulo global, e o `forFeature` fornece o adapter de cada entidade, nomeado (`forFeature(entityName, config)`) ou como o único adapter sem nome do módulo (`forFeature(config)`)
- **Múltiplos contextos.** Todo ponto de entrada aceita um `contextName`, então vários bancos podem conviver na mesma aplicação. O contexto padrão não tem nome
- **`lazyConfig`.** Por padrão o módulo aplica a config pelo `VSRepository.setGlobalConfig()` estático e pelo `setGlobalConfig()` do adapter. Com `lazyConfig: true` nada estático é tocado, então os contextos não se sobrescrevem: a config do `VSRepository` é injetada com `@InjectVSRepoConfig()` e o `adapterConfig` é mesclado em cada adapter criado pelo `forFeature`
- **`VSRepositoryBase`**, uma classe base para repositories que injeta o adapter e a config do `VSRepository` do contexto, mescla as opções recebidas por cima da config do módulo, nunca deixa as opções substituírem o adapter injetado e resolve os dynamic e query methods no `onModuleInit` quando o `lazyDynamicMethods` está ligado
- **`@Transactional`** e **`VSRepoTransactionManager`**. Os repositories de um contexto compartilham a transação aberta por um método `@Transactional`, sem passar `{ db: tx }`, e continuam funcionando com `select`, `relations` e as demais opções. Um método `@Transactional` aninhado participa da transação ativa, o `repository.transaction()` também participa, e um `db` explícito continua tendo prioridade. As transações são rastreadas por fluxo assíncrono (`AsyncLocalStorage`), e cada contexto tem o seu manager, injetável com `@InjectTransactionManager()`
- **Helpers de injeção:** `InjectAdapter`, `InjectDbClient`, `InjectVSRepoConfig` e `InjectTransactionManager`, com as funções de token correspondentes (`getAdapterToken`, `getAdapterClassToken`, `getVSRepoModuleOptionsToken`, `getDbClientToken`, `getVSRepoConfigToken` e `getTransactionManagerToken`)
- **Opções tipadas.** O `dbClient` e o `adapterConfig` são tipados a partir da classe do adapter passada ao módulo
- JSDoc (`@publicApi`) em toda a API pública, README (EN e pt-BR) e testes unitários do `@Transactional` e do `VSRepositoryBase`

---
