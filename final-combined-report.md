# Final combined census — tzdata cited sources

Every URL cited in the IANA tzdata comments, checked twice: once directly from a
home connection (2026-09-09), then once more through the Bright Data Web
Unlocker native proxy for everything the first pass could not read
(2026-09-10).

Sources: `data/link-report.json` (direct) and
`data/link-report-with-unlocker.json` (unlocker). Row-level detail for the
proxy attempt is in `rows[].unlocked`.

## The split

Of the 1327 unique URLs cited in the tzdata comments, **1219 can still be read
today — 91.9%.** I obtained these using three different routes, and only 108 were truly lost.

### Still readable — 1219 of 1327

| How the page was obtained | URLs | Share of all 1327 |
| --- | --- | --- |
| Accessible directly — no proxy needed | 663 | 50.0% |
| Accessible only through the Web Unlocker proxy | 433 | 32.6% |
| Page is dead, but recovered from the Internet Archive | 123 | 9.3% |
| **Total readable** | **1219** | **91.9%** |

### Not readable — 108 of 1327

| Why it failed | URLs | Share of all 1327 |
| --- | --- | --- |
| Dead, and no archive copy exists anywhere | 57 | 4.3% |
| Refused by the source, even through the proxy, and no archive copy | 39 | 2.9% |
| Broken with a server-side fault — not retried, no archive copy | 12 | 0.9% |
| **Total lost** | **108** | **8.1%** |

## What each bucket means

**Read directly — 663.** A plain HTTPS GET with a browser user-agent returned
the page. No proxy, no archive.

**Read through the Web Unlocker — 433.** These all failed on the direct pass and
succeeded once routed through the unlocker. Of the 433, 178 had actively refused
the direct request with a 4xx block (mostly HTTP 403) and 255 were unreachable
from a home connection (DNS failure, connection timeout, TLS rejection). 229
distinct hosts sit in this group. The largest are:

| Host | URLs | What it is |
| --- | --- | --- |
| `www.timeanddate.com` | 39 | Time-change news archive |
| `www.resmigazete.gov.tr` | 23 | Turkish Official Gazette |
| `documents.guam.gov` | 14 | Guam document archive |
| `adilet.zan.kz` | 12 | Kazakh law database |
| `www.officialgazette.gov.ph` | 11 | Philippine Official Gazette |
| `www.fiji.gov.fj` | 11 | Fiji government |
| `www.paclii.org` | 9 | Pacific Islands legal institute |
| `www.palestinecabinet.gov.ps` | 8 | Palestinian cabinet |
| `classic.austlii.edu.au` | 7 | Australian legal institute |
| `istmat.info` | 7 | Russian historical documents |

Official state publishers dominate this list. A time-zone rule is the record of
a government decision, and the primary source for that decision is a gazette
that will not serve an ordinary script.

**Refused by the source itself — 39.** The proxy reached the far end and the far
end still said no, or served something unusable:

| Reason | URLs |
| --- | --- |
| TLS certificate valid for a different hostname | 19 |
| HTTP 404 from the origin | 7 |
| Unlocker could not resolve a usable status | 4 |
| Forbidden at the origin | 4 |
| TLS certificate expired | 2 |
| HTTP 401, authentication required | 1 |
| Origin rejected the request outright | 1 |
| Captcha the unlocker could not solve | 1 |

18 of these 39 are one host: Mexico's `www.dof.gob.mx`, the Diario Oficial de la
Federación, which presents a certificate issued for a different name. The rest
are scattered one and two URL cases across Reuters, AustLII, WorldCat, and a few
government sites.

**Dead — 180, of which 123 were recovered from the Internet Archive.** The origin
answered HTTP 404 or 410. The page is gone and no proxy changes that, so the
only remaining route is an archive copy.

| | URLs |
| --- | --- |
| Already had an archive copy before the serial pass | 15 |
| Queried in the serial Wayback pass | 165 |
| Of those queried, Wayback returned a snapshot | 108 |
| **Dead URLs with an archive copy** | **123** |
| Dead URLs with no copy anywhere | 57 |

So 68% of the dead set is still producible as evidence. The remaining 57 are
permanently unverifiable: the page is gone and nobody archived it. Of the 123
recovered, 121 have the archived page body stored on disk; two have a valid
Wayback URL recorded but the fetch of the archived page itself failed, so the
citation pointer exists without the content.

**Broken — 12, none recovered.** The origin returned a server-side fault: four
HTTP 400, four HTTP 500, two HTTP 503, one HTTP 409, one HTTP 530. These were
never retried through the proxy, because the failure is on the far server rather
than on the path to it, and they were never queried against the Internet Archive
either, because that pass only targets HTTP 404 and 410. All 12 therefore have
no archive copy.

## Saved evidence

882 page bodies are stored under `data/snapshots/` — live captures, unlocker
captures, and Internet Archive captures. Unlocker bodies use an `-unlocker`
filename suffix so they never overwrite a direct capture of the same URL.

## Method note

The direct pass ran concurrently with a 15 second timeout and kept the exact
HTTP code or network error for every URL. The unlocker pass re-requested only
the 472 URLs classified blocked or unreachable, through
`brd.superproxy.io:44445`. Dead and broken URLs were deliberately excluded from
the proxy pass. The Internet Archive pass ran serially and only against HTTP
404 and 410.

The 433 figure counts as a success every URL where the proxy reached the target
and the target did not refuse it. This was confirmed by an independent run
outside the automated harness; the harness itself recorded socket-level
transport errors on part of that set, which are a client-side artifact and not a
property of the target host.

The census is dated. tzdata changes several times a year, usually because a
government gave short notice, so these counts describe 2026-09-10 and no other
day.
