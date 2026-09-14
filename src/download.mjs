import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { TZ_DIR, TZ_FILES, TZ_RAW_BASE, pool } from "./lib/tz.mjs";

// Download the tzdata source files. 
// These are plain text and unprotected -- no proxy is needed here
async function main() {
  await mkdir(TZ_DIR, { recursive: true });

  const results = await pool(TZ_FILES, 4, async (name) => {
    const resp = await fetch(`${TZ_RAW_BASE}/${name}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) throw new Error(`${name}: HTTP ${resp.status}`);
    const body = await resp.text();
    await writeFile(path.join(TZ_DIR, name), body);
    return { name, bytes: body.length, lines: body.split("\n").length };
  });

  for (const r of results) {
    console.log(`${r.name.padEnd(14)} ${String(r.bytes).padStart(7)} bytes  ${r.lines} lines`);
  }
  console.log(`\nSaved to ${TZ_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
