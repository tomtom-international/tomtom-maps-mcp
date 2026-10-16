import type { Target } from "./environments";
import type { Credentials, Tenant } from "./login";

export type AccountKind = "b2b" | "b2c";

export interface Account {
  kind: AccountKind;
  tenant: Tenant;
  variables: { email: string; password: string };
  credentials?: Credentials;
}

const VARIABLE_PREFIXES: Record<AccountKind, Partial<Record<Target, string>>> = {
  b2b: { prod: "E2E_B2B" },
  b2c: { prod: "E2E_B2C_PROD", dev: "E2E_B2C_DEV", local: "E2E_B2C_DEV" },
};

const TENANTS: Record<AccountKind, Tenant> = { b2b: "workforce", b2c: "external" };

export function accountsFor(target: Target, env: NodeJS.ProcessEnv = process.env): Account[] {
  return (Object.keys(VARIABLE_PREFIXES) as AccountKind[]).flatMap((kind) => {
    const prefix = VARIABLE_PREFIXES[kind][target];
    if (!prefix) return [];
    const variables = { email: `${prefix}_EMAIL`, password: `${prefix}_PASSWORD` };
    const email = env[variables.email];
    const password = env[variables.password];
    return [
      {
        kind,
        tenant: TENANTS[kind],
        variables,
        credentials: email && password ? { email, password } : undefined,
      },
    ];
  });
}
