# Agent Toolkit Plugin Reference

Headless conversational agent that gives any LLM tool-based control over a `TomTomMap` and TomTom services.
Built on [Vercel AI SDK](https://ai-sdk.dev/) v6 (`ToolLoopAgent`, `DirectChatTransport`).
No chat UI and no LLM provider are bundled — bring both.

> [Public preview](https://docs.tomtom.com/legal/public-preview) — package is `@tomtom-org/maps-sdk-plugin-agent-toolkit`.

This is the **base reference**: setup, `MapAgentOptions`, the turn lifecycle, and gotchas.
Subsystems live in `docs/agent-toolkit/` — read the matching file too.

## Sub-topic references

| Sub-topic | File | When to read |
|---|---|---|
| Tools registry & custom tools | `agent-toolkit/tools.md` | `DEFAULT_TOOLS` / `TOOL_NAMES`, `ToolEntry` / `ToolEntryBuilder`, add / replace / remove / hand-pick tools, `locatePlace` / `getViewportBias`, `createGetCurrentLocationTool`, `createClarifyIntentTool`, `getTrafficIncidents` `where` |
| Scope-aware data tools | `agent-toolkit/data-tools.md` | `analyseData` / `processData` / `clusterIncidents`, the sandbox (`createTracker` code too) and its injected identifiers, per-turn scoping, scopable custom tools |
| State | `agent-toolkit/state.md` | `ToolState` slices and their module accessors, tagged geometries ids, custom slices, entry mode, `getStateDigest` |
| Classifier & system prompt | `agent-toolkit/prompt-and-classifier.md` | `createDefaultClassifier` / custom classifier, `classificationPrompt`, `alwaysActive`, `BASE_SYSTEM_PROMPT` / `SYSTEM_PROMPT_SECTIONS` / `composeSystemPrompt`, prefix / suffix |
| BYOD | `agent-toolkit/byod.md` | `addByodSource` / `setByodLayers` / `updateByodDisplay`, `BYODDataProfile`, untrusted-data handling, `byod.validateSourceUrl` |

Read `${CLAUDE_SKILL_DIR}/docs/agent-toolkit/<filename>` directly.
For multi-topic tasks, read several.

---

## Imports

```ts
import {
    createMapAgent,
    createDefaultClassifier,
    DEFAULT_TOOLS,
    TOOL_NAMES,
    BASE_SYSTEM_PROMPT,
    composeSystemPrompt,
    SYSTEM_PROMPT_SECTIONS,
    ENTRY_MODE_SLICE_NAMES,
    getViewportBias,
    locatePlace,
    type EntryDataKind,
    type EntryModeSliceName,
    type MapAgentInstance,
    type MapAgentOptions,
    type StateSlice,
    type SystemPromptSection,
    type SystemPromptSectionOverrides,
    type ToolBuildOptions,
    type ToolEntry,
    type ToolEntryBuilder,
    type ToolState,
} from '@tomtom-org/maps-sdk-plugin-agent-toolkit';
```

## Installation

```bash
npm i @tomtom-org/maps-sdk @tomtom-org/maps-sdk-plugin-agent-toolkit ai zod
# Plus one Vercel AI SDK provider, e.g.:
npm i @ai-sdk/openai
```

Peer deps (all required): `@tomtom-org/maps-sdk` (`>=0.64.0 <1.0.0`, or a `1.0.0` release candidate), `@tomtom-org/maps-sdk-plugin-map-theme`, `ai@^6`,
`zod`, `maplibre-gl`, `@turf/turf`, `chart.js`, `h3-js`.

---

## Quick start

```ts
import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import { TomTomMap } from '@tomtom-org/maps-sdk/map';
import { createMapAgent } from '@tomtom-org/maps-sdk-plugin-agent-toolkit';
import { openai } from '@ai-sdk/openai';

TomTomConfig.instance.put({ apiKey: 'YOUR_API_KEY' });

const map = new TomTomMap({ mapLibre: { container: 'map' } });
const agent = createMapAgent(map, { model: openai('gpt-4o') });

// One-shot:
const { text } = await agent.generate({
    messages: [{ role: 'user', content: 'Find coffee shops near Dam Square' }],
});

// Chat UI: the agent is a real ToolLoopAgent — new DirectChatTransport({ agent }) with useChat.
```

`createMapAgent` returns a `ToolLoopAgent` (`MapAgentInstance`) with two extras:

```ts
agent.state;     // live ToolState (typed as your extended state when you pass custom slices)
agent.destroy(); // calls reset() on every state slice that implements StateSlice
```

---

## How a turn runs

1. **Intent classification** (step 0 of each user message) — a pre-pass (a second LLM call when the first answer fails
   validation) picks the subset of tools for the turn from each tool's `classificationPrompt`. For *scopable* tools (`analyseData`, `processData`, `clusterIncidents`) it also emits
   `toolScopes[<name>]` naming the entry kinds the turn touches; `prepareStep` rebuilds those tools' `description` +
   `inputSchema` for the turn. Detail: `agent-toolkit/prompt-and-classifier.md`, `agent-toolkit/data-tools.md`.
2. **Tool loop** — the model calls tools until it answers, capped at `maxSteps` (default 10).
   Tools return compact summaries; full data lives in `agent.state`.

Results are stored as entries with stable ids (`places-3`, `routes-1`) that the model re-reads with `recallState` —
*"add a stop after the first one"* works across turns.

---

## `MapAgentOptions`

```ts
const agent = createMapAgent(map, {
    model: openai('gpt-4o'),                        // REQUIRED — throws when missing

    // System prompt — prefix / suffix / section overrides compose; a full string replaces everything
    systemPromptPrefix: 'You work for Acme Logistics.',   // preamble, no heading
    systemPromptSuffix: 'Always respond in Spanish.',     // under "ADDITIONAL INSTRUCTIONS:"
    // systemPrompt: { identity: '…' },                   // override named sections
    // systemPrompt: `${BASE_SYSTEM_PROMPT}\n\n…`,        // full replacement, ignores prefix/suffix

    // Tools — merged over DEFAULT_TOOLS
    tools: {
        getFleetVehicle,                 // add
        setLanguage: false,              // remove
        locatePlace: myCustomLocate,     // replace (ToolEntry or ToolEntryBuilder)
    },
    includeDefaultTools: true,           // false → only what `tools` lists

    // Per data-entry kind, keyed by DataEntryKind: places / routes / incidents / customGeometries /
    // trafficAreaAnalytics / byod / ranges
    dataEntries: {
        routes: { entryMode: 'single' },
        byod: { enabled: false },        // drops byod from the data tools + its TOOLS_BY_DATA_ENTRY_KIND tools
    },

    byod: {
        validateSourceUrl: (url) =>
            url.hostname === 'data.example.com' ? { valid: true } : { valid: false, reason: 'Host not allowed' },
    },
    codeExecution: { timeoutMs: 10_000 },          // browser sandbox only; default 10 s

    // Classifier
    classifier: createDefaultClassifier({ model: openai('gpt-4o-mini') }), // or a Classifier function, or false
    onClassify: (result) => console.log(result?.activeToolNames, result?.toolScopes),

    // Observability and loop control
    onToolExecute: ({ toolName, durationMs, isError, errorMessage }) => {},
    maxSteps: 10,
    outputSchemas: true,                 // false for providers without structured tool outputs
    prepareStep: async (info) => ({}),   // its activeTools are intersected with the classifier's
    providerOptions: { openai: { reasoningEffort: 'low' } },
    stepProviderOptions: ({ activeTools, stepNumber }) => undefined, // merged over providerOptions per step

    state: { fleet: new FleetState() },  // custom slices only; built-ins are created for you
});
```

- `byod.validateSourceUrl` returns `{ valid: true } | { valid: false; reason: string }` (sync or async) — `agent-toolkit/byod.md`.
- `featureFlags` exists but defines no flags.

### Type-safe custom state

```ts
interface MyState extends ToolState {
    fleet: FleetState;
}

const agent = createMapAgent<MyState>(map, {
    model,
    state: { fleet: new FleetState() },
});
agent.state.fleet;   // FleetState
agent.state.routing; // built-in slice
```

Slice catalogue and the custom-slice contract: `agent-toolkit/state.md`.

---

## Cleanup

```ts
agent.destroy();             // resets every slice that implements reset()
map.mapLibreMap?.remove();   // tear down MapLibre when unmounting
```

---

## Privacy

- Sent to the model provider: every message + system prompt; the classifier's copy (default classifier: up to 8 earlier messages × 300 chars, tunable via `createDefaultClassifier({ maxHistoryMessages, maxHistoryMessageLength })`; a custom classifier sends what it sends; `classifier: false` turns it off); tool results (places, addresses, coords, reverse-geocoded addresses, viewport, device location, `analyseData` / `processData` output over BYOD, ≤200 tracker events per tracker, more when querying all trackers).
- The provider is the integrator's processor: DPA, EEA region where offered.
- `agent.state` is in-memory only; `resetState` or `agent.destroy()` clears all of it. `single` entry mode and entry removal can drop data sooner, but don't count on that for erasure. No browser storage. Chat history is the integrator's: erasure = clear it + `agent.destroy()`.
- Send less: remove tools, `classifier: false`, replace a tool with one returning less.
- Guide: `guides/plugins/agent-toolkit/what-the-agent-sends.mdx`.

---

## Gotchas

- **Coordinates are `[lng, lat]`** everywhere.
- **Tools return summaries, not GeoJSON.** Custom tools should do the same: small JSON to the model, data to a state slice.
- **Modules are per entry.** Each entry owns lazy modules, reached through its slice: `state.places.getEntryPlacesModule(id, markerType)`,
  `state.routing.getEntryRoutingModule(id)`, `state.ranges.getEntryRangesModule(id)`, `state.customGeometries.getEntryGeometriesModule(id)`,
  `getEntryModule(id)` on `byod` / `trafficIncidents` / `trafficAreaAnalytics`. Prefer the slice writers
  (`state.places.addPlaceResult(...)`, `state.byod.addEntry(...)`) plus the display tools.
- **Stateful custom tools need a recall path.** Store results on a `StateSlice` the model can re-read — it won't remember them.
- **`classifier: false` disables scoping.** Every tool is offered every turn and scopable tools keep their unscoped surface.
- **One run at a time per agent.** Scoping mutates the shared tool objects each turn (only `prepareStep` itself is
  serialised), and state is per agent. Create one agent per concurrent session.
