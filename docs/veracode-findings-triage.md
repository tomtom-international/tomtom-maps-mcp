# Veracode Pipeline Scan — Findings Triage

_Last updated: 2026-07-12. Source: first authenticated pipeline scan (run [29034887807](https://github.com/tomtom-international/tomtom-maps-mcp/actions/runs/29034887807), re-run of PR #222 after Dependabot secrets were added)._

## Background

Until 2026-07-12 the Veracode pipeline scan had **never actually run** on this repository:

- **Dependabot PRs** failed with `Input required and not supplied: vid` — workflow runs triggered by `dependabot[bot]` only receive Dependabot secrets, and `VERACODE_API_ID`/`VERACODE_API_KEY` existed only as Actions secrets. Fixed by mirroring the secrets into the Dependabot store.
- **Internal PRs showed green checks that were false passes**: the then-current Actions-level credentials were rejected with `HTTP 401 Unauthorized`, the scan uploaded nothing, and `Veracode-pipeline-scan-action@v1.0.20` still exits 0. Any veracode "pass" that completed in ~30 s never scanned anything (verified on PRs #221 and #223). The Actions secrets were replaced with working credentials on 2026-07-12 — verified by the scan on PR #224 running end-to-end (`SCAN_STATUS: SUCCESS`, 14 findings with the new scan scope, reported non-blocking). The workflow now also fails explicitly when the scan produces no results, so a credential failure can never masquerade as a pass again.

The first real scan found **20 findings (13 Medium, 7 Low)**. They are triaged below.

## Triage summary

| # | Sev | CWE | Location | Verdict | Rationale |
|---|-----|-----|----------|---------|-----------|
| 1 | Med | CWE-201 | `src/indexHttp.ts:226` | False positive | 400 response echoes the (validated-against-allowlist) backend name; no sensitive data. |
| 2 | Med | CWE-201 | `src/indexHttp.ts:282` | Accepted | `/health` deliberately reports version/mode/backends. Standard health-endpoint disclosure. |
| 3 | Med | CWE-201 | `src/indexHttp.ts:292` | By design | OAuth Protected Resource Metadata endpoint — this disclosure is required by RFC 9728. |
| 4 | Med | CWE-201 | `src/auth/ulsApiKeyResolver.ts:71` | By design | The token-exchange call itself: sends the bearer token to the configured TomTom ULS endpoint over HTTPS. That is the auth flow. |
| 5 | Med | CWE-201 | `src/auth/auth.integration.test.ts:155` | Out of scope | Test code, never shipped. Removed from scan scope (`*.test.ts` excluded). |
| 6 | Med | CWE-201 | `ui/serve.ts:47` | Accepted (dev-only) | Local dev harness returns the MCP server URL to the local UI. |
| 7 | Med | CWE-201 | `ui/serve.ts:52` | **True positive — fix** | `/api/config` returns the full TomTom API key as JSON. Dev-only harness, but should be hardened the same way `tomtom-traffic-analytics-mcp` did (no wildcard CORS on the key-serving endpoint, pinned origin). Tracked as follow-up. |
| 8 | Med | CWE-80 | `ui/src/sandbox.ts:34` | By design | MCP Apps sandbox host: renders app HTML inside a sandboxed iframe. Origin is checked (`EXPECTED_HOST_ORIGIN`) and the `sandbox` attribute constrains execution — this is the sandbox architecture, not an injection sink. |
| 9 | Med | CWE-80 | `ui/src/sandbox.ts:58` | By design | Same as #8 (`doc.write(html)` into the sandboxed inner iframe). |
| 10 | Med | CWE-798 | `src/auth/auth.integration.test.ts:68` | False positive | `"Bearer not-a-jwt"` is a deliberately malformed token asserting a 401. Test code; removed from scan scope. |
| 11 | Med | CWE-918 | `scripts/build-mcpb.cjs:65` | Out of scope | Build-time download helper following redirects from pinned URLs; never runs in production. `scripts/` removed from scan scope. (Optional hardening: cap redirect depth.) |
| 12–13 | Med | CWE-312 | `scripts/generate-version.cjs:16,23` | False positive | Logs the package version at build time — not sensitive. Out of scan scope now. |
| 14 | Low | CWE-312 | `scripts/generate-version.cjs:25` | False positive | Same as above. |
| 15–17 | Low | CWE-312 | `ui/serve.ts:119-121` | Accepted (dev-only) | Startup banner prints server URL, backend, and a **masked** API key (`slice(0, 6) + "..."`). |
| 18 | Low | CWE-117 | `src/utils/logger.ts:66` | False positive | Pino structured logging: values are JSON-serialized, which neutralizes CR/LF log injection. |
| 19 | Low | CWE-117 | `ui/src/implementation.ts:48` | False positive | Browser-console log of the server URL in the dev UI. |
| 20 | Low | CWE-117 | `ui/src/index.tsx:1349` | False positive | `console.warn` of a connection failure in the dev UI. |

**Net result:** 1 true positive to fix (#7), 6 findings removed by scoping the scan to shipped code, the rest false positives / by-design / accepted dev-only behavior.

## Changes made in this PR

1. **Scan scope** — `scripts/`, `*.test.ts`, `node_modules/`, `dist/`, `coverage/` excluded from the scanned package so findings reflect shipped code.
2. **`fail_build: false`** — findings are reported in the job log and results artifact without blocking merges, matching `tomtom-traffic-analytics-mcp`. Flip back to `true` once a baseline file is adopted (below).
3. **No more silent false passes** — the job now fails when the scan produces no `results.json` (as happened during the 401 era), instead of reporting green.

## Follow-ups

- [x] **Admin:** replace the Actions `VERACODE_API_ID`/`VERACODE_API_KEY` with working credentials — done 2026-07-12, verified by the end-to-end scan on PR #224.
- [ ] Fix #7: harden `ui/serve.ts` `/api/config` (mirror traffic-analytics: no wildcard CORS on the key-serving endpoint, pinned origin).
- [ ] Adopt a Veracode **baseline file** (commit `results.json` from an accepted scan, pass it via `baseline_file:`) and restore `fail_build: true` so only *new* findings block PRs.
- [ ] Optional: cap redirect depth in `scripts/build-mcpb.cjs` `download()`.
