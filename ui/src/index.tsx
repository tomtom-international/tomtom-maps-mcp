/**
 * TomTom MCP App Host – Debug UI
 *
 * Three-column layout:
 *   Left sidebar  – scrollable tool list with search
 *   Center panel  – JSON input editor + call controls
 *   Right panel   – tabbed map widget / JSON result
 */

import { getToolUiResourceUri, McpUiToolMetaSchema } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, Suspense, use, useCallback, useEffect, useRef, useState, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  callTool,
  connectToServer,
  hasAppHtml,
  initializeApp,
  loadSandboxProxy,
  newAppBridge,
  type ServerInfo,
  type ToolCallInfo,
} from "./implementation";
import { toggleTheme, getTheme, onThemeChange, type Theme } from "./theme";
import tomtomLogoUrl from "../../images/TomTom-logo.svg";

// ─── Example Inputs ──────────────────────────────────────────────────────

const EXAMPLE_INPUTS: Record<string, Record<string, unknown>> = {
  "tomtom-geocode": {
    query: "Amsterdam Central Station",
    limit: 3,
    language: "en-US",
    show_ui: true,
    response_detail: "compact",
  },
  "tomtom-reverse-geocode": {
    lat: 52.374,
    lon: 4.8897,
    language: "en-US",
    show_ui: true,
    response_detail: "compact",
  },
  "tomtom-fuzzy-search": {
    query: "restaurants in Amsterdam",
    lat: 52.374,
    lon: 4.8897,
    limit: 5,
    show_ui: true,
    response_detail: "compact",
  },
  "tomtom-poi-search": {
    query: "coffee shop",
    lat: 52.374,
    lon: 4.8897,
    limit: 5,
    show_ui: true,
    response_detail: "compact",
  },
  "tomtom-nearby": {
    lat: 52.374,
    lon: 4.8897,
    categorySet: "7315",
    radius: 2000,
    limit: 5,
    show_ui: true,
    response_detail: "compact",
  },
  "tomtom-routing": {
    origin: { lat: 52.374, lon: 4.8897 },
    destination: { lat: 52.52, lon: 13.405 },
    travelMode: "car",
    routeType: "fast",
    traffic: "live",
    show_ui: true,
    response_detail: "compact",
  },
  "tomtom-waypoint-routing": {
    waypoints: [
      { lat: 52.374, lon: 4.8897 },
      { lat: 51.2217, lon: 4.4051 },
      { lat: 50.8503, lon: 4.3517 },
    ],
    travelMode: "car",
    routeType: "fast",
    traffic: "live",
    show_ui: true,
    response_detail: "compact",
  },
  "tomtom-reachable-range": {
    origin: { lat: 52.374, lon: 4.8897 },
    timeBudgetInSec: 1800,
    travelMode: "car",
    routeType: "fast",
    traffic: "live",
    show_ui: true,
    response_detail: "compact",
  },
  "tomtom-traffic": {
    bbox: "4.8,52.3,4.95,52.4",
    language: "en-US",
    show_ui: true,
    response_detail: "compact",
  },
  "tomtom-dynamic-map": {
    markers: [{ lat: 52.374, lon: 4.8897, label: "Amsterdam" }],
    width: 600,
    height: 400,
    show_ui: true,
  },
  "tomtom-ev-search": {
    lat: 52.3676,
    lon: 4.9041,
    radius: 5000,
    limit: 5,
    show_ui: true,
    response_detail: "compact",
  },
  "tomtom-area-search": {
    query: "restaurant",
    center: { lat: 52.3676, lon: 4.9041 },
    radius: 2000,
    limit: 5,
    show_ui: true,
    response_detail: "compact",
  },
  "tomtom-search-along-route": {
    origin: { lat: 52.3676, lon: 4.9041 },
    destination: { lat: 51.4416, lon: 5.4697 },
    query: "gas station",
    limit: 3,
    show_ui: true,
    response_detail: "compact",
  },
  "tomtom-ev-routing": {
    origin: { lat: 52.3676, lon: 4.9041 },
    destination: { lat: 51.4416, lon: 5.4697 },
    currentChargePercent: 80,
    maxChargeKWH: 60,
    show_ui: true,
    response_detail: "compact",
  },
};

function getExampleInput(toolName: string): string {
  const example = EXAMPLE_INPUTS[toolName];
  if (example) return JSON.stringify(example, null, 2);
  return "{}";
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function isToolVisibleToModel(tool: { _meta?: Record<string, unknown> }): boolean {
  const result = McpUiToolMetaSchema.safeParse(tool._meta?.ui);
  if (!result.success) return true;
  const visibility = result.data.visibility;
  if (!visibility) return true;
  return visibility.includes("model");
}

function compareTools(a: Tool, b: Tool): number {
  const aHasUi = !!getToolUiResourceUri(a);
  const bHasUi = !!getToolUiResourceUri(b);
  if (aHasUi && !bHasUi) return -1;
  if (!aHasUi && bHasUi) return 1;
  return a.name.localeCompare(b.name);
}

function stripPrefix(name: string): string {
  return name.replace(/^tomtom-/, "");
}

// ─── SVG Icons (inline, no deps) ─────────────────────────────────────────

const Icons = {
  map: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  ),
  tool: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  search: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  play: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  ),
  sun: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  ),
  moon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
  clock: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  check: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  alert: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  server: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  ),
};

// ─── App Iframe ──────────────────────────────────────────────────────────

function AppIFrame({ toolCallInfo }: { toolCallInfo: Required<ToolCallInfo> }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current!;
    toolCallInfo.appResourcePromise.then(({ csp, permissions }) => {
      loadSandboxProxy(iframe, csp, permissions).then((firstTime) => {
        if (firstTime) {
          const appBridge = newAppBridge(toolCallInfo.serverInfo, iframe);
          initializeApp(iframe, appBridge, toolCallInfo);
        }
      });
    });
  }, [toolCallInfo]);

  return (
    <iframe
      ref={iframeRef}
      style={{
        width: "100%",
        flex: 1,
        minHeight: "400px",
        border: "none",
        background: "var(--color-bg)",
      }}
    />
  );
}

// ─── Tool Result (Suspense-powered) ──────────────────────────────────────

function ToolResultContent({ resultPromise }: { resultPromise: Promise<any> }) {
  const result = use(resultPromise);
  const json = JSON.stringify(result, null, 2);
  return (
    <pre style={{
      margin: 0, padding: "16px", fontSize: "12px", lineHeight: 1.6,
      whiteSpace: "pre-wrap", wordBreak: "break-word",
      color: "var(--color-text)", fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      overflow: "auto", maxHeight: "100%",
    }}>{json}</pre>
  );
}

// ─── Result Panel (right side) ───────────────────────────────────────────

interface CallState {
  info: ToolCallInfo;
  callId: number;
  startTime: number;
}

interface ResponseMeta {
  elapsed: number;
  status: "success" | "error";
  responseSize: number;
  contentParts: number;
  tokenEstimate: number;
  timestamp: string;
}

function computeResponseMeta(result: any, startTime: number): ResponseMeta {
  const json = JSON.stringify(result);
  const size = new Blob([json]).size;
  // Rough token estimate: ~4 chars per token for English text / JSON
  const tokenEstimate = Math.ceil(json.length / 4);
  const parts = Array.isArray(result?.content) ? result.content.length : 0;

  return {
    elapsed: Date.now() - startTime,
    status: result?.isError ? "error" : "success",
    responseSize: size,
    contentParts: parts,
    tokenEstimate,
    timestamp: new Date().toLocaleTimeString(),
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ResultPanel({ call, callNumber }: { call: CallState; callNumber: number }) {
  const { info, callId, startTime } = call;
  const isApp = hasAppHtml(info);
  const [tab, setTab] = useState<"map" | "result">(isApp ? "map" : "result");
  const [meta, setMeta] = useState<ResponseMeta | null>(null);

  useEffect(() => {
    setTab(isApp ? "map" : "result");
    setMeta(null);
  }, [callId, isApp]);

  // Listen to resultPromise directly so metadata resolves regardless of active tab
  useEffect(() => {
    info.resultPromise.then(
      (result) => setMeta(computeResponseMeta(result, startTime)),
      () => setMeta({
        elapsed: Date.now() - startTime,
        status: "error",
        responseSize: 0,
        contentParts: 0,
        tokenEstimate: 0,
        timestamp: new Date().toLocaleTimeString(),
      }),
    );
  }, [info.resultPromise, startTime]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--color-bg)" }}>
      {/* Tab bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 0,
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-secondary)",
        flexShrink: 0, padding: "0 16px",
        height: "40px",
      }}>
        {isApp && (
          <TabButton active={tab === "map"} onClick={() => setTab("map")} icon={Icons.map}>
            Map Widget
          </TabButton>
        )}
        <TabButton active={tab === "result"} onClick={() => setTab("result")} icon={Icons.tool}>
          JSON Result
        </TabButton>

        <div style={{ flex: 1 }} />

        {/* Response metadata chips */}
        <div style={{
          display: "flex", alignItems: "center", gap: "8px",
          fontSize: "10px",
        }}>
          {/* Call number */}
          <MetaChip label={`#${callNumber}`} color="var(--color-text-tertiary)" />

          {meta ? (
            <>
              {/* Status + latency */}
              <MetaChip
                icon={meta.status === "error" ? Icons.alert : Icons.check}
                label={meta.elapsed < 1000 ? `${meta.elapsed}ms` : `${(meta.elapsed / 1000).toFixed(1)}s`}
                color={meta.status === "error" ? "var(--color-danger)" : "var(--color-success)"}
              />
              {/* Response size */}
              <MetaChip label={formatBytes(meta.responseSize)} color="var(--color-text-tertiary)" />
              {/* Estimated tokens */}
              <MetaChip label={`~${meta.tokenEstimate.toLocaleString()} tok`} color="var(--color-text-tertiary)" />
              {/* Content parts */}
              {meta.contentParts > 0 && (
                <MetaChip label={`${meta.contentParts} part${meta.contentParts !== 1 ? "s" : ""}`} color="var(--color-text-tertiary)" />
              )}
              {/* Timestamp */}
              <span style={{ color: "var(--color-text-tertiary)", fontFamily: "monospace", fontSize: "10px", opacity: 0.6 }}>
                {meta.timestamp}
              </span>
            </>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--color-warning)" }}>
              {Icons.clock}
              <Spinner />
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{
        flex: 1, overflow: "auto", display: "flex", flexDirection: "column",
      }}>
        {tab === "map" && isApp && (
          <AppIFrame key={callId} toolCallInfo={info} />
        )}
        {tab === "result" && (
          <Suspense fallback={<LoadingResult />}>
            <ToolResultContent resultPromise={info.resultPromise} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

function MetaChip({ icon, label, color }: { icon?: React.ReactNode; label: string; color: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "3px",
      padding: "2px 6px", borderRadius: "3px",
      background: "var(--color-bg-tertiary)",
      color, fontFamily: "monospace", fontSize: "10px", fontWeight: 500,
      whiteSpace: "nowrap",
    }}>
      {icon}{label}
    </span>
  );
}

function TabButton({ active, onClick, icon, children }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: "6px",
        padding: "0 14px", height: "100%", border: "none",
        borderBottom: active ? "2px solid var(--color-primary)" : "2px solid transparent",
        background: "transparent",
        color: active ? "var(--color-text)" : "var(--color-text-tertiary)",
        fontWeight: active ? 600 : 400,
        fontSize: "12px", cursor: "pointer",
        transition: "all 0.15s ease",
      }}
    >
      {icon}{children}
    </button>
  );
}

function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: "10px", height: "10px",
      border: "1.5px solid var(--color-border)",
      borderTopColor: "var(--color-primary)",
      borderRadius: "50%",
      animation: "spin 0.6s linear infinite",
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}

function LoadingResult() {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      gap: "8px", height: "100%",
      color: "var(--color-text-tertiary)", fontSize: "13px",
    }}>
      <Spinner /> Waiting for response...
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      height: "100%", color: "var(--color-text-tertiary)", gap: "12px",
      background: "var(--color-bg)",
    }}>
      <div style={{
        width: "64px", height: "64px", borderRadius: "16px",
        background: "var(--color-bg-tertiary)",
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity: 0.6,
      }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </svg>
      </div>
      <div>
        <div style={{ fontSize: "14px", fontWeight: 600, textAlign: "center", color: "var(--color-text-secondary)" }}>
          No active call
        </div>
        <div style={{ fontSize: "12px", marginTop: "4px", textAlign: "center" }}>
          Select a tool and press <Kbd>Enter</Kbd> or click <strong>Run</strong>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      display: "inline-block", padding: "1px 5px",
      border: "1px solid var(--color-border)",
      borderRadius: "3px", fontSize: "11px",
      fontFamily: "inherit", background: "var(--color-bg-secondary)",
      boxShadow: "var(--shadow-sm)",
    }}>{children}</kbd>
  );
}

// ─── Tool List Sidebar ───────────────────────────────────────────────────

function ToolListSidebar({ tools, selectedTool, onSelect }: {
  tools: Tool[];
  selectedTool: string;
  onSelect: (name: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!filter) return tools;
    const q = filter.toLowerCase();
    return tools.filter((t) => t.name.toLowerCase().includes(q));
  }, [tools, filter]);

  // Focus search on Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div style={{
      width: "220px", minWidth: "220px", flexShrink: 0,
      borderRight: "1px solid var(--color-border)",
      display: "flex", flexDirection: "column",
      background: "var(--color-bg-secondary)",
      overflow: "hidden",
    }}>
      {/* Search */}
      <div style={{ padding: "12px 12px 8px", flexShrink: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: "6px",
          padding: "6px 10px",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-sm)",
          background: "var(--color-bg)",
          fontSize: "12px",
        }}>
          <span style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }}>{Icons.search}</span>
          <input
            ref={inputRef}
            placeholder="Search tools..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              border: "none", outline: "none", width: "100%",
              background: "transparent", color: "var(--color-text)",
              fontSize: "12px",
            }}
          />
          <kbd style={{
            fontSize: "9px", padding: "1px 4px",
            border: "1px solid var(--color-border)",
            borderRadius: "3px", color: "var(--color-text-tertiary)",
            flexShrink: 0, lineHeight: 1.4,
          }}>
            {"\u2318"}K
          </kbd>
        </div>
      </div>

      {/* Tool list */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 8px 8px" }}>
        {filtered.map((tool) => {
          const hasUi = !!getToolUiResourceUri(tool);
          const active = tool.name === selectedTool;
          return (
            <button
              key={tool.name}
              onClick={() => onSelect(tool.name)}
              style={{
                display: "flex", alignItems: "center", gap: "8px",
                width: "100%", padding: "7px 10px",
                border: "none", borderRadius: "var(--radius-sm)",
                background: active ? "var(--color-primary-ghost)" : "transparent",
                color: active ? "var(--color-primary)" : "var(--color-text-secondary)",
                fontSize: "12px", fontWeight: active ? 600 : 400,
                cursor: "pointer", textAlign: "left",
                transition: "all 0.1s ease",
                marginBottom: "1px",
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = "var(--color-bg-tertiary)";
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = "transparent";
              }}
            >
              <span style={{
                flexShrink: 0, display: "flex", alignItems: "center",
                color: hasUi
                  ? (active ? "var(--color-primary)" : "var(--color-success)")
                  : "var(--color-text-tertiary)",
              }}>
                {hasUi ? Icons.map : Icons.tool}
              </span>
              <span style={{
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                fontSize: "11.5px",
              }}>
                {stripPrefix(tool.name)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{
        padding: "8px 12px", borderTop: "1px solid var(--color-border)",
        fontSize: "10px", color: "var(--color-text-tertiary)",
        textAlign: "center", flexShrink: 0,
      }}>
        {tools.length} tools available
      </div>
    </div>
  );
}

// ─── Input Panel (center) ────────────────────────────────────────────────

function InputPanel({ server, selectedTool, onCall, loading }: {
  server: ServerInfo;
  selectedTool: string;
  onCall: (input: Record<string, unknown>) => void;
  loading: boolean;
}) {
  const [inputJson, setInputJson] = useState(getExampleInput(selectedTool));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInputJson(getExampleInput(selectedTool));
    setError(null);
  }, [selectedTool]);

  const isValidJson = useMemo(() => {
    try { JSON.parse(inputJson); return true; } catch { return false; }
  }, [inputJson]);

  const tool = server.tools.get(selectedTool);
  const hasUi = tool ? !!getToolUiResourceUri(tool) : false;

  const handleCall = () => {
    if (!isValidJson) return;
    setError(null);
    try {
      onCall(JSON.parse(inputJson));
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div style={{
      width: "340px", minWidth: "300px", flexShrink: 0,
      borderRight: "1px solid var(--color-border)",
      display: "flex", flexDirection: "column",
      overflow: "hidden", background: "var(--color-bg)",
    }}>
      {/* Tool header */}
      <div style={{
        padding: "16px 16px 12px", borderBottom: "1px solid var(--color-border)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
          <span style={{
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            fontSize: "13px", fontWeight: 700, color: "var(--color-text)",
          }}>
            {stripPrefix(selectedTool)}
          </span>
          {hasUi && (
            <span style={{
              padding: "2px 6px", borderRadius: "3px", fontSize: "9px",
              fontWeight: 700, letterSpacing: "0.5px",
              background: "var(--color-success-bg)", color: "var(--color-success)",
            }}>MAP UI</span>
          )}
        </div>
        {tool?.description && (
          <div style={{
            fontSize: "11.5px", color: "var(--color-text-secondary)",
            lineHeight: 1.5,
          }}>
            {tool.description}
          </div>
        )}
      </div>

      {/* JSON editor area */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "10px 16px 6px", flexShrink: 0,
        }}>
          <span style={{
            fontSize: "10px", fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.8px", color: "var(--color-text-tertiary)",
          }}>Request Body</span>
          {EXAMPLE_INPUTS[selectedTool] && (
            <button
              onClick={() => setInputJson(getExampleInput(selectedTool))}
              style={{
                padding: "2px 8px", border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm)", fontSize: "10px",
                background: "var(--color-bg-secondary)", color: "var(--color-text-secondary)",
                cursor: "pointer", fontWeight: 500,
              }}
            >
              Reset
            </button>
          )}
        </div>
        <div style={{ flex: 1, padding: "0 16px", overflow: "hidden" }}>
          <textarea
            value={inputJson}
            onChange={(e) => setInputJson(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                handleCall();
              }
            }}
            spellCheck={false}
            style={{
              width: "100%", height: "100%",
              padding: "12px",
              border: `1px solid ${isValidJson ? "var(--color-border)" : "var(--color-danger)"}`,
              borderRadius: "var(--radius-md)",
              fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
              fontSize: "12px", lineHeight: 1.6,
              background: "var(--color-bg-inset)",
              color: "var(--color-text)",
              resize: "none", outline: "none",
              boxShadow: "var(--shadow-inset)",
              transition: "border-color 0.15s ease",
            }}
          />
        </div>
        {!isValidJson && (
          <div style={{
            padding: "4px 16px", fontSize: "11px",
            color: "var(--color-danger)",
          }}>Invalid JSON</div>
        )}
      </div>

      {/* Call button */}
      <div style={{
        padding: "12px 16px", borderTop: "1px solid var(--color-border)",
        flexShrink: 0,
      }}>
        {error && (
          <div style={{
            padding: "8px 10px", marginBottom: "8px",
            background: "var(--color-danger-bg)", color: "var(--color-danger)",
            borderRadius: "var(--radius-sm)", fontSize: "11px",
          }}>{error}</div>
        )}
        <button
          onClick={handleCall}
          disabled={!selectedTool || !isValidJson || loading}
          style={{
            width: "100%", padding: "10px", border: "none",
            borderRadius: "var(--radius-md)",
            background: loading ? "var(--color-bg-tertiary)" : "var(--color-primary)",
            color: loading ? "var(--color-text-tertiary)" : "var(--color-primary-text)",
            fontWeight: 700, fontSize: "13px",
            cursor: (!selectedTool || !isValidJson || loading) ? "not-allowed" : "pointer",
            opacity: (!selectedTool || !isValidJson) ? 0.5 : 1,
            display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            transition: "all 0.15s ease",
            boxShadow: loading ? "none" : "var(--shadow-sm)",
          }}
        >
          {loading ? (
            <><Spinner /> Running...</>
          ) : (
            <>{Icons.play} Run</>
          )}
        </button>
        <div style={{
          textAlign: "center", marginTop: "6px",
          fontSize: "10px", color: "var(--color-text-tertiary)",
        }}>
          <Kbd>{"\u2318"}</Kbd> + <Kbd>Enter</Kbd>
        </div>
      </div>
    </div>
  );
}

// ─── Main Host ───────────────────────────────────────────────────────────

function Host({ serversPromise }: { serversPromise: Promise<ServerInfo[]> }) {
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [selectedTool, setSelectedTool] = useState("");
  const [currentCall, setCurrentCall] = useState<CallState | null>(null);
  const [loading, setLoading] = useState(false);
  const [callId, setCallId] = useState(0);
  const [theme, setTheme] = useState<Theme>(getTheme);

  useEffect(() => onThemeChange(setTheme), []);

  const sortedTools = useMemo(() => {
    if (!server) return [];
    return Array.from(server.tools.values()).filter(isToolVisibleToModel).sort(compareTools);
  }, [server]);

  const handleServerReady = useCallback((s: ServerInfo) => {
    setServer(s);
    const visible = Array.from(s.tools.values()).filter(isToolVisibleToModel).sort(compareTools);
    if (visible[0]) setSelectedTool(visible[0].name);
  }, []);

  const handleCall = useCallback((input: Record<string, unknown>) => {
    if (!server || !selectedTool) return;
    setLoading(true);
    const info = callTool(server, selectedTool, input);
    const newCallId = callId + 1;
    setCallId(newCallId);
    setCurrentCall({ info, callId: newCallId, startTime: Date.now() });
    info.resultPromise.then(
      () => setLoading(false),
      () => setLoading(false),
    );
  }, [server, selectedTool, callId]);

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100vh", overflow: "hidden",
      background: "var(--color-bg)",
    }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 16px", height: "44px",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-secondary)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <img src={tomtomLogoUrl} alt="TomTom" width="20" height="20" />
            <span style={{ fontWeight: 700, fontSize: "13px", letterSpacing: "-0.2px" }}>
              TomTom MCP
            </span>
          </div>
          <Suspense fallback={
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              fontSize: "11px", color: "var(--color-text-tertiary)",
            }}>
              <Spinner /> Connecting...
            </span>
          }>
            <ServerBadge serversPromise={serversPromise} onReady={handleServerReady} />
          </Suspense>
        </div>

        <button
          onClick={() => toggleTheme()}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "30px", height: "30px",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-bg)",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          {theme === "dark" ? Icons.sun : Icons.moon}
        </button>
      </div>

      {/* Main content */}
      {server && (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <ToolListSidebar
            tools={sortedTools}
            selectedTool={selectedTool}
            onSelect={setSelectedTool}
          />
          <InputPanel
            server={server}
            selectedTool={selectedTool}
            onCall={handleCall}
            loading={loading}
          />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {currentCall ? (
              <ResultPanel key={currentCall.callId} call={currentCall} callNumber={callId} />
            ) : (
              <EmptyState />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Server Badge ────────────────────────────────────────────────────────

function ServerBadge({
  serversPromise,
  onReady,
}: {
  serversPromise: Promise<ServerInfo[]>;
  onReady: (server: ServerInfo) => void;
}) {
  const servers = use(serversPromise);
  const [hasInit, setHasInit] = useState(false);

  useEffect(() => {
    if (hasInit || servers.length === 0) return;
    onReady(servers[0]);
    setHasInit(true);
  }, [servers, hasInit, onReady]);

  if (servers.length === 0) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: "6px",
        padding: "3px 10px", borderRadius: "var(--radius-sm)",
        fontSize: "11px", fontWeight: 500,
        background: "var(--color-danger-bg)", color: "var(--color-danger)",
      }}>
        {Icons.alert} Disconnected
      </span>
    );
  }

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "6px",
      padding: "3px 10px", borderRadius: "var(--radius-sm)",
      fontSize: "11px", fontWeight: 500,
      background: "var(--color-success-bg)", color: "var(--color-success)",
    }}>
      <span style={{
        width: "6px", height: "6px", borderRadius: "50%",
        background: "var(--color-success)",
        boxShadow: "0 0 0 2px var(--color-success-bg)",
      }} />
      {servers[0].name}
      <span style={{
        width: "1px", height: "12px",
        background: "currentColor", opacity: 0.2,
      }} />
      {servers[0].tools.size} tools
    </span>
  );
}

// ─── Bootstrap ───────────────────────────────────────────────────────────

async function connectToAllServers(): Promise<ServerInfo[]> {
  const [serversRes, configRes] = await Promise.all([
    fetch("/api/servers"),
    fetch("/api/config"),
  ]);
  const urls = (await serversRes.json()) as string[];
  const config = (await configRes.json()) as { apiKey: string; backend: string };

  const headers: Record<string, string> = {};
  if (config.apiKey) headers["tomtom-api-key"] = config.apiKey;
  if (config.backend) headers["tomtom-maps-backend"] = config.backend;

  const results = await Promise.allSettled(
    urls.map((url) => connectToServer(new URL(url), headers)),
  );

  const servers: ServerInfo[] = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "fulfilled") {
      servers.push((results[i] as PromiseFulfilledResult<ServerInfo>).value);
    } else {
      console.warn(`Failed to connect to ${urls[i]}:`, (results[i] as PromiseRejectedResult).reason);
    }
  }
  return servers;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Host serversPromise={connectToAllServers()} />
  </StrictMode>,
);
