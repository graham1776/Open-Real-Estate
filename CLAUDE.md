# ORE — Open Real Estate Format — Project Brief

**Name: ORE (Open Real Estate). File extension: `.ore` (JSON content). Decided June 2026.**

> This document is the founding context for the project. It seeds `CLAUDE.md` in the repo
> and should be read at the start of every working session. It captures the thesis,
> strategy, build specification, and adoption plan developed prior to first commit.
> Status: pre-v0.1. Last updated: June 2026.

---

## 0. Positioning discipline (standing rule)

This project is built from first principles and stands on its own merits. **No
public material — code, docs, manifesto, talks, outreach — names, references, or
implies displacement of any existing commercial software vendor or product.** The
project does not import, reverse-engineer, convert, or interoperate with any
proprietary file format. The case for the format is affirmative: deal data should
belong to the deal, not to any software license. This rule applies to all contributors
and all future materials without exception.

## 1. Thesis

Commercial real estate transaction data — rent rolls, lease abstracts, operating
histories, underwriting assumptions — moves between parties in formats that are
either license-gated or unstructured: proprietary model files that require paid
software to open, bespoke Excel workbooks that differ shop to shop, and PDFs inside
offering memoranda. Every deal forces the same underlying data to be manually
re-keyed three times: once by the listing broker, again by each buyer, again by the
appraiser. Errors compound, hours evaporate, and no two parties can verify they are
computing the same NOI from the same inputs.

This project creates two things:

1. **An open, JSON-based file format** for property-level underwriting data —
   machine-readable by design, LLM-native, with a published schema anyone can
   implement, free forever.
2. **An open-source reference calculation engine** that consumes the format and
   produces standardized outputs (NOI, DCF, direct cap, sensitivity). The engine
   matters as much as the format: consistent, auditable math is the point.

The model is PDF, not a software product: a published format that any tool can
produce and any tool can consume. Competition among software vendors moves to UX,
speed, and features; no one controls the file format, because no one owns it.

## 2. The structural problem (first principles)

Any market where data distribution is gated by proprietary file formats develops
four predictable pathologies. CRE transactions exhibit all four:

| Pathology | How it shows up in CRE | The open format's answer |
|---|---|---|
| **Mandatory tooling cost** | Participating in electronic deal distribution requires paid licenses — a six-figure annual line item for mid-size shops; smaller buyers and independent appraisers are priced out of the workflow entirely | Free format, free reference engine; zero cost to read or produce a conforming file |
| **Distribution lock-in** | The file format itself is the gatekeeper: receiving a deal package electronically requires the same software the sender used. Network effects entrench the format independent of software quality | An open spec anyone can implement; reading a deal file never requires a purchase |
| **Innovation stagnation** | When the format is the moat, the software behind it faces no competitive pressure to improve. Tools stay dated because switching is impossible, not because users are satisfied | With the format open, vendors compete on product quality — the moat moves to merit |
| **Opaque methodology** | Analysts trust outputs they cannot inspect; appraisers sign valuations produced by calculation logic they cannot audit. Standardization by force is not the same as standardization by transparency | Open-source engine: every calculation auditable line by line; trust by inspection, not by assumption |

None of this requires a villain. These are structural properties of closed-format
ecosystems, observable in every industry that has had one — documents before PDF,
music hardware before MIDI, building design before IFC. The remedy is also
structural: publish the format, open the math, let the ecosystem compete.

## 3. Users and value propositions

This is the **transaction layer**, not the portfolio-reporting layer. Three user classes:

- **Investment sales brokers** (create and distribute deal data): wider buyer pool —
  deals ingestible by any buyer with zero software cost; faster bid timelines; more
  price tension; reduced software overhead.
- **Buyers/investors** (ingest and re-underwrite): eliminate re-keying; analysts spend
  time on assumptions and judgment, not data entry; feed deal files directly into AI
  screening workflows against investment criteria.
- **Valuers/appraisers** (independently verify): auditable inputs and transparent
  methodology — defensibility when challenged; levels the field for smaller shops.

## 4. Strategic positioning and precedent

**REDI (Real Estate Data Initiative)** — the LP-led data model launched via PREA
(HOOPP, CalSTRS, TRS Texas, StepStone; v0.9 published Sept 2025; $657B+ AUM/AUA
backing; targeting 60–75% LP adoption in three years) — proves the industry adopts
common data formats when the right constituency organizes around one. REDI
standardizes the *reporting* layer (GP→LP, Excel-based, backward-looking). This
project standardizes the *transaction* layer (broker↔buyer↔appraiser, JSON-based,
forward-looking underwriting). Complementary, not competitive — and the narrative
writes itself: "REDI for reporting, this for transactions." Outreach to REDI
principals (Jennifer Allard/HOOPP, Nicholas Russell/StepStone) is a Phase 3 action
for lessons learned and narrative alignment.

Format precedents to study and cite: **MIDI** (one open format every instrument and
DAW could speak), **IFC/buildingSMART** (consortium-built open BIM interchange),
**HTML and PDF** (open formats that made universal access the default). In every
case the format won by being free, published, and implementable by anyone — not by
campaigning against incumbents.

**The forcing function is the pain itself** — cost, re-keying, opacity — felt
independently by all three user classes. Adoption strategy exploits this from the
bottom up (see §7).

## 5. Open-source playbook

Lifecycle the project follows:

1. **Benevolent dictator (now):** small core ships an opinionated, working v0.1.
   No design-by-committee — somebody decides what a lease looks like in the schema
   and how the DCF handles partial-year rent steps, and ships it. A working thing,
   not a white paper.
2. **Early contributors:** 5–20 analysts, appraisers, and developers filing issues
   and PRs on GitHub. Edge-case arguments are a feature — they harden the spec.
3. **Governance formalization:** technical steering committee with broker, buyer,
   appraiser, and independent-developer representation once decisions affect many users.
4. **Vendor adoption:** software providers build native support because shaping the
   standard is in their interest. Any vendor — including incumbents — implementing
   read/write support for the format is success, full stop.

Funding model: start unfunded (benevolent dictator), move to **consortium/foundation
model** (the IFC/buildingSMART path) once there is a working v1 and momentum.

## 6. Build specification — v0.1

### Scope (deliberate constraints)
- **Asset class:** US industrial only — single-tenant and multi-tenant. Simplest
  lease structures (NN/NNN, modified gross), founder's domain expertise, expand later.
- **Valuation methods:** DCF and direct capitalization. Sales comparison later.
- **Out of scope for v0.1:** retail percentage rent, office complex reimbursement
  pools, hotel, multifamily unit-level, international conventions, debt waterfalls
  (simple debt sizing only). Also out of scope permanently: import from or export to
  any proprietary file format (see §0).

### Format design principles
- JSON with a published JSON Schema. Versioned (`"formatVersion": "0.1.0"`), semver.
- Every field typed, defined, and documented in a data dictionary. Map definitions
  to existing open standards (NCREIF PREA Reporting Standards, REDI fields) where
  they exist.
- Human-readable AND machine-readable. An LLM should be able to ingest a file and
  reason over it with zero scraping.
- Calculation assumptions travel WITH the data (growth rates, reversion cap,
  discount rate, rollover assumptions) so any conforming engine reproduces identical
  outputs from the same file.
- File extension: `.ore` — content is standard JSON, so `cat deal.ore | jq` just works.

### Schema modules (v0.1)
1. `property` — identity, location, physical (SF, clear height, dock doors, land,
   parcel/APN, year built)
2. `rentRoll` / `leases[]` — tenant, suite, SF, term dates, base rent schedule with
   steps, escalations (fixed %, CPI), reimbursement structure (NNN/MG/Gross),
   free rent, TI/LC, options, security
3. `expenses` — operating expense schedule, recoverable flags, management fee basis
4. `marketAssumptions` — market rent by space type, growth curves, downtime,
   renewal probability, market TI/LC
5. `valuation` — method, discount rate, reversion cap, hold period, selling costs
6. `debt` (optional) — simple loan terms for levered returns
7. `provenance` — who produced the file, when, source documents, broker contact

### Reference engine
- **Language: TypeScript first.** Runs in browser and Node — enables the killer
  demo (drag a file onto a webpage, full DCF renders instantly, no install, no
  license) and lets anyone build web tools. **Python port is the fast-follower**
  (institutional analysts live in Python/pandas).
- Pure functions, zero UI dependency. Engine = library; demos consume it.
- Outputs: monthly and annual cash flows, NOI bridge, unlevered/levered IRR, NPV,
  direct cap value, per-SF metrics, sensitivity tables.
- **Golden-file test suite:** every example deal has locked expected outputs.
  Conformance = reproducing golden outputs exactly. This is how "the engine working
  the same way" becomes enforceable for third-party implementations.

### Repo structure
```
/spec        — JSON Schema files + human-readable spec + data dictionary
/engine      — TypeScript reference engine + tests + golden files
/examples    — 3+ anonymized industrial deal files (single-tenant NNN,
               multi-tenant infill, value-add with rollover)
/validator   — CLI + browser validation tool
/demo        — browser drag-and-drop DCF demo
/docs        — documentation site source
CLAUDE.md, LICENSE, CONTRIBUTING.md, GOVERNANCE.md, ROADMAP.md
```

### License
**Apache 2.0** (proposed default). Permissive enough that corporations adopt without
legal anxiety; explicit patent grant matters for consortium-bound industry work.
(MIT acceptable alternative; Apache 2.0 preferred for the patent clause.)

## 7. Adoption plan

**Sequence: bottom-up pressure, then top-down legitimacy.**

1. **Ship it** (Phase 1, weeks 1–6): repo public, schema + engine + demo working.
2. **Case study** (Phase 2, weeks 6–12): run one real industrial deal through the
   format end-to-end. Manifesto + landing page. The founder's network supplies the
   deal flow for examples.
3. **Design partners** (Phase 3, months 3–9): 3–5 partners — a mid-market/regional
   investment sales shop (highest software cost burden relative to revenue, least
   institutional inertia), one institutional or mid-market buyer, one appraisal firm.
   Document everything.
4. **Conference circuit:** NAIOP, PREA, CREFC, ULI, Appraisal Institute. Present as
   industry initiative with working software and a real case study — not a pitch.
5. **Advisory board:** respected independents and thought leaders, not necessarily
   mega-firm names. Credibility before scale.
6. **REDI outreach:** complementary-layer narrative; lessons from their politics.
7. **Mega-brokerage approach (last, from strength):** national brokerage leadership
   once momentum exists: "This standard is gaining adoption — do you want a seat at
   the table shaping it?" Carrot: wider buyer pools, faster bids, cost reduction,
   modernization credit. Implicit dynamic: first mover gets the reputational upside.

**Buyer-side leverage is the accelerant:** when buyers start telling brokers "I
prefer deals in this format — I can ingest them instantly," brokers follow capital.

## 8. Open decisions (Phase 0 — decide before first commit)

| Decision | Default / candidates | Notes |
|---|---|---|
| **Name** | **DECIDED: ORE (Open Real Estate), `.ore` extension** | First Claude Code task: verify npm name availability (likely need a scope, e.g. `@ore-format/engine`) and pick repo name (`ore` or `ore-format`); domain candidates: oreformat.org, orestandard.org |
| License | Apache 2.0 | See §6 |
| v0.1 scope | US industrial, DCF + direct cap | See §6 |
| Engine language | TypeScript first, Python port second | See §6 |
| Founder visibility | Standalone neutral identity for the project (not personal-brand); founder writes/talks about it under own name | Industry initiatives need neutral identity for multi-firm credibility |
| Governance timing | Defer formal governance until post-v1 traction | GOVERNANCE.md states intent from day one |

## 9. Working model

- **Claude Code** (against the GitHub repo): all build work — schema, engine, tests,
  validator, demo, docs. This file becomes `CLAUDE.md` at repo root.
- **Claude chat:** strategy, naming, manifesto drafting, pitch materials, conference
  prep, outreach planning.
- **Founder context:** 15+ years industrial RE investment experience (SoCal infill
  specialization), senior role at a global industrial platform, existing GitHub
  presence (github.com/graham1776), history of building custom CRE underwriting
  tools and calculators. Domain authority is the project's unfair advantage: the
  schema will be designed by someone who has actually underwritten billions in
  industrial product.

## 10. Definition of done — v0.1

- [ ] JSON Schema published and documented (data dictionary complete)
- [ ] Three example deal files validate against schema
- [ ] Reference engine reproduces golden outputs for all examples
- [ ] Validator CLI works (`npx @ore-format/cli validate deal.ore` or similar)
- [ ] Browser demo: drag file → rendered DCF, cash flows, returns
- [ ] README, CONTRIBUTING, GOVERNANCE, ROADMAP, LICENSE in place
- [ ] One real (anonymized) deal run end-to-end as the case study
