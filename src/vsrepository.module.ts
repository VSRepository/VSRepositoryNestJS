import { DynamicModule, Module, Provider } from "@nestjs/common";
import { VSRepoAdapter, VSRepoAdapterConstructor, VSRepoGlobalConfig, VSRepository } from "vsrepo";
import { createTransactionManager, VSRepoTransactionManager } from "./transaction-manager.js";
import {
    PartialVSRepositoryModuleOptions,
    VSRepositoryModuleAsyncOptions,
    VSRepositoryModuleOptions,
    VSRepositoryOptionsFactory,
} from "./types.js";
import {
    getAdapterClassToken,
    getAdapterToken,
    getDbClientToken,
    getTransactionManagerToken,
    getVSRepoConfigToken,
    getVSRepoModuleOptionsToken,
} from "./utils.js";

@Module({})
export class VSRepositoryModule {
    private static configureAdapter<T extends VSRepoAdapterConstructor>(options: VSRepositoryModuleOptions<T>): T {
        const { dbClient: _, contextName: _1, lazyConfig, adapter, adapterConfig, ...vsrepoConfig } = options;

        if (!lazyConfig) {
            VSRepository.setGlobalConfig(vsrepoConfig);

            if (adapterConfig !== undefined) {
                adapter.setGlobalConfig?.(adapterConfig);
            }
        }

        return adapter;
    }

    static forRoot<T extends VSRepoAdapterConstructor>(options: VSRepositoryModuleOptions<T>): DynamicModule {
        const adapterClassToken = getAdapterClassToken(options.contextName);
        const VSRepoModuleOptionsToken = getVSRepoModuleOptionsToken(options.contextName);
        const dbClientToken = getDbClientToken(options.contextName);
        const VSRepoConfigToken = getVSRepoConfigToken(options.contextName);
        const transactionManagerToken = getTransactionManagerToken(options.contextName);

        return {
            module: VSRepositoryModule,
            providers: [
                {
                    provide: VSRepoModuleOptionsToken,
                    useValue: options,
                },
                {
                    provide: adapterClassToken,
                    inject: [VSRepoModuleOptionsToken],
                    useFactory: (config: VSRepositoryModuleOptions<T>) => this.configureAdapter(config),
                },
                {
                    provide: dbClientToken,
                    inject: [VSRepoModuleOptionsToken],
                    useFactory: (config: VSRepositoryModuleOptions<T>) => config.dbClient,
                },
                {
                    provide: VSRepoConfigToken,
                    inject: [VSRepoModuleOptionsToken],
                    useFactory: ({
                        lazyDynamicMethods,
                        logLevel,
                        mergeConfig,
                        softDeleteField,
                        vsPlaceholders,
                    }: VSRepositoryModuleOptions<T>): VSRepoGlobalConfig => ({
                        lazyDynamicMethods,
                        logLevel,
                        mergeConfig,
                        softDeleteField,
                        vsPlaceholders,
                    }),
                },
                {
                    provide: transactionManagerToken,
                    useFactory: () => createTransactionManager(dbClientToken),
                },
            ],
            exports: [
                adapterClassToken,
                dbClientToken,
                VSRepoConfigToken,
                VSRepoModuleOptionsToken,
                transactionManagerToken,
            ],
            global: true,
        };
    }

    static forRootAsync<T extends VSRepoAdapterConstructor>(options: VSRepositoryModuleAsyncOptions<T>): DynamicModule {
        const adapterClassToken = getAdapterClassToken(options.contextName);
        const VSRepoModuleOptionsToken = getVSRepoModuleOptionsToken(options.contextName);
        const dbClientToken = getDbClientToken(options.contextName);
        const VSRepoConfigToken = getVSRepoConfigToken(options.contextName);
        const transactionManagerToken = getTransactionManagerToken(options.contextName);
        const providers = [];

        if (options.useFactory) {
            providers.push({
                provide: VSRepoModuleOptionsToken,
                useFactory: options.useFactory,
                inject: options.inject ?? [],
            });
        } else if (options.useClass) {
            providers.push(
                {
                    provide: options.useClass,
                    useClass: options.useClass,
                },
                {
                    provide: VSRepoModuleOptionsToken,
                    useFactory: (factory: VSRepositoryOptionsFactory<T>) => factory.createVSRepositoryOptions(),
                    inject: [options.useClass],
                },
            );
        } else if (options.useExisting) {
            providers.push({
                provide: VSRepoModuleOptionsToken,
                useFactory: (factory: VSRepositoryOptionsFactory<T>) => factory.createVSRepositoryOptions(),
                inject: [options.useExisting],
            });
        } else {
            throw new Error("One of useFactory, useClass or useExisting must be provided.");
        }

        providers.push(
            {
                provide: adapterClassToken,
                inject: [VSRepoModuleOptionsToken],
                useFactory: (config: PartialVSRepositoryModuleOptions<T>) => this.configureAdapter(config),
            },
            {
                provide: dbClientToken,
                inject: [VSRepoModuleOptionsToken],
                useFactory: (config: PartialVSRepositoryModuleOptions<T>) => config.dbClient,
            },
            {
                provide: VSRepoConfigToken,
                inject: [VSRepoModuleOptionsToken],
                useFactory: ({
                    lazyDynamicMethods,
                    logLevel,
                    mergeConfig,
                    softDeleteField,
                    vsPlaceholders,
                }: PartialVSRepositoryModuleOptions<T>): VSRepoGlobalConfig => ({
                    lazyDynamicMethods,
                    logLevel,
                    mergeConfig,
                    softDeleteField,
                    vsPlaceholders,
                }),
            },
            {
                provide: transactionManagerToken,
                useFactory: () => createTransactionManager(dbClientToken),
            },
        );

        return {
            module: VSRepositoryModule,
            imports: options.imports ?? [],
            providers,
            exports: [
                adapterClassToken,
                dbClientToken,
                VSRepoConfigToken,
                VSRepoModuleOptionsToken,
                transactionManagerToken,
            ],
            global: true,
        };
    }

    static forFeature<T extends object>(config: T, contextName?: string): DynamicModule;
    static forFeature<T extends object>(entityName: string, config: T, contextName?: string): DynamicModule;
    static forFeature<T extends object>(
        entityNameOrConfig: string | T,
        configOrContextName?: T | string,
        contextName?: string,
    ): DynamicModule {
        const providers: Provider[] = [];
        const exports = [];

        if (typeof entityNameOrConfig === "string") {
            if (!configOrContextName) throw new Error("The config param must be provided.");
            if (typeof configOrContextName === "string") throw new Error("The contextName param must be the last.");

            const adapterToken = getAdapterToken(entityNameOrConfig, contextName);
            const adapterClassToken = getAdapterClassToken(contextName);
            const dbClientToken = getDbClientToken(contextName);
            const VSRepoModuleOptionsToken = getVSRepoModuleOptionsToken(contextName);
            const transactionManagerToken = getTransactionManagerToken(contextName);

            exports.push(adapterToken);

            providers.push({
                provide: adapterToken,
                inject: [adapterClassToken, dbClientToken, VSRepoModuleOptionsToken, transactionManagerToken],
                useFactory: (
                    Adapter: VSRepoAdapterConstructor,
                    dbClient: any,
                    config: VSRepositoryModuleOptions<any>,
                    transactionManager: VSRepoTransactionManager,
                ) => {
                    const adapter = new Adapter(
                        dbClient,
                        config.adapterConfig && config.lazyConfig
                            ? { ...config.adapterConfig, ...configOrContextName }
                            : configOrContextName,
                    );

                    transactionManager.attach(adapter);

                    return adapter;
                },
            });
        } else {
            if (configOrContextName !== undefined && typeof configOrContextName !== "string")
                throw new Error("The contextName param must be a string.");

            const adapterClassToken = getAdapterClassToken(configOrContextName);
            const dbClientToken = getDbClientToken(configOrContextName);
            const VSRepoModuleOptionsToken = getVSRepoModuleOptionsToken(configOrContextName);
            const transactionManagerToken = getTransactionManagerToken(configOrContextName);

            exports.push(VSRepoAdapter);

            providers.push({
                provide: VSRepoAdapter,
                inject: [adapterClassToken, dbClientToken, VSRepoModuleOptionsToken, transactionManagerToken],
                useFactory: (
                    Adapter: VSRepoAdapterConstructor,
                    dbClient: any,
                    config: VSRepositoryModuleOptions<any>,
                    transactionManager: VSRepoTransactionManager,
                ) => {
                    const adapter = new Adapter(
                        dbClient,
                        config.adapterConfig && config.lazyConfig
                            ? { ...config.adapterConfig, ...entityNameOrConfig }
                            : entityNameOrConfig,
                    );

                    transactionManager.attach(adapter);

                    return adapter;
                },
            });
        }

        return {
            module: VSRepositoryModule,
            providers,
            exports,
        };
    }
}
