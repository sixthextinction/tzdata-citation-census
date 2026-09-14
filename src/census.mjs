import path from "node:path";
import {
  DATA,
  flag,
  pool,
  readJson,
  readJsonSafe,
} from "./lib/tz.mjs";
import { classify, get, saveBody, urlId } from "./lib/get.mjs";
import { createUnlockerAgent, needsUnlockRetry, unlocker } from "./lib/unlocker.mjs";
import { needsWayback, wayback } from "./lib/wayback.mjs";
import {
  REPORT_JSON,
  REPORT_UNLOCKER_JSON,
  decorate,
  overlayUnlockerRows,
  persist,
  reportPaths,
} from "./lib/persist.mjs";

/**
 * This is the citation census.
 *
 * First we GET every unique URL from a home connection (the live pass).
 * Then, for URLs that came back 404 or 410, we ask the Internet Archive
 * for a copy (the recover pass). Those two are separate on purpose:
 * a dead page is not the same thing as a page that refused us.
 *
 * `--unlock` is an optional extra hop through Bright Data, only for
 * URLs we could not reach directly.
 *
 * Re-run resumes. `--recover` skips live. `--live-only` skips Wayback.
 */

const SAMPLE = Number(flag("sample", 0));
// A sample run is a dry run, so we let more requests be in flight. 
// An actual run will still be conservative with its concurrency
const CONCURRENCY = Number(flag("concurrency", SAMPLE > 0 ? 16 : 8));
const BATCH = 32;
const WAYBACK_GAP_MS = Number(flag("wayback-gap", 1200));
const USE_UNLOCKER = Boolean(flag("unlock", false));
const LIVE_ONLY = Boolean(flag("live-only", false));
const RECOVER_ONLY = Boolean(flag("recover", false));

/* Utility functions */
// 1. Sleep
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 2. Deterministic shuffle (Optional, only needed if you use --sample/--seed flags)
// Because we need, say, `--sample 60 --seed 7` to always pick the same subset.
function shuffle(items) {
  const out = [...items];
  let seed = Number(flag("seed", 7));
  // Math.random() does not take a seed and is not deterministic
  // So we use a simple linear congruential generator 
  // Reference: https://en.wikipedia.org/wiki/Linear_congruential_generator
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648; 
    return seed / 2147483648;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 3. Split the items into smaller batches
function chunks(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// 4. Did we already store a live GET for this URL?
// This is only true (i.e. "we already tried") if 
// prev exists + prev.direct is 200 or a timeout
function liveDone(prev) {
  return prev && prev.direct !== undefined && prev.direct !== null;
}
/* End of utility functions */

// Step 1: The live pass
async function livePass(todo, done, uniqueCount, dispatcher, priorByUrl) {
  const canUnlock = Boolean(dispatcher);
  let finished = done.length;
  for (const batch of chunks(todo, BATCH)) {
    const part = await pool(batch, CONCURRENCY, async (c) => {
      const id = urlId(c.url);
      const prev = priorByUrl.get(c.url);
      const reused = liveDone(prev);
      // Resume logic: First, make sure if we already stored a direct status, we do not GET again.
      const first = reused
        ? { status: prev.direct, buf: null, contentType: null }
        : await get(c.url);
      let state = classify(first.status);
      // Next, if its a new URL: start as a direct fetch.
      // And lastly if its a resumed URL: keep last run's route, unlocker result, and saved file.
      let via = reused ? (prev.via ?? "direct") : "direct";
      let unlocked = reused ? (prev.unlocked ?? null) : null;
      let snapshot = reused ? (prev.snapshot ?? null) : null;

      if (!reused && state === "ok") {
        snapshot = await saveBody(id, first.buf, first.contentType, c.url);
      }

      // Only use Bright Data's Web Unlocker as a second try, if we were blocked or couldnt reach the cited URL the first time. 
      if (canUnlock && (state === "blocked" || state === "unreachable")) {
        const second = await unlocker(c.url, dispatcher); // fetch with unlocker
        unlocked = second.status;
        if (classify(second.status) === "ok") {
          state = "ok";
          via = "unlocker";
          snapshot = await saveBody(`${id}-unlocker`, second.buf, second.contentType, c.url); // save the body
        }
      }

      return decorate({
        ...c,
        direct: first.status,
        unlocked,
        state,
        via,
        // A live pass should never use Wayback. 
        // Keep any archive fields that a previous recover pass already wrote on this row.
        archived: reused ? (prev.archived ?? null) : null,
        wayback: reused ? prev.wayback : undefined,
        snapshot,
      });
    });
    done.push(...part);
    finished += part.length;
    // Checkpoint after every batch (so we can have resumes)
    await persist(uniqueCount, done, USE_UNLOCKER);
    process.stderr.write(`  live ${finished}/${uniqueCount}\r`);
  }
}

// Step 2: The recover pass, where we fetch the URLs from the Internet Archive's Wayback Machine.
async function recoverPass(rows, uniqueCount) {
  const queue = [];
  rows.forEach((row, i) => {
    if (needsWayback(row)) queue.push(i);
  });
  console.error(
    `\nWayback recover: ${queue.length} HTTP 404/410, serial, ${WAYBACK_GAP_MS} ms apart.`,
  );
  for (let n = 0; n < queue.length; n++) {
    const i = queue[n];
    const row = rows[i];
    const wb = await wayback(row.url);
    row.wayback = wb;
    if (wb.hit) {
      row.archived = { url: wb.url, timestamp: wb.timestamp };
      const snap = await get(wb.url, 30_000);
      if (classify(snap.status) === "ok") {
        row.snapshot = await saveBody(urlId(row.url), snap.buf, snap.contentType, wb.url);
      }
    }
    rows[i] = decorate(row);
    // HEADS UP: Archive.org does rate-limits. So persist often enough to survive
    if ((n + 1) % 5 === 0 || n === queue.length - 1) {
      await persist(uniqueCount, rows, USE_UNLOCKER);
    }
    process.stderr.write(`  wayback ${n + 1}/${queue.length}\r`);
    if (n < queue.length - 1) await sleep(WAYBACK_GAP_MS);
  }
}

async function main() {
  const citations = await readJson(path.join(DATA, "citations.json"));
  // Same URL can appear in more than one comment and we only want unique URLs, so...
  const unique = [...new Map(citations.map((c) => [c.url, c])).values()];
  const universe = SAMPLE > 0 ? shuffle(unique).slice(0, SAMPLE) : unique;

  const dispatcher = USE_UNLOCKER ? createUnlockerAgent() : null;
  const canUnlock = Boolean(dispatcher);
  // Self explanatory
  if (USE_UNLOCKER && !canUnlock) {
    console.error("--unlock needs BRIGHT_DATA_UNLOCKER_AUTH.");
    process.exit(1);
  }

  // For resume, we dont want sample runs to pick up rows from a previous full census.
  // So we only resume if we are NOT sampling.
  const resume = SAMPLE === 0;
  const directRows = resume ? (await readJsonSafe(REPORT_JSON, {}))?.rows ?? [] : [];
  const unlockerRows = resume && USE_UNLOCKER
    ? (await readJsonSafe(REPORT_UNLOCKER_JSON, {}))?.rows ?? []
    : [];
  const prior = USE_UNLOCKER ? overlayUnlockerRows(directRows, unlockerRows) : directRows;
  const priorByUrl = new Map(prior.map((r) => [r.url, r]));
  const done = [];
  const todo = [];
  for (const c of universe) {
    const prev = priorByUrl.get(c.url);
    if (RECOVER_ONLY) {
      if (prev) done.push(decorate(prev));
      else todo.push(c);
    } else if (liveDone(prev) && !(canUnlock && needsUnlockRetry(prev))) {
      done.push(decorate(prev));
    } else {
      todo.push(c);
    }
  }

  // If we are only recovering, we need a live census first.
  if (RECOVER_ONLY && todo.length) {
    console.error(`--recover needs a live census first. ${todo.length} URLs have no direct status.`);
  }

  console.error(
    `${universe.length} URLs. Live already done: ${done.length}. Live remaining: ${todo.length}.`,
  );

  // Try to do the live pass, then the recover pass.
  try {
    if (!RECOVER_ONLY) {
      await livePass(todo, done, unique.length, dispatcher, priorByUrl);
    }

    // Rebuild in citation order so the recover pass is stable across runs.
    const byUrl = new Map(done.map((r) => [r.url, r]));
    const rows = universe.map((c) => byUrl.get(c.url)).filter(Boolean);

    // Write the live census before we try using Wayback, so we still leave a record
    await persist(unique.length, rows, USE_UNLOCKER);

    // If we are not limited to only the live pass, THEN we can try using Wayback.
    if (!LIVE_ONLY) {
      await recoverPass(rows, unique.length);
    }

    // Persist + write a quick report
    const report = await persist(unique.length, rows, USE_UNLOCKER);
    console.log(`\nChecked ${report.checked} of ${unique.length} unique cited URLs`);
    for (const [state, n] of Object.entries(report.tally).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${state.padEnd(12)} ${String(n).padStart(4)}  ${((n / report.checked) * 100).toFixed(0)}%`);
    }
    console.log(`  retry queue:`);
    for (const [how, n] of Object.entries(report.retry ?? {}).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${how.padEnd(12)} ${String(n).padStart(4)}`);
    }
    console.log(`  archive hits: ${rows.filter((r) => r.archived).length}`);
    console.log(`  wayback pending: ${report.wayback_pending}`);
    console.log(`  saved on disk: ${rows.filter((r) => r.snapshot).length}`);
    const dest = reportPaths(USE_UNLOCKER);
    console.log(`\nWrote ${path.relative(path.dirname(DATA), dest.json)} and ${path.relative(path.dirname(DATA), dest.md)}`);
  } finally {
    await dispatcher?.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
