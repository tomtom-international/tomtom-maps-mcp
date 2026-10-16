import type { APIRequestContext } from "@playwright/test";

export interface JsonRpcResponse {
  status: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

export async function mcpCall(
  request: APIRequestContext,
  mcpUrl: string,
  accessToken: string,
  method: string,
  params: Record<string, unknown> = {}
): Promise<JsonRpcResponse> {
  const response = await request.post(mcpUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    data: { jsonrpc: "2.0", id: 1, method, params },
  });
  const body = await response.text();
  const message = parseJsonRpc(body, response.headers()["content-type"] ?? "");
  return { status: response.status(), ...message };
}

export function toolResultText(result: Record<string, unknown> | undefined): string {
  const content = result?.content as Array<{ type: string; text?: string }> | undefined;
  return content?.find((item) => item.type === "text")?.text ?? "";
}

// The server answers JSON-RPC either as plain JSON or as one event-stream message.
function parseJsonRpc(body: string, contentType: string): Omit<JsonRpcResponse, "status"> {
  if (!body.trim()) return {};
  const json = contentType.startsWith("text/event-stream")
    ? body
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length))
        .join("")
    : body;
  const parsed = JSON.parse(json) as { result?: Record<string, unknown>; error?: JsonRpcResponse["error"] };
  return { result: parsed.result, error: parsed.error };
}
