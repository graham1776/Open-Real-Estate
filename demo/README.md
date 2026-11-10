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
- **Editing (the reader is a writer):** every value a person would change is
  editable where it is shown. Click an underlined number, date, name or dropdown
  on the Summary, Rent Roll, Expenses, Assumptions or Valuation tab, change it,
  and press Enter or Tab. The file is re-validated and recomputed at once.
  - **Results bar:** Year-1 NOI, direct cap value, DCF value and IRRs stay on
    screen, each with its change from where the file stood when opened or last
    saved. Change a rent, see what it does to value.
  - **Rows:** add or remove leases, rent steps, vacant suites and expense items;
    mark a suite vacant. The ▸ beside a lease opens its less common fields.
  - **Undo / Revert / Save:** Undo steps back one change (Ctrl/⌘-Z); Revert
    returns to the last saved file. **Save** writes back to disk through the
    file's handle (Chrome/Edge; Ctrl/⌘-S works too). Elsewhere it is Save As…,
    or a download. Unsaved changes pause the watcher for that file, mark its
    chip with ●, and prompt before the tab closes.
  - **New deal:** starts a minimal valid file from a template, so a deal can be
    authored here and not only opened here.
  - **Edit JSON** remains for anything the forms do not cover (options, free
    rent periods, comparables) and for repairing a file that is not valid JSON.
  The first form edit re-serializes the file with its own indentation; key order
  is kept, number formatting is normalized (`4.0` becomes `4`).
- **Excel:** the Excel button in the results bar downloads the deal on screen,
  edits included, as a loaded ORE Workbook (`.xlsx`, no macros). See
  [`excel/README.md`](../excel/README.md).
- **Examples from anywhere:** "+ Open an example…" in the file bar loads any
  bundled deal beside the ones already open.
- Static page, no backend, no build step: nothing is uploaded anywhere.
- Imports the reference engine (`../engine/dist/`) directly, so display and math
  share one implementation.

## Run it

From the repo root (the page uses ES module imports, so it needs an HTTP server):

```bash
npm run demo          # serves the repo and opens /demo/
# or: python3 -m http.server   then open http://localhost:8000/demo/
```

When served from the repo, the page offers the bundled examples, including
a one-click load of all of them as a portfolio.
