<div align="center">
  <img src="https://res.cloudinary.com/ddbfifdxd/image/upload/w_200,q_auto,f_auto/v1786386427/VS_logo_TextoAbaixo_yev4tq.png" alt="VSRepository Logo" width="200"/>

  <p style="margin-top: 12px;">
    <img src="https://img.shields.io/npm/v/@vsrepo/nestjs?style=flat-square" alt="npm version"/>
    <img src="https://img.shields.io/npm/l/@vsrepo/nestjs?style=flat-square" alt="npm license"/>
    <img src="https://img.shields.io/npm/dt/@vsrepo/nestjs?style=flat-square" alt="npm downloads"/>
    <img src="https://img.shields.io/badge/inspired%20by-Spring%20Data%20JPA-E6DB33F?style=flat-square" alt="inspired by Spring Data JPA"/>
  </p>
</div>

# VSRepositoryNestJS

🇧🇷 [Ler em português](./README.pt-BR.md)

> 🚧 **Early release.** `@vsrepo/nestjs` targets [VSRepository v3](https://github.com/VSRepository/VSRepository), which is still in development, so its API may change.

[NestJS](https://nestjs.com/) module for [VSRepository](https://github.com/VSRepository/VSRepository). It registers your database client and adapter once, hands each repository its adapter through dependency injection, supports several databases (contexts) in the same application, and adds a `@Transactional()` decorator so repositories share a transaction without passing `{ db: tx }` around.

It is ORM-agnostic, like VSRepository itself: it works with any `VSRepoAdapter`. The examples use [`@vsrepo/prisma7-adapter`](https://github.com/VSRepository/VSRepoPrisma7Adapter).

---

## Table of contents

- [Installation](#installation)
- [Basic usage](#basic-usage)
- [Registering the module](#registering-the-module)
    - [`forRoot`](#forroot)
    - [`forRootAsync`](#forrootasync)
    - [`forFeature`](#forfeature)
- [Repositories](#repositories)
    - [`VSRepositoryBase`](#vsrepositorybase)
    - [Without `VSRepositoryBase`](#without-vsrepositorybase)
- [Multiple contexts](#multiple-contexts)
- [Global config and `lazyConfig`](#global-config-and-lazyconfig)
- [Transactions](#transactions)
    - [`@Transactional`](#transactional)
    - [How it works](#how-it-works)
    - [Nesting and joining](#nesting-and-joining)
    - [Things to know](#things-to-know)
    - [`VSRepoTransactionManager`](#vsrepotransactionmanager)
- [Injection helpers](#injection-helpers)
- [Requirements](#requirements)
- [License](#license)

---

## Installation

```bash
npm install @vsrepo/nestjs vsrepo@dev @nestjs/common @nestjs/core
```

You also need an adapter for your ORM. With Prisma 7:

```bash
npm install @prisma/client @vsrepo/prisma7-adapter@dev
```

While VSRepository v3 is in development, install `vsrepo` and the adapter with the `dev` tag.

## Basic usage

Register the context once, in the root module:

```typescript
import { Module } from "@nestjs/common";
import { VSRepositoryModule } from "@vsrepo/nestjs";
import { Prisma7Adapter } from "@vsrepo/prisma7-adapter";
import { prisma } from "./prisma";

@Module({
    imports: [VSRepositoryModule.forRoot({ adapter: Prisma7Adapter, dbClient: prisma }), UserModule],
})
export class AppModule {}
```

Provide the adapter of each entity in the module that owns it:

```typescript
@Module({
    imports: [VSRepositoryModule.forFeature<Prisma7Adapter<User>>("User", { modelName: "user", pkName: "id" })],
    providers: [UserRepository, UserService],
})
export class UserModule {}
```

Extend `VSRepositoryBase` to get the adapter and the config injected:

```typescript
import { Injectable } from "@nestjs/common";
import { DynamicMethod, type MethodOptions } from "vsrepo";
import { VSRepositoryBase } from "@vsrepo/nestjs";
import type { User } from "./generated/prisma/client";

@Injectable()
export class UserRepository extends VSRepositoryBase<User, string>({ entityName: "User" }) {
    @DynamicMethod()
    declare findByEmail: (email: string, options?: MethodOptions<User>) => Promise<User[]>;
}
```

And use it like any other provider:

```typescript
@Injectable()
export class UserService {
    constructor(private readonly userRepository: UserRepository) {}

    findByEmail(email: string) {
        return this.userRepository.findByEmail(email, { relations: { posts: true } });
    }
}
```

## Registering the module

A **context** is a database. The default context has no name; extra ones are told apart by `contextName` (see [Multiple contexts](#multiple-contexts)).

### `forRoot`

```typescript
VSRepositoryModule.forRoot({
    adapter: Prisma7Adapter, // the adapter class (not an instance)
    dbClient: prisma, // typed from the adapter's constructor
    adapterConfig: { logLevel: VSLogLevel.WARN }, // optional — typed from the adapter's static setGlobalConfig
    contextName: "reporting", // optional — omit for the default context
    lazyConfig: false, // optional — see "Global config and lazyConfig"
    logLevel: VSLogLevel.WARN, // optional — any VSRepoGlobalConfig option
});
```

Besides the fields above, `forRoot` accepts every [`VSRepoGlobalConfig`](https://github.com/VSRepository/VSRepository/blob/main/docs/base-methods.md) option. The module is **global**: import it once and the context is available everywhere.

### `forRootAsync`

Same as `forRoot`, with the options coming from a factory, so they can depend on other providers:

```typescript
VSRepositoryModule.forRootAsync({
    imports: [PrismaModule],
    inject: [PrismaService],
    useFactory: (prisma: PrismaService) => ({
        adapter: Prisma7Adapter,
        dbClient: prisma,
    }),
});
```

With `useClass`/`useExisting`, the class implements `VSRepositoryOptionsFactory` and returns the options from `createVSRepositoryOptions()`. `contextName` goes on `forRootAsync` itself, not on what the factory returns.

### `forFeature`

`forFeature` provides the adapter of an entity. The adapter is created with the db client of the context and is [transaction-aware](#how-it-works).

```typescript
// named: one adapter per entity, injected with @InjectAdapter("User")
VSRepositoryModule.forFeature<Prisma7Adapter<User>>("User", { modelName: "user", pkName: "id" });

// named, in a non-default context
VSRepositoryModule.forFeature<Prisma7Adapter<User>>("User", { modelName: "user", pkName: "id" }, "reporting");

// unnamed: a single adapter for the module, injected with @InjectAdapter()
VSRepositoryModule.forFeature<Prisma7Adapter<User>>({ modelName: "user", pkName: "id" });
```

The `config` is the adapter's own constructor config. The unnamed form is a shortcut for modules with a single entity; inject it with `@InjectAdapter()` (or as `VSRepoAdapter`). A module can have only one unnamed adapter, so use named ones when it has several entities.

#### The generic

The type argument is the **adapter type**: the same class registered in `forRoot`. It exists to type `config`.

```typescript
VSRepositoryModule.forFeature<Prisma7Adapter<User>>("User", { modelName: "user", pkName: "id" });
```

The generic is **compile-time only**: at runtime the adapter class still comes from `forRoot`, and `config` is passed through unchanged. It works with the unnamed form too: `forFeature<Prisma7Adapter<User>>({ modelName: "user", pkName: "id" })`.

If you omit it, TypeScript falls back to the constraint, `VSRepoAdapter`, whose `configType` is `any`.

## Repositories

### `VSRepositoryBase`

`VSRepositoryBase<Entity, PK>(options?)` returns a base class to extend instead of `VSRepository`. It injects the adapter and the `VSRepository` config of the context, so the repository needs no constructor and no `@Inject`.

```typescript
// the adapter of forFeature("User", ...)
class UserRepository extends VSRepositoryBase<User, string>({ entityName: "User" }) {}

// the unnamed adapter of forFeature({ ... })
class UserRepository extends VSRepositoryBase<User, string>() {}

// a named adapter of another context
class UserRepository extends VSRepositoryBase<User, string>({ entityName: "User", contextName: "reporting" }) {}
```

The options are the [`VSRepoConfig`](https://github.com/VSRepository/VSRepository/blob/main/docs/base-methods.md) options of the repository (`pkName`, `defaultOrdering`, `logLevel`, ...) plus `entityName` and `contextName`:

- `entityName` picks the adapter: omit it to inject the unnamed one.
- The config comes from the module, and the options you pass win over it.
- The adapter is always the injected one.
- With `lazyDynamicMethods`, the dynamic and query methods are resolved on `onModuleInit`. A subclass that overrides `onModuleInit` must call `super.onModuleInit()` or `this.resolveDynamicMethods()`.
- A subclass can declare its own constructor to inject more dependencies. It receives the adapter and the config and passes them to `super`:

```typescript
@Injectable()
class UserRepository extends VSRepositoryBase<User, string>() {
    constructor(
        @InjectVSRepoConfig() config: VSRepoGlobalConfig,
        adapter: VSRepoAdapter<User>,
        private readonly clock: Clock,
    ) {
        super(adapter, config);
    }
}
```

### Without `VSRepositoryBase`

Extending `VSRepository` directly also works. Inject the adapter, and the config if you use `lazyConfig`:

```typescript
@Injectable()
class UserRepository extends VSRepository<User, string> {
    constructor(adapter: VSRepoAdapter<User>, @InjectVSRepoConfig() config: VSRepoGlobalConfig) {
        super({ ...config, adapter });
    }
}
```

## Multiple contexts

Give each extra database its own `contextName`, in `forRoot`, in `forFeature` and wherever you inject:

```typescript
@Module({
    imports: [
        VSRepositoryModule.forRoot({ adapter: Prisma7Adapter, dbClient: mainPrisma, lazyConfig: true }),
        VSRepositoryModule.forRoot({
            adapter: Prisma7Adapter,
            dbClient: reportingPrisma,
            contextName: "reporting",
            lazyConfig: true,
        }),
    ],
})
export class AppModule {}

@Module({
    imports: [
        VSRepositoryModule.forFeature<Prisma7Adapter<User>>("User", { modelName: "user", pkName: "id" }),
        VSRepositoryModule.forFeature<Prisma7Adapter<UserReporting>>(
            "User",
            { modelName: "user", pkName: "id" },
            "reporting",
        ),
    ],
    providers: [UserRepository, ReportingUserRepository],
})
export class UserModule {}

class UserRepository extends VSRepositoryBase<User, string>({ entityName: "User" }) {}
class ReportingUserRepository extends VSRepositoryBase<User, string>({
    entityName: "User",
    contextName: "reporting",
}) {}
```

## Global config and `lazyConfig`

By default (`lazyConfig` omitted or `false`), `forRoot` applies its config through the **static** `VSRepository.setGlobalConfig()` and the adapter's `setGlobalConfig()`, when the module initializes and before any repository is created. That is what most applications want: configure once, every repository follows.

The catch is that this configuration is process-wide and each call **replaces** the previous one. With several contexts, the last one initialized wins. With `lazyConfig: true`, nothing static is touched. Instead:

- the `VSRepository` config of the context is provided through `@InjectVSRepoConfig()` (`VSRepositoryBase` uses it for you; a plain `VSRepository` subclass has to spread it into its `super` call);
- `adapterConfig` is merged into the config of each adapter created by `forFeature`, and the entity's own config wins over it.

## Transactions

### `@Transactional`

```typescript
import { VSRepoIsolationLevel } from "vsrepo";
import { Transactional } from "@vsrepo/nestjs";

@Injectable()
export class OrderService {
    constructor(
        private readonly orderRepository: OrderRepository,
        private readonly itemRepository: ItemRepository,
    ) {}

    @Transactional({ isolationLevel: VSRepoIsolationLevel.SERIALIZABLE })
    async checkout(dto: CheckoutDto) {
        const order = await this.orderRepository.create(dto.order, { select: { id: true } }); // no { db: tx }
        await this.itemRepository.createMany(dto.items.map(item => ({ ...item, orderId: order.id })));
    }
}
```

Every `VSRepository` call made while the method runs uses the transaction: base methods, dynamic methods, `query()` and the query builders, in any repository of the context. Other options (`select`, `relations`, `order`, `pagination`, ...) work as usual. The transaction commits when the method resolves and rolls back when it throws.

Options: `isolationLevel` and `timeoutMs` (the usual `VSRepoTransactionOptions`) and `contextName`, to choose the context (default: the default context).

### How it works

The core fills `options.db` with `adapter.getDbClient()` whenever a call doesn't pass one. `forFeature` makes every adapter it creates transaction-aware: inside a `@Transactional` scope, `getDbClient()` returns the transaction client, and `runInTransaction()` (that is, `repository.transaction()`) joins the active transaction instead of opening another. The active transaction is tracked per async flow with `AsyncLocalStorage`, so concurrent requests never share one. Nothing changes outside a scope.

The transaction itself is opened by the adapter class's static `execInTransaction(dbClient, fn, options)`, straight from the db client of the context, so no adapter instance (and no `forFeature`) is needed. It is an optional hook of `VSRepoAdapter` (the Prisma 7 adapter implements it): `@Transactional` and `manager.run()` require it, and throw an error explaining it when the adapter doesn't have it.

An explicit `db` always wins over the active transaction: `{ db: prisma }` runs outside of it, on purpose.

### Nesting and joining

- A `@Transactional` method called inside another one **joins** the active transaction of that context. The `isolationLevel` and `timeoutMs` of the inner method are ignored: the outer ones apply.
- There are no savepoints. If the inner method throws and the outer one catches the error, what the inner one wrote is still committed (unless the database aborted the transaction).
- A method without `@Transactional` called from inside a transactional one runs in the same transaction.
- Called from outside a transaction, a `@Transactional` method opens its own, and the transaction ends when it does. Two transactional methods called in sequence by a non-transactional one are two separate transactions: to make them atomic, make the caller `@Transactional` too.
- Contexts are independent: a `@Transactional({ contextName: "reporting" })` method opens a transaction on that database only. There is no atomicity across databases.

### Things to know

- **`getDbClient()` changes meaning inside a scope.** It is documented as the client used outside of transactions; inside `@Transactional` it returns the transaction client.
- **The method becomes asynchronous.** A synchronous method decorated with `@Transactional` returns a promise.
- **Don't leave work running.** Promises that aren't awaited and keep running after the method returns would use a transaction that has already ended.
- **Only repositories take part.** A db client used directly (e.g. `prisma.user.findMany()`) doesn't. Read the transaction with `VSRepoTransactionManager.current()` if you need it.
- **The adapter must implement `execInTransaction`.** When the adapter class doesn't have the static hook, `@Transactional` and `manager.run()` throw an error explaining it, without running the method. Everything else in the module, `repository.transaction()` included, works with any adapter.
- **Timeouts are the ORM's.** Without `timeoutMs`, the ORM's default applies (Prisma interactive transactions default to 5 seconds).
- **It works with other Nest decorators.** `@Transactional()` keeps the metadata that decorators like `@Get()` or `@UseGuards()` put on the method.

### `VSRepoTransactionManager`

Each context has a manager, created by `forRoot`/`forRootAsync`, for the cases where a decorator doesn't fit:

```typescript
@Injectable()
export class ImportService {
    constructor(
        private readonly transactionManager: VSRepoTransactionManager,
        private readonly userRepository: UserRepository,
    ) {}

    async importAll(rows: UserRow[]) {
        await this.transactionManager.run(async () => {
            for (const row of rows) await this.userRepository.save(row);
        });
    }
}
```

In the default context the manager is provided under the `VSRepoTransactionManager` class itself, so it can be injected by type. For a named context, use `@InjectTransactionManager("context")`.

| Member              | Description                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `run(fn, options?)` | Runs `fn` in a transaction (or joins the active one) and returns what it returns.                           |
| `current()`         | The transaction client active in the current async flow, or `undefined` outside of a transaction.           |
| `attach(adapter)`   | Makes an adapter transaction-aware. `forFeature` does it for you; use it only for adapters created by hand. |

## Injection helpers

| Decorator                         | Injects                                                                   | Token function                     |
| --------------------------------- | ------------------------------------------------------------------------- | ---------------------------------- |
| `@InjectAdapter(entity?, ctx?)`   | The adapter of an entity, or the unnamed adapter when `entity` is omitted | `getAdapterToken(entity?, ctx?)`   |
| `@InjectDbClient(ctx?)`           | The db client given to `forRoot`                                          | `getDbClientToken(ctx?)`           |
| `@InjectVSRepoConfig(ctx?)`       | The `VSRepoGlobalConfig` built from the module options                    | `getVSRepoConfigToken(ctx?)`       |
| `@InjectTransactionManager(ctx?)` | The `VSRepoTransactionManager` of the context                             | `getTransactionManagerToken(ctx?)` |

`ctx` is the `contextName`; omit it for the default context.

## Requirements

- Node.js `>=22`
- `@nestjs/common` and `@nestjs/core` `^11.0.5 || ^12.0.0`
- `vsrepo` `^3.0.0-dev.5`
- An adapter for your database, such as [`@vsrepo/prisma7-adapter`](https://github.com/VSRepository/VSRepoPrisma7Adapter)
- To use `@Transactional`, an adapter that implements the static `execInTransaction` (the Prisma 7 adapter does)
- `experimentalDecorators` enabled in your `tsconfig.json`

## License

[MIT](./LICENSE)
