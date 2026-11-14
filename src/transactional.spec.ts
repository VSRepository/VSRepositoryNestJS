import "reflect-metadata";
import { Inject, Injectable, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { VSLogLevel, VSRepository, type VSRepoAdapterConstructor } from "vsrepo";
import type { VSRepoTransactionManager } from "./transaction-manager.js";
import { Transactional } from "./transactional.decorator.js";
import { getTransactionManagerToken, InjectAdapter } from "./utils.js";
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

/** Options received by every adapter call, in order. */
const calls: { method: string; options: any }[] = [];

class FakeAdapter {
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
        return this.db.transaction(fn);
    }

    async findOne(_where: unknown, options: any) {
        calls.push({ method: "findOne", options });
        return null;
    }

    async findMany(_where: unknown, options: any) {
        calls.push({ method: "findMany", options });
        return [];
    }

    async create(obj: unknown, options: any) {
        calls.push({ method: "create", options });
        return obj;
    }
}

const FakeAdapterClass = FakeAdapter as unknown as VSRepoAdapterConstructor;

@Injectable()
class UserRepository extends VSRepository<User, string> {
    constructor(@InjectAdapter("user") adapter: any) {
        super({ adapter, logLevel: VSLogLevel.NONE });
    }
}

@Injectable()
class AuditRepository extends VSRepository<User, string> {
    constructor(@InjectAdapter("audit") adapter: any) {
        super({ adapter, logLevel: VSLogLevel.NONE });
    }
}

@Injectable()
class OtherRepository extends VSRepository<User, string> {
    constructor(@InjectAdapter("user", "other") adapter: any) {
        super({ adapter, logLevel: VSLogLevel.NONE });
    }
}

let mainDb: FakeDb;

@Injectable()
class Service {
    constructor(
        @Inject(UserRepository) readonly users: UserRepository,
        @Inject(AuditRepository) readonly audit: AuditRepository,
        @Inject(OtherRepository) readonly other: OtherRepository,
    ) {}

    async outside() {
        await this.users.get("1");
    }

    @Transactional()
    async twoRepositories() {
        await this.users.get("1");
        await this.audit.create({ id: "a", name: "audit" });
        await this.users.findOne({ name: "x" });
    }

    @Transactional()
    async withReadOptions() {
        await this.users.get("1", { select: { id: true } as any, relations: { posts: true } as any });
        await this.users.find({}, { order: { name: "asc" }, pagination: { limit: 5 } });
    }

    @Transactional()
    async explicitDb() {
        await this.users.get("1", { db: mainDb as any });
    }

    @Transactional()
    async failing() {
        await this.users.get("1");
        throw new Error("boom");
    }

    @Transactional()
    async nestedInner() {
        await this.users.get("1");
    }

    @Transactional()
    async nestedOuter() {
        await this.users.get("1");
        await this.nestedInner();
        await this.users.get("2");
    }

    @Transactional()
    async withRepositoryTransaction() {
        await this.users.transaction(async tx => {
            await this.users.get("1", { db: tx });
        });
    }

    @Transactional({ contextName: "other" })
    async otherContext() {
        await this.other.get("1");
        await this.users.get("1"); // default context: stays outside the transaction
    }

    @Transactional()
    async identify(label: string) {
        await new Promise(resolve => setTimeout(resolve, label === "slow" ? 20 : 1));
        await this.users.get(label);
        return label;
    }

    @Transactional()
    syncMethod() {
        return 42;
    }

    @Transactional({ contextName: "missing" })
    async missingContext() {
        return 1;
    }
}

@Module({
    imports: [
        VSRepositoryModule.forFeature("user", {}),
        VSRepositoryModule.forFeature("audit", {}),
        VSRepositoryModule.forFeature("user", {}, "other"),
    ],
    providers: [UserRepository, AuditRepository, OtherRepository, Service],
})
class FeatureModule {}

describe("@Transactional", () => {
    let otherDb: FakeDb;
    let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
    let service: Service;

    beforeEach(async () => {
        calls.length = 0;
        mainDb = new FakeDb("main");
        otherDb = new FakeDb("other");

        // the db clients are part of the module declaration, so the root module is rebuilt per test
        @Module({
            imports: [
                VSRepositoryModule.forRoot({ adapter: FakeAdapterClass, dbClient: mainDb, lazyConfig: true }),
                VSRepositoryModule.forRoot({
                    adapter: FakeAdapterClass,
                    dbClient: otherDb,
                    lazyConfig: true,
                    contextName: "other",
                }),
                FeatureModule,
            ],
        })
        class AppModule {}

        app = await NestFactory.createApplicationContext(AppModule, { logger: false });
        service = app.get(Service);
    });

    afterEach(async () => {
        await app.close();
    });

    it("leaves calls outside @Transactional on the root client", async () => {
        await service.outside();

        expect(calls[0]?.options.db).toBe(mainDb);
        expect(mainDb.events).toEqual([]);
    });

    it("makes every repository of the context use one transaction, without { db }", async () => {
        await service.twoRepositories();

        expect(mainDb.events).toEqual(["begin main-tx1", "commit main-tx1"]);
        expect(calls).toHaveLength(3);
        for (const call of calls) {
            expect(call.options.db).toEqual({ kind: "tx", id: "main-tx1" });
        }
    });

    it("keeps select, relations, order and pagination while applying the transaction", async () => {
        await service.withReadOptions();

        expect(calls[0]?.options.select).toEqual({ id: true });
        expect(calls[0]?.options.relations).toEqual({ posts: true });
        expect(calls[0]?.options.db).toEqual({ kind: "tx", id: "main-tx1" });
        expect(calls[1]?.options.order).toEqual({ name: "asc" });
        expect(calls[1]?.options.pagination).toEqual({ limit: 5 });
        expect(calls[1]?.options.db).toEqual({ kind: "tx", id: "main-tx1" });
    });

    it("lets an explicit db win over the transaction", async () => {
        await service.explicitDb();

        expect(calls[0]?.options.db).toBe(mainDb);
        expect(mainDb.events).toEqual(["begin main-tx1", "commit main-tx1"]);
    });

    it("rolls back and rethrows when the method throws", async () => {
        await expect(service.failing()).rejects.toThrow("boom");

        expect(mainDb.events).toEqual(["begin main-tx1", "rollback main-tx1"]);
    });

    it("joins the active transaction when a @Transactional method calls another one", async () => {
        await service.nestedOuter();

        expect(mainDb.events).toEqual(["begin main-tx1", "commit main-tx1"]);
        expect(calls.map(c => c.options.db.id)).toEqual(["main-tx1", "main-tx1", "main-tx1"]);
    });

    it("makes repository.transaction() join the active transaction", async () => {
        await service.withRepositoryTransaction();

        expect(mainDb.events).toEqual(["begin main-tx1", "commit main-tx1"]);
        expect(calls[0]?.options.db).toEqual({ kind: "tx", id: "main-tx1" });
    });

    it("keeps repository.transaction() working outside of a scope", async () => {
        await service.users.transaction(async tx => {
            await service.users.get("1", { db: tx });
        });

        expect(mainDb.events).toEqual(["begin main-tx1", "commit main-tx1"]);
    });

    it("only affects the repositories of the chosen context", async () => {
        await service.otherContext();

        expect(otherDb.events).toEqual(["begin other-tx1", "commit other-tx1"]);
        expect(mainDb.events).toEqual([]);
        expect(calls[0]?.options.db).toEqual({ kind: "tx", id: "other-tx1" });
        expect(calls[1]?.options.db).toBe(mainDb);
    });

    it("isolates concurrent scopes from each other", async () => {
        await Promise.all([service.identify("slow"), service.identify("fast")]);

        const txIds = calls.map(c => c.options.db.id);

        expect(new Set(txIds).size).toBe(2);
        expect(mainDb.events.filter(e => e.startsWith("commit"))).toHaveLength(2);
    });

    it("turns a sync method into an async one that still returns its value", async () => {
        await expect(service.syncMethod()).resolves.toBe(42);
        expect(mainDb.events).toEqual(["begin main-tx1", "commit main-tx1"]);
    });

    it("fails with a clear error when the context isn't initialized", () => {
        expect(() => service.missingContext()).toThrow("not initialized for the context 'missing'");
    });

    it("exposes the active transaction through the manager", async () => {
        const manager = app.get<VSRepoTransactionManager>(getTransactionManagerToken());

        expect(manager.current()).toBeUndefined();
        await manager.run(async () => {
            expect(manager.current()).toEqual({ kind: "tx", id: "main-tx1" });
        });
        expect(manager.current()).toBeUndefined();
    });
});

describe("@Transactional decorator", () => {
    it("keeps metadata set by other decorators and the method name", () => {
        const original = async function handler() {
            return 1;
        };
        Reflect.defineMetadata("custom:meta", "route:/x", original);

        const descriptor: PropertyDescriptor = { value: original };
        Transactional()({}, "handler", descriptor as TypedPropertyDescriptor<unknown>);

        expect(descriptor.value).not.toBe(original);
        expect(Reflect.getMetadata("custom:meta", descriptor.value)).toBe("route:/x");
        expect(descriptor.value.name).toBe("handler");
    });

    it("rejects being applied to something that isn't a method", () => {
        expect(() => Transactional()({}, "x", { value: 1 } as TypedPropertyDescriptor<unknown>)).toThrow(
            "only be applied to methods",
        );
    });
});
