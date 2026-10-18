# Agent Toolkit — Classifier & system prompt

Tuning the intent classifier and shaping the system prompt.
See [base reference](../agent-toolkit.md) for setup, [data-tools.md](./data-tools.md) for how scoping feeds off the classifier.

---

## Classifier

The default classifier is one LLM call per user message on your main `model` (a second when the first answer fails validation). A cheaper model, and the history window:

```ts
createMapAgent(map, {
    model: openai('gpt-4o'),
    classifier: createDefaultClassifier({
        model: openai('gpt-4o-mini'),
        maxHistoryMessages: 8,        // prior user/assistant messages sent (default 8)
        maxHistoryMessageLength: 300, // characters kept per prior message (default 300)
    }),
});
```

- Sees the last user message in full, the prior history truncated, and every tool's `ToolMetadata` — never the system
  prompt, tool results or state.
- Two attempts; an invalid answer keeps the usable tool names, and a failed call activates every tool (fail-open).
- `classifier: false` exposes every tool every turn and disables scoping.

A classifier is a function: `(ctx: ClassifierContext) => Promise<ClassificationResult | null>`, where `ctx` is
`{ messages, toolsMetadata }`. Return `null` to activate every tool. `ToolMetadata` carries `name`, `description`,
`classificationPrompt`, `scopePrompt`, `tags`, `dependsOn`, `alwaysActive`, … — enough for rule-based selection.
`classifyUserIntent(conversation, { chatModel, toolsMetadata })` and `extractLastUserText(messages)` are the building blocks
of the default one.

```ts
type ClassificationResult = {
    activeToolNames: string[];
    toolScopes?: Record<string, unknown>;    // per-tool scope, validated against scopeSchema in prepareStep
    timeMs: number;
    usage: { inputTokens; outputTokens; totalTokens };
};
```

Observe each turn's pick with `onClassify: (result) => …` (`result` is `null` on fail-open).

### `classificationPrompt`

The one line the classifier reads to decide whether to offer a tool:

```ts
// Too broad — fires on any location query
classificationPrompt: 'Get fleet vehicle data.'

// Precise — fires only when an explicit ID is mentioned
classificationPrompt: 'Locate a fleet vehicle by its ID (e.g. "TT-001"); not for general location queries.'
```

- `alwaysActive: true` on an entry offers it every step regardless of the classifier (`clarifyIntent` is by default).
- A scopable tool's `scopePrompt` is appended as a `SCOPE:` hint; the scope is then mandatory whenever the tool is picked.

---

## System prompt

Seven named, individually overridable sections (`SystemPromptSection`), in order:

| Section | Heading | Covers |
|---|---|---|
| `identity` | — | Who the assistant is; the persona hook |
| `capabilities` | — | The map environment and a group-level summary of what the toolkit does |
| `rejectionRules` | `SCOPE & REJECTIONS` | In-scope, mixed, out-of-scope and illegal requests; every rejection says why |
| `responseFormatting` | `RESPONSE FORMATTING` | Markdown, concise, most relevant first |
| `dataConfidence` | `DATA CONFIDENCE` | Flagging incomplete, stale or conflicting data |
| `toolExecution` | `TOOL EXECUTION` | Parallel calls, show results in the same step, ground every fact in a tool call, ask only via `clarifyIntent` |
| `sessionState` | `SESSION STATE` | Stable entry ids; check `recallState` before referencing one |

Defaults are exported as `SYSTEM_PROMPT_SECTIONS`; `BASE_SYSTEM_PROMPT` is the assembled default.

**The system prompt never reaches the classifier.** "Always also call `getTrafficIncidents`" does nothing on a turn
where that tool wasn't picked — extend its `classificationPrompt`, or set `alwaysActive: true`.

Prefix, suffix and section overrides compose; a full string replaces everything:

```ts
// Prepend a preamble, append instructions
createMapAgent(map, {
    model,
    systemPromptPrefix: 'You work for Acme Logistics.',               // no heading, at the top
    systemPromptSuffix: 'Always use metric units. Respond in Dutch.', // under "ADDITIONAL INSTRUCTIONS:"
});

// Override sections — omitted ones keep their defaults; the heading is kept; '' drops the section
createMapAgent(map, {
    model,
    systemPrompt: {
        identity: 'You are a delivery fleet dispatcher built on the TomTom map.',
        responseFormatting: 'Reply in Dutch, metric units, one short paragraph.',
        rejectionRules: `${SYSTEM_PROMPT_SECTIONS.rejectionRules}\n- Decline weather questions.`, // extend
    } satisfies SystemPromptSectionOverrides,
});

// Full replacement (ignores prefix/suffix) — extend BASE_SYSTEM_PROMPT rather than starting blank
createMapAgent(map, {
    model,
    systemPrompt: `${BASE_SYSTEM_PROMPT}

ADDITIONAL INSTRUCTIONS:
- When a vehicle ID is mentioned, call getFleetVehicle before anything else.`,
});
```

`composeSystemPrompt(overrides)` returns the string a section-override object assembles (for logging, diffing,
token checks); passed back as `systemPrompt` it is a full string, so prefix/suffix are ignored. Per-tool mechanics (coordinate order, "near me" vs "in this area") live in tool descriptions, not the prompt.
