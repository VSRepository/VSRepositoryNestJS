import { Inject } from "@nestjs/common";

export function getAdapterToken(entityName: string): string {
    return `VSRepoAdapter(${entityName})`;
}

export const InjectAdapter = (entityName: string) => Inject(getAdapterToken(entityName));
