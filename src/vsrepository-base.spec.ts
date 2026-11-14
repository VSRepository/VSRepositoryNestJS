import "reflect-metadata";
import { DynamicModule, Inject, Injectable, Module, Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DynamicMethod, VSLogLevel, VSRepository, type VSRepoAdapterConstructor } from "vsrepo";
import { InjectAdapter, InjectVSRepoConfig } from "./utils.js";
import { VSRepositoryBase } from "./vsrepository-base.js";
import { VSRepositoryModule } from "./vsrepository.module.js";

type User = { id: string; uuid: string; name: string };

class FakeDb {
    constructor(readonly name: string) {}
}

/** Where clauses received by the adapter, in order. */
const calls: { method: string; where: any }[] = [];

class FakeAdapter {
    constructor(
        private readonly db: FakeDb,
        readonly config: Record<string, unknown>,
    ) {}

    getPkName() {
        return "id";
    }

    getDbClient() {
        return this.db;
    }

    runInTransaction(fn: (tx: any) => Promise<any>) {
        return fn(this.db);
    }

    async findOne(where: unknown) {
        calls.push({ method: "findOne", where });
        return null;
    }

    async findMany(where: unknown) {
        calls.push({ method: "findMany", where });
        return [];
    }
}

const FakeAdapterClass = FakeAdapter as unknown as VSRepoAdapterConstructor;

const quiet = { logLevel: VSLogLevel.NONE };

/**
 * Boots an app with a default context (and, optionally, an "other" one). `abortOnError: false`
 * makes initialization failures reject instead of aborting the whole test process.
 */
async function createApp(options: {
    providers: Type[];
    features: DynamicModule[];
    root?: Record<string, unknown>;
    withOtherContext?: boolean;
}) {
    const mainDb = new FakeDb("main");
    const otherDb = new FakeDb("other");

    @Module({ imports: options.features, providers: options.providers })
    class FeatureModule {}

    @Module({
        imports: [
            VSRepositoryModule.forRoot({
                adapter: FakeAdapterClass,
                dbClient: mainDb,
                lazyConfig: true,
                ...options.root,
            }),
            ...(options.withOtherContext
                ? [
                      VSRepositoryModule.forRoot({
                          adapter: FakeAdapterClass,
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

describe("VSRepositoryBase", () => {
    let app: Awaited<ReturnType<typeof createApp>>["app"] | undefined;

    beforeEach(() => {
        calls.length = 0;
    });

    afterEach(async () => {
        await app?.close();
        app = undefined;
        VSRepository.setGlobalConfig({}); // some tests set the (static) global config
    });

    describe("adapter injection", () => {
        it("injects the unnamed adapter of forFeature(config) when no entityName is given", async () => {
            @Injectable()
            class UserRepository extends VSRepositoryBase<User, string>(quiet) {}

            const created = await createApp({
                providers: [UserRepository],
                features: [VSRepositoryModule.forFeature({})],
            });
            app = created.app;

            const repository = app.get(UserRepository);
            await repository.get("1");

            expect(repository.getDbClient()).toBe(created.mainDb);
            expect(calls[0]).toEqual({ method: "findOne", where: { id: "1" } });
        });

        it("injects the named adapter of forFeature(entityName, config) when only entityName is given", async () => {
            @Injectable()
            class UserRepository extends VSRepositoryBase<User, string>({ ...quiet, entityName: "user" }) {}

            const created = await createApp({
                providers: [UserRepository],
                features: [VSRepositoryModule.forFeature("user", { tag: "user" })],
            });
            app = created.app;

            const repository = app.get(UserRepository);

            expect(repository.getAdapter<any>().config).toEqual({ tag: "user" });
            expect(repository.getDbClient()).toBe(created.mainDb);
        });

        it("injects the adapter of the chosen context when entityName and contextName are given", async () => {
            @Injectable()
            class MainRepository extends VSRepositoryBase<User, string>({ ...quiet, entityName: "user" }) {}

            @Injectable()
            class OtherRepository extends VSRepositoryBase<User, string>({
                ...quiet,
                entityName: "user",
                contextName: "other",
            }) {}

            const created = await createApp({
                providers: [MainRepository, OtherRepository],
                features: [
                    VSRepositoryModule.forFeature("user", { tag: "main" }),
                    VSRepositoryModule.forFeature("user", { tag: "other" }, "other"),
                ],
                withOtherContext: true,
            });
            app = created.app;

            const main = app.get(MainRepository);
            const other = app.get(OtherRepository);

            expect(main.getDbClient()).toBe(created.mainDb);
            expect(main.getAdapter<any>().config).toEqual({ tag: "main" });
            expect(other.getDbClient()).toBe(created.otherDb);
            expect(other.getAdapter<any>().config).toEqual({ tag: "other" });
        });

        it("fails to initialize when the adapter it asks for was not provided by a forFeature", async () => {
            @Injectable()
            class UserRepository extends VSRepositoryBase<User, string>({ ...quiet, entityName: "user" }) {}

            await expect(
                createApp({ providers: [UserRepository], features: [VSRepositoryModule.forFeature("audit", {})] }),
            ).rejects.toThrow("Nest can't resolve dependencies");
        });

        it("never lets options replace the injected adapter", async () => {
            const intruder = new FakeAdapter(new FakeDb("intruder"), {});

            @Injectable()
            class UserRepository extends VSRepositoryBase<User, string>({ ...quiet, adapter: intruder } as any) {}

            const created = await createApp({
                providers: [UserRepository],
                features: [VSRepositoryModule.forFeature({})],
            });
            app = created.app;

            expect(app.get(UserRepository).getAdapter()).not.toBe(intruder);
            expect(app.get(UserRepository).getDbClient()).toBe(created.mainDb);
        });
    });

    describe("subclasses", () => {
        it("can declare their own constructor to inject extra dependencies", async () => {
            @Injectable()
            class Clock {
                readonly now = "now";
            }

            @Injectable()
            class UserRepository extends VSRepositoryBase<User, string>({ ...quiet, entityName: "user" }) {
                constructor(
                    @InjectAdapter("user") adapter: any,
                    @InjectVSRepoConfig() config: any,
                    @Inject(Clock) readonly clock: Clock,
                ) {
                    super(adapter, config);
                }
            }

            const created = await createApp({
                providers: [Clock, UserRepository],
                features: [VSRepositoryModule.forFeature("user", {})],
            });
            app = created.app;

            const repository = app.get(UserRepository);

            expect(repository.clock.now).toBe("now");
            expect(repository.getDbClient()).toBe(created.mainDb);
        });
    });

    describe("config precedence", () => {
        it("uses the adapter's pkName unless the options override it", async () => {
            @Injectable()
            class DefaultPk extends VSRepositoryBase<User, string>(quiet) {}

            @Injectable()
            class OverriddenPk extends VSRepositoryBase<User, string>({ ...quiet, pkName: "uuid" }) {}

            const created = await createApp({
                providers: [DefaultPk, OverriddenPk],
                features: [VSRepositoryModule.forFeature({})],
            });
            app = created.app;

            await app.get(DefaultPk).get("1");
            await app.get(OverriddenPk).get("1");

            expect(calls.map(c => c.where)).toEqual([{ id: "1" }, { uuid: "1" }]);
        });
    });

    describe("lazyDynamicMethods", () => {
        /** Counts the calls to the (protected) method, which warns when called twice. */
        const spyOnResolve = (repository: Type) => vi.spyOn(repository.prototype as any, "resolveDynamicMethods");

        it("resolves the dynamic methods once, in the constructor, when the module isn't lazy", async () => {
            @Injectable()
            class UserRepository extends VSRepositoryBase<User, string>(quiet) {
                @DynamicMethod() declare findByName: (name: string) => Promise<User[]>;
            }
            const spy = spyOnResolve(UserRepository);

            const created = await createApp({
                providers: [UserRepository],
                features: [VSRepositoryModule.forFeature({})],
            });
            app = created.app;

            expect(spy).toHaveBeenCalledTimes(1);
            expect(typeof app.get(UserRepository).findByName).toBe("function");
        });

        it("resolves them once, on module init, when the module sets lazyDynamicMethods", async () => {
            @Injectable()
            class UserRepository extends VSRepositoryBase<User, string>(quiet) {
                @DynamicMethod() declare findByName: (name: string) => Promise<User[]>;
            }
            const spy = spyOnResolve(UserRepository);

            const created = await createApp({
                providers: [UserRepository],
                features: [VSRepositoryModule.forFeature({})],
                root: { lazyDynamicMethods: true },
            });
            app = created.app;

            const repository = app.get(UserRepository);
            await repository.findByName("john");

            expect(spy).toHaveBeenCalledTimes(1);
            expect(calls[0]).toEqual({ method: "findMany", where: { name: "john" } });
        });

        it("lets the repository options turn it on over a non-lazy module", async () => {
            @Injectable()
            class UserRepository extends VSRepositoryBase<User, string>({ ...quiet, lazyDynamicMethods: true }) {}
            const spy = spyOnResolve(UserRepository);

            const created = await createApp({
                providers: [UserRepository],
                features: [VSRepositoryModule.forFeature({})],
            });
            app = created.app;

            expect(spy).toHaveBeenCalledTimes(1);
        });

        it("lets the repository options turn it off over a lazy module", async () => {
            @Injectable()
            class UserRepository extends VSRepositoryBase<User, string>({ ...quiet, lazyDynamicMethods: false }) {}
            const spy = spyOnResolve(UserRepository);

            const created = await createApp({
                providers: [UserRepository],
                features: [VSRepositoryModule.forFeature({})],
                root: { lazyDynamicMethods: true },
            });
            app = created.app;

            // only the constructor resolved them: onModuleInit must not resolve them a second time
            expect(spy).toHaveBeenCalledTimes(1);
        });

        it("also honors a lazyDynamicMethods set through VSRepository.setGlobalConfig", async () => {
            // the effective value is only known to the core, which writes it back into the config it receives
            VSRepository.setGlobalConfig({ lazyDynamicMethods: true });

            @Injectable()
            class UserRepository extends VSRepositoryBase<User, string>(quiet) {
                @DynamicMethod() declare findByName: (name: string) => Promise<User[]>;
            }
            const spy = spyOnResolve(UserRepository);

            const created = await createApp({
                providers: [UserRepository],
                features: [VSRepositoryModule.forFeature({})],
            });
            app = created.app;

            expect(spy).toHaveBeenCalledTimes(1);
            expect(typeof app.get(UserRepository).findByName).toBe("function");
        });
    });
});
