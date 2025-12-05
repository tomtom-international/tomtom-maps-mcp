# Adding New Tools to TomTom MCP

This guide explains how to add a new **tool** (API integration) to the TomTom MCP repository. It covers structure, coding, testing, and documentation best practices.

---

## 1️⃣ Preparation

Before starting, collect all relevant information about the API you want to integrate:

* **Base URL** and available **endpoints**.
* Authentication requirements (API key, OAuth, etc.).
* Supported HTTP methods and query/path parameters.
* Expected request/response payloads.
* Rate limits, quotas, and timeouts.
* Error format and retry recommendations.

> Keep this info handy; it will guide service implementation and schema design.

---

## 2️⃣ Create the Service Layer

The service is responsible for talking to the external API.

1. Inside `src/services/`, create a folder for your service, e.g. `elevation/`.
2. Add three files:

   * `service.ts`: the implementation (HTTP calls, error handling, parsing).
   * `types.ts`: TypeScript interfaces for request/response.
   * `service.test.ts`: unit/integration tests for the service.

**Example structure:**

```
src/services/elevation/
├── service.ts
├── service.test.ts
└── types.ts
```

### Tips

* Keep `service.ts` focused on API logic only.
* Export clear, typed functions (e.g., `getElevation(params: ElevationRequest): Promise<ElevationResponse>`).
* Use environment variables for secrets (update `.env.example`).
* Add retries or caching if the API is rate-limited.

---

## 3️⃣ Define Schemas

Schemas validate inputs (and optionally outputs) for the tool.

1. Create a schema file under `src/schemas/`, e.g. `elevationSchema.ts`.
2. Export a JSON Schema or TypeScript type describing allowed parameters.

> This ensures invalid input is caught before calling the API.

---

## 4️⃣ Implement the Tool

Tools live in `src/tools/` and define how MCP exposes the service.

1. Create a file (e.g. `elevationTool.ts`).
2. Export an object with:

   * `name`: unique identifier (e.g., `tomtom-elevation`).
   * `description`: short explanation.
   * `inputSchema`: schema from step 3.
   * `handler`: async function calling the service and returning formatted output.

---

## 5️⃣ Register the Tool

Update the server bootstrap (`src/createServer.ts` or equivalent):

```ts
import { elevationTool } from './tools/elevationTool';

const tools = [
  ...existingTools,
  elevationTool
];
```

This makes the tool available through the MCP protocol.

---

## 6️⃣ Write Tests

* **Service tests** (`service.test.ts`): Cover success, error, and edge cases.
* **Tool tests** (optional but recommended): Validate that MCP input/output works correctly.
* Use mocks for network calls where feasible.

> Run tests locally and in CI to ensure stability.

---

## 7️⃣ Documentation

* Update or create entries in `docs/` describing the new tool:

  * Purpose and endpoints used.
  * Example requests/outputs.
  * Special requirements (auth, rate limits, etc.).
* Mention the tool in the "Available Tools" section of the main README if appropriate.

---

## 8️⃣ Review & Deploy

* Verify naming consistency (tool, files, schemas).
* Check linting and formatting.
* Ensure environment variables are documented.
* Run all tests and integration checks before merging.

---

### ✅ Summary Checklist

* [ ] Gather API details and authentication.
* [ ] Create `service.ts`, `types.ts`, and `service.test.ts`.
* [ ] Define an input schema.
* [ ] Implement a tool with `name`, `description`, `inputSchema`, and `handler`.
* [ ] Register the tool in `createServer.ts`.
* [ ] Add unit/integration tests.
* [ ] Document the tool in `docs/` and README.
* [ ] Verify environment variables and rate limits.

---

Following these steps keeps the repository modular, type-safe, and easy to maintain while extending its capabilities with new APIs.
