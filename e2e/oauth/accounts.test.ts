import { describe, expect, it } from "vitest";
import { accountsFor } from "./accounts";

const prefixes = (accounts: ReturnType<typeof accountsFor>) =>
  accounts.map((account) => `${account.kind}:${account.variables.email}`);

describe("accountsFor", () => {
  it("signs in to prod as a workforce and an external user of ULS prod", () => {
    expect(prefixes(accountsFor({ target: "prod", ulsEnv: "prod" }, {}))).toEqual([
      "b2b:E2E_B2B_EMAIL",
      "b2c:E2E_B2C_PROD_EMAIL",
    ]);
  });

  it("signs in to dev on ULS prod as the external user of ULS prod only", () => {
    expect(prefixes(accountsFor({ target: "dev", ulsEnv: "prod" }, {}))).toEqual([
      "b2c:E2E_B2C_PROD_EMAIL",
    ]);
  });

  it("signs in to dev on ULS staging as the external user of ULS staging only", () => {
    expect(prefixes(accountsFor({ target: "dev", ulsEnv: "staging" }, {}))).toEqual([
      "b2c:E2E_B2C_DEV_EMAIL",
    ]);
  });

  it("reads the credentials of the account it picks", () => {
    const [account] = accountsFor(
      { target: "dev", ulsEnv: "staging" },
      { E2E_B2C_DEV_EMAIL: "dev@example.com", E2E_B2C_DEV_PASSWORD: "secret" }
    );

    expect(account.credentials).toEqual({ email: "dev@example.com", password: "secret" });
  });

  it("leaves the credentials out when the password is missing", () => {
    const [account] = accountsFor(
      { target: "dev", ulsEnv: "staging" },
      { E2E_B2C_DEV_EMAIL: "dev@example.com" }
    );

    expect(account.credentials).toBeUndefined();
  });
});
