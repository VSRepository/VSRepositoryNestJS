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

🇺🇸 [Read in English](./README.md)

> 🚧 **Versão inicial.** O `@vsrepo/nestjs` é feito para o [VSRepository v3](https://github.com/VSRepository/VSRepository), que ainda está em desenvolvimento, então a API pode mudar.

Módulo [NestJS](https://nestjs.com/) para o [VSRepository](https://github.com/VSRepository/VSRepository). Ele registra o client do banco e o adapter uma única vez, entrega a cada repository o seu adapter por injeção de dependência, suporta vários bancos (contextos) na mesma aplicação e traz um decorator `@Transactional()` para que os repositories compartilhem uma transação sem precisar passar `{ db: tx }` para todo lado.

Ele é agnóstico de ORM, como o próprio VSRepository: funciona com qualquer `VSRepoAdapter`. Os exemplos usam o [`@vsrepo/prisma7-adapter`](https://github.com/VSRepository/VSRepoPrisma7Adapter).

---

## Sumário

- [Instalação](#instalação)
- [Uso básico](#uso-básico)
- [Registrando o módulo](#registrando-o-módulo)
    - [`forRoot`](#forroot)
    - [`forRootAsync`](#forrootasync)
    - [`forFeature`](#forfeature)
- [Repositories](#repositories)
    - [`VSRepositoryBase`](#vsrepositorybase)
    - [Sem o `VSRepositoryBase`](#sem-o-vsrepositorybase)
- [Múltiplos contextos](#múltiplos-contextos)
- [Config global e `lazyConfig`](#config-global-e-lazyconfig)
- [Transações](#transações)
    - [`@Transactional`](#transactional)
    - [Como funciona](#como-funciona)
    - [Aninhamento e participação](#aninhamento-e-participação)
    - [O que você precisa saber](#o-que-você-precisa-saber)
    - [`VSRepoTransactionManager`](#vsrepotransactionmanager)
- [Helpers de injeção](#helpers-de-injeção)
- [Requisitos](#requisitos)
- [Licença](#licença)

---

## Instalação

```bash
npm install @vsrepo/nestjs vsrepo@dev @nestjs/common @nestjs/core
```

Você também precisa de um adapter para o seu ORM. Com Prisma 7:

```bash
npm install @prisma/client @vsrepo/prisma7-adapter@dev
```

Enquanto o VSRepository v3 está em desenvolvimento, instale o `vsrepo` e o adapter com a tag `dev`.

## Uso básico

Registre o contexto uma única vez, no módulo raiz:

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

Forneça o adapter de cada entidade no módulo que é dono dela:

```typescript
@Module({
    imports: [VSRepositoryModule.forFeature<Prisma7Adapter<User>>("User", { modelName: "user", pkName: "id" })],
    providers: [UserRepository, UserService],
})
export class UserModule {}
```

Estenda o `VSRepositoryBase` para ter o adapter e a config injetados:

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

E use como qualquer outro provider:

```typescript
@Injectable()
export class UserService {
    constructor(private readonly userRepository: UserRepository) {}

    findByEmail(email: string) {
        return this.userRepository.findByEmail(email, { relations: { posts: true } });
    }
}
```

## Registrando o módulo

Um **contexto** é um banco de dados. O contexto padrão não tem nome; os extras se distinguem pelo `contextName` (veja [Múltiplos contextos](#múltiplos-contextos)).

### `forRoot`

```typescript
VSRepositoryModule.forRoot({
    adapter: Prisma7Adapter, // a classe do adapter (não uma instância)
    dbClient: prisma, // tipado a partir do construtor do adapter
    adapterConfig: { logLevel: VSLogLevel.WARN }, // opcional — tipado a partir do setGlobalConfig estático do adapter
    contextName: "reporting", // opcional — omita para o contexto padrão
    lazyConfig: false, // opcional — veja "Config global e lazyConfig"
    logLevel: VSLogLevel.WARN, // opcional — qualquer opção do VSRepoGlobalConfig
});
```

Além dos campos acima, o `forRoot` aceita todas as opções do [`VSRepoGlobalConfig`](https://github.com/VSRepository/VSRepository/blob/main/docs/base-methods.pt-BR.md). O módulo é **global**: importe uma vez e o contexto fica disponível em toda a aplicação.

### `forRootAsync`

Igual ao `forRoot`, com as opções vindo de uma factory, para poderem depender de outros providers:

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

Com `useClass`/`useExisting`, a classe implementa `VSRepositoryOptionsFactory` e devolve as opções em `createVSRepositoryOptions()`. O `contextName` vai no próprio `forRootAsync`, não no que a factory retorna.

### `forFeature`

O `forFeature` fornece o adapter de uma entidade. O adapter é criado com o db client do contexto e [sabe participar de transações](#como-funciona).

```typescript
// nomeado: um adapter por entidade, injetado com @InjectAdapter("User")
VSRepositoryModule.forFeature<Prisma7Adapter<User>>("User", { modelName: "user", pkName: "id" });

// nomeado, em um contexto que não é o padrão
VSRepositoryModule.forFeature<Prisma7Adapter<User>>("User", { modelName: "user", pkName: "id" }, "reporting");

// sem nome: um único adapter para o módulo, injetado com @InjectAdapter()
VSRepositoryModule.forFeature<Prisma7Adapter<User>>({ modelName: "user", pkName: "id" });
```

O `config` é a config do construtor do próprio adapter. A forma sem nome é um atalho para módulos com uma única entidade; injete-a com `@InjectAdapter()` (ou como `VSRepoAdapter`). Um módulo só pode ter um adapter sem nome, então use os nomeados quando houver várias entidades.

#### A generic

O argumento de tipo é o **tipo do adapter**: a mesma classe registrada no `forRoot`. Ele existe para tipar o `config`.

```typescript
VSRepositoryModule.forFeature<Prisma7Adapter<User>>("User", { modelName: "user", pkName: "id" });
```

A generic é **só de compilação**: em runtime a classe do adapter continua vindo do `forRoot`, e o `config` é repassado sem alteração. Ele também funciona na forma sem nome: `forFeature<Prisma7Adapter<User>>({ modelName: "user", pkName: "id" })`.

Se você omitir, o TypeScript cai na restrição, `VSRepoAdapter`, cujo `configType` é `any`.

## Repositories

### `VSRepositoryBase`

`VSRepositoryBase<Entity, PK>(options?)` devolve uma classe base para estender no lugar do `VSRepository`. Ela injeta o adapter e a config do `VSRepository` do contexto, então o repository não precisa de construtor nem de `@Inject`.

```typescript
// o adapter do forFeature("User", ...)
class UserRepository extends VSRepositoryBase<User, string>({ entityName: "User" }) {}

// o adapter sem nome do forFeature({ ... })
class UserRepository extends VSRepositoryBase<User, string>() {}

// um adapter nomeado de outro contexto
class UserRepository extends VSRepositoryBase<User, string>({ entityName: "User", contextName: "reporting" }) {}
```

As opções são as do [`VSRepoConfig`](https://github.com/VSRepository/VSRepository/blob/main/docs/base-methods.pt-BR.md) do repository (`pkName`, `defaultOrdering`, `logLevel`, ...) mais `entityName` e `contextName`:

- O `entityName` escolhe o adapter: omita para injetar o sem nome.
- A config vem do módulo, e as opções que você passa têm prioridade sobre ela.
- O adapter é sempre o injetado.
- Com `lazyDynamicMethods`, os dynamic e query methods são resolvidos no `onModuleInit`. Uma subclasse que sobrescreve o `onModuleInit` precisa chamar `super.onModuleInit()` ou `this.resolveDynamicMethods()`.
- Uma subclasse pode declarar o próprio construtor para injetar mais dependências. Ela recebe o adapter e a config e os repassa ao `super`:

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

### Sem o `VSRepositoryBase`

Estender o `VSRepository` diretamente também funciona. Injete o adapter, e a config se você usar `lazyConfig`:

```typescript
@Injectable()
class UserRepository extends VSRepository<User, string> {
    constructor(adapter: VSRepoAdapter<User>, @InjectVSRepoConfig() config: VSRepoGlobalConfig) {
        super({ ...config, adapter });
    }
}
```

## Múltiplos contextos

Dê a cada banco extra o seu `contextName`, no `forRoot`, no `forFeature` e onde for injetar:

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

## Config global e `lazyConfig`

Por padrão (`lazyConfig` omitido ou `false`), o `forRoot` aplica a config pelo `VSRepository.setGlobalConfig()` **estático** e pelo `setGlobalConfig()` do adapter, quando o módulo inicializa e antes de qualquer repository ser criado. É o que a maioria das aplicações quer: configura uma vez, todo repository segue.

O porém é que essa configuração vale para o processo inteiro e cada chamada **substitui** a anterior. Com vários contextos, vale o último que inicializar. Com `lazyConfig: true`, nada estático é tocado. Em vez disso:

- a config do `VSRepository` do contexto é fornecida por `@InjectVSRepoConfig()` (o `VSRepositoryBase` usa isso por você; uma subclasse comum de `VSRepository` precisa espalhá-la na chamada do `super`);
- o `adapterConfig` é mesclado na config de cada adapter criado pelo `forFeature`, e a config da própria entidade tem prioridade sobre ele.

## Transações

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
        const order = await this.orderRepository.create(dto.order, { select: { id: true } }); // sem { db: tx }
        await this.itemRepository.createMany(dto.items.map(item => ({ ...item, orderId: order.id })));
    }
}
```

Toda chamada ao `VSRepository` feita enquanto o método executa usa a transação: métodos base, dynamic methods, `query()` e os query builders, em qualquer repository do contexto. As outras opções (`select`, `relations`, `order`, `pagination`, ...) funcionam normalmente. A transação faz commit quando o método resolve e rollback quando ele lança.

Opções: `isolationLevel` e `timeoutMs` (as `VSRepoTransactionOptions` de sempre) e `contextName`, para escolher o contexto (padrão: o contexto padrão).

### Como funciona

O core preenche o `options.db` com `adapter.getDbClient()` sempre que a chamada não passa um. O `forFeature` faz todo adapter que cria participar de transações: dentro de um escopo `@Transactional`, o `getDbClient()` devolve o client da transação, e o `runInTransaction()` (ou seja, o `repository.transaction()`) entra na transação ativa em vez de abrir outra. A transação ativa é rastreada por fluxo assíncrono com `AsyncLocalStorage`, então requisições concorrentes nunca compartilham uma. Fora de um escopo, nada muda.

A transação em si é aberta pelo `execInTransaction(dbClient, fn, options)` estático da classe do adapter, direto a partir do db client do contexto, então nenhuma instância de adapter (e nenhum `forFeature`) é necessária. É um hook opcional do `VSRepoAdapter` (o adapter do Prisma 7 implementa): o `@Transactional` e o `manager.run()` o exigem, e lançam um erro explicando isso quando o adapter não o tem.

Um `db` explícito sempre vence a transação ativa: `{ db: prisma }` executa fora dela, de propósito.

### Aninhamento e participação

- Um método `@Transactional` chamado dentro de outro **participa** da transação ativa daquele contexto. O `isolationLevel` e o `timeoutMs` do método interno são ignorados: valem os do externo.
- Não há savepoints. Se o método interno lançar e o externo capturar o erro, o que o interno gravou continua sendo commitado (a não ser que o banco tenha abortado a transação).
- Um método sem `@Transactional` chamado de dentro de um transacional executa na mesma transação.
- Chamado fora de uma transação, um método `@Transactional` abre a sua própria, e ela termina quando ele termina. Dois métodos transacionais chamados em sequência por um método não transacional são duas transações separadas: para torná-los atômicos, deixe o chamador `@Transactional` também.
- Os contextos são independentes: um método `@Transactional({ contextName: "reporting" })` abre uma transação apenas nesse banco. Não há atomicidade entre bancos.

### O que você precisa saber

- **O `getDbClient()` muda de significado dentro de um escopo.** Ele é documentado como o client usado fora de transações; dentro de um `@Transactional` ele devolve o client da transação.
- **O método passa a ser assíncrono.** Um método síncrono decorado com `@Transactional` devolve uma promise.
- **Não deixe trabalho rodando.** Promises sem `await` que continuam executando depois que o método retorna usariam uma transação que já terminou.
- **Só os repositories participam.** Um db client usado diretamente (ex.: `prisma.user.findMany()`) não participa. Leia a transação com `VSRepoTransactionManager.current()` se precisar dela.
- **O adapter precisa implementar o `execInTransaction`.** Quando a classe do adapter não tem o hook estático, o `@Transactional` e o `manager.run()` lançam um erro explicando isso, sem executar o método. O resto do módulo, incluindo o `repository.transaction()`, funciona com qualquer adapter.
- **O timeout é o do ORM.** Sem `timeoutMs`, vale o padrão do ORM (as transações interativas do Prisma têm padrão de 5 segundos).
- **Funciona com outros decorators do Nest.** O `@Transactional()` preserva a metadata que decorators como `@Get()` ou `@UseGuards()` colocam no método.

### `VSRepoTransactionManager`

Cada contexto tem um manager, criado pelo `forRoot`/`forRootAsync`, para os casos em que um decorator não serve:

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

No contexto padrão o manager é fornecido sob a própria classe `VSRepoTransactionManager`, então pode ser injetado pelo tipo. Para um contexto nomeado, use `@InjectTransactionManager("context")`.

| Membro              | Descrição                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `run(fn, options?)` | Executa `fn` em uma transação (ou participa da ativa) e devolve o que ela retorna.                       |
| `current()`         | O client da transação ativa no fluxo assíncrono atual, ou `undefined` fora de uma transação.             |
| `attach(adapter)`   | Faz um adapter participar de transações. O `forFeature` já faz isso; use só para adapters criados à mão. |

## Helpers de injeção

| Decorator                         | Injeta                                                                     | Função do token                    |
| --------------------------------- | -------------------------------------------------------------------------- | ---------------------------------- |
| `@InjectAdapter(entity?, ctx?)`   | O adapter de uma entidade, ou o adapter sem nome quando `entity` é omitido | `getAdapterToken(entity?, ctx?)`   |
| `@InjectDbClient(ctx?)`           | O db client passado ao `forRoot`                                           | `getDbClientToken(ctx?)`           |
| `@InjectVSRepoConfig(ctx?)`       | O `VSRepoGlobalConfig` montado a partir das opções do módulo               | `getVSRepoConfigToken(ctx?)`       |
| `@InjectTransactionManager(ctx?)` | O `VSRepoTransactionManager` do contexto                                   | `getTransactionManagerToken(ctx?)` |

`ctx` é o `contextName`; omita para o contexto padrão.

## Requisitos

- Node.js `>=22`
- `@nestjs/common` e `@nestjs/core` `^11.0.5 || ^12.0.0`
- `vsrepo` `^3.0.0-dev.5`
- Um adapter para o seu banco, como o [`@vsrepo/prisma7-adapter`](https://github.com/VSRepository/VSRepoPrisma7Adapter)
- Para usar o `@Transactional`, um adapter que implemente o `execInTransaction` estático (o adapter do Prisma 7 implementa)
- `experimentalDecorators` habilitado no seu `tsconfig.json`

## Licença

[MIT](./LICENSE)
