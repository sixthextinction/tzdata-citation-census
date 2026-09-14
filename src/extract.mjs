import path from "node:path";
import {
  DATA,
  TZ_FILES,
  flag,
  parseBlocks,
  readTzFile,
  writeJson,
} from "./lib/tz.mjs";

/**
 * Turn the comment prose in the tzdata sources into two datasets:
 *   blocks.json    -- every comment block, with author, date, and cited URLs
 *   citations.json -- one row per cited URL, which is the input to the link check
 *
 * Host counts are printed to console only -- theyre just a group-by of citations.json.
 */
async function main() {
  const only = flag("region"); // filter to a single region if specified
  const files = only ? TZ_FILES.filter((f) => f === only) : TZ_FILES;
  if (!files.length) throw new Error(`Unknown region: ${only}`);

  const blocks = [];
  for (const file of files) {
    blocks.push(...parseBlocks(await readTzFile(file), file));
  }

  const citations = [];
  for (const b of blocks) { // iterate over each comment block
    for (const url of b.urls) {
      citations.push({
        url,
        host: new URL(url).host.toLowerCase(),
        file: b.file,
        line: b.line,
        subject: b.subject,
        author: b.author,
        date: b.date,
      });
    }
  }

  const hosts = {}; 
  // count the number of citations per host
  for (const c of citations) hosts[c.host] = (hosts[c.host] ?? 0) + 1;
  // sort hosts by citation count
  const topHosts = Object.entries(hosts).sort((a, b) => b[1] - a[1]); 

  // write the datasets to the data directory
  await writeJson(path.join(DATA, "blocks.json"), blocks);
  await writeJson(path.join(DATA, "citations.json"), citations);

  // print the results
  console.log(`files            ${files.length}`);
  console.log(`comment blocks   ${blocks.length}`);
  console.log(`cited urls       ${citations.length} across ${topHosts.length} hosts`);
  console.log(`\nMost cited hosts:`);
  for (const [host, n] of topHosts.slice(0, 15)) {
    console.log(`  ${String(n).padStart(3)}  ${host}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
