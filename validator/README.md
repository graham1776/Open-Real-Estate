# ORE Validator

CLI and browser validation for `.ore` files against the published JSON Schema.
Planned usage: `npx @ore-format/cli validate deal.ore`.

Until the CLI lands, `validate-examples.mjs` validates every file in `/examples`
against `/spec/schema` (run via `npm run validate` from the repo root). Its schema
loading is the seed of the CLI's core.
