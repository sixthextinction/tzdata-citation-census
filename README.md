# A Study of the URL Sources Cited by the IANA Time Zone Database

This project extracts URLs from comments in the [IANA Time Zone Database](https://www.iana.org/time-zones) and checks whether those URLs are still accessible.

The current run covers 1,327 unique URLs cited in tzdata comments. Each URL is tried directly first. URLs that fail because of access restrictions or network errors can be retried through Bright Data Web Unlocker. URLs returning HTTP 404 or 410 are checked against the Internet Archive.

The current results:

* 663 URLs work directly
* 433 can only be accessed using a proxy like Bright Data's Web Unlocker
* 123 URLs were dead, but I could find an Internet Archive copy
* 57 had no archive copy
* 39 still fail, even using Web Unlocker
* 12 return other HTTP errors (mostly 500)

That leaves 1,219 of 1,327 URLs (91.9%) that can currently be retrieved.

## Data

The project downloads nine tzdata source files from a pinned `eggert/tz` commit: `9b754dca34242956926c3a94c70832acc6d72d88`

The extraction step found:

* 1,609 comment blocks
* 1,352 citation occurrences
* 1,327 unique URLs
* 623 hosts

The most frequently cited hosts include:

* `dre.pt` — 38
* `nevo.co.il` — 37
* `resmigazete.gov.tr` — 23
* `dof.gob.mx` — 20
* `impo.com.uy` — 19
* Guam document archive — 14
* Fiji government site — 13
* `adilet.zan.kz` — 12

## Pipeline

There are three main commands:

```bash
npm run download
npm run extract
npm run census
```

`download` fetches the pinned tzdata files.

`extract` splits comments into blocks and extracts the URLs and attribution information.

`census` makes the direct HTTP requests, saves response bodies where possible, and checks HTTP 404/410 responses against the Internet Archive.

Run the complete pipeline with:

```bash
npm run all
```

The direct census can resume from `data/link-report.json` if interrupted.

### Internet Archive recovery

To run the Wayback recovery pass against an existing census:

```bash
npm run recover
```

The normal `census` run also performs this pass for HTTP 404 and 410 responses.

### Web Unlocker

To retry blocked and unreachable URLs through Bright Data Web Unlocker:

```bash
npm run census -- --unlock --live-only
```

This writes:

```text
data/link-report-with-unlocker.json
data/link-report-with-unlocker.md
```

It does not modify the direct census. Subsequent runs skip URLs that already have an Unlocker result.

## Results

The final counts are:

| Result                                  |      URLs |    Share |
| --------------------------------------- | --------: | -------: |
| Accessible directly                     |       663 |    50.0% |
| Accessible through Web Unlocker         |       433 |    32.6% |
| Available from the Internet Archive     |       123 |     9.3% |
| No archive copy                         |        57 |     4.3% |
| Still inaccessible through Web Unlocker |        39 |     2.9% |
| Other HTTP errors                       |        12 |     0.9% |
| **Total**                               | **1,327** | **100%** |

The 123 Wayback results are limited to URLs that returned HTTP 404 or 410 from the original host. Blocked and unreachable URLs are not sent to the Wayback API by the default recovery logic.

## Output

Committed output:

* `data/citations.json` — citation occurrences
* `data/link-report.json` — direct census and Wayback results
* `data/link-report-with-unlocker.json` — direct results plus Unlocker results
* `final-combined-report.md` — combined results

Generated locally and not committed:

* `data/blocks.json` — extracted comment blocks and URLs
* `data/link-report.md` — direct census summary
* `data/link-report-with-unlocker.md` — Unlocker census summary
* `data/snapshots/` — saved response bodies
* `data/tz/` — downloaded tzdata files

## Options

| Command              | Flag                 | Description                         |
| -------------------- | -------------------- | ----------------------------------- |
| `extract`            | `--region africa`    | Process one source file             |
| `census`             | `--sample 60`        | Run against a random sample         |
| `census`             | `--seed 7`           | Set the sample seed                 |
| `census`             | `--concurrency 8`    | Number of concurrent requests       |
| `census`             | `--live-only`        | Skip Wayback recovery               |
| `census` / `recover` | `--recover`          | Run only Wayback recovery           |
| `census`             | `--wayback-gap 1200` | Delay between Wayback requests      |
| `census`             | `--unlock`           | Retry failures through Web Unlocker |

Delete `data/link-report.json` to start the direct census again.

Delete `data/link-report-with-unlocker.json` to start the Unlocker pass again.

## Credentials

The default pipeline does not require credentials.

For Web Unlocker, copy `.env.example` to `.env` and set:

```text
BRIGHT_DATA_UNLOCKER_AUTH=brd-customer-XXXXX-zone-web_unlocker:PASSWORD
```

The native Web Unlocker proxy is used. Do not add `-render` to the zone name.

The proxy host and port can also be configured:

```text
BRIGHT_DATA_UNLOCKER_PROXY_HOST=brd.superproxy.io
BRIGHT_DATA_UNLOCKER_PROXY_PORT=44445
```

Both default to the values above if omitted.

## Requirements

* Node.js 22+
* Internet access
* Bright Data credentials only for the `--unlock` pass
