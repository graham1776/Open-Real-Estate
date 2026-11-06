#!/usr/bin/env python3
"""Run the xlsm's VBA importer/exporter headless in LibreOffice and check it.

For every example and fixture:
  1. LoadOreFile(path) - the macro behind the Import button - fills the Tape.
     The Tape must equal `ore tape` row for row (paths, values, types).
  2. The workbook's DCF/direct-cap values must equal the engine's.
  3. ExportTapeFile(out) - the macro behind "Save Tape as .ore" - must write
     JSON that parses back to the original file.

    python3 excel/test_macro.py [filter]

LibreOffice runs the module in its VBA-compatibility mode, which is close to
but not the same as Excel's VBA; this checks the parser and tape logic, not
Excel's UI (file dialogs, buttons).
"""

import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import test_workbook as T  # noqa: E402
import uno  # noqa: E402


def enable_macros(ctx):
    cp = ctx.ServiceManager.createInstanceWithContext("com.sun.star.configuration.ConfigurationProvider", ctx)
    for node, props in (("/org.openoffice.Office.Common/Security/Scripting", {"MacroSecurityLevel": 0}),
                        ("/org.openoffice.Office.Calc/Filter/Import/VBA", {"Load": True, "Executable": True})):
        ua = cp.createInstanceWithArguments("com.sun.star.configuration.ConfigurationUpdateAccess", (T.pv("nodepath", node),))
        for k, v in props.items():
            ua.setPropertyValue(k, v)
        ua.commitChanges()


def same(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-12)
    if isinstance(a, dict) and isinstance(b, dict):
        return list(a) == list(b) and all(same(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    return a == b


def main():
    filt = sys.argv[1] if len(sys.argv) > 1 else ""
    files = [os.path.join(ROOT, "examples", f) for f in sorted(os.listdir(os.path.join(ROOT, "examples"))) if f.endswith(".ore")]
    files += [os.path.join(HERE, "fixtures", f) for f in sorted(os.listdir(os.path.join(HERE, "fixtures"))) if f.endswith(".ore")]
    files = [f for f in files if filt in f]
    office = T.Office()
    failures = 0
    tmp = tempfile.mkdtemp(prefix="ore-macro-")
    try:
        enable_macros(office.ctx)
        work = os.path.join(tmp, "ORE-Workbook.xlsm")  # a copy: LibreOffice leaves lock files beside what it opens
        shutil.copy(os.path.join(HERE, "ORE-Workbook.xlsm"), work)
        url = uno.systemPathToFileUrl(work)
        doc = office.desktop.loadComponentFromURL(url, "_blank", 0, (T.pv("Hidden", True), T.pv("MacroExecutionMode", 4)))
        sp = doc.ScriptProvider
        load = sp.getScript("vnd.sun.star.script:VBAProject.ORE.LoadOreFile?language=Basic&location=document")
        export = sp.getScript("vnd.sun.star.script:VBAProject.ORE.ExportTapeFile?language=Basic&location=document")
        tape = doc.Sheets.getByName("Tape")
        val = doc.Sheets.getByName("Valuation")
        for f in files:
            name = os.path.relpath(f, ROOT)
            problems = []
            n = load.invoke((f,), (), ())[0]
            expected = T.tape_rows(f)
            expected = [r for r in expected if not r["path"].startswith("$engine")]
            got = []
            for i in range(len(expected) + 1):
                ca, cb = tape.getCellByPosition(0, i + 1), tape.getCellByPosition(1, i + 1)
                if ca.getString() == "":
                    break
                t = cb.getType().value  # EMPTY / VALUE / TEXT / FORMULA
                if t == "EMPTY":
                    v = None
                elif t == "VALUE":
                    v = cb.getValue()
                    # LibreOffice stores booleans as 1/0 with a boolean format
                    if "BOOLEAN" in str(doc.NumberFormats.getByKey(cb.NumberFormat).Type) or cb.NumberFormat in (99,):
                        v = bool(v)
                else:
                    v = cb.getString()
                got.append({"path": ca.getString(), "value": v})
            if int(n) != len(expected):
                problems.append(f"macro reported {n} rows, expected {len(expected)}")
            for i, (e, g) in enumerate(zip(expected, got)):
                ev = e["value"]
                gv = g["value"]
                if isinstance(ev, bool) and not isinstance(gv, bool):
                    gv = bool(gv) if isinstance(gv, float) else gv
                if e["path"] != g["path"] or not same(ev, gv):
                    problems.append(f"row {i+2}: expected {e['path']}={ev!r}, got {g['path']}={gv!r}")
                    break
            if len(got) != len(expected):
                problems.append(f"tape has {len(got)} rows, expected {len(expected)}")
            # engine agreement on headline values
            out = json.loads(subprocess.run(["node", os.path.join(ROOT, "validator", "cli.mjs"), "compute", f],
                                            check=True, capture_output=True, text=True).stdout)
            cells = {r[0]: r[1] for r in val.getCellRangeByName("B4:C120").getDataArray()}
            for label, eng in (("Indicated value — DCF", (out.get("dcf") or {}).get("indicatedValue")),
                               ("Indicated value — direct cap", (out.get("directCap") or {}).get("indicatedValue"))):
                wbv = cells.get(label)
                if eng is None:
                    continue
                if not isinstance(wbv, float) or math.floor(wbv + 0.5) != eng:
                    problems.append(f"{label}: workbook {wbv!r} vs engine {eng}")
            # export round trip
            outp = os.path.join(tmp, os.path.basename(f))
            export.invoke((outp,), (), ())
            with open(f) as fh:
                orig = json.load(fh)
            try:
                with open(outp, encoding="utf-8") as fh:
                    back = json.load(fh)
                if not same(orig, back):
                    problems.append("ExportTapeFile JSON differs from the original")
            except Exception as e:
                problems.append(f"ExportTapeFile wrote invalid JSON: {e}")
            failures += 1 if problems else 0
            print(f"{'PASS' if not problems else 'FAIL'}  {name:44s} {len(got):4d} tape rows, export round-trips")
            for p in problems[:5]:
                print("      " + p)
        doc.close(True)
    finally:
        office.close()
        shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
