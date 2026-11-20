import type { VSRepoAdapter, VSRepoAdapterConstructor, VSRepoTransactionOptions } from "vsrepo";
import { AsyncLocalStorage } from "node:async_hooks";
import { OnModuleDestroy } from "@nestjs/common";

/**
 * Transactions active in the current async execution flow, keyed by the context's db client token
 * (see `getDbClientToken`). One entry per context, so several contexts can be inside a
 * `@Transactional` scope at the same time without interfering with each other.
 */
export type TransactionScope = ReadonlyMap<string | symbol, unknown>;

export const transactionStorage = new AsyncLocalStorage<TransactionScope>();

/**
 * Managers of every initialized context, so `@Transactional` (a decorator, with no access to DI)
 * can find the manager of its context. Filled by `VSRepositoryModule`.
 */
const managers = new Map<string | symbol, VSRepoTransactionManager>();

export function registerTransactionManager(manager: VSRepoTransactionManager): void {
    managers.set(manager.key, manager);
}

export function unregisterTransactionManager(manager: VSRepoTransactionManager): void {
    // only removes its own entry: a newer manager of the same context must be kept
    if (managers.get(manager.key) === manager) managers.delete(manager.key);
}

export function getTransactionManager(key: string | symbol): VSRepoTransactionManager | undefined {
    return managers.get(key);
}

/**
 * Opens transactions for one context and makes every repository of that context take part in the
 * one that is active in the current async flow.
 *
 * It works without touching `VSRepository`: the repository fills `options.db` with
 * `adapter.getDbClient()` whenever the call doesn't pass one, so the adapters of the context are
 * patched (`attach`) to return the active transaction client while a scope is open.
 *
 * The transaction itself is opened by the static `execInTransaction()` of the adapter class, straight
 * from the context's db client, so no adapter instance is needed. That hook is optional in
 * `VSRepoAdapter`, but `run()` (and so `@Transactional`) requires it and throws an error explaining it
 * when the adapter doesn't implement it.
 *
 * There is one per context, created by `VSRepositoryModule.forRoot()`/`forRootAsync()`. In the default
 * context it is provided under this class itself, so it can be injected by type; for a named context use
 * `@InjectTransactionManager(contextName)`.
 *
 * @publicApi
 */
export class VSRepoTransactionManager implements OnModuleDestroy {
    /**
     * @param key Token of the context's db client (see `getDbClientToken`), which identifies the context.
     * @param adapterClass Adapter class of the context. `run()` opens the transactions with its static
     * `execInTransaction()`.
     * @param dbClient Db client of the context, handed to `adapterClass.execInTransaction()`.
     */
    constructor(
        readonly key: string | symbol,
        private readonly adapterClass: VSRepoAdapterConstructor,
        private readonly dbClient: unknown,
    ) {}

    /**
     * The transaction client active in the current async flow for this context, if any.
     *
     * @template T Type of the transaction client.
     */
    current<T = any>(): T | undefined {
        return transactionStorage.getStore()?.get(this.key) as T | undefined;
    }

    /**
     * Makes `adapter` transaction-aware: inside a scope `getDbClient()` returns the transaction
     * client, and `runInTransaction()` (i.e. `repository.transaction()`) joins the active
     * transaction instead of opening another one. Outside a scope nothing changes.
     *
     * `VSRepositoryModule.forFeature()` calls it for every adapter it creates; call it yourself only
     * for an adapter you instantiate by hand.
     *
     * @param adapter Adapter of this context.
     */
    attach(adapter: VSRepoAdapter): void {
        const rawGetDbClient = adapter.getDbClient.bind(adapter);
        const rawRunInTransaction = adapter.runInTransaction.bind(adapter);

        adapter.getDbClient = () => this.current() ?? rawGetDbClient();
        adapter.runInTransaction = ((fn, options) => {
            const tx = this.current();
            return tx === undefined ? rawRunInTransaction(fn, options) : fn(tx);
        }) as VSRepoAdapter["runInTransaction"];
    }

    /**
     * Runs `fn` inside a transaction. If one is already active for this context, `fn` simply takes
     * part in it (`options` are ignored, since the transaction already exists). The transaction
     * commits when `fn` resolves and rolls back when it throws.
     *
     * A new transaction is opened with the static `execInTransaction()` of the adapter class, which
     * works even before any `forFeature`.
     *
     * @param fn Code to run in the transaction. Repositories of the context use it automatically.
     * @param options Isolation level and timeout of a new transaction.
     * @throws {Error} When the adapter class doesn't implement the static `execInTransaction()`, and
     * `fn` is not run.
     *
     * @example
     * ```typescript
     * await this.transactionManager.run(async () => {
     *     await this.usersRepository.create(user);
     *     await this.auditRepository.create(entry);
     * });
     * ```
     */
    async run<R>(fn: () => R | Promise<R>, options?: VSRepoTransactionOptions): Promise<R> {
        if (this.current() !== undefined) return fn();

        if (!this.adapterClass.execInTransaction) {
            throw new Error(
                `The adapter ${this.adapterClass.name || "of this context"} doesn't implement the static execInTransaction(), ` +
                    "which @Transactional and VSRepoTransactionManager.run() use to open transactions. " +
                    "Use an adapter that implements it (e.g. @vsrepo/prisma7-adapter).",
            );
        }

        const outer = transactionStorage.getStore();

        // returned (not awaited here) so the transaction only ends when `fn` does
        return this.adapterClass.execInTransaction(
            this.dbClient,
            tx => {
                const scope = new Map(outer);
                scope.set(this.key, tx);

                return transactionStorage.run(scope, async () => fn());
            },
            options,
        );
    }

    /**
     * Removes the manager from the registry `@Transactional()` uses when the module is destroyed.
     */
    onModuleDestroy(): void {
        unregisterTransactionManager(this);
    }
}

export function createTransactionManager(
    key: string | symbol,
    adapterClass: VSRepoAdapterConstructor,
    dbClient: unknown,
): VSRepoTransactionManager {
    const manager = new VSRepoTransactionManager(key, adapterClass, dbClient);
    registerTransactionManager(manager);
    return manager;
}
