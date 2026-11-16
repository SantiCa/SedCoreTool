## SedCoreTool V0.151

SedCoreTool quantifies bioturbation and ichnotaxa in sediment-core images and combines them with other down-core
records and described intervals. Version 0.x, in active development. The downloads contain no sample data: the
program starts empty and you open your own images and tables.

### Highlights
- The Windows portable version is now a ZIP of the program folder: extract it with "Extract all" and run
  `SedCoreTool.exe`. The previous single self-extracting file took about 50 seconds to open.
- A verified, smaller portable Python runtime (3,552 files, about 205 MB) is included for the experimental local
  engine. The experiment is off by default; the interface still calculates as before.
- New name: **SedCoreTool** (formerly CorAnTool and IchAnTool). Projects saved with earlier versions and `.corantool`
  packages still open.
- Editable colours in every figure, including the multiproxy and location maps; invalid stored colours fall back to
  the defaults.
- Final test on reserved cores excludes only the training examples that may come from them.
- Age models tolerate repeated rows and incomplete ranges.
- If saving fails on closing, the program asks whether to retry, export the project or close without saving.
- Python package: exclusion layer, batch analysis of many sections and cores from a CSV manifest, LAS 2.0 export.

The full list of changes is in [CHANGELOG.md](https://github.com/SantiCa/SedCoreTool/blob/master/CHANGELOG.md).

### Downloads

| System | File |
|---|---|
| Windows 10/11, x64 | `SedCoreTool-V0.151-windows-setup.exe` or `SedCoreTool-V0.151-windows-portable.zip` |
| macOS 13 or later, Intel and Apple Silicon | `SedCoreTool-V0.151-mac-universal.dmg` |
| Linux, x64 | `SedCoreTool-V0.151-linux-x86_64.AppImage` or `SedCoreTool-V0.151-linux-amd64.deb` |
| Any system, in a browser | `SedCoreTool_V0.151.html` (single file, works offline) |
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
