#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_LOCAL_FILE="${ROOT_DIR}/.env.local"

if [[ -f "${ENV_LOCAL_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_LOCAL_FILE}"
  set +a
fi

export E2E_GATEWAY_URL="${E2E_GATEWAY_URL:-http://dashboard.localtest.me:8080}"
export E2E_NAMESPACE="${E2E_NAMESPACE:-platform}"
export E2E_CHAT="${E2E_CHAT:-false}"

: "${ADMIN_EMAIL:?Set ADMIN_EMAIL in .env.local or the environment.}"
: "${ADMIN_PASSWORD:?Set ADMIN_PASSWORD in .env.local or the environment.}"

if ! command -v node >/dev/null 2>&1 || ! command -v kubectl >/dev/null 2>&1; then
  echo "[e2e] node and kubectl are required." >&2
  exit 1
fi

node --input-type=module <<'NODE'
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const baseUrl = process.env.E2E_GATEWAY_URL.replace(/\/+$/, "");
const namespace = process.env.E2E_NAMESPACE;
const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const expectedOrderId = process.env.EXPECTED_ORDER_ID;
const shouldRunChat = process.env.E2E_CHAT === "true";
let adminCookie;
let notesDisabled = false;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { method = "GET", body, cookie, token } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  return { response, text: await response.text() };
}

async function parseBody(result, label) {
  let parsed;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    throw new Error(`${label} returned non-JSON HTTP ${result.response.status}.`);
  }
  if (!result.response.ok) {
    const message = parsed.error?.json?.message ?? parsed.error?.message ?? result.text;
    throw new Error(`${label} failed (HTTP ${result.response.status}): ${message}`);
  }
  return parsed;
}

async function trpc(path, input, { cookie = adminCookie, method } = {}) {
  const isQuery = method === "GET";
  const query = isQuery && input !== undefined
    ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
    : "";
  const url = isQuery
    ? `${baseUrl}/api/trpc/${path}${query}`
    : `${baseUrl}/api/trpc/${path}`;
  const result = await request(url.slice(baseUrl.length), {
    method: isQuery ? "GET" : "POST",
    ...(isQuery ? {} : { body: { json: input } }),
    cookie,
  });
  const parsed = await parseBody(result, `tRPC ${path}`);
  if (parsed.error) {
    const message = parsed.error.json?.message ?? parsed.error.message ?? "Unknown tRPC error";
    throw new Error(`tRPC ${path} failed: ${message}`);
  }
  return parsed.result?.data?.json ?? parsed.result?.data;
}

async function login(email, password) {
  const result = await request("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  await parseBody(result, "Login");
  const cookieHeader = result.response.headers.get("set-cookie");
  assert(cookieHeader, "Login did not issue a session cookie.");
  return { cookie: cookieHeader.split(";")[0], user: JSON.parse(result.text) };
}

async function createMember(email) {
  const result = await trpc("members.create", { email, role: "MEMBER" });
  assert(result?.member?.id && result.temporaryPassword, "Member creation returned no credentials.");
  return {
    id: result.member.id,
    email: result.member.email,
    password: result.temporaryPassword,
  };
}

async function mcp(token, method, params = {}) {
  const result = await request("/mcp", {
    method: "POST",
    token,
    body: { jsonrpc: "2.0", id: randomBytes(4).readUInt32BE(), method, params },
  });
  if (result.response.status === 401) {
    return { unauthorized: true };
  }
  const contentType = result.response.headers.get("content-type") ?? "";
  let message;
  if (contentType.includes("text/event-stream")) {
    const dataLines = result.text.split(/\r?\n/).filter((line) => line.startsWith("data:"));
    assert(dataLines.length, `MCP ${method} returned an empty event stream.`);
    message = JSON.parse(dataLines.at(-1).slice(5).trim());
  } else {
    message = await parseBody(result, `MCP ${method}`);
  }
  assert(result.response.ok, `MCP ${method} failed with HTTP ${result.response.status}.`);
  assert(!message.error, `MCP ${method} returned: ${message.error?.message ?? "JSON-RPC error"}`);
  return message.result ?? {};
}

async function listTools(token) {
  const result = await mcp(token, "tools/list");
  return result.tools ?? [];
}

async function callTool(token, name, args = {}) {
  const result = await mcp(token, "tools/call", {
    name,
    arguments: args,
  });
  assert(!result.isError, `${name} returned a tool error.`);
  return result;
}

async function waitForServerStatus(slug, expected, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const servers = await trpc("servers.list", undefined, { method: "GET" });
    const server = servers.find((item) => item.slug === slug);
    if (server?.status === expected) return server;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(`Server '${slug}' did not reach ${expected} within ${timeoutMs}ms.`);
}

async function chat(cookie, text) {
  const result = await request("/api/chat", {
    method: "POST",
    cookie,
    body: {
      messages: [
        {
          id: `e2e-${randomBytes(4).toString("hex")}`,
          role: "user",
          parts: [{ type: "text", text }],
        },
      ],
    },
  });
  assert(result.response.ok, `Chat failed with HTTP ${result.response.status}: ${result.text}`);
  return result.text;
}

async function run() {
  console.log(`[e2e] Gateway: ${baseUrl}`);
  const admin = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  adminCookie = admin.cookie;
  assert(admin.user.role === "ADMIN", "Configured login is not an administrator.");
  console.log("[e2e] Administrator login passed.");

  const memberA = await createMember(`e2e-a-${suffix}@example.test`);
  const memberB = await createMember(`e2e-b-${suffix}@example.test`);
  const sessionA = await login(memberA.email, memberA.password);
  const sessionB = await login(memberB.email, memberB.password);
  const apiKey = await trpc("keys.create", { name: `e2e-${suffix}` }, { cookie: sessionB.cookie });
  assert(apiKey.key?.startsWith("mcpgw_"), "Member B API key was not issued.");
  console.log("[e2e] Created isolated User A and User B accounts and issued User B a key.");

  const configuredServers = await trpc("servers.list", undefined, { method: "GET" });
  const enabledSlugs = configuredServers.filter((server) => server.enabled).map((server) => server.slug);
  assert(enabledSlugs.includes("woo"), "The WooCommerce upstream is not enabled.");
  assert(enabledSlugs.includes("utils"), "The utils upstream is not enabled.");
  const tools = await listTools(apiKey.key);
  const names = new Set(tools.map((tool) => tool.name));
  for (const required of ["woo__list_orders", "woo__create_product", "utils__current_time"]) {
    assert(names.has(required), `Gateway tool list is missing ${required}.`);
  }
  for (const slug of enabledSlugs) {
    assert(
      [...names].some((name) => name.startsWith(`${slug}__`)),
      `No tools were returned for enabled upstream '${slug}'.`,
    );
  }
  console.log(`[e2e] MCP key sees prefixed tools from: ${enabledSlugs.join(", ")}.`);

  const orders = await callTool(apiKey.key, "woo__list_orders", { today: true });
  const currentTime = await callTool(apiKey.key, "utils__current_time");
  const orderText = orders.content?.filter((part) => part.type === "text").map((part) => part.text).join("\n") ?? "";
  const timeText = currentTime.content?.filter((part) => part.type === "text").map((part) => part.text).join("\n") ?? "";
  assert(timeText.length > 0, "utils__current_time returned no text.");
  if (expectedOrderId) {
    assert(
      orderText.includes(`"id":${expectedOrderId}`) || orderText.includes(`"id": ${expectedOrderId}`),
      `Expected manual order ${expectedOrderId} was not returned by woo__list_orders today.`,
    );
  }
  console.log("[e2e] Called WooCommerce orders and utils time tools successfully.");

  await execFileAsync("kubectl", [
    "exec",
    "-n",
    namespace,
    "deploy/mcp-utils",
    "--",
    "node",
    "-e",
    "require('node:dns').promises.lookup('woo-mcp').then(()=>fetch('http://woo-mcp:3003/healthz',{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(1)).catch(()=>process.exit(0))).catch(()=>process.exit(2))",
  ]);
  console.log("[e2e] NetworkPolicy blocks woo-mcp access from a non-gateway pod.");

  if (shouldRunChat) {
    const productName = `E2E Chat Product ${suffix}`;
    const productResponse = await chat(
      sessionA.cookie,
      `Create a published WooCommerce product named "${productName}" priced 1.37. Use the create product tool.`,
    );
    assert(
      productResponse.includes("woo__create_product"),
      "Chat stream did not show a WooCommerce create_product tool call.",
    );
    const products = await callTool(apiKey.key, "woo__list_products", {
      search: productName,
      page: 1,
      per_page: 10,
    });
    assert(
      (products.content ?? []).some((part) => part.type === "text" && part.text.includes(productName)),
      "Chat-created product did not appear in WooCommerce.",
    );
    console.log("[e2e] User A created a product through chat; WooCommerce returned it.");

    if (expectedOrderId) {
      const orderResponse = await chat(
        sessionA.cookie,
        "What orders came in today? Include the order ID and total.",
      );
      assert(
        orderResponse.includes(expectedOrderId),
        `Chat response did not include manual order ${expectedOrderId}.`,
      );
      console.log("[e2e] User A chat found the expected manual order.");
    }
  } else {
    console.log("[e2e] Chat provider checks skipped; set E2E_CHAT=true after configuring LLM_API_KEY.");
  }

  await trpc("servers.setEnabled", { slug: "notes", enabled: false });
  notesDisabled = true;
  const disabledTools = await listTools(apiKey.key);
  assert(
    !disabledTools.some((tool) => tool.name.startsWith("notes__")),
    "Disabled notes tools remained in the external MCP tool list.",
  );
  await trpc("servers.setEnabled", { slug: "notes", enabled: true });
  notesDisabled = false;
  console.log("[e2e] Disabled upstream tools disappear from the external MCP tool list.");

  const { stdout: wooPods } = await execFileAsync("kubectl", [
    "get",
    "pods",
    "-n",
    namespace,
    "-l",
    "app.kubernetes.io/component=woo-mcp",
    "-o",
    "jsonpath={.items[0].metadata.name}",
  ]);
  const wooPod = wooPods.trim();
  assert(wooPod, "Could not find a woo-mcp pod to restart.");
  await execFileAsync("kubectl", [
    "delete",
    "pod",
    "-n",
    namespace,
    wooPod,
    "--wait=false",
  ]);
  const unavailable = await waitForServerStatus("woo", "UNREACHABLE");
  assert(unavailable.status === "UNREACHABLE", "Dashboard API did not show WooCommerce as unreachable.");
  const degradedTools = await listTools(apiKey.key);
  assert(
    !degradedTools.some((tool) => tool.name.startsWith("woo__")),
    "Unreachable WooCommerce tools were still listed.",
  );
  const utilsDuringOutage = await callTool(apiKey.key, "utils__current_time");
  assert(utilsDuringOutage.content?.length, "utils failed while WooCommerce was unavailable.");
  console.log("[e2e] Woo pod outage is isolated; dashboard status is Unreachable and utils still works.");

  await waitForServerStatus("woo", "CONNECTED");
  console.log("[e2e] WooCommerce recovered and dashboard status returned to Connected.");

  const audit = await trpc(
    "audit.list",
    { userId: memberB.id, limit: 100 },
    { method: "GET" },
  );
  const memberBAudits = audit.items ?? [];
  for (const toolName of ["list_orders", "current_time"]) {
    assert(
      memberBAudits.some(
        (entry) => entry.toolName === toolName && entry.source === "mcp" && entry.status === "success",
      ),
      `Audit log is missing User B's successful MCP call for ${toolName}.`,
    );
  }
  if (shouldRunChat) {
    const memberAAudit = await trpc(
      "audit.list",
      { userId: memberA.id, limit: 100 },
      { method: "GET" },
    );
    assert(
      (memberAAudit.items ?? []).some(
        (entry) => entry.toolName === "create_product" && entry.source === "chat",
      ),
      "Audit log is missing User A's chat-attributed create_product call.",
    );
  }
  console.log("[e2e] Audit rows attribute tool calls to User B (MCP) and User A (chat when enabled).");

  await trpc("keys.revoke", { id: apiKey.id }, { cookie: sessionB.cookie });
  const revokedCall = await request("/mcp", {
    method: "POST",
    token: apiKey.key,
    body: { jsonrpc: "2.0", id: 99, method: "tools/list", params: {} },
  });
  assert(revokedCall.response.status === 401, "Revoked key was not rejected on the next MCP request.");
  console.log("[e2e] Revoked User B key is rejected with HTTP 401 on the next request.");
  console.log("[e2e] All automated end-to-end checks passed.");
}

try {
  await run();
} catch (error) {
  if (notesDisabled && adminCookie) {
    try {
      await trpc("servers.setEnabled", { slug: "notes", enabled: true });
    } catch {
      console.error("[e2e] Warning: failed to re-enable the notes upstream after an error.");
    }
  }
  console.error(`[e2e] ${error instanceof Error ? error.message : "Unknown failure."}`);
  process.exitCode = 1;
}
NODE
