' ORE (Open Real Estate) importer for the ORE Workbook.
'
' ImportOre        - pick a .ore file, load it into the Tape sheet, recalculate.
' ImportOreFile p  - same, for a known path (no dialog).
' ExportTape       - write the Tape sheet back out as a .ore (JSON) file.
' ClearTape        - empty the Tape (blank workbook).
'
' The Tape is the workbook's only input: one row per JSON leaf, path in
' column A, value in column B, in file order. Paths join object keys with "."
' and array positions as [i], e.g. rentRoll.leases[0].leasedSF.
' Pure VBA: no references, no ActiveX, works on Windows and Mac Excel.
' Source of truth: excel/vba/ORE.bas in the ORE repository (Apache-2.0).

Option Explicit

Private Const TAPE_SHEET As String = "Tape"
Private Const TAPE_ROWS As Long = 6000

Private src As String
Private pos As Long
Private srcLen As Long
Private outPath() As String
Private outVal() As Variant
Private outN As Long

Public Sub ImportOre()
    Dim f As Variant
    If InStr(1, Application.OperatingSystem, "Mac", vbTextCompare) > 0 Then
        f = Application.GetOpenFilename()
    Else
        f = Application.GetOpenFilename("ORE deal files (*.ore;*.json),*.ore;*.json,All files (*.*),*.*", 1, "Open a .ore file")
    End If
    If VarType(f) = vbBoolean Then Exit Sub
    ImportOreFile CStr(f)
End Sub

Public Sub ImportOreFile(ByVal path As String)
    Dim msg As String, n As Long
    On Error GoTo Fail
    n = LoadOreFile(path)
    msg = "Loaded " & n & " values from" & vbLf & path & vbLf & vbLf & _
          "Status: " & ThisWorkbook.Worksheets("Check").Range("C4").Value
    On Error Resume Next
    ThisWorkbook.Worksheets("Summary").Activate
    MsgBox msg, vbInformation, "ORE"
    Exit Sub
Fail:
    MsgBox "Could not load the file." & vbLf & vbLf & Err.Description, vbExclamation, "ORE"
End Sub

' Load a .ore file into the Tape and recalculate, without any dialog. Returns the row count.
Public Function LoadOreFile(ByVal path As String) As Long
    Dim n As Long
    n = LoadTape(ReadUtf8(path))
    LoadOreFile = n
    Recalc
End Function

' Parse JSON text and write it to the Tape. Returns the row count; raises an error on malformed JSON.
Public Function LoadTape(ByVal text As String) As Long
    Dim ws As Object, i As Long, data() As Variant
    src = text
    srcLen = Len(src)
    pos = 1
    outN = 0
    ReDim outPath(1 To 1024)
    ReDim outVal(1 To 1024)
    If srcLen > 0 Then
        If (AscW(Mid$(src, 1, 1)) And 65535) = 65279 Then pos = 2
    End If
    SkipWs
    ParseValue ""
    SkipWs
    If pos <= srcLen Then Err.Raise vbObjectError + 513, "ORE", "Unexpected text after the JSON value at character " & pos & "."
    If outN > TAPE_ROWS Then Err.Raise vbObjectError + 514, "ORE", "The file has " & outN & " values; the Tape holds " & TAPE_ROWS & "."
    Set ws = ThisWorkbook.Worksheets(TAPE_SHEET)
    ws.Range("A2:B" & (TAPE_ROWS + 1)).ClearContents
    LoadTape = outN
    If outN = 0 Then Exit Function
    ReDim data(1 To outN, 1 To 2)
    For i = 1 To outN
        data(i, 1) = outPath(i)
        data(i, 2) = outVal(i)
    Next i
    ws.Range("A2:B" & (TAPE_ROWS + 1)).NumberFormat = "@"
    ws.Range("A2").Resize(outN, 2).Value = data
End Function

Public Sub ClearTape()
    ThisWorkbook.Worksheets(TAPE_SHEET).Range("A2:B" & (TAPE_ROWS + 1)).ClearContents
    Recalc
End Sub

' Full recalculation (Excel); falls back to a normal recalc where CalculateFull is unavailable.
Private Sub Recalc()
    On Error Resume Next
    Application.CalculateFull
    If Err.Number <> 0 Then
        Err.Clear
        Application.Calculate
    End If
    On Error GoTo 0
End Sub

' ------------------------------------------------------------------ reader

Private Function ReadUtf8(ByVal path As String) As String
    Dim fh As Integer, n As Long, b() As Byte
    fh = FreeFile
    Open path For Binary Access Read As #fh
    n = LOF(fh)
    If n = 0 Then
        Close #fh
        ReadUtf8 = ""
        Exit Function
    End If
    ReDim b(0 To n - 1)
    Get #fh, , b
    Close #fh
    ReadUtf8 = Utf8Decode(b, n)
End Function

Private Function Utf8Decode(b() As Byte, ByVal n As Long) As String
    Dim buf As String, i As Long, k As Long, c As Long, cp As Long
    buf = String$(n, " ")
    i = 0
    k = 0
    If n >= 3 Then
        If b(0) = &HEF And b(1) = &HBB And b(2) = &HBF Then i = 3
    End If
    Do While i < n
        c = b(i)
        If c < &H80 Then
            cp = c
            i = i + 1
        ElseIf c < &HE0 And i + 1 < n Then
            cp = ((c And &H1F) * 64) Or (b(i + 1) And &H3F)
            i = i + 2
        ElseIf c < &HF0 And i + 2 < n Then
            cp = ((c And &HF) * 4096) Or ((b(i + 1) And &H3F) * 64) Or (b(i + 2) And &H3F)
            i = i + 3
        ElseIf i + 3 < n Then
            cp = ((c And &H7) * 262144) Or ((b(i + 1) And &H3F) * 4096) Or ((b(i + 2) And &H3F) * 64) Or (b(i + 3) And &H3F)
            i = i + 4
        Else
            cp = 65533
            i = i + 1
        End If
        If cp >= &H10000 Then
            cp = cp - &H10000
            k = k + 1
            Mid$(buf, k, 1) = ChrW(55296 + (cp \ 1024))
            k = k + 1
            Mid$(buf, k, 1) = ChrW(56320 + (cp And 1023))
        Else
            k = k + 1
            Mid$(buf, k, 1) = ChrW(cp)
        End If
    Loop
    Utf8Decode = Left$(buf, k)
End Function

' ------------------------------------------------------------------ parser

Private Sub Emit(ByVal path As String, ByVal v As Variant)
    outN = outN + 1
    If outN > UBound(outPath) Then
        ReDim Preserve outPath(1 To UBound(outPath) * 2)
        ReDim Preserve outVal(1 To UBound(outVal) * 2)
    End If
    outPath(outN) = path
    outVal(outN) = v
End Sub

Private Sub SkipWs()
    Dim c As Integer
    Do While pos <= srcLen
        c = AscW(Mid$(src, pos, 1))
        If c = 32 Or c = 9 Or c = 10 Or c = 13 Then
            pos = pos + 1
        Else
            Exit Do
        End If
    Loop
End Sub

Private Function Peek() As String
    If pos <= srcLen Then Peek = Mid$(src, pos, 1) Else Peek = ""
End Function

Private Sub Expect(ByVal ch As String)
    If Peek() <> ch Then Err.Raise vbObjectError + 515, "ORE", "Expected '" & ch & "' at character " & pos & " but found '" & Peek() & "'."
    pos = pos + 1
End Sub

Private Sub ParseValue(ByVal path As String)
    Dim ch As String
    SkipWs
    ch = Peek()
    Select Case ch
        Case "{"
            ParseObject path
        Case "["
            ParseArray path
        Case """"
            Emit path, ParseString()
        Case "t"
            ExpectWord "true"
            Emit path, True
        Case "f"
            ExpectWord "false"
            Emit path, False
        Case "n"
            ExpectWord "null"
            Emit path, Empty
        Case Else
            Emit path, ParseNumber()
    End Select
End Sub

Private Sub ExpectWord(ByVal w As String)
    If Mid$(src, pos, Len(w)) <> w Then Err.Raise vbObjectError + 516, "ORE", "Invalid token at character " & pos & "."
    pos = pos + Len(w)
End Sub

Private Sub ParseObject(ByVal path As String)
    Dim name As String
    Expect "{"
    SkipWs
    If Peek() = "}" Then
        pos = pos + 1
        If path <> "" Then Emit path, "{}"
        Exit Sub
    End If
    Do
        SkipWs
        name = ParseString()
        SkipWs
        Expect ":"
        If path = "" Then
            ParseValue name
        Else
            ParseValue path & "." & name
        End If
        SkipWs
        If Peek() = "," Then
            pos = pos + 1
        Else
            Expect "}"
            Exit Do
        End If
    Loop
End Sub

Private Sub ParseArray(ByVal path As String)
    Dim i As Long
    Expect "["
    SkipWs
    If Peek() = "]" Then
        pos = pos + 1
        Emit path, "[]"
        Exit Sub
    End If
    i = 0
    Do
        ParseValue path & "[" & i & "]"
        i = i + 1
        SkipWs
        If Peek() = "," Then
            pos = pos + 1
        Else
            Expect "]"
            Exit Do
        End If
    Loop
End Sub

Private Function ParseString() As String
    Dim buf As String, k As Long, c As String, e As String, startPos As Long
    Expect """"
    buf = String$(64, " ")
    k = 0
    Do
        If pos > srcLen Then Err.Raise vbObjectError + 517, "ORE", "Unterminated string."
        c = Mid$(src, pos, 1)
        pos = pos + 1
        If c = """" Then Exit Do
        If c = "\" Then
            e = Mid$(src, pos, 1)
            pos = pos + 1
            Select Case e
                Case "n": c = vbLf
                Case "r": c = vbCr
                Case "t": c = vbTab
                Case "b": c = Chr$(8)
                Case "f": c = Chr$(12)
                Case "u"
                    c = ChrW(CLng("&H" & Mid$(src, pos, 4)))
                    pos = pos + 4
                Case Else: c = e
            End Select
        End If
        k = k + 1
        If k > Len(buf) Then buf = buf & String$(Len(buf), " ")
        Mid$(buf, k, 1) = c
    Loop
    ParseString = Left$(buf, k)
End Function

Private Function ParseNumber() As Double
    Dim startPos As Long, c As String
    startPos = pos
    Do While pos <= srcLen
        c = Mid$(src, pos, 1)
        If InStr(1, "+-0123456789.eE", c, vbBinaryCompare) > 0 Then
            pos = pos + 1
        Else
            Exit Do
        End If
    Loop
    If pos = startPos Then Err.Raise vbObjectError + 518, "ORE", "Unexpected character '" & Peek() & "' at character " & pos & "."
    ParseNumber = Val(Mid$(src, startPos, pos - startPos))
End Function

' ------------------------------------------------------------------ export

Public Sub ExportTape()
    Dim f As Variant
    If InStr(1, Application.OperatingSystem, "Mac", vbTextCompare) > 0 Then
        f = Application.GetSaveAsFilename("deal.ore")
    Else
        f = Application.GetSaveAsFilename("deal.ore", "ORE deal files (*.ore),*.ore", 1, "Save the Tape as a .ore file")
    End If
    If VarType(f) = vbBoolean Then Exit Sub
    ExportTapeFile CStr(f)
    MsgBox "Wrote " & CStr(f), vbInformation, "ORE"
End Sub

' Rebuild JSON from the Tape (rows above the first $engine path). Every row is
' a leaf; container structure is reconstructed from the paths.
Public Sub ExportTapeFile(ByVal path As String)
    Dim ws As Object, data As Variant, n As Long, i As Long, out As String
    Set ws = ThisWorkbook.Worksheets(TAPE_SHEET)
    data = ws.Range("A2:B" & (TAPE_ROWS + 1)).Value
    n = 0
    For i = 1 To TAPE_ROWS
        If CStr(data(i, 1)) = "" Then Exit For
        If Left$(CStr(data(i, 1)), 7) = "$engine" Then Exit For
        n = i
    Next i
    out = BuildJson(data, n)
    WriteUtf8 path, out
End Sub

Private Function BuildJson(data As Variant, ByVal n As Long) As String
    ' Rows are leaves in document order. Keep a stack of open containers and
    ' close/open them as consecutive paths diverge. Level 0 is the root object.
    Dim stackTok(0 To 64) As String, isArr(0 To 64) As Boolean, first(0 To 64) As Boolean
    Dim depth As Long, i As Long, k As Long, t As Long, common As Long
    Dim toks As Variant, s As String
    s = "{"
    first(0) = True
    depth = 0
    For i = 1 To n
        toks = Tokenize(CStr(data(i, 1)))
        t = UBound(toks)
        common = 0
        Do While common < depth And common < t
            If stackTok(common + 1) <> toks(common) Then Exit Do
            common = common + 1
        Loop
        Do While depth > common
            If isArr(depth) Then s = s & "]" Else s = s & "}"
            depth = depth - 1
        Loop
        For k = depth To t - 1
            s = s & Sep(first, k) & KeyPart(toks(k))
            depth = depth + 1
            stackTok(depth) = toks(k)
            isArr(depth) = IsIndex(toks(k + 1))
            first(depth) = True
            If isArr(depth) Then s = s & "[" Else s = s & "{"
        Next k
        s = s & Sep(first, t) & KeyPart(toks(t)) & JsonValue(data(i, 2))
    Next i
    Do While depth > 0
        If isArr(depth) Then s = s & "]" Else s = s & "}"
        depth = depth - 1
    Loop
    BuildJson = s & "}" & vbLf
End Function

Private Function Sep(first() As Boolean, ByVal k As Long) As String
    If first(k) Then
        first(k) = False
        Sep = ""
    Else
        Sep = ","
    End If
End Function

Private Function KeyPart(ByVal tok As String) As String
    If IsIndex(tok) Then KeyPart = "" Else KeyPart = JsonString(tok) & ":"
End Function

Private Function IsIndex(ByVal tok As String) As Boolean
    IsIndex = (Left$(tok, 1) = "[")
End Function

' "a.b[0].c" -> ("a", "b", "[0]", "c"), as a Variant holding a String array
Private Function Tokenize(ByVal p As String) As Variant
    Dim res() As String, n As Long, i As Long, c As String, cur As String
    ReDim res(0 To 63)
    n = -1
    cur = ""
    For i = 1 To Len(p)
        c = Mid$(p, i, 1)
        If c = "." Or c = "[" Then
            If cur <> "" Then
                n = n + 1
                res(n) = cur
            End If
            If c = "[" Then cur = "[" Else cur = ""
        ElseIf c = "]" Then
            n = n + 1
            res(n) = cur & "]"
            cur = ""
        Else
            cur = cur & c
        End If
    Next i
    If cur <> "" Then
        n = n + 1
        res(n) = cur
    End If
    ReDim Preserve res(0 To n)
    Tokenize = res
End Function

Private Function JsonValue(ByVal v As Variant) As String
    If IsEmpty(v) Then
        JsonValue = "null"
    ElseIf VarType(v) = vbBoolean Then
        If v Then JsonValue = "true" Else JsonValue = "false"
    ElseIf IsNumeric(v) And VarType(v) <> vbString Then
        JsonValue = Trim$(Str$(v))
        If Left$(JsonValue, 1) = "." Then JsonValue = "0" & JsonValue
        If Left$(JsonValue, 2) = "-." Then JsonValue = "-0" & Mid$(JsonValue, 2)
    ElseIf CStr(v) = "[]" Or CStr(v) = "{}" Then
        JsonValue = CStr(v)
    Else
        JsonValue = JsonString(CStr(v))
    End If
End Function

Private Function JsonString(ByVal s As String) As String
    Dim i As Long, c As String, code As Long, r As String
    r = """"
    For i = 1 To Len(s)
        c = Mid$(s, i, 1)
        code = AscW(c)
        If code < 0 Then code = code + 65536
        Select Case code
            Case 34: r = r & "\"""
            Case 92: r = r & "\\"
            Case 10: r = r & "\n"
            Case 13: r = r & "\r"
            Case 9: r = r & "\t"
            Case Is < 32: r = r & "\u" & Right$("000" & Hex$(code), 4)
            Case Else: r = r & c
        End Select
    Next i
    JsonString = r & """"
End Function

Private Sub WriteUtf8(ByVal path As String, ByVal s As String)
    Dim fh As Integer, b() As Byte, n As Long, i As Long, cp As Long, k As Long, lo As Long
    ReDim b(0 To Len(s) * 4)
    k = 0
    i = 1
    Do While i <= Len(s)
        cp = AscW(Mid$(s, i, 1))
        If cp < 0 Then cp = cp + 65536
        If cp >= 55296 And cp <= 56319 And i < Len(s) Then
            lo = AscW(Mid$(s, i + 1, 1))
            If lo < 0 Then lo = lo + 65536
            cp = 65536 + (cp - 55296) * 1024 + (lo - 56320)
            i = i + 1
        End If
        If cp < &H80 Then
            b(k) = cp: k = k + 1
        ElseIf cp < &H800 Then
            b(k) = &HC0 Or (cp \ 64): b(k + 1) = &H80 Or (cp And &H3F): k = k + 2
        ElseIf cp < &H10000 Then
            b(k) = &HE0 Or (cp \ 4096): b(k + 1) = &H80 Or ((cp \ 64) And &H3F): b(k + 2) = &H80 Or (cp And &H3F): k = k + 3
        Else
            b(k) = &HF0 Or (cp \ 262144): b(k + 1) = &H80 Or ((cp \ 4096) And &H3F)
            b(k + 2) = &H80 Or ((cp \ 64) And &H3F): b(k + 3) = &H80 Or (cp And &H3F): k = k + 4
        End If
        i = i + 1
    Loop
    If Len(Dir(path)) > 0 Then Kill path
    fh = FreeFile
    Open path For Binary Access Write As #fh
    If k > 0 Then
        ReDim Preserve b(0 To k - 1)
        Put #fh, , b
    End If
    Close #fh
End Sub
