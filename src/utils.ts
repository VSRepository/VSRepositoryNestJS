import { Inject } from "@nestjs/common";
import { ADAPTER_CLASS, DB_CLIENT, MODULE_OPTIONS, VSREPO_CONFIG } from "./constants.js";

export function getAdapterToken(entityName: string, contextName?: string): string {
    return `VSRepoAdapter(${entityName}${contextName ? `:${contextName}` : ""})`;
}

export const InjectAdapter = (entityName: string, contextName?: string) =>
    Inject(getAdapterToken(entityName, contextName));

export function getAdapterClassToken(contextName?: string): string | symbol {
    return contextName ? `VSRepoAdapterClass(${contextName})` : ADAPTER_CLASS;
}

export function getVSRepoModuleOptionsToken(contextName?: string): string | symbol {
    return contextName ? `VSRepoModuleOptions(${contextName})` : MODULE_OPTIONS;
}

export function getDbClientToken(contextName?: string): string | symbol {
    return contextName ? `DbClient(${contextName})` : DB_CLIENT;
}

export function getVSRepoConfigToken(contextName?: string): string | symbol {
    return contextName ? `VSRepoConfig(${contextName})` : VSREPO_CONFIG;
}

export const InjectVSRepoConfig = (contextName?: string) => Inject(getVSRepoConfigToken(contextName));
