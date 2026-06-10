# ORE Viewer (demo)

Drag a `.ore` file onto the page and see the deal in 30 seconds: property summary,
rent roll, expenses, market assumptions, valuation inputs, computed outputs, and
warnings — without re-keying anything or reading a wall of JSON.

- Static page, no backend, no build step: nothing is uploaded anywhere.
- Imports the thin calc kernel (`../engine/kernel.mjs`) directly, so display and
  math share one implementation.
- Warnings are a first-class tab: every simplification the kernel applied to the
  loaded file is named.

## Run it

From the repo root (the page uses ES module imports, so it needs an HTTP server):

```bash
npm run demo          # serves the repo and opens /demo/
# or: python3 -m http.server   then open http://localhost:8000/demo/
```

When served from the repo, the page also offers the three bundled examples as
one-click loads.

Light editing (change an assumption → outputs update → download the edited file)
is the next step for this page; see ROADMAP.md.
