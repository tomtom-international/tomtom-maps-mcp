import type { Page } from "@playwright/test";
import type { AuthorizationRequest } from "./connectorClient";
import type { Connector } from "./environments";

export type Tenant = "workforce" | "external";

export interface Credentials {
  email: string;
  password: string;
}

export interface PendingAuthorization {
  redirect: Promise<URL>;
  state: string;
}

const TENANT_CHOICES: Record<Tenant, string> = {
  workforce: "Enterprise sign in (SSO)",
  external: "Register / sign in",
};
const LOGIN_PAGES: Record<Tenant, { url: RegExp; emailField: string }> = {
  workforce: { url: /login\.microsoftonline\.com/, emailField: "input[type=email]" },
  external: { url: /ciamlogin\.com/, emailField: "input[placeholder='Email address']" },
};
const LOGIN_PAGE_TIMEOUT = 20_000;
const IMMEDIATE_REDIRECT_TIMEOUT = 3_000;
const REDIRECT_TIMEOUT = 60_000;

export async function chooseTenant(
  page: Page,
  { url, state }: AuthorizationRequest,
  connector: Connector,
  tenant: Tenant
): Promise<PendingAuthorization> {
  const redirect = captureRedirect(page, connector.redirectUri);
  redirect.catch(() => undefined); // Awaited later; this keeps an early failure from also surfacing as an unhandled rejection.

  const navigation = await page.goto(url.href, { waitUntil: "domcontentloaded" }).then(
    () => undefined,
    (error: Error) => error
  );
  if (navigation) {
    // ULS may answer with a redirect straight away; its host resolves to localhost, so goto fails.
    const early = await Promise.race([redirect, rejectAfter(IMMEDIATE_REDIRECT_TIMEOUT, navigation)]);
    throw new Error(`ULS redirected before any login: ${authorizationOutcome(early)}`);
  }
  await rejectUlsError(page, url.origin);
  await page.getByText(TENANT_CHOICES[tenant], { exact: true }).click();
  await page.waitForURL(LOGIN_PAGES[tenant].url, { timeout: LOGIN_PAGE_TIMEOUT });
  return { redirect, state };
}

export async function authenticate(page: Page, tenant: Tenant, { email, password }: Credentials): Promise<void> {
  await page.locator(LOGIN_PAGES[tenant].emailField).fill(email);
  await page.getByRole("button", { name: "Next" }).click();
  await page.locator("input[type=password]").fill(password);
  await page.getByRole("button", { name: /sign in|continue/i }).click();
  await declineStaySignedIn(page);
}

export async function receiveAuthorizationCode({ redirect, state }: PendingAuthorization): Promise<string> {
  const url = await redirect;
  if (url.searchParams.get("state") !== state) {
    throw new Error("The authorization response carries a state this login did not send");
  }
  const code = url.searchParams.get("code");
  if (!code) throw new Error(`Authorization failed: ${authorizationOutcome(url)}`);
  return code;
}

function authorizationOutcome(redirect: URL): string {
  if (redirect.searchParams.has("code")) return "a code was issued";
  const error = redirect.searchParams.get("error") ?? "no code";
  const description = redirect.searchParams.get("error_description") ?? "";
  return `${error} ${description}`.trim();
}

function rejectAfter(ms: number, error: Error): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(error), ms));
}

function captureRedirect(page: Page, redirectUri: string): Promise<URL> {
  const redirected = page.waitForRequest((request) => request.url().startsWith(redirectUri), {
    timeout: REDIRECT_TIMEOUT,
  });
  const routed = page.route(`${redirectUri}**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>captured</title>" })
  );
  return routed.then(() => redirected).then((request) => new URL(request.url()));
}

async function rejectUlsError(page: Page, authorizationServer: string): Promise<void> {
  if (!page.url().startsWith(authorizationServer)) return;
  const body = (await page.textContent("body")) ?? "";
  let error: { error?: string; error_description?: string } = {};
  try {
    error = JSON.parse(body);
  } catch {
    return;
  }
  if (error.error) {
    const detail = `${error.error} ${error.error_description ?? ""}`.trim();
    throw new Error(`ULS refused the authorize request: ${detail}`);
  }
}

// Microsoft asks "Stay signed in?" after the password on some tenants; "No" keeps the flow going.
async function declineStaySignedIn(page: Page): Promise<void> {
  const no = page.getByRole("button", { name: "No" });
  await no.click({ timeout: 5_000 }).catch(() => undefined);
}
