import type { Environment } from "./environments";
import type { Credentials, Tenant } from "./login";

export type AccountKind = "b2b" | "b2c";

export interface Account {
  kind: AccountKind;
  tenant: Tenant;
  variables: { email: string; password: string };
  credentials?: Credentials;
}

type SignInEnvironment = Pick<Environment, "target" | "ulsEnv">;

const VARIABLE_PREFIXES: Record<AccountKind, (environment: SignInEnvironment) => string | undefined> = {
  // The workforce tenant holds no resource app for the dev origin yet.
  b2b: ({ target }) => (target === "prod" ? "E2E_B2B" : undefined),
  b2c: ({ ulsEnv }) => (ulsEnv === "prod" ? "E2E_B2C_PROD" : "E2E_B2C_DEV"),
};

const TENANTS: Record<AccountKind, Tenant> = { b2b: "workforce", b2c: "external" };

export function accountsFor(environment: SignInEnvironment, env: NodeJS.ProcessEnv = process.env): Account[] {
  return (Object.keys(VARIABLE_PREFIXES) as AccountKind[]).flatMap((kind) => {
    const prefix = VARIABLE_PREFIXES[kind](environment);
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
