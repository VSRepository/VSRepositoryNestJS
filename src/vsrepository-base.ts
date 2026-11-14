import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { VSRepoAdapter, VSRepoGlobalConfig, VSRepoOrmTypes, VSRepository } from "vsrepo";
import { InjectAdapter, InjectVSRepoConfig } from "./utils.js";
import { VSRepositoryBaseConstructor, VSRepositoryBaseOptions } from "./types.js";

/**
 * Creates a base class for repositories, to `extend` instead of `VSRepository`. It injects the
 * adapter and the `VSRepository` config of the context, so the repository needs no constructor and no
 * `@Inject`, and it resolves the `@DynamicMethod`/`@QueryMethod` fields on module init when
 * `lazyDynamicMethods` is on.
 *
 * - The config comes from the module (`forRoot`), and the options passed here win over it.
 * - The adapter is always the injected one.
 * - A subclass that overrides `onModuleInit` must call `super.onModuleInit()` or `this.resolveDynamicMethods()`;
 *   otherwise the dynamic methods are never resolved when `lazyDynamicMethods` is on.
 * - A subclass that declares its own constructor receives the adapter and the config, and passes them
 *   to `super(adapter, config)`.
 *
 * @template E Entity type managed by the repository.
 * @template PK Type of the entity's primary key value.
 * @template Orm ORM types of the adapter.
 *
 * @param options `VSRepoConfig` options of the repository and which adapter to inject.
 *
 * @example
 * ```typescript
 * *@Injectable()
 * export class UserRepository extends VSRepositoryBase<User, string>({ entityName: "User" }) {
 *     *@DynamicMethod()
 *     declare findByName: (name: string) => Promise<User[]>;
 * }
 * ```
 *
 * @publicApi
 */
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
