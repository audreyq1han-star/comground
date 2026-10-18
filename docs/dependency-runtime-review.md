# Dependency and runtime advisory review

Reviewed on **17 October 2026** against official maintainer sources. This document records the dependency findings separately from the application's functional verification. It is not a claim that the application or its complete dependency tree has no vulnerabilities.

## Decision and runtime boundary

- Retain **Next.js 16.4.2**, **React 19.3.1**, **react-dom 19.3.1**, and installed **Sharp 0.35.5** for the five October advisories assessed below: their published fixes are satisfied.
- Replace the application's use of **Node 22.23.1** with the reviewed **Node 22.23.3** target. **22.23.2** is the minimum 22.x security floor established by the July 2026 security release; 22.23.3 includes those fixes and subsequent maintenance changes.
- Use an official **workspace-local portable runtime** after validating its archive SHA-256 against the official release checksums. Leave the existing host/agent runtime unchanged; the wrapper uses a separately reviewed workspace runtime when available.
- Archive download/checksum validation and application checks under the replacement runtime must be recorded separately. The advisory review itself did not install, update, or execute a downloaded runtime.

Official runtime sources: [Node 22.23.1 release](https://nodejs.org/en/blog/release/v22.23.1), [July security advisory](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases), [Node 22.23.2 security release](https://nodejs.org/en/blog/release/v22.23.2), [Node 22.23.3 release and checksums](https://nodejs.org/en/blog/release/v22.23.3).

## October Next.js and React advisories

Ranges below reproduce the maintainer's package metadata, including unusual boundary choices. Version comparison supports the stated conclusions for these advisories; it does not establish the absence of unrelated issues.

| Official advisory | Published affected range | Published fixed versions | Relevant prerequisite and local result |
| --- | --- | --- | --- |
| [GHSA-2464-fhr4-w9xw / CVE-2026-96889 — SVG image optimization RCE](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw) | `>=10.0.0 <=15.5.27`; `>16.0.0 <=16.4.0` | Next `15.5.28`, `16.4.1`; documented workaround: Sharp `>=0.35.5` | Advisory describes image optimization on glibc-based Linux. Installed Next **16.4.2** and Sharp **0.35.5** satisfy the published fixes. The reviewed host is macOS arm64. |
| [GHSA-673q-mjm6-r5xr — cached typed-array RCE](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr) | `>=16.0.0 <=16.4.0` | Next `16.4.1` | App Router with Cache Components and a `use cache` function returning multiple typed arrays. Installed Next **16.4.2** is beyond the fixed release. This app does not enable that cache workflow. |
| [GHSA-p3m5-59mp-jv5r — Server Actions DoS](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r) | `>=13.0.0 <=15.5.27`; `>=16.0.0 <=16.4.0` | Next `15.5.28`, `16.4.1` | App Router with at least one Server Action. Installed Next **16.4.2** is beyond the fixed release. This app uses route handlers for mutations and has no Server Actions. |
| [GHSA-xqc2-xf4c-x3h3 — React Server Components RCE](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3) | RSC packages: `19.0.0–19.0.8`, `19.1.0–19.1.9`, `19.2.0–19.2.8`, and `19.3.0` | `19.0.9`, `19.1.10`, `19.2.9`, `19.3.1` | RSC-capable framework responses transporting multiple typed arrays and an attacker-controlled value. **19.3.1** is a fixed stable release; Next's own fixed framework version is also relevant, as explained below. |
| [GHSA-h3gv-c5rc-p453 — React Server Functions DoS](https://github.com/react/react/security/advisories/GHSA-h3gv-c5rc-p453) | Package metadata lists the same affected ranges as the RSC RCE advisory above | `19.0.9`, `19.1.10`, `19.2.9`, `19.3.1` | Crafted requests to Server Function endpoints can exhaust memory or CPU. **19.3.1** is a fixed stable release. The advisory prose lists narrower older ranges than its package metadata; this assessment uses the wider metadata and explicit fixed versions. |

The React advisories name `react-server-dom-webpack`, `react-server-dom-turbopack`, and `react-server-dom-parcel`, rather than the root `react` and `react-dom` packages. Next vendors its RSC implementation. Installed bundled metadata identifies a canary dependency, so root React's version alone is not evidence that the framework's RSC implementation is fixed. The applicable Next advisories explicitly identify **Next 16.4.1** as fixed; installed **16.4.2** satisfies that framework requirement. No manual replacement of Next's bundled React files was performed.

## Additional Next.js advisory checks and uncertainty

The official September advisory pages contain some incomplete patched-version strings and open-ended affected ranges. These were not silently converted into valid semantic-version ranges. Application prerequisites and installed guard behavior provide narrower evidence where noted.

| Official advisory | Published version metadata | Applicability observed in this app |
| --- | --- | --- |
| [GHSA-vcvr-r3jv-pc5j / CVE-2026-94545 — `next/og` RCE](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j) | Affected `>=16.2.0 <16.3.6`; fixed `16.3.6` | Installed **16.4.2** is beyond the fixed release. No attacker-controlled SVG rendered through Node `ImageResponse` was found. |
| [GHSA-h694-7cp9-m8p3 — nested cache/root-param leak](https://github.com/vercel/next.js/security/advisories/GHSA-h694-7cp9-m8p3) | Affected `16.3.0`; fixed `16.3.8` | Installed **16.4.2** is beyond the fixed release. Cache Components and the described nested cache workflow are absent. |
| [GHSA-3w37-wq28-93x7 — Draft Mode cache leak](https://github.com/vercel/next.js/security/advisories/GHSA-3w37-wq28-93x7) | Affected `16.3.0`; fixed value shown as `16.3.?` | This app has no Cache Components/experimental use-cache workflow or cached Draft Mode previews. The incomplete fix value does not establish an exact upgrade threshold. |
| [GHSA-cjq9-62q9-8jv4 — image optimization SSRF](https://github.com/vercel/next.js/security/advisories/GHSA-cjq9-62q9-8jv4) | Affected `>=16.0.0 <16.3.?`; fixed `16.3.?` | The advisory requires an attacker-controlled, allowlisted remote image URL. This app has no `images.remotePatterns`; the advisory explicitly excludes that configuration. |
| [GHSA-39w2-rjm5-chcv / CVE-2026-94486 — development MCP disclosure](https://github.com/vercel/next.js/security/advisories/GHSA-39w2-rjm5-chcv) | Affected `>=16.0.0`; fixed `16.3.?` | Relevant because the launcher uses `next dev`, and Next enables MCP by default. Installed-code inspection and isolated guard checks support mitigation of the described cross-site path; see below. Exact fix version remains unclear in the advisory metadata. |
| [GHSA-4jqv-mc3x-m676 / CVE-2026-94543 — Pages Router SSG/ISR cache poisoning](https://github.com/vercel/next.js/security/advisories/GHSA-4jqv-mc3x-m676) | Affected `>=15.0.0` and `>=16.0.0`; fixed `15.5.?`, `16.3.?` | Requires self-hosted Pages Router SSG/ISR pages. This app uses App Router and has no Pages Router pages. |
| [GHSA-mcj8-r9mp-w47p / CVE-2026-94484 — root catch-all cache poisoning](https://github.com/vercel/next.js/security/advisories/GHSA-mcj8-r9mp-w47p) | Affected `>=16.0.0` and `>=15.0.0`; fixed `16.3.?`, `15.5.?` | Requires a root-level catch-all page together with SSG/ISR routes. This app has no root-level catch-all page. |

For development MCP, installed `node_modules/next/dist/server/lib/router-server.js` invokes `blockCrossSiteDEV` before the development hot-reloader/MCP middleware. `node_modules/next/dist/server/lib/router-utils/block-cross-site-dev.js` treats `/_next/mcp` as an internal endpoint. Direct isolated calls with mock requests returned **403** for a foreign `Origin`, `Origin: null`, and a cross-site/no-cors request. No server was started for this check. This is a targeted guard check, not an end-to-end browser exploit test or proof against every possible bypass. The app does not configure additional `allowedDevOrigins`.

## Node security floor and pending release

The installed runtime reported **v22.23.1**, Darwin arm64. Node's [22.23.1 release](https://nodejs.org/en/blog/release/v22.23.1) dates to 23 June and precedes the [29 July security release](https://nodejs.org/en/blog/release/v22.23.2).

The July release establishes **22.23.2** as the fixed 22.x version for the disclosed issues affecting that release line. These include HTTP/2 memory accounting and use-after-free issues (**CVE-2026-56846**, **CVE-2026-56848**), permission-model path over-grants (**CVE-2026-58043**), HTTPS identity/session handling, DNS and zlib crashes, permission-model trace/report writes, HTTP header handling, and dependency updates. The overview identifies affected release lines rather than a precise introduction version for every issue; this review does not invent lower bounds. Its SQLTagStore issue, **CVE-2026-58041**, lists only 24.x/26.x as affected, so it is not attributed to this 22.x runtime. [Official July advisory](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases).

Use **22.23.3**, released 23 September, as the reviewed current 22.x target. Its release notes include later maintenance updates such as OpenSSL 3.5.8 and Undici 6.28.1. Updating is justified by the runtime's published security fixes; this review did not demonstrate exploitation through the local application's HTTP/1 loopback-only workflow. [Official 22.23.3 release](https://nodejs.org/en/blog/release/v22.23.3).

**Pending and not covered:** the Node project announced on 14 October that new 26.x, 24.x, and 22.x security releases are planned on or shortly after **21 October 2026**, with a highest severity of **HIGH** for each line. At this review date, that announcement does not disclose exact replacement versions or vulnerability details. Node 22.23.3 must not be described as covering those forthcoming fixes. [Official October announcement](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).

## Method and limits

- Consulted official Next/React maintainer advisories and Node release/security pages. Only public package names, versions, and advisory identifiers were sent in lookups; no local source, manifest, lockfile, credentials, or private records were uploaded.
- Read local package metadata and lockfile entries. At inspection, installed versions matched their lockfile entries; all 80 dependency tarball entries used `registry.npmjs.org`. No installed `preinstall`, `install`, `postinstall`, or `prepare` scripts were found. Registry origin and integrity metadata do not prove that a package is trustworthy or vulnerability-free.
- Did not run `npm audit`, a remote dependency scanner, package installation, lifecycle scripts, a development server, or a production build as part of this advisory check. No framework or dependency files were modified.
- The earlier independent application review ran all **113** then-current unit/handler tests successfully under Node 22.23.1. That result does not substitute for checks under the replacement runtime or after subsequent application edits.
- This is a targeted review of the identified advisories and relevant current entries, not an exhaustive audit of every transitive dependency, native library, Node build variant, or previously published advisory. Future releases, changed configuration, and newly disclosed issues require reassessment.

## Runtime installation and final validation

The primary integration pass downloaded the official `node-v22.23.3-darwin-arm64.tar.gz` and `SHASUMS256.txt` from `https://nodejs.org/dist/v22.23.3/`. The archive SHA-256 matched **23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53** before extraction into ignored `.tools/`. No install script or global runtime change was used. `scripts/with-local-node.mjs` selects this portable runtime for every npm script and requires a supported 22.x security floor on other machines.

Final unit, HTTP, browser, accessibility, strict-type and build checks ran under **v22.23.3**; exact counts are in `docs/evidence/final-checks.json`. The portable runtime is setup state, intentionally excluded from the source archive. Node’s announced 21 October security release remains outside this review.
