Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\Geoinfotech\Documents\GIS Team\Election Dashboard"
code = sh.Run("node scripts\_offline-write-pres-lga.js", 0, True)
Set fso = CreateObject("Scripting.FileSystemObject")
Set f = fso.CreateTextFile("scripts\_wiki_raw\_vbs-exit.txt", True)
f.WriteLine "exit=" & code
f.Close
