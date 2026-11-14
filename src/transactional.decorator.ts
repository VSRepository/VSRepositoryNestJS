import { getTransactionManager } from "./transaction-manager.js";
import { TransactionalOptions } from "./types.js";
import { getDbClientToken } from "./utils.js";

/**
 * Runs the method inside a transaction of the context. Every `VSRepository` call made while it
 * runs (base methods, dynamic methods, `query()` and the query builders, in any repository of the
 * context) uses the transaction automatically — no need to pass `{ db: tx }`. Other options such as
 * `select` and `relations` work as usual, and an explicit `db` still wins over the transaction.
 *
 * - The transaction commits when the method resolves and rolls back when it throws.
 * - If the context already has an active transaction (e.g. a `@Transactional` method called by
 *   another one), the method takes part in it.
 * - The method becomes asynchronous. Work left running after it returns (promises that are not
 *   awaited) would use a transaction that already ended.
 * - Only the repositories of the context take part. A db client used directly doesn't.
 *
 * @example
 * ```typescript
 * *@Transactional({ isolationLevel: VSRepoIsolationLevel.SERIALIZABLE })
 * async checkout(dto: CheckoutDto) {
 *     const order = await this.ordersRepository.create(dto.order, { select: { id: true } });
 *     await this.itemsRepository.createMany(dto.items.map(item => ({ ...item, orderId: order.id })));
 * }
 * ```
 */
export function Transactional(options: TransactionalOptions = {}): MethodDecorator {
    const { contextName, ...transactionOptions } = options;

    return (_target, _propertyKey, descriptor: PropertyDescriptor) => {
        const original = descriptor.value;

        if (typeof original !== "function") {
            throw new Error("@Transactional can only be applied to methods.");
        }

        const wrapped = function (this: unknown, ...args: unknown[]) {
            const manager = getTransactionManager(getDbClientToken(contextName));

            if (!manager) {
                throw new Error(
                    `VSRepositoryModule is not initialized for ${contextName ? `the context '${contextName}'` : "the default context"}.`,
                );
            }

            return manager.run(() => original.apply(this, args), transactionOptions);
        };

        // keeps the metadata other decorators (@Get, @UseGuards, ...) put on the method, and its name
        for (const key of Reflect.getMetadataKeys(original)) {
            Reflect.defineMetadata(key, Reflect.getMetadata(key, original), wrapped);
        }
        Object.defineProperty(wrapped, "name", { value: original.name, configurable: true });

        descriptor.value = wrapped;
    };
}
