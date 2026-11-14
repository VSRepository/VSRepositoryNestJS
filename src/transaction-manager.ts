import type { VSRepoAdapter, VSRepoTransactionOptions } from "vsrepo";
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
 * There is one per context, created by `VSRepositoryModule.forRoot()`/`forRootAsync()` and injected
 * with `@InjectTransactionManager()`.
 *
 * @publicApi
 */
export class VSRepoTransactionManager implements OnModuleDestroy {
    private runRaw?: VSRepoAdapter["runInTransaction"];

    /**
     * @param key Token of the context's db client (see `getDbClientToken`), which identifies the context.
     */
    constructor(readonly key: string | symbol) {}

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
     * for an adapter you instantiate by hand. The first adapter attached is also the one that opens
     * the transactions of `run()`, so `run()` needs at least one.
     *
     * @param adapter Adapter of this context.
     */
    attach(adapter: VSRepoAdapter): void {
        const rawGetDbClient = adapter.getDbClient.bind(adapter);
        const rawRunInTransaction = adapter.runInTransaction.bind(adapter);

        // every adapter of a context shares the same client, so any of them can open the transaction
        this.runRaw ??= rawRunInTransaction;

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
     * @param fn Code to run in the transaction. Repositories of the context use it automatically.
     * @param options Isolation level and timeout of a new transaction.
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

        if (!this.runRaw) {
            throw new Error(
                "No repository is registered in this context yet. Import VSRepositoryModule.forFeature() in a module before using @Transactional.",
            );
        }

        const outer = transactionStorage.getStore();

        return this.runRaw(tx => {
            const scope = new Map(outer);
            scope.set(this.key, tx);

            // returned (not awaited here) so the transaction only ends when `fn` does
            return transactionStorage.run(scope, async () => fn());
        }, options);
    }

    /**
     * Removes the manager from the registry `@Transactional()` uses when the module is destroyed.
     */
    onModuleDestroy(): void {
        unregisterTransactionManager(this);
    }
}

export function createTransactionManager(key: string | symbol): VSRepoTransactionManager {
    const manager = new VSRepoTransactionManager(key);
    registerTransactionManager(manager);
    return manager;
}
