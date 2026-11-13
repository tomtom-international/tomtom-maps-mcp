import { describe, expect, it } from "vitest";
import { environmentFromEnv } from "./environments";

describe("environmentFromEnv", () => {
  it("defaults to prod signing in through ULS prod", () => {
    const env = environmentFromEnv({});

    expect(env.target).toBe("prod");
    expect(env.ulsEnv).toBe("prod");
    expect(env.authorizationServer).toBe("https://oauth.my.tomtom.com");
    expect(env.exchangedKeysServeApi).toBe(true);
  });

  it("expects dev on ULS prod when no ULS environment is given", () => {
    const env = environmentFromEnv({ OAUTH_E2E_TARGET: "dev" });

    expect(env.ulsEnv).toBe("prod");
    expect(env.authorizationServer).toBe("https://oauth.my.tomtom.com");
    expect(env.exchangedKeysServeApi).toBe(true);
  });

  it("expects dev on ULS staging, whose keys the TomTom APIs reject, when told so", () => {
    const env = environmentFromEnv({ OAUTH_E2E_TARGET: "dev", OAUTH_E2E_ULS_ENV: "staging" });

    expect(env.ulsEnv).toBe("staging");
    expect(env.authorizationServer).toBe("https://staging.oauth.my.tomtom.com");
    expect(env.exchangedKeysServeApi).toBe(false);
  });

  it("expects local on the ULS environment it is given", () => {
    const env = environmentFromEnv({ OAUTH_E2E_TARGET: "local", OAUTH_E2E_ULS_ENV: "staging" });

    expect(env.authorizationServer).toBe("https://staging.oauth.my.tomtom.com");
  });

  it("refuses prod on ULS staging", () => {
    expect(() =>
      environmentFromEnv({ OAUTH_E2E_TARGET: "prod", OAUTH_E2E_ULS_ENV: "staging" })
    ).toThrow('OAUTH_E2E_ULS_ENV is "staging" but prod signs in through ULS prod only; unset it or use prod');
  });

  it("refuses an unknown ULS environment", () => {
    expect(() => environmentFromEnv({ OAUTH_E2E_ULS_ENV: "stg" })).toThrow(
      'OAUTH_E2E_ULS_ENV is "stg"; use one of staging, prod'
    );
  });

  it("refuses an unknown target", () => {
    expect(() => environmentFromEnv({ OAUTH_E2E_TARGET: "test" })).toThrow(
      'OAUTH_E2E_TARGET is "test"; use one of prod, dev, local'
    );
  });
});
