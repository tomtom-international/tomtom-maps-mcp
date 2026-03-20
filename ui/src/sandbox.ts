import type { McpUiSandboxProxyReadyNotification, McpUiSandboxResourceReadyNotification } from "@modelcontextprotocol/ext-apps";
import { buildAllowAttribute } from "@modelcontextprotocol/ext-apps/app-bridge";

const ALLOWED_REFERRER_PATTERN = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/;

if (window.self === window.top) {
  throw new Error("This file is only to be used in an iframe sandbox.");
}

if (!document.referrer) {
  throw new Error("No referrer, cannot validate embedding site.");
}

if (!document.referrer.match(ALLOWED_REFERRER_PATTERN)) {
  throw new Error(`Embedding domain not allowed in referrer ${document.referrer}.`);
}

const EXPECTED_HOST_ORIGIN = new URL(document.referrer).origin;
const OWN_ORIGIN = new URL(window.location.href).origin;

// Security check: sandbox must not have access to parent
try {
  window.top!.alert("If you see this, the sandbox is not setup securely.");
  throw "FAIL";
} catch (e) {
  if (e === "FAIL") {
    throw new Error("The sandbox is not setup securely.");
  }
}

const inner = document.createElement("iframe");
inner.style.cssText = "width:100%; height:100%; border:none;";
inner.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
document.body.appendChild(inner);

const RESOURCE_READY_NOTIFICATION: McpUiSandboxResourceReadyNotification["method"] =
  "ui/notifications/sandbox-resource-ready";
const PROXY_READY_NOTIFICATION: McpUiSandboxProxyReadyNotification["method"] =
  "ui/notifications/sandbox-proxy-ready";

window.addEventListener("message", async (event) => {
  if (event.source === window.parent) {
    if (event.origin !== EXPECTED_HOST_ORIGIN) return;

    if (event.data && event.data.method === RESOURCE_READY_NOTIFICATION) {
      const { html, sandbox, permissions } = event.data.params;
      if (typeof sandbox === "string") {
        inner.setAttribute("sandbox", sandbox);
      }
      const allowAttribute = buildAllowAttribute(permissions);
      if (allowAttribute) {
        inner.setAttribute("allow", allowAttribute);
      }
      if (typeof html === "string") {
        const doc = inner.contentDocument || inner.contentWindow?.document;
        if (doc) {
          doc.open();
          doc.write(html);
          doc.close();
        } else {
          inner.srcdoc = html;
        }
      }
    } else {
      if (inner && inner.contentWindow) {
        inner.contentWindow.postMessage(event.data, "*");
      }
    }
  } else if (event.source === inner.contentWindow) {
    if (event.origin !== OWN_ORIGIN) return;
    window.parent.postMessage(event.data, EXPECTED_HOST_ORIGIN);
  }
});

window.parent.postMessage({
  jsonrpc: "2.0",
  method: PROXY_READY_NOTIFICATION,
  params: {},
}, EXPECTED_HOST_ORIGIN);
