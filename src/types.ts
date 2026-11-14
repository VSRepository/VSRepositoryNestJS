import type { DynamicModule, Type } from "@nestjs/common";
import type {
    VSRepoAdapter,
    VSRepoAdapterConstructor,
    VSRepoConfig,
    VSRepoGlobalConfig,
    VSRepoOrmTypes,
    VSRepository,
    VSRepoTransactionOptions,
} from "vsrepo";

/**
 * Options of `VSRepositoryModule.forRoot()`. Besides the fields below, it accepts every
 * `VSRepoGlobalConfig` option (`logLevel`, `lazyDynamicMethods`, `vsPlaceholders`, `mergeConfig`,
 * `softDeleteField`), which configure the `VSRepository` of the context.
 *
 * @template T Adapter class used by the context.
 *
 * @publicApi
 */
export interface VSRepositoryModuleOptions<T extends VSRepoAdapterConstructor> extends VSRepoGlobalConfig {
    /** Adapter class used by every repository of the context, e.g. `Prisma7Adapter`. */
    adapter: T;
    /**
     * Global config of the adapter, typed from the argument of the adapter's static `setGlobalConfig`.
     * Without `lazyConfig` it is passed to `adapter.setGlobalConfig()`. With `lazyConfig: true` it is
     * merged into the config of each adapter created by `forFeature()` instead (the entity's own
     * config wins over it).
     */
    adapterConfig?: T extends { setGlobalConfig(config: infer C): void } ? C : undefined;
    /** Db client the adapters work on, typed from the first argument of the adapter's constructor. */
    dbClient: ConstructorParameters<T>[0];
    /** Name of the context. Omit it for the default context; give each extra context a distinct name. */
    contextName?: string;
    /**
     * When `true`, the static configuration (`VSRepository.setGlobalConfig()` and
     * `adapter.setGlobalConfig()`) is left untouched, so contexts don't override each other. The
     * `VSRepository` config is then delivered through `InjectVSRepoConfig()` (or `VSRepositoryBase`),
     * and `adapterConfig` is merged into each adapter by `forFeature()`.
     *
     * @default false
     */
    lazyConfig?: boolean;
}

/**
 * What the factory of `VSRepositoryModule.forRootAsync()` returns.
 *
 * @template T Adapter class used by the context.
 *
 * @publicApi
 */
export interface PartialVSRepositoryModuleOptions<T extends VSRepoAdapterConstructor> extends Omit<
    VSRepositoryModuleOptions<T>,
    "contextName"
> {}

/**
 * @publicApi
 */
export type MaybePromise<T> = T | Promise<T>;

/**
 * Contract of the class given to `forRootAsync({ useClass })` or `forRootAsync({ useExisting })`.
 *
 * @template T Adapter class used by the context.
 *
 * @publicApi
 */
export interface VSRepositoryOptionsFactory<T extends VSRepoAdapterConstructor> {
    /** Builds the module options. */
    createVSRepositoryOptions(): MaybePromise<PartialVSRepositoryModuleOptions<T>>;
}

/**
 * Options of `VSRepositoryModule.forRootAsync()`.
 *
 * @template T Adapter class used by the context.
 *
 * @publicApi
 */
export interface VSRepositoryModuleAsyncOptions<T extends VSRepoAdapterConstructor> {
    /** Name of the context. Omit it for the default context. */
    contextName?: string;
    /** Modules whose providers `inject` and `useClass` need. */
    imports?: DynamicModule["imports"];
    /** Providers injected as the arguments of `useFactory`. */
    inject?: any[];
    /** Factory that builds the module options. */
    useFactory?: (...args: any[]) => MaybePromise<PartialVSRepositoryModuleOptions<T>>;
    /** Class that implements `VSRepositoryOptionsFactory`. */
    useClass?: Type<VSRepositoryOptionsFactory<T>>;
    /** Already provided class that implements `VSRepositoryOptionsFactory`, to be reused. */
    useExisting?: Type<VSRepositoryOptionsFactory<T>>;
}

/**
 * Options of `@Transactional()`: the `VSRepoTransactionOptions` of the transaction plus
 * the context it runs in.
 *
 * @publicApi
 */
export interface TransactionalOptions extends VSRepoTransactionOptions {
    /** Context whose repositories take part in the transaction. Defaults to the default context. */
    contextName?: string;
}

/**
 * Type of the class returned by `VSRepositoryBase()`: a `VSRepository` that also implements
 * `onModuleInit`. Its constructor receives the injected adapter and `VSRepository` config, which
 * matters only to subclasses that declare their own constructor.
 *
 * @template E Entity type managed by the repository.
 * @template PK Type of the entity's primary key value.
 * @template Orm ORM types of the adapter.
 *
 * @publicApi
 */
export interface VSRepositoryBaseConstructor<E, PK, Orm extends VSRepoOrmTypes = VSRepoOrmTypes> extends Function {
    new (adapter: VSRepoAdapter<E>, config: VSRepoGlobalConfig): VSRepository<E, PK, Orm> & { onModuleInit(): void };
}

/**
 * Options of `VSRepositoryBase()`: any `VSRepoConfig` option except `adapter` (which is always the
 * injected one), plus which adapter to inject.
 *
 * @template T Entity type managed by the repository.
 * @template K Type of the entity's primary key value.
 *
 * @publicApi
 */
export type VSRepositoryBaseOptions<T, K> = Omit<Partial<VSRepoConfig<T, K>>, "adapter"> & {
    /**
     * Name the adapter was given in `forFeature(entityName, config)`. Omit it to inject the unnamed
     * adapter of `forFeature(config)`.
     */
    entityName?: string;
    /**
     * Context of the adapter and of the config. Omit for the default context.
     */
    contextName?: string;
};
