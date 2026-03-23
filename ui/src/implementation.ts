/**
 * MCP host implementation for TomTom MCP Apps.
 * Handles server connections, tool calls, and app rendering via AppBridge.
 */

import {
  RESOURCE_MIME_TYPE,
  getToolUiResourceUri,
  type McpUiSandboxProxyReadyNotification,
  AppBridge,
  PostMessageTransport,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
  buildAllowAttribute,
  type McpUiUpdateModelContextRequest,
  type McpUiMessageRequest,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { CallToolResult, Resource, Tool } from "@modelcontextprotocol/sdk/types.js";
import { getTheme, onThemeChange } from "./theme";
import { HOST_STYLE_VARIABLES } from "./host-styles";

const SANDBOX_PROXY_BASE_URL = "http://localhost:8081/sandbox.html";
const IMPLEMENTATION = { name: "TomTom MCP App Host", version: "1.0.0" };

export const log = {
  info: console.log.bind(console, "[HOST]"),
  warn: console.warn.bind(console, "[HOST]"),
  error: console.error.bind(console, "[HOST]"),
};

export interface ServerInfo {
  name: string;
  client: Client;
  tools: Map<string, Tool>;
  resources: Map<string, Resource>;
}

/**
 * Connect to a TomTom MCP server with custom headers for API key + backend.
 */
export async function connectToServer(
  serverUrl: URL,
  headers?: Record<string, string>,
): Promise<ServerInfo> {
  log.info("Connecting to server:", serverUrl.href);
  const client = await connectWithFallback(serverUrl, headers);

  const name = client.getServerVersion()?.name ?? serverUrl.href;

  const toolsList = await client.listTools();
  const tools = new Map(toolsList.tools.map((tool) => [tool.name, tool]));
  log.info("Server tools:", Array.from(tools.keys()));

  let resources: Map<string, Resource>;
  const serverCapabilities = client.getServerCapabilities();
  if (serverCapabilities?.resources) {
    const resourcesList = await client.listResources();
    resources = new Map(resourcesList.resources.map((r) => [r.uri, r]));
    log.info("Server resources:", Array.from(resources.keys()));
  } else {
    resources = new Map();
    log.info("Server does not advertise resources capability, skipping resource listing");
  }

  return { name, client, tools, resources };
}

async function connectWithFallback(
  serverUrl: URL,
  headers?: Record<string, string>,
): Promise<Client> {
  const requestInit: RequestInit = headers
    ? { headers }
    : {};

  // Try Streamable HTTP first
  try {
    const client = new Client(IMPLEMENTATION);
    await client.connect(new StreamableHTTPClientTransport(serverUrl, { requestInit }));
    log.info("Connected via Streamable HTTP");
    return client;
  } catch (e) {
    log.info("Streamable HTTP failed, trying SSE:", e);
  }

  // Fall back to SSE
  try {
    const client = new Client(IMPLEMENTATION);
    await client.connect(new SSEClientTransport(serverUrl, { requestInit }));
    log.info("Connected via SSE");
    return client;
  } catch (e) {
    throw new Error(`Could not connect with any transport: ${e}`);
  }
}

// ─── Tool Calling ─────────────────────────────────────────────────────────

interface UiResourceData {
  html: string;
  csp?: McpUiResourceCsp;
  permissions?: McpUiResourcePermissions;
}

export interface ToolCallInfo {
  serverInfo: ServerInfo;
  tool: Tool;
  input: Record<string, unknown>;
  resultPromise: Promise<CallToolResult>;
  appResourcePromise?: Promise<UiResourceData>;
}

export function hasAppHtml(info: ToolCallInfo): info is Required<ToolCallInfo> {
  return !!info.appResourcePromise;
}

export function callTool(
  serverInfo: ServerInfo,
  name: string,
  input: Record<string, unknown>,
): ToolCallInfo {
  log.info("Calling tool:", name, input);
  const resultPromise = serverInfo.client.callTool({
    name,
    arguments: input,
  }) as Promise<CallToolResult>;

  const tool = serverInfo.tools.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);

  const info: ToolCallInfo = { serverInfo, tool, input, resultPromise };

  const uiResourceUri = getToolUiResourceUri(tool);
  if (uiResourceUri) {
    info.appResourcePromise = getUiResource(serverInfo, uiResourceUri);
  }

  return info;
}

async function getUiResource(
  serverInfo: ServerInfo,
  uri: string,
): Promise<UiResourceData> {
  log.info("Reading UI resource:", uri);
  const resource = await serverInfo.client.readResource({ uri });

  if (!resource || resource.contents.length !== 1) {
    throw new Error(`Resource not found or unexpected contents: ${uri}`);
  }

  const content = resource.contents[0];
  if (content.mimeType !== RESOURCE_MIME_TYPE) {
    throw new Error(`Unsupported MIME type: ${content.mimeType}`);
  }

  const html = "blob" in content ? atob(content.blob as string) : (content as any).text;

  const contentMeta = (content as any)._meta || (content as any).meta;
  const listingResource = serverInfo.resources.get(uri);
  const listingMeta = (listingResource as any)?._meta;
  const uiMeta = contentMeta?.ui ?? listingMeta?.ui;

  return { html, csp: uiMeta?.csp, permissions: uiMeta?.permissions };
}

// ─── Sandbox / AppBridge ──────────────────────────────────────────────────

export function loadSandboxProxy(
  iframe: HTMLIFrameElement,
  csp?: McpUiResourceCsp,
  permissions?: McpUiResourcePermissions,
): Promise<boolean> {
  if (iframe.src) return Promise.resolve(false);

  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");

  const allowAttribute = buildAllowAttribute(permissions);
  if (allowAttribute) iframe.setAttribute("allow", allowAttribute);

  const readyNotification: McpUiSandboxProxyReadyNotification["method"] =
    "ui/notifications/sandbox-proxy-ready";

  const readyPromise = new Promise<boolean>((resolve) => {
    const listener = ({ source, data }: MessageEvent) => {
      if (source === iframe.contentWindow && data?.method === readyNotification) {
        window.removeEventListener("message", listener);
        resolve(true);
      }
    };
    window.addEventListener("message", listener);
  });

  const sandboxUrl = new URL(SANDBOX_PROXY_BASE_URL);
  if (csp) sandboxUrl.searchParams.set("csp", JSON.stringify(csp));
  iframe.src = sandboxUrl.href;

  return readyPromise;
}

export async function initializeApp(
  iframe: HTMLIFrameElement,
  appBridge: AppBridge,
  { input, resultPromise, appResourcePromise }: Required<ToolCallInfo>,
): Promise<void> {
  const appInitializedPromise = hookInitializedCallback(appBridge);

  await appBridge.connect(
    new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!),
  );

  const { html, csp, permissions } = await appResourcePromise;
  log.info("Sending UI resource HTML to MCP App");
  await appBridge.sendSandboxResourceReady({ html, csp, permissions });

  await appInitializedPromise;
  log.info("MCP App initialized");

  appBridge.sendToolInput({ arguments: input });

  resultPromise.then(
    (result) => {
      log.info("Sending tool result to MCP App");
      appBridge.sendToolResult(result);
    },
    (error) => {
      log.error("Tool call failed:", error);
      appBridge.sendToolCancelled({
        reason: error instanceof Error ? error.message : String(error),
      });
    },
  );
}

function hookInitializedCallback(appBridge: AppBridge): Promise<void> {
  const oninitialized = appBridge.oninitialized;
  return new Promise<void>((resolve) => {
    appBridge.oninitialized = (...args) => {
      resolve();
      appBridge.oninitialized = oninitialized;
      appBridge.oninitialized?.(...args);
    };
  });
}

export type ModelContext = McpUiUpdateModelContextRequest["params"];
export type AppMessage = McpUiMessageRequest["params"];

export interface AppBridgeCallbacks {
  onContextUpdate?: (context: ModelContext | null) => void;
  onMessage?: (message: AppMessage) => void;
}

export function newAppBridge(
  serverInfo: ServerInfo,
  iframe: HTMLIFrameElement,
  callbacks?: AppBridgeCallbacks,
): AppBridge {
  const serverCapabilities = serverInfo.client.getServerCapabilities();
  const appBridge = new AppBridge(serverInfo.client, IMPLEMENTATION, {
    openLinks: {},
    serverTools: serverCapabilities?.tools,
    serverResources: serverCapabilities?.resources,
    updateModelContext: { text: {} },
  }, {
    hostContext: {
      theme: getTheme(),
      platform: "web",
      styles: { variables: HOST_STYLE_VARIABLES },
      containerDimensions: { maxHeight: 6000 },
      displayMode: "inline",
      availableDisplayModes: ["inline"],
    },
  });

  onThemeChange((newTheme) => {
    appBridge.sendHostContextChange({ theme: newTheme });
  });

  appBridge.onmessage = async (params) => {
    log.info("Message from app:", params);
    callbacks?.onMessage?.(params);
    return {};
  };

  appBridge.onopenlink = async (params) => {
    window.open(params.url, "_blank", "noopener,noreferrer");
    return {};
  };

  appBridge.onloggingmessage = (params) => {
    log.info("App log:", params);
  };

  appBridge.onupdatemodelcontext = async (params) => {
    const hasContent = params.content && params.content.length > 0;
    const hasStructured = params.structuredContent && Object.keys(params.structuredContent).length > 0;
    callbacks?.onContextUpdate?.(hasContent || hasStructured ? params : null);
    return {};
  };

  appBridge.onsizechange = async ({ width, height }) => {
    const style = getComputedStyle(iframe);
    const isBorderBox = style.boxSizing === "border-box";

    if (width !== undefined) {
      if (isBorderBox) {
        width += parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      }
      iframe.style.minWidth = `min(${width}px, 100%)`;
    }
    if (height !== undefined) {
      if (isBorderBox) {
        height += parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      }
      iframe.style.height = `${height}px`;
    }
  };

  appBridge.onrequestdisplaymode = async (params) => {
    const newMode = params.mode === "fullscreen" ? "fullscreen" : "inline";
    appBridge.sendHostContextChange({ displayMode: newMode });
    return { mode: newMode };
  };

  return appBridge;
}
