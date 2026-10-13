import type { Target } from "./environments";
import type { Credentials, Tenant } from "./login";

export type AccountKind = "b2b" | "b2c";

export interface Account {
  kind: AccountKind;
  tenant: Tenant;
  variables: { email: string; password: string };
  credentials?: Credentials;
}

const VARIABLES: Record<AccountKind, Record<Target, { email: string; password: string }>> = {
  b2b: {
    prod: { email: "E2E_B2B_EMAIL", password: "E2E_B2B_PASSWORD" },
    dev: { email: "E2E_B2B_EMAIL", password: "E2E_B2B_PASSWORD" },
  },
  b2c: {
    prod: { email: "E2E_B2C_PROD_EMAIL", password: "E2E_B2C_PROD_PASSWORD" },
    dev: { email: "E2E_B2C_DEV_EMAIL", password: "E2E_B2C_DEV_PASSWORD" },
  },
};

const TENANTS: Record<AccountKind, Tenant> = { b2b: "workforce", b2c: "external" };

export function accountsFor(target: Target, env: NodeJS.ProcessEnv = process.env): Account[] {
  return (Object.keys(VARIABLES) as AccountKind[]).map((kind) => {
    const variables = VARIABLES[kind][target];
    const email = env[variables.email];
    const password = env[variables.password];
    return {
      kind,
      tenant: TENANTS[kind],
      variables,
      credentials: email && password ? { email, password } : undefined,
    };
  });
}
