import { config as loadDotenv } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
loadDotenv({ path: path.join(ROOT, ".env") }); // get env vars

// The data directory
export const DATA = path.join(ROOT, "data");
export const TZ_DIR = path.join(DATA, "tz");

// These are the tzdata source files (they use no extension) that carry rules + maintainer commentary
export const TZ_FILES = [
  "africa",
  "antarctica",
  "asia",
  "australasia",
  "backward",
  "etcetera",
  "europe",
  "northamerica",
  "southamerica",
];

// The base URL for the tzdata source files on GitHub
export const TZ_RAW_BASE = "https://raw.githubusercontent.com/eggert/tz/main";

export const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;
// This regex catches lines like `# From Steffen Thorsen (2015-04-08):`
export const ATTRIBUTION_RE = /^#\s*From ([^(]+?)\s*\((\d{4}-\d{2}-\d{2})[^)]*\)\s*:/;

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// clean up URLs by removing trailing punctuation.
export function cleanUrl(raw) {
  return raw.replace(/[.,;:]+$/, "");
}

/**
 * This splits one tzdata file into comment blocks.
 *
 * On their repo, a comment block is a sequence of `#` lines. 
 * A new `# From <name> (<date>):` line starts a new block, 
 * because each such line is a different person speaking. 
 * Also, `subject` is the first Rule / Zone / Link line below, 
 * which is the rule under discussion.
 */
export function parseBlocks(text, file) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let current = null;
  let pending = [];

  const close = () => {
    if (!current) return;
    pending.push(current);
    current = null;
  };
  const open = (i) => {
    current = { file, startLine: i + 1, lines: [] };
  };

  lines.forEach((line, i) => {
    if (line.startsWith("#")) {
      if (ATTRIBUTION_RE.test(line) && current?.lines.length) close();
      if (!current) open(i);
      current.lines.push(line);
      return;
    }
    // A blank line should not end a block because these maintaners' commentary is often multi paragraphs.
    if (line.trim() === "") return;
    close();
    for (const b of pending) {
      b.subject = line.trim();
      blocks.push(b);
    }
    pending = [];
  });
  close();
  blocks.push(...pending);

  return blocks.map((b) => {
    const body = b.lines.join("\n");
    const attribution = b.lines.map((l) => l.match(ATTRIBUTION_RE)).find(Boolean);
    return {
      file: b.file,
      line: b.startLine,
      subject: b.subject ?? null,
      author: attribution?.[1] ?? null,
      date: attribution?.[2] ?? null,
      text: body,
      urls: [...new Set((body.match(URL_RE) ?? []).map(cleanUrl))],
    };
  });
}

// reads a tzdata file from the data directory.
export async function readTzFile(name) {
  return readFile(path.join(TZ_DIR, name), "utf8");
}

/** These three functions write/read a JSON file to/from the data directory. */
export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + "\n");
}
export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
// same thing but with a fallback value if the file does not exist.
export async function readJsonSafe(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

// This runs a `worker` over `items`, at most `limit` in flight. 
// Note that order of results is preserved
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

// This parses command line flags like `--name value` or `--name` to a boolean.
export function flag(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  return value && !value.startsWith("--") ? value : true;
}
