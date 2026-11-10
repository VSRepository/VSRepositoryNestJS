import type { DynamicModule, Type } from "@nestjs/common";
import type { VSRepoAdapter, VSRepoGlobalConfig } from "vsrepo";

export interface AdapterConstructor extends Type<VSRepoAdapter<any>> {
    setGlobalConfig?(config: unknown): void;
}

export interface VSRepositoryModuleOptions<T extends AdapterConstructor> extends VSRepoGlobalConfig {
    adapter: T;
    adapterConfig?: T extends { setGlobalConfig(config: infer C): void } ? C : undefined;
    dbClient: any;
}

export interface VSRepositoryOptionsFactory<T extends AdapterConstructor> {
    createVSRepositoryOptions(): VSRepositoryModuleOptions<T> | Promise<VSRepositoryModuleOptions<T>>;
}

export interface VSRepositoryModuleAsyncOptions<T extends AdapterConstructor> {
    imports?: DynamicModule["imports"];
    inject?: any[];
    useFactory?: (...args: any[]) => Promise<VSRepositoryModuleOptions<T>> | VSRepositoryModuleOptions<T>;
    useClass?: Type<VSRepositoryOptionsFactory<T>>;
    useExisting?: Type<VSRepositoryOptionsFactory<T>>;
}

export type AdapterArgs<T> = T extends readonly unknown[] ? T : [T];

export interface VSRepositoryFeature<T> {
    entityName: string;
    adapterArgs: AdapterArgs<T>;
}
