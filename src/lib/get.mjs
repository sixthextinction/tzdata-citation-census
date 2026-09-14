import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BROWSER_UA, DATA } from "./tz.mjs";

export const TIMEOUT_MS = 15_000;
export const MAX_BYTES = 2 * 1024 * 1024;
export const SNAP_DIR = path.join(DATA, "snapshots");

const BLOCKED_CODES = new Set([401, 403, 405, 406, 429, 451]); // Expand as necessary but this should be enough really

// Generate a unique ID for a URL
export function urlId(url) {
  return createHash("sha1").update(url).digest("hex").slice(0, 16);
}

// Classify the outcome of a fetch
export function classify(outcome) {
  if (typeof outcome !== "number") return "unreachable";
  if (outcome >= 200 && outcome < 400) return "ok";
  if (BLOCKED_CODES.has(outcome)) return "blocked";
  if (outcome === 404 || outcome === 410) return "gone";
  return "error";
}

// Determine the extension for a given content type and URL
function extFor(contentType, url) {
  const t = (contentType ?? "").toLowerCase();
  if (t.includes("pdf") || url.toLowerCase().endsWith(".pdf")) return "pdf";
  if (t.includes("html") || t.includes("xml") || t.includes("text")) return "html";
  if (t.includes("json")) return "json";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  if (t.includes("png")) return "png";
  return "bin";
}

// Save the body to a file
export async function saveBody(id, buf, contentType, sourceUrl) {
  if (!buf?.length) return null;
  const clipped = buf.length > MAX_BYTES ? buf.subarray(0, MAX_BYTES) : buf;
  const ext = extFor(contentType, sourceUrl);
  await mkdir(SNAP_DIR, { recursive: true });
  const rel = path.join("snapshots", `${id}.${ext}`);
  await writeFile(path.join(DATA, rel), clipped);
  return {
    file: rel.replaceAll("\\", "/"),
    bytes: clipped.length,
    contentType: contentType ?? null,
    sourceUrl,
    clipped: buf.length > MAX_BYTES,
  };
}

// Fetch a URL with a timeout
export async function get(url, timeout = TIMEOUT_MS) {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });
    const contentType = resp.headers.get("content-type");
    const len = Number(resp.headers.get("content-length") ?? 0);
    const okish = resp.status >= 200 && resp.status < 400;
    if (!okish || len > MAX_BYTES) {
      resp.body?.cancel();
      return { status: resp.status, buf: null, contentType };
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    return { status: resp.status, buf, contentType };
  } catch (err) {
    const status = err.name === "TimeoutError" ? "timeout" : (err.cause?.code ?? err.name);
    return { status, buf: null, contentType: null };
  }
}
