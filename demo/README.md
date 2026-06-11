# ORE Viewer (demo)

Drop `.ore` files onto the page and see the deal in 30 seconds — or drop several
and see the portfolio.

- **One file:** property summary, rent roll, expenses, market assumptions,
  valuation inputs, computed outputs (direct cap and DCF walks, returns, annual
  cash flows, sensitivity), and warnings.
- **Multiple files:** a portfolio roll-up — totals, a per-deal comparison table
  (click a row to open the deal), blended portfolio returns, a lease expiration
  schedule across all deals, top tenants, and combined annual cash flows. Ten
  deals from ten different producers aggregate cleanly because they're all the
  same format.
- **Live refresh:** the viewer watches loaded files and re-reads them when they
  change on disk — edit a `.ore` in your text editor or another tool, save, and
  the numbers update in ~2 seconds. Manual ↻ Refresh and a watch toggle are in
  the file bar. (Watching files picked via the file dialog/drag uses the File
  System Access API — Chrome/Edge; the bundled examples re-fetch everywhere.
  In other browsers, re-drop a changed file or use ↻ Refresh.)
- Static page, no backend, no build step: nothing is uploaded anywhere.
- Imports the reference engine (`../engine/dist/`) directly, so display and math
  share one implementation.

## Run it

From the repo root (the page uses ES module imports, so it needs an HTTP server):

```bash
npm run demo          # serves the repo and opens /demo/
# or: python3 -m http.server   then open http://localhost:8000/demo/
```

When served from the repo, the page offers the three bundled examples — including
a one-click "all three (portfolio)" load.

Light editing in the viewer itself (change an assumption → outputs update →
download the edited file) remains on the roadmap; with file watching, the current
workflow is: edit the `.ore` anywhere, save, watch the viewer update.
