# Copilot Instructions for TomTom MCP Server

## Project Overview
- **TomTom MCP Server** provides unified access to TomTom geospatial APIs (search, routing, traffic, maps) for AI workflows and developer tools.
- Main entry: `src/index.ts` and `src/createServer.ts`.
- Core logic is organized by domain: `src/tools/`, `src/services/`, `src/schemas/`, `src/utils/`.
- Each domain (search, routing, traffic, map) has its own handler, service, schema, and tool modules.

## Architecture & Patterns
- **Handlers** (`src/handlers/`) process HTTP requests and route to domain services.
- **Services** (`src/services/`) wrap TomTom API calls and business logic.
- **Schemas** (`src/schemas/`) validate and transform request/response data.
- **Tools** (`src/tools/`) expose MCP features for integration with external agents.
- **Utils** (`src/utils/`) provide shared helpers (logging, error handling).
- All API calls require a valid TomTom API key (see `.env`).

## Developer Workflows
- **Build:** `npm run build` (TypeScript -> JavaScript)
- **Start server:** `node ./bin/tomtom-mcp.js` (local dev)
- **Dev server:** `npm run dev` (hot reload)
- **Test:**
  - All: `npm test`
  - Unit: `npm run test:unit`
  - Integration: `npm run test:comprehensive`
- **Setup:** `npm run setup` (initial project setup)
- **API key required for all tests** (real API calls, not mocked)

## Conventions & Patterns
- **TypeScript** throughout; strict typing enforced.
- **Error handling:** Use `src/utils/errorHandler.ts` and custom error types in `src/types/errorTypes.ts`.
- **Logging:** Use `src/utils/logger.ts`.
- **Schemas:** Always validate external data using `src/schemas/` before processing.
- **Tool definitions:** Add new MCP tools in `src/tools/` and document in README.
- **Tests:** Place alongside source files as `.test.ts` (unit) or in `tests/` (integration).
- **Environment:** Use `.env` for secrets/config; see `.env.example`.

## Integration Points
- External agents/tools integrate via MCP tools (`src/tools/`) and HTTP endpoints (see handlers).
- See `docs/` for integration guides (Claude, Cursor, VS Code, WindSurf, Smolagents).
- API key management: `.env`, environment variable, or CLI argument.

## Spec-Kit Workflow
- **Feature development:** Use `.specify/` for structured feature specification and planning.
- **New features:** Run `.specify/scripts/bash/create-new-feature.sh "feature description"` to create spec branches.
- **Templates:** Follow `.specify/templates/` for consistent specification format.
- **Constitution:** Adhere to principles in `.specify/memory/constitution.md`.

## Examples
- Add a new tool: create `src/tools/myTool.ts`, update `README.md` table, add schema/service/handler as needed.
- Validate a request: import schema from `src/schemas/`, call `.parse()` or `.validate()`.
- Log an event: `import { logger } from '../utils/logger'; logger.info('message');`
- Create feature spec: `.specify/scripts/bash/create-new-feature.sh --json "Add geocoding cache"`

## Copilot Instructions Maintenance
- **Keep updated:** These instructions should reflect current architecture and patterns as the codebase evolves.
- **When to update:** After major architectural changes, new tools/workflows, or convention changes.
- **What to include:** Project-specific patterns that differ from standard practices, not generic advice.

---
For questions, see `CONTRIBUTING.md` or open an issue on GitHub.
