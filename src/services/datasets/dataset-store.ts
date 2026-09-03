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
 * The dataset store — server-held tool results, addressable by `dataset_id`.
 *
 * Replaces `services/viz-cache.ts`, which stored a bare blob under a random UUID
 * for the MCP app to fetch. Three things change, and each is forced by making the
 * handle something the MODEL can address rather than app-only plumbing:
 *
 * 1. **An envelope, not a blob.** `kind`, `summary` and `provenance` travel with
 *    the data, so `tomtom-describe-dataset` can answer without re-deriving
 *    anything and a cache miss can say what the dataset *was*.
 * 2. **Owner scoping.** A `dataset_id` the model can pass to a read tool is a
 *    guessable read primitive. Entries are keyed by the resolved principal and a
 *    cross-owner read is reported as "not found" — the same answer as a genuine
 *    miss, so the store never confirms that someone else's id exists.
 * 3. **A byte budget.** `node-cache` bounds nothing but time, so a 50 MB BYOD
 *    upload sat in RSS for its whole TTL. Entries now carry an estimated size and
 *    the oldest are evicted once the budget is exceeded.
 *
 * Still explicitly a per-process cache: a follow-up call that lands on another
 * pod misses. `provenance` is recorded so a future phase can rebuild the dataset
 * by replaying the call that produced it (see the proposal, §2.5).
 */

import { createHash, randomBytes } from "node:crypto";
import NodeCache from "node-cache";
import type { ToolDataKind } from "../../tools/shared/tool-entry";
import { logger } from "../../utils/logger";
import { redactCredentials } from "../../utils/redact";
import { getEffectiveApiKey } from "../api-key";
import { type DatasetSummary, summarize } from "./summarize";

/**
 * 30 minutes. The old 5-minute TTL was tuned for "the app fetches immediately
 * after the tool call"; a dataset the model queries across several turns of a
 * conversation needs to outlive a pause for thought.
 */
const DEFAULT_TTL_SECONDS = 10 * 60;

/**
 * Ten minutes, overridable with `DATASET_TTL_SECONDS`.
 *
 * The default is set for the SHARED case, because that is the one where the
 * wrong answer costs someone other than the person who chose it: on a hosted
 * server every minute an abandoned dataset stays resident is budget its other
 * tenants cannot use. Single-user stdio can raise it freely — the store is that
 * user's alone and an idle dataset costs only them.
 *
 * Ten minutes still covers the case datasets exist for: asking a follow-up
 * question about a result you are looking at. It does not cover coming back
 * after lunch, which is what the expiry now tells the model up front.
 */
export const DATASET_TTL_SECONDS = (() => {
  const raw = Number(process.env.DATASET_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_TTL_SECONDS;
})();

const TTL_SECONDS = DATASET_TTL_SECONDS;

/**
 * How long datasets live, in words, for tool descriptions and error messages.
 *
 * Derived rather than written out, because a description saying "30 minutes"
 * against a store configured for 10 is worse than one that says nothing: the
 * model plans around it and the dataset is gone when it gets there.
 */
export const datasetLifetimePhrase = (): string => {
  const minutes = DATASET_TTL_SECONDS / 60;
  if (Number.isInteger(minutes)) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${DATASET_TTL_SECONDS} seconds`;
};

/**
 * The `_meta` a data tool returns alongside its result.
 *
 * Carries the lifetime because the model is the one that has to decide whether a
 * handle is still worth using, and it cannot know a policy nobody told it. An
 * expiry it can see is the difference between planning a follow-up and issuing
 * one that fails.
 */
export const datasetMeta = (
  dataset: Pick<Dataset, "id">,
  showUi: boolean
): { show_ui: boolean; dataset_id: string; dataset_expires_in_seconds: number } => ({
  show_ui: showUi,
  dataset_id: dataset.id,
  dataset_expires_in_seconds: DATASET_TTL_SECONDS,
});

/** Total estimated bytes held across all owners before eviction kicks in. */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

/** Hard entry ceiling, as a second guard for many small datasets. */
const MAX_ENTRIES = 500;

/**
 * Per-owner ceilings, so one caller cannot evict everyone else.
 *
 * The global budget alone bounds the PROCESS and nothing else: a single 200 MB
 * upload stays inside it while pushing every other tenant's datasets out, and the
 * victim sees "not available (datasets live 30 minutes)" in the middle of a
 * conversation — a correct message describing something that did not happen.
 * Eviction now takes from the owner who is over their own share first, and only
 * falls back to oldest-first across the store when no one is.
 */
const MAX_OWNER_BYTES = 64 * 1024 * 1024;
const MAX_OWNER_ENTRIES = 100;

/**
 * Provenance outlives the data it describes, at 4x the TTL.
 *
 * The proposal planned to REBUILD an expired dataset by replaying the call that
 * produced it. Implementing that surfaced two problems:
 *
 * 1. Provenance lived inside the entry that expires, so an expired id carried
 *    nothing to replay from. Hence this separate index — it is tiny (a tool name
 *    and its params) so keeping it far longer than the payload costs nothing.
 * 2. More seriously, **replay is not sound for time-varying data.** Re-running a
 *    traffic query 40 minutes later returns different incidents, and an analysis
 *    over them would silently describe a different world than the id implied. A
 *    wrong answer that looks right is worse than a miss.
 *
 * So the index makes a miss *specific* rather than automatic: the caller is told
 * exactly which call to re-issue and decides whether refetching is appropriate.
 * Auto-replay may still make sense for the deterministic kinds (a geocode is
 * stable in a way traffic is not); that is a per-kind judgement and deliberately
 * not made here.
 */
const PROVENANCE_TTL_SECONDS = TTL_SECONDS * 4;

/** What produced a dataset — enough to re-run it. */
export interface DatasetProvenance {
  tool: string;
  params: unknown;
}

export interface Dataset {
  id: string;
  kind: ToolDataKind | "unknown";
  /** The UNTRIMMED tool response. */
  data: unknown;
  summary: DatasetSummary;
  provenance: DatasetProvenance;
  /** Opaque principal digest — never the key itself. */
  owner: string;
  createdAt: number;
  /** Estimated size; see {@link estimateBytes}. */
  bytes: number;
}

/** Provenance-only index, keyed by dataset id — see {@link PROVENANCE_TTL_SECONDS}. */
const provenanceIndex = new NodeCache({
  stdTTL: PROVENANCE_TTL_SECONDS,
  checkperiod: 120,
  useClones: false,
});

const store = new NodeCache({
  stdTTL: TTL_SECONDS,
  checkperiod: 60,
  // Datasets are handed out for reading, never mutated in place, so cloning would
  // duplicate a potentially large payload on every access for no benefit.
  useClones: false,
});

/**
 * Digest of the resolved principal.
 *
 * Hashed so the store never holds an API key, and truncated because it only ever
 * needs to be compared, not reversed. Absent key (stdio without configuration)
 * collapses to a single `anonymous` owner, which is correct for single-user stdio
 * and never reached on the hosted server, where a key is required per request.
 */
function currentOwner(): string {
  const key = getEffectiveApiKey();
  if (!key) return "anonymous";
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/**
 * Estimates a payload's size from its summary sample rather than serialising it.
 *
 * `JSON.stringify` on a 50 MB BYOD upload costs more than the request that
 * fetched it, so the size is extrapolated from the sampled features. Deliberately
 * an estimate: it drives eviction, where being roughly right is enough, and never
 * anything a caller sees.
 */
function estimateBytes(summary: DatasetSummary): number {
  const sample = summary.sample;
  if (!sample.length) return 1024;
  let sampleBytes: number;
  try {
    sampleBytes = JSON.stringify(sample).length;
  } catch {
    return 1024;
  }
  const perFeature = sampleBytes / sample.length;
  return Math.max(1024, Math.round(perFeature * Math.max(summary.count, 1)));
}

/** Every live entry, oldest first. */
function liveEntries(): Dataset[] {
  return store
    .keys()
    .map((key) => store.get<Dataset>(key))
    .filter((entry): entry is Dataset => entry !== undefined)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function evict(entry: Dataset, reason: string): void {
  store.del(entry.id);
  logger.debug(
    { dataset_id: entry.id, freed_bytes: entry.bytes, owner: entry.owner, reason },
    "Evicted dataset"
  );
}

/**
 * Brings ONE owner back inside their own share, oldest of theirs first.
 *
 * Run for the storing owner on every write, so a caller who keeps allocating
 * pays for it themselves rather than spending the shared budget.
 */
function enforceOwnerBudget(owner: string): void {
  const mine = liveEntries().filter((entry) => entry.owner === owner);
  let bytes = mine.reduce((sum, entry) => sum + entry.bytes, 0);
  let count = mine.length;

  for (const entry of mine) {
    if (bytes <= MAX_OWNER_BYTES && count <= MAX_OWNER_ENTRIES) break;
    evict(entry, "owner budget");
    bytes -= entry.bytes;
    count -= 1;
  }
}

/**
 * Brings the whole store inside the process budget.
 *
 * Takes from the largest owner first rather than the oldest entry anywhere: with
 * one heavy tenant and several light ones, oldest-first empties the light ones
 * while the heavy one keeps everything it just wrote.
 */
function enforceGlobalBudget(): void {
  let entries = liveEntries();
  let totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);

  while (totalBytes > MAX_TOTAL_BYTES || entries.length > MAX_ENTRIES) {
    const byOwner = new Map<string, { bytes: number; oldest: Dataset }>();
    for (const entry of entries) {
      const seen = byOwner.get(entry.owner);
      if (seen) seen.bytes += entry.bytes;
      else byOwner.set(entry.owner, { bytes: entry.bytes, oldest: entry });
    }

    const heaviest = [...byOwner.values()].sort((a, b) => b.bytes - a.bytes)[0];
    if (!heaviest) break;

    evict(heaviest.oldest, "process budget");
    totalBytes -= heaviest.oldest.bytes;
    entries = entries.filter((entry) => entry.id !== heaviest.oldest.id);
  }
}

/**
 * Stores an untrimmed tool response and returns its `dataset_id`.
 *
 * The summary is computed once here rather than on each read: it is what
 * `describe-dataset` serves and what the eviction estimate is built from.
 */
export function storeDataset(options: {
  data: unknown;
  kind?: ToolDataKind | "unknown";
  provenance: DatasetProvenance;
}): Dataset {
  const { data, kind = "unknown", provenance } = options;
  // The SDK echoes request params — including the API key — into feature
  // properties. Stored data outlives the call and is readable by both the app and
  // model-authored analysis code, so it is redacted on the way in.
  redactCredentials(data);
  const summary = summarize(data, kind);
  const dataset: Dataset = {
    id: `ds_${randomBytes(8).toString("hex")}`,
    kind,
    data,
    summary,
    provenance,
    owner: currentOwner(),
    createdAt: Date.now(),
    bytes: estimateBytes(summary),
  };

  store.set(dataset.id, dataset);
  provenanceIndex.set(dataset.id, { owner: dataset.owner, provenance, kind });
  enforceOwnerBudget(dataset.owner);
  enforceGlobalBudget();

  logger.debug(
    { dataset_id: dataset.id, kind, count: summary.count, bytes: dataset.bytes },
    "Stored dataset"
  );
  return dataset;
}

/**
 * Reads a dataset the CURRENT principal owns.
 *
 * A dataset belonging to someone else returns `undefined` — identical to a real
 * miss, deliberately, so the store cannot be used to probe which ids exist.
 */
export function getDataset(datasetId: string): Dataset | undefined {
  const dataset = store.get<Dataset>(datasetId);
  if (!dataset) {
    logger.debug({ dataset_id: datasetId }, "Dataset not found (expired or unknown)");
    return undefined;
  }
  if (dataset.owner !== currentOwner()) {
    // Logged as a warning: on the hosted server this is either a bug or a probe.
    logger.warn({ dataset_id: datasetId }, "Dataset access denied — different owner");
    return undefined;
  }
  return dataset;
}

/**
 * What an unavailable dataset WAS, when the provenance index still remembers.
 *
 * Lets a caller tell the model which exact call to re-issue instead of a generic
 * "expired". Owner-scoped like {@link getDataset}, so it cannot be used to learn
 * about someone else's datasets.
 */
export function recallProvenance(
  datasetId: string
): { provenance: DatasetProvenance; kind: ToolDataKind | "unknown" } | undefined {
  const entry = provenanceIndex.get<{
    owner: string;
    provenance: DatasetProvenance;
    kind: ToolDataKind | "unknown";
  }>(datasetId);
  if (!entry || entry.owner !== currentOwner()) return undefined;
  return { provenance: entry.provenance, kind: entry.kind };
}

/**
 * Builds the LLM-facing message for an unavailable dataset, naming the originating
 * call when it is still known.
 */
export function explainMissingDataset(datasetId: string): string {
  const recalled = recallProvenance(datasetId);
  if (!recalled) {
    return (
      `Dataset "${datasetId}" is not available. It may have expired (datasets live 30 minutes), ` +
      "or the id may be wrong. Re-run the tool that produced it to get a fresh dataset_id."
    );
  }
  const params = JSON.stringify(recalled.provenance.params).slice(0, 400);
  return (
    `Dataset "${datasetId}" has expired (datasets live 30 minutes). It came from ` +
    `${recalled.provenance.tool} with ${params}. Re-run that call to get a fresh dataset_id — ` +
    "note the result may differ if the underlying data has changed since."
  );
}

/** Deletes a dataset, if the current principal owns it. */
export function deleteDataset(datasetId: string): boolean {
  if (!getDataset(datasetId)) return false;
  return store.del(datasetId) > 0;
}

/** Store statistics, for monitoring. */
export function getDatasetStoreStats(): NodeCache.Stats & { entries: number; bytes: number } {
  const entries = store
    .keys()
    .map((key) => store.get<Dataset>(key))
    .filter((entry): entry is Dataset => entry !== undefined);
  return {
    ...store.getStats(),
    entries: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  };
}

/** Clears every dataset and its provenance. For tests and shutdown. */
export function clearDatasetStore(): void {
  store.flushAll();
  provenanceIndex.flushAll();
  logger.info("Cleared the dataset store");
}
