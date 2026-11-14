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

/**
 * NestJS module for VSRepository. `forRoot()`/`forRootAsync()` register a context (its db client and
 * adapter class) and `forFeature()` provides the adapter of each entity, so repositories receive
 * them through dependency injection.
 *
 * A **context** is a database: use the default one (no `contextName`), or name each one to work
 * with several in the same application.
 *
 * @example
 * ```typescript
 * *@Module({
 *     imports: [VSRepositoryModule.forRoot({ adapter: Prisma7Adapter, dbClient: prisma }), UserModule],
 * })
 * export class AppModule {}
 *
 * *@Module({
 *     imports: [VSRepositoryModule.forFeature("User", { modelName: "user", pkName: "id" })],
 *     providers: [UserRepository],
 * })
 * export class UserModule {}
 * ```
 *
 * @publicApi
 */
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

    /**
     * Registers a context: its db client, its adapter class and its `VSRepository` config. The module
     * is global, so it is imported once (usually in the root module) and the context is available
     * everywhere.
     *
     * Without `lazyConfig`, the config is applied through the static `VSRepository.setGlobalConfig()`
     * and `adapter.setGlobalConfig()` when the module initializes, before any repository is created.
     * Those are process-wide and each call replaces the previous one, so with several contexts the last
     * one wins: set `lazyConfig: true` on them to leave the static config alone.
     *
     * @param options Adapter class, db client, config and, optionally, the name of the context.
     *
     * @example
     * ```typescript
     * VSRepositoryModule.forRoot({
     *     adapter: Prisma7Adapter,
     *     dbClient: prisma,
     *     logLevel: VSLogLevel.WARN,
     * })
     * ```
     *
     * @publicApi
     */
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
                        adapter: _0,
                        dbClient: _1,
                        adapterConfig: _2,
                        contextName: _3,
                        lazyConfig: _4,
                        ...config
                    }: VSRepositoryModuleOptions<T>): VSRepoGlobalConfig => config,
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

    /**
     * Same as `forRoot()`, but the options come from a factory, so they can depend on other providers
     * (e.g. a config service) and be built asynchronously. The module is global.
     *
     * @param options Where the options come from (`useFactory`, `useClass` or `useExisting`) and,
     * optionally, the name of the context.
     *
     * @example
     * ```typescript
     * VSRepositoryModule.forRootAsync({
     *     imports: [ConfigModule],
     *     inject: [ConfigService],
     *     useFactory: (config: ConfigService) => ({
     *         adapter: Prisma7Adapter,
     *         dbClient: new PrismaClient({ adapter: new PrismaPg(config.getOrThrow("DATABASE_URL")) }),
     *     }),
     * })
     * ```
     *
     * @publicApi
     */
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
                    adapter: _0,
                    dbClient: _1,
                    adapterConfig: _2,
                    lazyConfig: _3,
                    ...config
                }: PartialVSRepositoryModuleOptions<T>): VSRepoGlobalConfig => config,
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

    /**
     * Provides the **unnamed** adapter of the module, to inject with `VSRepoAdapter`. A module
     * can have only one: use `forFeature(entityName, config)` for modules with several entities.
     *
     * The adapter is created with the db client of the context and is transaction-aware, so
     * `@Transactional()` works with the repositories that use it.
     *
     * @param config Constructor config of the adapter (e.g. `{ modelName, pkName }` for Prisma).
     * @param contextName Context to use. Omit it for the default context.
     *
     * @publicApi
     */
    static forFeature<T extends object>(config: T, contextName?: string): DynamicModule;
    /**
     * Provides the adapter of an entity under its name, to inject with `@InjectAdapter(entityName)`.
     * A module can provide several, one per entity.
     *
     * The adapter is created with the db client of the context and is transaction-aware, so
     * `@Transactional()` works with the repositories that use it.
     *
     * @param entityName Name of the entity, used to inject its adapter.
     * @param config Constructor config of the adapter (e.g. `{ modelName, pkName }` for Prisma).
     * @param contextName Context to use. Omit it for the default context.
     *
     * @example
     * ```typescript
     * VSRepositoryModule.forFeature("User", { modelName: "user", pkName: "id" }, "reporting")
     * ```
     *
     * @publicApi
     */
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
