import type { DynamicModule, Type } from "@nestjs/common";
import type { VSRepoAdapterConstructor, VSRepoGlobalConfig } from "vsrepo";

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
