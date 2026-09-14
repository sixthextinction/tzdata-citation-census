import { ProxyAgent, fetch as proxyFetch } from "undici";
import { BROWSER_UA } from "./tz.mjs";
import { MAX_BYTES, classify } from "./get.mjs";

// Build the proxy URI for the Bright Data Web Unlocker
export function unlockerProxyUri() {
  const auth = process.env.BRIGHT_DATA_UNLOCKER_AUTH?.trim();
  if (!auth) return null;
  const colon = auth.indexOf(":");
  const user = colon === -1 ? auth : auth.slice(0, colon);
  const pass = colon === -1 ? "" : auth.slice(colon + 1);
  const host = process.env.BRIGHT_DATA_UNLOCKER_PROXY_HOST?.trim() || "brd.superproxy.io";
  const port = process.env.BRIGHT_DATA_UNLOCKER_PROXY_PORT?.trim() || "44445";
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
}

// Create a new ProxyAgent for the Bright Data Web Unlocker
export function createUnlockerAgent() {
  const uri = unlockerProxyUri();
  if (!uri) return null;
  const insecure = (process.env.BRIGHT_DATA_UNLOCKER_INSECURE ?? "1") !== "0";
  return new ProxyAgent({
    uri,
    requestTls: { rejectUnauthorized: !insecure },
    proxyTls: { rejectUnauthorized: !insecure },
  });
}

// Quick health check from headers
function unlockerStatus(resp) {
  const brdError = resp.headers.get("x-brd-error-code") || resp.headers.get("x-brd-error");
  if (brdError) return `unlocker ${brdError}`;
  const brdStatus = Number(resp.headers.get("x-brd-status-code"));
  if (Number.isFinite(brdStatus) && brdStatus > 0) return brdStatus;
  return resp.status;
}

// Our meat and potatoes.
// This function fetches a URL with Bright Data's Web unlocker and returns the status, body, and content type
export async function unlocker(url, dispatcher) {
  try {
    const resp = await proxyFetch(url, {
      dispatcher,
      headers: { "User-Agent": BROWSER_UA, Accept: "*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    });
    const contentType = resp.headers.get("content-type");
    const status = unlockerStatus(resp);
    const len = Number(resp.headers.get("content-length") ?? 0);
    const okish = typeof status === "number" && status >= 200 && status < 400;
    if (!okish || len > MAX_BYTES) {
      resp.body?.cancel();
      return { status, buf: null, contentType };
    }
    const buf = Buffer.from(await resp.arrayBuffer()); // dont forget, you still need to convert the body to a buffer
    return { status, buf, contentType };
  } catch (err) {
    return {
      status: err.name === "TimeoutError" ? "timeout" : (err.cause?.code ?? err.name),
      buf: null,
      contentType: null,
    };
  }
}

// Lets leave this here for convenience
// This function quickly checks adnd returns if we need to retry with the unlocker
export function needsUnlockRetry(row) {
  if (!row || row.direct == null) return false;
  if (row.unlocked != null || row.via === "unlocker") return false;
  const state = row.state ?? classify(row.direct);
  return state === "blocked" || state === "unreachable";
}
