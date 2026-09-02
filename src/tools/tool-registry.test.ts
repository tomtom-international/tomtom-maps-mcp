/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Registry invariants. These replace the per-domain `*Tools.test.ts` files,
 * which each asserted a handful of `registerAppTool` calls; a table lets us
 * assert the invariants once, across every tool.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOOLS,
  getDefaultToolPrompts,
  getToolEntry,
  TOOL_ENTRIES,
  TOOL_NAMES,
} from "./tool-registry";
import { TOOL_TAGS } from "./tool-tags";

describe("TOOL_ENTRIES", () => {
  it("registers every tool under a unique name", () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
  });

  it("names every tool with the tomtom- prefix", () => {
    for (const name of TOOL_NAMES) {
      expect(name).toMatch(/^tomtom-[a-z0-9-]+$/);
    }
  });

  it("gives every tool a title, a non-trivial description, and a handler", () => {
    for (const entry of TOOL_ENTRIES) {
      expect(entry.title, entry.name).toBeTruthy();
      // A one-word description is the single most common cause of a model
      // picking the wrong tool.
      expect(entry.description.length, entry.name).toBeGreaterThan(20);
      expect(typeof entry.handler, entry.name).toBe("function");
    }
  });

  it("only uses tags from the shared vocabulary", () => {
    for (const entry of TOOL_ENTRIES) {
      for (const tag of entry.tags ?? []) {
        expect(TOOL_TAGS, `${entry.name} tag "${tag}"`).toContain(tag);
      }
    }
  });

  it("points relatedTools and dependsOn at tools that exist", () => {
    for (const entry of TOOL_ENTRIES) {
      for (const ref of [...(entry.relatedTools ?? []), ...(entry.dependsOn ?? [])]) {
        expect(TOOL_NAMES, `${entry.name} references "${ref}"`).toContain(ref);
      }
    }
  });

  it("derives each app resource URI from the tool's app directory", () => {
    for (const entry of TOOL_ENTRIES) {
      if (!entry.app) continue;
      expect(entry.app.resourceUri, entry.name).toMatch(
        new RegExp(`^ui://[a-z0-9-]+/${entry.app.appName}/app\\.html$`)
      );
    }
  });

  it("registers a unique resource URI per app tool", () => {
    const uris = TOOL_ENTRIES.flatMap((entry) => (entry.app ? [entry.app.resourceUri] : []));
    expect(new Set(uris).size).toBe(uris.length);
  });

  it("hides exactly the app-internal plumbing from the model", () => {
    const hidden = TOOL_ENTRIES.filter((entry) => entry.visibility === "app").map((e) => e.name);
    expect(hidden).toEqual(["tomtom-get-api-key", "tomtom-get-app-config", "tomtom-get-dataset"]);
    expect(DEFAULT_TOOLS).toHaveLength(TOOL_ENTRIES.length - hidden.length);
    expect(DEFAULT_TOOLS.map((e) => e.name)).not.toContain("tomtom-get-dataset");
  });

  it("looks a tool up by name", () => {
    expect(getToolEntry("tomtom-plan-route")?.title).toBe("TomTom Plan Route");
    expect(getToolEntry("tomtom-nope")).toBeUndefined();
  });
});

describe("getDefaultToolPrompts", () => {
  it("returns one entry per model-visible tool", () => {
    const prompts = getDefaultToolPrompts();
    expect(Object.keys(prompts).sort()).toEqual(DEFAULT_TOOLS.map((e) => e.name).sort());
  });

  it("gives every model-visible tool at least one example prompt", () => {
    // The eval suite derives its canonical scenario from the FIRST prompt of
    // each tool, so a tool with no prompts is a tool with no selection test.
    const prompts = getDefaultToolPrompts();
    for (const [name, list] of Object.entries(prompts)) {
      expect(list.length, `${name} has no examplePrompts`).toBeGreaterThan(0);
    }
  });
});

describe("tool descriptions", () => {
  // Descriptions outlive the tools they name. After the consolidation,
  // tomtom-poi-categories still said it was "REQUIRED before using poiCategories
  // in any search tool" and pointed at fuzzy-search, poi-search, nearby and
  // area-search — none of which exist. The model believed it, and ran a category
  // pre-flight before every search that the consolidation exists to remove.
  // A dangling name is worse than a vague description: it is a confident
  // instruction to do something impossible.
  it("never points at a tool that does not exist", () => {
    const known = new Set<string>(TOOL_NAMES);
    for (const entry of TOOL_ENTRIES) {
      const mentioned = entry.description.match(/tomtom-[a-z0-9-]+/g) ?? [];
      for (const name of mentioned) {
        expect(known, `${entry.name} mentions "${name}"`).toContain(name);
      }
    }
  });

  // The whole point of accepting natural-language categories is that no lookup
  // hop is needed. A description that calls the lookup mandatory undoes it.
  it("does not present the category lookup as a prerequisite", () => {
    const categories = TOOL_ENTRIES.find((e) => e.name === "tomtom-poi-categories");
    expect(categories).toBeDefined();
    expect(categories?.description).not.toMatch(/REQUIRED before/i);
    expect(categories?.description).toMatch(/NOT a prerequisite|Optional/i);
  });
});
