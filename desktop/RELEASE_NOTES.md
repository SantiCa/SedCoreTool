## SedCoreTool V0.153

SedCoreTool quantifies bioturbation and ichnotaxa in sediment-core images and combines them with other down-core
records and described intervals. Version 0.x, in active development. The downloads contain no sample data: the
program starts empty and you open your own images and tables.

### Highlights
- **Tables of records read more of what laboratories write:** -999 and similar codes, values below a detection limit,
  titles before the table, decimal commas and repeated column names; the import dialog shows how the file was read, and
  an import can be undone. Adding a record asks the unit of its depth or age column and converts it.
- **Data tab:** small values are edited without rounding, long tables scroll to the end without «Show more», plots of
  very long series draw quickly, and very long series no longer stop a chart, map or figure.
- **Figures:** PNG export at 300 or 600 dpi.
- **Safer files:** opening a project or a table from someone else can no longer add elements to the program's pages or
  run code.
- **Fixed:** opening a project while a save was still waiting could overwrite the saved project; several save, backup
  and project-switching problems with several cores are corrected.
- **Experimental, off by default** (desktop program, engine experiment): large "tiled" sections can be split into parts,
  are included in exports, backups and project-folder copies, reopen faster, and stay within memory when their masks
  hold extreme numbers of objects.

The full list of changes is in [CHANGELOG.md](https://github.com/SantiCa/SedCoreTool/blob/master/CHANGELOG.md).

### Downloads

| System | File |
|---|---|
| Windows 10/11, x64 | `SedCoreTool-V0.153-windows-setup.exe` or `SedCoreTool-V0.153-windows-portable.zip` |
| macOS 13 or later, Intel and Apple Silicon | `SedCoreTool-V0.153-mac-universal.dmg` |
| Linux, x64 | `SedCoreTool-V0.153-linux-x86_64.AppImage` or `SedCoreTool-V0.153-linux-amd64.deb` |
| Any system, in a browser | `SedCoreTool_V0.153.html` (single file, works offline) |
| Verification | `SHA256SUMS.txt` and `RELEASE_MANIFEST.json` |

Windows: run the installer or open the portable version. macOS: drag the application to Applications. Linux: make
the AppImage executable or install the DEB package. The HTML file opens with a double click. The installers are not
code-signed, so the operating system may ask for confirmation the first time.

To verify a file: `Get-FileHash <file> -Algorithm SHA256` in PowerShell, `shasum -a 256 <file>` on macOS or
`sha256sum -c SHA256SUMS.txt` on Linux. The manifest identifies the source commit and the size and hash of each file.

### Before you update
Export a copy of your projects. The program does not update itself; install the new version over the old one.

### Known limitations
- U-Net models must be trained by the user; no model trained on real cores is distributed yet.
- The first download of the vision model and map backgrounds need an internet connection.
- Training a U-Net needs Python 3.10 or later on the computer and installs a 2–3 GB module once.

Documentation: [technical documentation](https://github.com/SantiCa/SedCoreTool/blob/master/docs/TECHNICAL_DOCUMENTATION.md).
