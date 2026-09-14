import { writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA, writeJson } from "./tz.mjs";
import { classify } from "./get.mjs";
import { needsWayback } from "./wayback.mjs";

// Paths to save our reports in
export const REPORT_JSON = path.join(DATA, "link-report.json");
export const REPORT_MD = path.join(DATA, "link-report.md");
export const REPORT_UNLOCKER_JSON = path.join(DATA, "link-report-with-unlocker.json");
export const REPORT_UNLOCKER_MD = path.join(DATA, "link-report-with-unlocker.md");

// Label the stored live outcome: "HTTP 403", or a string like "timeout".
function reasonOf(direct) {
  return typeof direct === "number" ? `HTTP ${direct}` : String(direct);
}

// Which next method to try, if any
function retryOf(direct, state) {
  if (state === "ok") return null;
  if (direct === 404 || direct === 410) return "wayback";
  if (state === "blocked" || state === "unreachable") return "unlocker";
  return "retry-direct";
}

// Fill in `state` and `retry` on a row.
export function decorate(row) {
  const state = row.state ?? classify(row.direct);
  const out = { ...row, state, retry: retryOf(row.direct, state) };
  return out;
}

// Count how many rows have each value of a field (default: state).
function summarize(rows, key = "state") {
  const tally = {};
  for (const r of rows) {
    const k = r[key] ?? "unknown";
    tally[k] = (tally[k] ?? 0) + 1;
  }
  return tally;
}

// Count how many of these URLs came from each website.
// `pred` picks which rows to include (for example only blocked ones).
// The host with the most URLs is listed first.
function hostTable(rows, pred) {
  const counts = {};
  for (const r of rows.filter(pred)) counts[r.host] = (counts[r.host] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

// Count rows that still need a retry, grouped by their live outcome label.
function reasonTally(rows) {
  const tally = {};
  for (const r of rows) {
    if (!r.retry) continue;
    const k = reasonOf(r.direct);
    tally[k] = (tally[k] ?? 0) + 1;
  }
  return tally;
}

function waybackPending(rows) {
  return rows.filter(needsWayback).length;
}

export function reportPaths(unlockerOn) {
  return unlockerOn
    ? { json: REPORT_UNLOCKER_JSON, md: REPORT_UNLOCKER_MD }
    : { json: REPORT_JSON, md: REPORT_MD };
}

export function overlayUnlockerRows(base, extra) {
  const extraByUrl = new Map((extra ?? []).map((r) => [r.url, r]));
  return (base ?? []).map((row) => {
    const over = extraByUrl.get(row.url);
    if (!over) return row;
    return {
      ...row,
      unlocked: over.unlocked ?? row.unlocked,
      via: over.via ?? row.via,
      state: over.state ?? row.state,
      snapshot: over.snapshot ?? row.snapshot,
    };
  });
}

// Generate a markdown report
function markdown(report) {
  const pct = (n) => ((n / report.checked) * 100).toFixed(0) + "%";
  const lines = [
    `# tzdata citation census — ${report.checked_at.slice(0, 10)}`,
    "",
    report.checked === report.total
      ? `Checked all ${report.total} unique cited URLs.`
      : `Checked ${report.checked} of ${report.total} unique cited URLs. Re-run to finish the live pass.`,
    report.unlocker ? "Bright Data unlocker: on." : "Bright Data unlocker: off.",
    "",
    "| state | count | share | retry |",
    "| --- | --- | --- | --- |",
  ];
  const retryFor = { ok: "—", gone: "wayback", blocked: "unlocker", unreachable: "unlocker", error: "retry-direct" };
  for (const [state, n] of Object.entries(report.tally).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${state} | ${n} | ${pct(n)} | ${retryFor[state] ?? "retry-direct"} |`);
  }

  const archived = report.rows.filter((r) => r.archived); // archived copies
  const saved = report.rows.filter((r) => r.snapshot); // saved bodies
  const gone = report.rows.filter((r) => r.direct === 404 || r.direct === 410); // 404/410
  const goneWithArchive = gone.filter((r) => r.archived); // gone but with an archive copy
  const otherArchive = archived.length - goneWithArchive.length; // archive copies of other failures
  lines.push("");
  lines.push(`Saved on disk: ${saved.length}.`);
  lines.push("");
  lines.push("| | count |");
  lines.push("| --- | --- |");
  lines.push(`| Gone (HTTP 404/410) | ${gone.length} |`);
  lines.push(`| Gone, with an archive copy | ${goneWithArchive.length} |`);
  lines.push(`| Gone, with no archive copy | ${gone.length - goneWithArchive.length} |`);
  lines.push(`| Archive copies of other failures | ${otherArchive} |`);
  lines.push(`| Archive copies, total | ${archived.length} |`);
  lines.push("", "## Live failures by exact reason", "");
  const reasons = reasonTally(report.rows);
  for (const [reason, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${reason} — ${n}`);
  }

  lines.push("", "## Hosts that refused or could not be reached", "");
  for (const [host, n] of hostTable(
    report.rows,
    (r) => r.state === "blocked" || r.state === "unreachable",
  )) {
    lines.push(`- \`${host}\` — ${n}`);
  }

  lines.push("", "## Archive copies, by host", "");
  for (const [host, n] of hostTable(archived, () => true)) {
    lines.push(`- \`${host}\` — ${n}`);
  }
  return lines.join("\n") + "\n";
}

export async function persist(uniqueCount, rows, unlockerOn) {
  const decorated = rows.map(decorate);
  const report = {
    checked_at: new Date().toISOString(),
    total: uniqueCount,
    checked: decorated.length,
    unlocker: unlockerOn,
    wayback_pending: waybackPending(decorated),
    wayback_tried: decorated.filter((r) => r.wayback?.tried).length,
    wayback_recovered: decorated.filter((r) => r.wayback?.hit).length,
    tally: summarize(decorated, "state"),
    reasons: reasonTally(decorated),
    retry: summarize(decorated.filter((r) => r.retry), "retry"),
    rows: decorated,
  };
  const dest = reportPaths(unlockerOn);
  await writeJson(dest.json, report);
  await writeFile(dest.md, markdown(report));
  return report;
}
