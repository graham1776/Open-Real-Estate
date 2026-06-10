# Name availability check — npm and domains

Date: 2026-06-10. Resolves the verification action items in the project brief (§8).

## npm (checked against registry.npmjs.org)

| Name | Status |
|---|---|
| `ore` | **Taken** (unrelated package, "Foundations for reusable web components", last published years ago at 0.0.10) |
| `ore-format` | Available |
| `@ore-format/*` scope | Available (no existing packages or org found under the scope) |
| `@ore/*` scope | No packages found, but bare `@ore` org availability must be confirmed at signup |

**Conclusion:** publish under the `@ore-format` scope as planned — `@ore-format/engine`,
`@ore-format/cli`. Register the npm org before first publish.

## Domains (checked via authoritative DNS, 2026-06-10)

| Domain | Signal |
|---|---|
| `oreformat.org` | NXDOMAIN — no delegation in the .org zone; appears unregistered |
| `orestandard.org` | NXDOMAIN — no delegation in the .org zone; appears unregistered |

Caveat: RDAP/WHOIS endpoints were unreachable from the build environment, so this is
a DNS-level signal (NXDOMAIN with healthy control queries), not a registry-record
confirmation. A registered-but-undelegated domain would look the same. Confirm at a
registrar before announcing; both candidates are very likely available.

## Repo name

Candidates per the brief: `ore` or `ore-format`. Current repo is `Open-Real-Estate`;
renaming to `ore-format` (matching the npm scope and domain) is the consistent choice
once decided. Not actioned here.
