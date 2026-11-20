## SedCoreTool V0.152

SedCoreTool quantifies bioturbation and ichnotaxa in sediment-core images and combines them with other down-core
records and described intervals. Version 0.x, in active development. The downloads contain no sample data: the
program starts empty and you open your own images and tables.

### Highlights
- **Exported data keep their values.** CSV files keep 15 significant digits (small values such as a mass susceptibility of
  1e-8 were written as 0) and leave a value that is not a number empty. The CSV of the core column writes each external
  record as the mean of its samples in each interval, with their number, or its value at the interval centre without
  bridging gaps; age reversals are marked and intervals outside the age model are counted.
- **Deleting an ichnotaxon** asks first, says how many traces and predictions in how many cores are concerned, acts on
  every core of the project and can be undone with «Restore» while the project is open. Projects that kept traces of a
  deleted class are repaired when they open.
- **Saving:** two saves can no longer run at the same time.
- **Fixed:** a 16-bit TIFF larger than about 28 megapixels made the window stop answering when it was decoded; choosing
  a resolution too large for memory could make the window go blank (such sizes are now disabled, with a message).
- The Multiproxy log of a long core opens much faster (100,000 rows: from 3 min 15 s to about 0.6 s).
- **Experimental, off by default** (desktop program, engine experiment): images of several gigabytes opened as "tiled"
  sections with full-resolution masks, interval table, saving and reopening, locating a moved image and keeping a copy
  of it in the project.

The full list of changes is in [CHANGELOG.md](https://github.com/SantiCa/SedCoreTool/blob/master/CHANGELOG.md).

### Downloads

| System | File |
|---|---|
| Windows 10/11, x64 | `SedCoreTool-V0.152-windows-setup.exe` or `SedCoreTool-V0.152-windows-portable.zip` |
| macOS 13 or later, Intel and Apple Silicon | `SedCoreTool-V0.152-mac-universal.dmg` |
| Linux, x64 | `SedCoreTool-V0.152-linux-x86_64.AppImage` or `SedCoreTool-V0.152-linux-amd64.deb` |
| Any system, in a browser | `SedCoreTool_V0.152.html` (single file, works offline) |
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
