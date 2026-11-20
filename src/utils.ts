import { Inject } from "@nestjs/common";
import { ADAPTER_CLASS, DB_CLIENT, MODULE_OPTIONS, VSREPO_CONFIG } from "./constants.js";
import { VSRepoTransactionManager } from "./transaction-manager.js";
import { VSRepoAdapter } from "vsrepo";

/**
 * Returns the injection token of the adapter that `VSRepositoryModule.forFeature()` provides. With
 * an `entityName` it is the token of that named adapter; without it, the `VSRepoAdapter` class,
 * which is the token of the unnamed adapter.
 *
 * @param entityName Name given to the entity in `forFeature(entityName, config)`. Omit it to get
 * the unnamed adapter's token.
 * @param contextName Context the adapter belongs to. Omit it for the default context.
 *
 * @publicApi
 */
export function getAdapterToken(entityName?: string, contextName?: string): string | typeof VSRepoAdapter {
    return entityName ? `VSRepoAdapter(${entityName}${contextName ? `:${contextName}` : ""})` : VSRepoAdapter;
}

/**
 * Parameter decorator that injects the **unnamed** adapter of the module, provided by
 * `VSRepositoryModule.forFeature(config)` (the `VSRepoAdapter` token).
 *
 * @publicApi
 */
export function InjectAdapter(): ReturnType<typeof Inject>;
/**
 * Parameter decorator that injects the adapter of an entity, as provided by
 * `VSRepositoryModule.forFeature(entityName, config, contextName)`.
 *
 * @param entityName Name given to the entity in `forFeature`.
 * @param contextName Context the adapter belongs to. Omit it for the default context.
 *
 * @publicApi
 */
export function InjectAdapter(entityName: string, contextName?: string): ReturnType<typeof Inject>;
export function InjectAdapter(entityName?: string, contextName?: string) {
    return Inject(getAdapterToken(entityName, contextName));
}

/**
 * Returns the injection token of the adapter **class** registered by
 * `VSRepositoryModule.forRoot()`/`forRootAsync()`.
 *
 * @param contextName Context to look up. Omit it for the default context.
 *
 * @internal
 */
export function getAdapterClassToken(contextName?: string): string | symbol {
    return contextName ? `VSRepoAdapterClass(${contextName})` : ADAPTER_CLASS;
}

/**
 * Returns the injection token of the options a context was registered with: the object passed to
 * `forRoot()`, or the one `forRootAsync()` resolved. It includes the `dbClient` and the `adapter`.
 *
 * @param contextName Context to look up. Omit it for the default context.
 *
 * @internal
 */
export function getVSRepoModuleOptionsToken(contextName?: string): string | symbol {
    return contextName ? `VSRepoModuleOptions(${contextName})` : MODULE_OPTIONS;
}

/**
 * Returns the injection token of the db client (e.g. a `PrismaClient`) a context was registered with.
 *
 * @param contextName Context to look up. Omit it for the default context.
 *
 * @publicApi
 */
export function getDbClientToken(contextName?: string): string | symbol {
    return contextName ? `DbClient(${contextName})` : DB_CLIENT;
}

/**
 * Parameter decorator that injects the db client a context was registered with.
 *
 * @param contextName Context to look up. Omit it for the default context.
 *
 * @publicApi
 */
export function InjectDbClient(contextName?: string) {
    return Inject(getDbClientToken(contextName));
}

/**
 * Returns the injection token of the `VSRepository` config of a context (a `VSRepoGlobalConfig`).
 *
 * @param contextName Context to look up. Omit it for the default context.
 *
 * @publicApi
 */
export function getVSRepoConfigToken(contextName?: string): string | symbol {
    return contextName ? `VSRepoConfig(${contextName})` : VSREPO_CONFIG;
}

/**
 * Parameter decorator that injects the `VSRepository` config of a context: a `VSRepoGlobalConfig`
 * with the configs given to the module. It is provided whether or not `lazyConfig` is set, which makes
 * it the way to hand that config to a repository when `lazyConfig` is `true` (`VSRepositoryBase` does it for you).
 *
 * @param contextName Context to look up. Omit it for the default context.
 *
 * @publicApi
 */
export function InjectVSRepoConfig(contextName?: string) {
    return Inject(getVSRepoConfigToken(contextName));
}

/**
 * Returns the injection token of the `VSRepoTransactionManager` of a context. The default context
 * uses the `VSRepoTransactionManager` class itself as the token; a named context uses a string.
 *
 * @param contextName Context to look up. Omit it for the default context.
 *
 * @publicApi
 */
export function getTransactionManagerToken(contextName?: string): string | typeof VSRepoTransactionManager {
    return contextName ? `VSRepoTransactionManager(${contextName})` : VSRepoTransactionManager;
}

/**
 * Parameter decorator that injects the `VSRepoTransactionManager` of a context, to open a
 * transaction in code (`manager.run()`) or to read the active one (`manager.current()`).
 *
 * In the default context it is equivalent to `@Inject(VSRepoTransactionManager)`; use it with a
 * `contextName` to inject the manager of a named context.
 *
 * @param contextName Context to look up. Omit it for the default context.
 *
 * @publicApi
 */
export function InjectTransactionManager(contextName?: string) {
    return Inject(getTransactionManagerToken(contextName));
}
