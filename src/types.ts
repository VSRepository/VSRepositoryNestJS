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

export interface VSRepositoryModuleOptions<T extends VSRepoAdapterConstructor> extends VSRepoGlobalConfig {
    adapter: T;
    adapterConfig?: T extends { setGlobalConfig(config: infer C): void } ? C : undefined;
    dbClient: ConstructorParameters<T>[0];
    contextName?: string;
    lazyConfig?: boolean;
}

export interface PartialVSRepositoryModuleOptions<T extends VSRepoAdapterConstructor> extends Omit<
    VSRepositoryModuleOptions<T>,
    "contextName"
> {}

export type MaybePromise<T> = T | Promise<T>;

export interface VSRepositoryOptionsFactory<T extends VSRepoAdapterConstructor> {
    createVSRepositoryOptions(): MaybePromise<PartialVSRepositoryModuleOptions<T>>;
}

export interface VSRepositoryModuleAsyncOptions<T extends VSRepoAdapterConstructor> {
    contextName?: string;
    imports?: DynamicModule["imports"];
    inject?: any[];
    useFactory?: (...args: any[]) => MaybePromise<PartialVSRepositoryModuleOptions<T>>;
    useClass?: Type<VSRepositoryOptionsFactory<T>>;
    useExisting?: Type<VSRepositoryOptionsFactory<T>>;
}

export interface TransactionalOptions extends VSRepoTransactionOptions {
    /** Context whose repositories take part in the transaction. Defaults to the default context. */
    contextName?: string;
}

export interface VSRepositoryBaseConstructor<E, PK, Orm extends VSRepoOrmTypes = VSRepoOrmTypes> extends Function {
    new (adapter: VSRepoAdapter<E>, config: VSRepoGlobalConfig): VSRepository<E, PK, Orm> & { onModuleInit(): void };
}

export type VSRepositoryBaseOptions<T, K> = Omit<Partial<VSRepoConfig<T, K>>, "adapter"> &
    ({ entityName?: string; contextName?: undefined } | { entityName: string; contextName?: string });
