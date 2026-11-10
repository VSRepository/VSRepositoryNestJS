import { DynamicModule, Global, Module, Provider } from "@nestjs/common";
import { VSRepoAdapter, VSRepository } from "vsrepo";
import {
    AdapterArgs,
    AdapterConstructor,
    VSRepositoryFeature,
    VSRepositoryModuleAsyncOptions,
    VSRepositoryModuleOptions,
    VSRepositoryOptionsFactory,
} from "./types.js";
import { ADAPTER_CLASS, DB_CLIENT, VSREPOSITORY_OPTIONS } from "./constants.js";
import { getAdapterToken } from "./utils.js";

@Global()
@Module({})
export class VSRepositoryModule {
    private static configureAdapter<T extends AdapterConstructor>(options: VSRepositoryModuleOptions<T>): T {
        const { dbClient: _, adapter, adapterConfig, ...vsrepoConfig } = options;

        VSRepository.setGlobalConfig(vsrepoConfig);

        if (adapterConfig !== undefined) {
            adapter.setGlobalConfig?.(adapterConfig);
        }

        return adapter;
    }

    static forRoot<T extends AdapterConstructor>(options: VSRepositoryModuleOptions<T>): DynamicModule {
        return {
            module: VSRepositoryModule,
            providers: [
                {
                    provide: VSREPOSITORY_OPTIONS,
                    useValue: options,
                },
                {
                    provide: ADAPTER_CLASS,
                    inject: [VSREPOSITORY_OPTIONS],
                    useFactory: (config: VSRepositoryModuleOptions<T>) => this.configureAdapter(config),
                },
                {
                    provide: DB_CLIENT,
                    inject: [VSREPOSITORY_OPTIONS],
                    useFactory: (config: VSRepositoryModuleOptions<T>) => config.dbClient,
                },
            ],
            exports: [ADAPTER_CLASS, DB_CLIENT],
        };
    }

    static forRootAsync<T extends AdapterConstructor>(options: VSRepositoryModuleAsyncOptions<T>): DynamicModule {
        const providers = [];

        if (options.useFactory) {
            providers.push({
                provide: VSREPOSITORY_OPTIONS,
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
                    provide: VSREPOSITORY_OPTIONS,
                    useFactory: (factory: VSRepositoryOptionsFactory<T>) => factory.createVSRepositoryOptions(),
                    inject: [options.useClass],
                },
            );
        } else if (options.useExisting) {
            providers.push({
                provide: VSREPOSITORY_OPTIONS,
                useFactory: (factory: VSRepositoryOptionsFactory<T>) => factory.createVSRepositoryOptions(),
                inject: [options.useExisting],
            });
        } else {
            throw new Error("One of useFactory, useClass or useExisting must be provided.");
        }

        providers.push(
            {
                provide: ADAPTER_CLASS,
                useFactory: (config: VSRepositoryModuleOptions<T>) => this.configureAdapter(config),
                inject: [VSREPOSITORY_OPTIONS],
            },
            {
                provide: DB_CLIENT,
                inject: [VSREPOSITORY_OPTIONS],
                useFactory: (config: VSRepositoryModuleOptions<T>) => config.dbClient,
            },
        );

        return {
            module: VSRepositoryModule,
            imports: options.imports ?? [],
            providers,
            exports: [ADAPTER_CLASS, DB_CLIENT],
        };
    }

    static forFeature<T = readonly unknown[]>(entityName: string, ...adapterArgs: AdapterArgs<T>): DynamicModule;
    static forFeature<T = readonly unknown[]>(features: readonly VSRepositoryFeature<T>[]): DynamicModule;
    static forFeature<T = readonly unknown[]>(
        entityOrFeatures: string | readonly VSRepositoryFeature<T>[],
        ...adapterArgs: AdapterArgs<T>
    ): DynamicModule {
        const singleFeat = typeof entityOrFeatures === "string";
        const features = singleFeat ? [{ entityName: entityOrFeatures, adapterArgs }] : entityOrFeatures;

        const providers: Provider[] = features.map(({ entityName, adapterArgs }) => ({
            provide: getAdapterToken(entityName),
            inject: [ADAPTER_CLASS, DB_CLIENT],
            useFactory: (Adapter: AdapterConstructor, dbClient: any) => new Adapter(dbClient, ...adapterArgs),
        }));

        if (singleFeat) {
            providers.push({
                provide: VSRepoAdapter,
                useExisting: getAdapterToken(entityOrFeatures),
            });
        }

        return {
            module: VSRepositoryModule,
            providers,
            exports: [
                ...features.map(({ entityName }) => getAdapterToken(entityName)),
                ...(singleFeat ? [VSRepoAdapter] : []),
            ],
        };
    }
}

// const a = VSRepositoryModule.forRootAsync({useFactory: ()=> ({})})
