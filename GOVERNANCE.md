# ORE Governance

## Current model: benevolent dictator

Pre-1.0, ORE is maintained by a small core with a single decision-maker. Somebody
has to decide what a lease looks like in the schema and how the DCF handles
partial-year rent steps — and ship it. Issues and PRs are welcome and arguments
about edge cases are actively useful, but final calls rest with the maintainer.

## Stated intent

This model is a bootstrapping phase, not the destination:

1. **Now — benevolent dictator:** ship an opinionated, working v0.1.
2. **Early contributors:** analysts, appraisers, and developers hardening the spec
   through issues and PRs.
3. **Technical steering committee:** once decisions affect many users, formal
   governance with broker, buyer, appraiser, and independent-developer
   representation.
4. **Consortium / foundation:** once there is a working v1 and momentum, the format
   moves to a neutral home so that no single party — including the founder — owns it.

## Principles that survive every phase

- The format specification and reference engine are free to implement, forever
  (Apache 2.0).
- Calculation methodology is open and auditable; trust by inspection, not assumption.
- Any vendor implementing read/write support for the format is success, full stop.
- Versioning is semver; breaking schema changes require a major version.
