#!/usr/bin/env python3
"""Build the macro-enabled workbook: ORE-Workbook.xlsm = ORE-Workbook.xlsx + VBA importer + button.

    python3 excel/build_xlsm.py

Steps:
  1. Compile excel/vba/ORE.bas into a VBA project (xl/vbaProject.bin) using
     LibreOffice headless: a one-sheet scratch document with the module is saved
     as .xlsm and its vbaProject.bin is lifted out. Excel recompiles VBA from
     the stored source on first open, so no Office install is needed to build.
  2. Inject that vbaProject.bin into the generated ORE-Workbook.xlsx, switch the
     package to macro-enabled content types, and add form-control buttons on
     Start Here bound to ImportOre / ExportTape / ClearTape.

Requires LibreOffice with Python UNO. Run build_workbook.py first.
"""

import os
import re
import shutil
import subprocess
import tempfile
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))

MODULE_NAME = "ORE"


def compile_vba(bas_path, n_sheets):
    import uno
    from com.sun.star.beans import PropertyValue

    def pv(n, v):
        p = PropertyValue()
        p.Name = n
        p.Value = v
        return p

    with open(bas_path, encoding="utf-8") as f:
        code = f.read()
    profile = tempfile.mkdtemp(prefix="ore-lo-")
    pipe = f"ore_vba_{os.getpid()}"
    proc = subprocess.Popen(["soffice", "--headless", "--invisible", "--norestore", "--nologo",
                             f"-env:UserInstallation=file://{profile}",
                             f"--accept=pipe,name={pipe};urp;StarOffice.ComponentContext"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    out_dir = tempfile.mkdtemp(prefix="ore-vba-")
    try:
        local = uno.getComponentContext()
        res = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
        ctx = None
        for _ in range(120):
            try:
                ctx = res.resolve(f"uno:pipe,name={pipe};urp;StarOffice.ComponentContext")
                break
            except Exception:
                time.sleep(0.5)
        smgr = ctx.ServiceManager
        cp = smgr.createInstanceWithContext("com.sun.star.configuration.ConfigurationProvider", ctx)
        ua = cp.createInstanceWithArguments("com.sun.star.configuration.ConfigurationUpdateAccess",
                                            (pv("nodepath", "/org.openoffice.Office.Calc/Filter/Import/VBA"),))
        for n in ua.getElementNames():
            ua.setPropertyValue(n, True)
        ua.commitChanges()
        desk = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
        doc = desk.loadComponentFromURL("private:factory/scalc", "_blank", 0, (pv("Hidden", True),))
        # one scratch sheet per workbook sheet, so the project carries matching document modules
        sheets = doc.Sheets
        while sheets.Count < n_sheets:
            sheets.insertNewByName(f"S{sheets.Count + 1}", sheets.Count)
        for i in range(n_sheets):
            try:
                sheets.getByIndex(i).CodeName = f"Sheet{i+1}"
            except Exception as e:
                print("  sheet CodeName not settable:", e)
        try:
            doc.CodeName = "ThisWorkbook"
        except Exception as e:
            print("  document CodeName not settable:", e)
        libs = doc.BasicLibraries
        libs.VBACompatibilityMode = True
        print("  LO VBA project name:", repr(libs.ProjectName))
        libs.ProjectName = "VBAProject"
        if not libs.hasByName("VBAProject"):
            libs.createLibrary("VBAProject")
        lib = libs.getByName("VBAProject")
        lib.insertByName(MODULE_NAME, "Option VBASupport 1\n" + code)
        # register it as a standard (non-document) VBA module so the exporter writes it
        mi = uno.createUnoStruct("com.sun.star.script.ModuleInfo")
        mi.ModuleType = uno.getConstantByName("com.sun.star.script.ModuleType.NORMAL")
        lib.insertModuleInfo(MODULE_NAME, mi)
        doc_t = uno.getConstantByName("com.sun.star.script.ModuleType.DOCUMENT")
        # LibreOffice writes the workbook class (VB_Base 00020819) only when the module object is a VBA Workbook
        vba_wb = smgr.createInstanceWithArgumentsAndContext("ooo.vba.excel.Workbook", (None, doc), ctx)
        for name, obj in [("ThisWorkbook", vba_wb)] + [(f"Sheet{i+1}", sheets.getByIndex(i)) for i in range(n_sheets)]:
            if lib.hasByName(name):
                lib.removeByName(name)
            dmi = uno.createUnoStruct("com.sun.star.script.ModuleInfo")
            dmi.ModuleType = doc_t
            dmi.ModuleObject = obj
            lib.insertByName(name, "Option VBASupport 1\n")
            if lib.hasModuleInfo(name):
                lib.removeModuleInfo(name)
            lib.insertModuleInfo(name, dmi)
        target = os.path.join(out_dir, "scratch.xlsm")
        doc.storeToURL(uno.systemPathToFileUrl(target), (pv("FilterName", "Calc MS Excel 2007 VBA XML"),))
        doc.close(True)
        try:
            desk.terminate()
        except Exception:
            pass
        with zipfile.ZipFile(target) as z:
            return z.read("xl/vbaProject.bin")
    finally:
        try:
            proc.wait(timeout=30)
        except Exception:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)
        shutil.rmtree(out_dir, ignore_errors=True)


BUTTONS = [
    # (macro, caption, left px, right px) inside column C of Start Here, row 3
    ("ImportOre", "Import .ore file", 0, 170),
    ("ExportTape", "Save Tape as .ore", 185, 355),
    ("ClearTape", "Clear", 370, 450),
]


def vml_buttons():
    shapes = []
    for i, (macro, caption, left, right) in enumerate(BUTTONS):
        sid = 1025 + i
        # Anchor: LeftColumn, LeftOffset, TopRow, TopOffset, RightColumn, RightOffset, BottomRow, BottomOffset
        # (0-based columns/rows, offsets in pixels): column C, row 3
        anchor = f"2, {left}, 2, 5, 2, {right}, 2, 37"
        shapes.append(f'''<v:shape id="_x0000_s{sid}" type="#_x0000_t201" style='position:absolute;margin-left:0;margin-top:0;width:150pt;height:28pt;z-index:{i+1}' o:button="t" fillcolor="buttonFace [67]" strokecolor="windowText [64]" o:insetmode="auto">
  <v:fill color2="buttonFace [67]" o:detectmouseclick="t"/>
  <o:lock v:ext="edit" rotation="t"/>
  <v:textbox style='mso-direction-alt:auto' o:singleclick="f">
   <div style='text-align:center'><font face="Arial" size="200" color="auto"><b>{caption}</b></font></div>
  </v:textbox>
  <x:ClientData ObjectType="Button">
   <x:Anchor>{anchor}</x:Anchor>
   <x:PrintObject>False</x:PrintObject>
   <x:AutoFill>False</x:AutoFill>
   <x:FmlaMacro>[0]!{macro}</x:FmlaMacro>
   <x:TextHAlign>Center</x:TextHAlign>
   <x:TextVAlign>Center</x:TextVAlign>
  </x:ClientData>
 </v:shape>''')
    return ('<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" '
            'xmlns:x="urn:schemas-microsoft-com:office:excel">\n'
            ' <o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>\n'
            ' <v:shapetype id="_x0000_t201" coordsize="21600,21600" o:spt="201" path="m,l,21600r21600,l21600,xe">\n'
            '  <v:stroke joinstyle="miter"/><v:path shadowok="f" o:extrusionok="f" strokeok="f" fillok="f" o:connecttype="rect"/>\n'
            '  <o:lock v:ext="edit" shapetype="t"/>\n'
            ' </v:shapetype>\n' + "\n".join(shapes) + "\n</xml>\n")


def inject(xlsx_path, xlsm_path, vba_bin):
    with zipfile.ZipFile(xlsx_path) as z:
        parts = {n: z.read(n) for n in z.namelist()}
        order = z.namelist()
    # content types: macro-enabled workbook, bin and vml defaults
    ct = parts["[Content_Types].xml"].decode()
    ct = ct.replace("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
                    "application/vnd.ms-excel.sheet.macroEnabled.main+xml")
    if 'Extension="bin"' not in ct:
        ct = ct.replace("<Default ", '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/><Default ', 1)
    if 'Extension="vml"' not in ct:
        ct = ct.replace("<Default ", '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/><Default ', 1)
    parts["[Content_Types].xml"] = ct.encode()
    # workbook relationship to the VBA project
    rels = parts["xl/_rels/workbook.xml.rels"].decode()
    rels = rels.replace("</Relationships>",
                        '<Relationship Id="rIdVBA1" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>')
    parts["xl/_rels/workbook.xml.rels"] = rels.encode()
    parts["xl/vbaProject.bin"] = vba_bin
    order.append("xl/vbaProject.bin")
    # code names: workbook ThisWorkbook, sheets Sheet1..N
    wb = parts["xl/workbook.xml"].decode()
    if "<workbookPr" in wb:
        wb = re.sub(r"<workbookPr([^>]*?)/>", lambda m: f'<workbookPr{re.sub(r" codeName=\"[^\"]*\"", "", m.group(1))} codeName="ThisWorkbook"/>', wb, count=1)
    else:
        wb = wb.replace("<bookViews>", '<workbookPr codeName="ThisWorkbook"/><bookViews>', 1)
    parts["xl/workbook.xml"] = wb.encode()
    sheet_parts = sorted((n for n in parts if re.match(r"xl/worksheets/sheet\d+\.xml$", n)),
                         key=lambda n: int(re.findall(r"\d+", n)[0]))
    for n in sheet_parts:
        idx = int(re.findall(r"\d+", n)[0])
        x = parts[n].decode()
        if "<sheetPr" in x:
            x = re.sub(r"<sheetPr(?![^>]*codeName)", f'<sheetPr codeName="Sheet{idx}"', x, count=1)
        else:
            x = re.sub(r"(<worksheet[^>]*>)", rf'\1<sheetPr codeName="Sheet{idx}"/>', x, count=1)
        parts[n] = x.encode()
    # buttons on Start Here (sheet1): VML drawing + legacyDrawing
    start = "xl/worksheets/sheet1.xml"
    parts["xl/drawings/vmlDrawing1.vml"] = vml_buttons().encode()
    order.append("xl/drawings/vmlDrawing1.vml")
    srels_name = "xl/worksheets/_rels/sheet1.xml.rels"
    srels = parts.get(srels_name, b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                                  b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>').decode()
    srels = srels.replace("</Relationships>",
                          '<Relationship Id="rIdVml1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>')
    if srels_name not in parts:
        order.append(srels_name)
    parts[srels_name] = srels.encode()
    x = parts[start].decode()
    if 'xmlns:r="' not in x[:600]:
        x = x.replace("<worksheet ", '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ', 1)
    # legacyDrawing goes after pageSetup/headerFooter/drawing and before tableParts/extLst
    m = re.search(r"<(tableParts|extLst)\b", x)
    tag = '<legacyDrawing r:id="rIdVml1"/>'
    x = x[:m.start()] + tag + x[m.start():] if m else x.replace("</worksheet>", tag + "</worksheet>")
    parts[start] = x.encode()
    with zipfile.ZipFile(xlsm_path, "w", zipfile.ZIP_DEFLATED) as z:
        for n in order:
            z.writestr(n, parts[n])


def main():
    xlsx = os.path.join(HERE, "ORE-Workbook.xlsx")
    xlsm = os.path.join(HERE, "ORE-Workbook.xlsm")
    tmp = tempfile.mkdtemp(prefix="ore-xlsm-")
    try:
        # the macro workbook's Start Here mentions the buttons
        subprocess.run(["python3", os.path.join(HERE, "build_workbook.py"), "--out", os.path.join(tmp, "m.xlsx"), "--macro"],
                       check=True)
        with zipfile.ZipFile(os.path.join(tmp, "m.xlsx")) as z:
            n_sheets = sum(1 for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
        vba = compile_vba(os.path.join(HERE, "vba", "ORE.bas"), n_sheets)
        inject(os.path.join(tmp, "m.xlsx"), xlsm, vba)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("wrote", xlsm, f"(vbaProject.bin {len(vba)} bytes)")


if __name__ == "__main__":
    main()
