import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { VSRepoAdapter, VSRepoGlobalConfig, VSRepoOrmTypes, VSRepository } from "vsrepo";
import { InjectAdapter, InjectVSRepoConfig } from "./utils.js";
import { VSRepositoryBaseConstructor, VSRepositoryBaseOptions } from "./types.js";

export function VSRepositoryBase<E, PK, Orm extends VSRepoOrmTypes = VSRepoOrmTypes>(
    options?: VSRepositoryBaseOptions<E, PK>,
): VSRepositoryBaseConstructor<E, PK, Orm> {
    const { contextName, entityName, ...overrideConfig } = options ?? {};

    const AdapterDecorator = () => (entityName ? InjectAdapter(entityName, contextName) : Inject(VSRepoAdapter));

    @Injectable()
    class Base extends VSRepository<E, PK, Orm> implements OnModuleInit {
        private readonly callResolveDynamicMethods?: boolean;

        constructor(
            @AdapterDecorator() adapter: VSRepoAdapter<E>,
            @InjectVSRepoConfig(contextName) config: VSRepoGlobalConfig,
        ) {
            const mergedConfig = { ...config, ...overrideConfig, adapter };

            super(mergedConfig);

            this.callResolveDynamicMethods = mergedConfig.lazyDynamicMethods;
        }

        onModuleInit(): void {
            if (this.callResolveDynamicMethods) {
                this.resolveDynamicMethods();
            }
        }
    }
    return Base;
}
