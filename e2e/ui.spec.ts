import { test, expect } from "./fixtures/servers";

test.describe("Host UI", () => {
  test("connects to MCP server and displays server name", async ({ connectedPage: page }) => {
    await expect(page.getByTestId("server-badge")).toBeVisible();
    await expect(page.getByTestId("server-name")).not.toBeEmpty();
  });

  test("populates tool sidebar with available tools", async ({ connectedPage: page }) => {
    const buttons = page.getByTestId("tool-list").locator("button");
    await expect(buttons.first()).toBeVisible();
    expect(await buttons.count()).toBeGreaterThan(0);
  });

  test("auto-selects first tool and pre-populates example JSON", async ({ connectedPage: page }) => {
    await expect(page.getByTestId("selected-tool-name")).not.toBeEmpty();
    const value = await page.getByTestId("request-body-textarea").inputValue();
    expect(value.length).toBeGreaterThan(2);
    expect(() => JSON.parse(value)).not.toThrow();
  });

  test("filters tool list when typing in search", async ({ connectedPage: page }) => {
    const toolList = page.getByTestId("tool-list");
    const initialCount = await toolList.locator("button").count();

    await page.getByTestId("tool-search-input").fill("geocode");
    const filteredCount = await toolList.locator("button").count();
    expect(filteredCount).toBeLessThan(initialCount);
    expect(filteredCount).toBeGreaterThan(0);
  });

  test("switches tool selection and updates input JSON", async ({ connectedPage: page }) => {
    await page.getByTestId("tool-item-tomtom-geocode").click();
    const geocodeInput = await page.getByTestId("request-body-textarea").inputValue();

    await page.getByTestId("tool-item-tomtom-routing").click();
    const routingInput = await page.getByTestId("request-body-textarea").inputValue();

    expect(geocodeInput).not.toBe(routingInput);
    await expect(page.getByTestId("selected-tool-name")).toHaveText("routing");
  });

  test("shows validation error and disables Run for invalid JSON", async ({ connectedPage: page }) => {
    await page.getByTestId("tool-item-tomtom-geocode").click();
    await page.getByTestId("request-body-textarea").fill("not valid json {{{");

    await expect(page.getByTestId("json-error")).toBeVisible();
    await expect(page.getByTestId("run-button")).toBeDisabled();
  });

  test("shows loading state while tool executes and returns result", async ({ connectedPage: page }) => {
    await page.getByTestId("tool-item-tomtom-geocode").click();
    await page.getByTestId("run-button").click();

    await expect(page.getByTestId("run-button")).toContainText("Running");

    await expect(page.getByTestId("tab-result")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("tab-result").click();
    await expect(page.getByTestId("json-result")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("run-button")).toContainText("Run");
  });
});
