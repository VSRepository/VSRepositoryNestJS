import "reflect-metadata";
import { DynamicModule, Inject, Injectable, Module, Optional, Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Prisma7Adapter } from "@vsrepo/prisma7-adapter";
import { VSLogLevel, VSRepoIsolationLevel, VSRepository, type VSRepoAdapterConstructor } from "vsrepo";
import type { VSRepoTransactionManager } from "./transaction-manager.js";
import { Transactional } from "./transactional.decorator.js";
import { InjectAdapter, InjectTransactionManager } from "./utils.js";
import { VSRepositoryModule } from "./vsrepository.module.js";

type User = { id: string; name: string };
type FakeTx = { kind: "tx"; id: string };

/** Fake db client: opens fake transactions and logs begin/commit/rollback. */
class FakeDb {
    readonly kind = "root";
    readonly events: string[] = [];
    private nextTx = 1;

    constructor(readonly name: string) {}

    async transaction<R>(fn: (tx: FakeTx) => Promise<R>): Promise<R> {
        const tx: FakeTx = { kind: "tx", id: `${this.name}-tx${this.nextTx++}` };
        this.events.push(`begin ${tx.id}`);

        try {
            const result = await fn(tx);
            this.events.push(`commit ${tx.id}`);
            return result;
        } catch (err) {
            this.events.push(`rollback ${tx.id}`);
            throw err;
        }
    }
}

/** How many times each way of opening a transaction was used. */
const staticCalls: { self: unknown; dbClient: unknown; options: unknown }[] = [];
let instanceRuns = 0;

/** Where the adapter calls ran, in order. */
const calls: { method: string; db: unknown }[] = [];

/** An adapter without the optional static `execInTransaction`. */
class PlainAdapter {
    constructor(
        private readonly db: FakeDb,
        _config: object,
    ) {}

    getPkName() {
        return "id";
    }

    getDbClient() {
        return this.db;
    }

    runInTransaction(fn: (tx: any) => Promise<any>) {
        instanceRuns++;
        return this.db.transaction(fn);
    }

    async findOne(_where: unknown, options: any) {
        calls.push({ method: "findOne", db: options?.db });
        return null;
    }
}

/** The same adapter, now able to open a transaction straight from a db client. */
class StaticAdapter extends PlainAdapter {
    static execInTransaction<R>(dbClient: FakeDb, fn: (tx: any) => Promise<R>, options?: unknown): Promise<R> {
        staticCalls.push({ self: this, dbClient, options });
        return dbClient.transaction(fn);
    }
}

const PlainAdapterClass = PlainAdapter as unknown as VSRepoAdapterConstructor;
const StaticAdapterClass = StaticAdapter as unknown as VSRepoAdapterConstructor;

@Injectable()
class UserRepository extends VSRepository<User, string> {
    constructor(@InjectAdapter("user") adapter: any) {
        super({ adapter, logLevel: VSLogLevel.NONE });
    }
}

/** Only needs the manager, so it works in apps with no forFeature at all. */
@Injectable()
class PlainService {
    constructor(
        @InjectTransactionManager() readonly manager: VSRepoTransactionManager,
        @Optional() @InjectTransactionManager("other") readonly other?: VSRepoTransactionManager,
    ) {}

    @Transactional()
    async inTransaction() {
        return this.manager.current<FakeTx>();
    }

    @Transactional({ isolationLevel: VSRepoIsolationLevel.SERIALIZABLE, timeoutMs: 1234 })
    async withOptions() {
        return this.manager.current<FakeTx>();
    }

    @Transactional()
    async failing() {
        throw new Error("boom");
    }

    @Transactional({ contextName: "other" })
    async inOtherContext() {
        return { main: this.manager.current<FakeTx>(), other: this.other?.current<FakeTx>() };
    }
}

@Injectable()
class RepositoryService {
    constructor(@Inject(UserRepository) readonly users: UserRepository) {}

    @Transactional()
    async work() {
        await this.users.get("1");
        await this.users.transaction(async tx => {
            await this.users.get("2", { db: tx });
        });
    }
}

async function createApp(options: {
    adapter: VSRepoAdapterConstructor;
    providers: Type[];
    features?: DynamicModule[];
    otherAdapter?: VSRepoAdapterConstructor;
    async?: boolean;
    dbClient?: unknown;
}) {
    const mainDb = new FakeDb("main");
    const otherDb = new FakeDb("other");

    @Module({ imports: options.features ?? [], providers: options.providers })
    class FeatureModule {}

    @Module({
        imports: [
            options.async
                ? VSRepositoryModule.forRootAsync({
                      useFactory: () => ({
                          adapter: options.adapter,
                          dbClient: options.dbClient ?? mainDb,
                          lazyConfig: true,
                      }),
                  })
                : VSRepositoryModule.forRoot({
                      adapter: options.adapter,
                      dbClient: options.dbClient ?? mainDb,
                      lazyConfig: true,
                  }),
            ...(options.otherAdapter
                ? [
                      VSRepositoryModule.forRoot({
                          adapter: options.otherAdapter,
                          dbClient: otherDb,
                          lazyConfig: true,
                          contextName: "other",
                      }),
                  ]
                : []),
            FeatureModule,
        ],
    })
    class AppModule {}

    const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });

    return { app, mainDb, otherDb };
}

describe("@Transactional", () => {
    let app: Awaited<ReturnType<typeof createApp>>["app"] | undefined;

    beforeEach(() => {
        staticCalls.length = 0;
        calls.length = 0;
        instanceRuns = 0;
    });

    afterEach(async () => {
        await app?.close();
        app = undefined;
    });

    describe("with an adapter that has a static execInTransaction", () => {
        it("opens the transaction through it, from the context's db client", async () => {
            const created = await createApp({ adapter: StaticAdapterClass, providers: [PlainService] });
            app = created.app;

            const tx = await app.get(PlainService).inTransaction();

            expect(tx).toEqual({ kind: "tx", id: "main-tx1" });
            expect(created.mainDb.events).toEqual(["begin main-tx1", "commit main-tx1"]);
            expect(staticCalls).toHaveLength(1);
            expect(staticCalls[0]?.dbClient).toBe(created.mainDb);
            expect(instanceRuns).toBe(0);
        });

        it("calls it on the adapter class, so `this` is the class", async () => {
            const created = await createApp({ adapter: StaticAdapterClass, providers: [PlainService] });
            app = created.app;

            await app.get(PlainService).inTransaction();

            expect(staticCalls[0]?.self).toBe(StaticAdapter);
        });

        it("works without any forFeature: no adapter instance is needed", async () => {
            const created = await createApp({ adapter: StaticAdapterClass, providers: [PlainService] });
            app = created.app;

            await expect(app.get(PlainService).manager.run(async () => "done")).resolves.toBe("done");
            expect(created.mainDb.events).toEqual(["begin main-tx1", "commit main-tx1"]);
        });

        it("passes isolationLevel and timeoutMs along, and nothing else", async () => {
            const created = await createApp({ adapter: StaticAdapterClass, providers: [PlainService] });
            app = created.app;

            await app.get(PlainService).inTransaction();
            await app.get(PlainService).withOptions();

            expect(staticCalls[0]?.options).toEqual({});
            expect(staticCalls[1]?.options).toEqual({ isolationLevel: "Serializable", timeoutMs: 1234 });
        });

        it("rolls back and rethrows when the method throws", async () => {
            const created = await createApp({ adapter: StaticAdapterClass, providers: [PlainService] });
            app = created.app;

            await expect(app.get(PlainService).failing()).rejects.toThrow("boom");

            expect(created.mainDb.events).toEqual(["begin main-tx1", "rollback main-tx1"]);
        });

        it("still makes the repositories take part, and repository.transaction() joins without opening another", async () => {
            const created = await createApp({
                adapter: StaticAdapterClass,
                providers: [UserRepository, RepositoryService],
                features: [VSRepositoryModule.forFeature("user", {})],
            });
            app = created.app;

            await app.get(RepositoryService).work();

            expect(calls.map(c => c.db)).toEqual([
                { kind: "tx", id: "main-tx1" },
                { kind: "tx", id: "main-tx1" },
            ]);
            expect(created.mainDb.events).toEqual(["begin main-tx1", "commit main-tx1"]);
            expect(staticCalls).toHaveLength(1);
            expect(instanceRuns).toBe(0);
        });

        it("works when the adapter class and db client come from forRootAsync", async () => {
            const created = await createApp({ adapter: StaticAdapterClass, providers: [PlainService], async: true });
            app = created.app;

            await app.get(PlainService).inTransaction();

            expect(staticCalls).toHaveLength(1);
            expect(staticCalls[0]?.dbClient).toBe(created.mainDb);
        });

        it("uses the adapter class and db client of the context the method asks for", async () => {
            const created = await createApp({
                adapter: StaticAdapterClass,
                otherAdapter: StaticAdapterClass,
                providers: [PlainService],
            });
            app = created.app;

            const scopes = await app.get(PlainService).inOtherContext();

            expect(scopes).toEqual({ main: undefined, other: { kind: "tx", id: "other-tx1" } });
            expect(staticCalls).toHaveLength(1);
            expect(staticCalls[0]?.dbClient).toBe(created.otherDb);
            expect(created.mainDb.events).toEqual([]);
        });
    });

    describe("with the real Prisma7Adapter", () => {
        it("opens the transaction with $transaction, mapping isolationLevel and timeoutMs", async () => {
            const prismaTx = { kind: "prisma-tx" };
            const transactionArgs: unknown[] = [];
            const prisma = {
                $transaction: async (fn: (tx: unknown) => Promise<unknown>, options: unknown) => {
                    transactionArgs.push(options);
                    return fn(prismaTx);
                },
            };

            const created = await createApp({
                adapter: Prisma7Adapter,
                providers: [PlainService],
                dbClient: prisma,
            });
            app = created.app;

            const tx = await app.get(PlainService).withOptions();

            expect(tx).toBe(prismaTx);
            expect(transactionArgs).toEqual([{ isolationLevel: "Serializable", timeout: 1234 }]);
        });
    });

    describe("with an adapter that doesn't have it", () => {
        const MISSING_HOOK = "PlainAdapter doesn't implement the static execInTransaction()";

        it("throws an error explaining it, without running the method or opening a transaction", async () => {
            const created = await createApp({
                adapter: PlainAdapterClass,
                providers: [UserRepository, RepositoryService],
                features: [VSRepositoryModule.forFeature("user", {})],
            });
            app = created.app;

            await expect(app.get(RepositoryService).work()).rejects.toThrow(MISSING_HOOK);

            expect(calls).toEqual([]);
            expect(instanceRuns).toBe(0);
            expect(created.mainDb.events).toEqual([]);
        });

        it("names the way out in the error", async () => {
            const created = await createApp({ adapter: PlainAdapterClass, providers: [PlainService] });
            app = created.app;

            await expect(app.get(PlainService).inTransaction()).rejects.toThrow("Use an adapter that implements it");
        });

        it("throws from manager.run() too", async () => {
            const created = await createApp({ adapter: PlainAdapterClass, providers: [PlainService] });
            app = created.app;

            await expect(app.get(PlainService).manager.run(async () => "never")).rejects.toThrow(MISSING_HOOK);
        });

        it("only fails when a transaction is requested: the app boots and repositories keep working", async () => {
            const created = await createApp({
                adapter: PlainAdapterClass,
                providers: [UserRepository, RepositoryService],
                features: [VSRepositoryModule.forFeature("user", {})],
            });
            app = created.app;

            const { users } = app.get(RepositoryService);
            await users.get("1");
            await users.transaction(async tx => {
                await users.get("2", { db: tx });
            });

            expect(calls.map(c => c.db)).toEqual([created.mainDb, { kind: "tx", id: "main-tx1" }]);
            expect(instanceRuns).toBe(1);
        });

        it("only affects the context whose adapter lacks the hook", async () => {
            const created = await createApp({
                adapter: PlainAdapterClass,
                otherAdapter: StaticAdapterClass,
                providers: [PlainService],
            });
            app = created.app;

            await expect(app.get(PlainService).inTransaction()).rejects.toThrow(MISSING_HOOK);

            const scopes = await app.get(PlainService).inOtherContext();

            expect(scopes.other).toEqual({ kind: "tx", id: "other-tx1" });
            expect(staticCalls).toHaveLength(1);
            expect(instanceRuns).toBe(0);
        });
    });
});
