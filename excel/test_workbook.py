#!/usr/bin/env python3
"""Conformance test: the Excel workbook must reproduce the reference engine.

For every example deal, loads excel/ORE-Workbook.xlsx in LibreOffice (headless),
writes the deal's tape plus the engine's outputs ($engine.* rows) into the Tape
sheet, recalculates, and reads the Check sheet. Any FAIL row fails the test.

    python3 excel/test_workbook.py                 # all examples
    python3 excel/test_workbook.py multi-tenant    # examples whose name contains this
    python3 excel/test_workbook.py --workbook X.xlsm --verbose

Requires LibreOffice (soffice) with Python UNO, and Node (to produce tapes via
validator/cli.mjs). Engine outputs come from engine/dist, which the golden
suite already locks, so passing here means workbook == goldens.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

import uno  # noqa: E402  (LibreOffice's Python bridge)
from com.sun.star.beans import PropertyValue  # noqa: E402


def pv(name, value):
    p = PropertyValue()
    p.Name = name
    p.Value = value
    return p


class Office:
    def __init__(self):
        self.profile = tempfile.mkdtemp(prefix="ore-lo-")
        self.pipe = "ore_test_" + str(os.getpid())
        self.proc = subprocess.Popen(
            ["soffice", "--headless", "--invisible", "--norestore", "--nologo",
             f"-env:UserInstallation=file://{self.profile}",
             f"--accept=pipe,name={self.pipe};urp;StarOffice.ComponentContext"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
        for _ in range(120):
            try:
                self.ctx = resolver.resolve(f"uno:pipe,name={self.pipe};urp;StarOffice.ComponentContext")
                break
            except Exception:
                time.sleep(0.5)
        else:
            raise RuntimeError("could not connect to LibreOffice")
        self.desktop = self.ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", self.ctx)

    def load(self, path):
        url = uno.systemPathToFileUrl(os.path.abspath(path))
        return self.desktop.loadComponentFromURL(url, "_blank", 0, (pv("Hidden", True),))

    def close(self):
        try:
            self.desktop.terminate()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=30)
        except Exception:
            self.proc.kill()
        shutil.rmtree(self.profile, ignore_errors=True)


def tape_rows(ore_path):
    out = subprocess.run(["node", os.path.join(ROOT, "validator", "cli.mjs"), "tape", ore_path, "--engine", "--json"],
                         check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def write_tape(doc, rows):
    sh = doc.Sheets.getByName("Tape")
    n = len(rows)
    sh.getCellRangeByName(f"A2:B6001").clearContents(1 | 2 | 4 | 16)  # values, dates, strings, formulas
    data = []
    bools = []
    for i, r in enumerate(rows):
        v = r["value"]
        if isinstance(v, bool):
            bools.append((i, v))
            v = ""
        elif v is None:
            v = ""
        elif isinstance(v, (int, float)):
            v = float(v)
        else:
            v = str(v)
        data.append((r["path"], v))
    if n:
        sh.getCellRangeByName(f"A2:B{n+1}").setDataArray(tuple(data))
    for i, v in bools:
        sh.getCellRangeByName(f"B{i+2}").setFormula("=TRUE()" if v else "=FALSE()")


def read_check(doc):
    sh = doc.Sheets.getByName("Check")
    status = sh.getCellRangeByName("C4").getString()
    passed = sh.getCellRangeByName("C5").getString()
    capacity = sh.getCellRangeByName("C6").getString()
    data = sh.getCellRangeByName("B9:H900").getDataArray()
    rows = [r for r in data if r[0] != ""]
    return status, passed, capacity, rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("filter", nargs="?", default="")
    ap.add_argument("--workbook", default=os.path.join(HERE, "ORE-Workbook.xlsx"))
    ap.add_argument("--verbose", "-v", action="store_true")
    ap.add_argument("--via-cli", action="store_true",
                    help="build each deal's workbook with `ore excel` and recalculate that file (slower; tests the shipped path)")
    ap.add_argument("--dump", action="append", default=[], help="print a range after recalculation, e.g. Valuation.B4:C60")
    a = ap.parse_args()
    dirs = [os.path.join(ROOT, "examples"), os.path.join(HERE, "fixtures")]
    files = sorted((os.path.join(dd, f) for dd in dirs for f in os.listdir(dd) if f.endswith(".ore") and a.filter in f),
                   key=lambda p: (os.path.basename(os.path.dirname(p)) != "examples", os.path.basename(p)))
    office = Office()
    failures = 0
    try:
        t0 = time.time()
        tmp = tempfile.mkdtemp(prefix="ore-xl-")
        doc = None
        if not a.via_cli:
            work = os.path.join(tmp, os.path.basename(a.workbook))  # a copy: LibreOffice leaves lock files beside what it opens
            shutil.copy(a.workbook, work)
            doc = office.load(work)
            print(f"loaded {os.path.basename(a.workbook)} in {time.time()-t0:.1f}s")
        for f in files:
            t1 = time.time()
            if a.via_cli:
                if doc is not None:
                    doc.close(True)
                out = os.path.join(tmp, os.path.basename(f).replace(".ore", ".xlsx"))
                subprocess.run(["node", os.path.join(ROOT, "validator", "cli.mjs"), "excel", f, "-o", out],
                               check=True, capture_output=True)
                doc = office.load(out)
            else:
                write_tape(doc, tape_rows(f))
            f = os.path.relpath(f, ROOT)
            doc.calculateAll()
            status, passed, capacity, rows = read_check(doc)
            fails = [r for r in rows if r[4] == "FAIL"]
            ok = status == "MATCHES ENGINE" and not fails
            failures += 0 if ok else 1
            star = [r for r in rows if r[4] == "PASS*"]
            note = f"  {len(star)} on a rounding boundary" if star else ""
            print(f"{'PASS' if ok else 'FAIL'}  {f:44s} {passed:>11s} checks  ({time.time()-t1:.1f}s){note}  {'' if ok else status}")
            for r in star:
                print(f"      PASS* {r[0]:52s} workbook={r[6]!s:>22} engine={r[2]!s:>16}  {r[5]}")
            for spec in a.dump:
                sname, rng = spec.split(".", 1)
                for drow in doc.Sheets.getByName(sname).getCellRangeByName(rng).getDataArray():
                    print("      | " + " | ".join(str(x) for x in drow))
            for r in (rows if a.verbose else fails)[:60]:
                print(f"      {r[4]:5s} {r[0]:52s} workbook={r[1]!s:>16} engine={r[2]!s:>16}  {r[5]}")
        if doc is not None:
            doc.close(True)
        shutil.rmtree(tmp, ignore_errors=True)
    finally:
        office.close()
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
