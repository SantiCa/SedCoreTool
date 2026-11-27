## SedCoreTool V0.154

SedCoreTool quantifies bioturbation and ichnotaxa in sediment-core images and combines them with other down-core
records and described intervals. Version 0.x, in active development. The downloads contain no sample data: the
program starts empty and you open your own images and tables.

### Highlights
- **Figures of ichnotaxa:** «Ichnotaxa distribution» can include the core photo and geochemical proxies or other records;
  «Whole interpreted core», «Core log» and «Multiproxy log of a core» offer a compact ichnotaxa view; plots no longer draw
  a line across intervals where a taxon is absent.
- **Fixed:** the core image of «Multiproxy log of a core» now shows reliably on depth and age axes; core photos no longer
  flicker while laying out figures of cores with many high-resolution sections; «Go to the trace» stays on the trace;
  the image view fills exactly its pane at every window size; a section no longer stays on its grey "loading" image
  after opening or creating a project while another was still loading.
- **Fixed:** a project file with an invalid classifier setting no longer stops the classifier; the setting returns to its
  default and a message names it.
- **Experimental, off by default** (desktop program, engine experiment): ages of a core's merged table are computed by
  the engine; a large "tiled" section shown as a grey placeholder no longer reports a "locked" error after memory is freed.

The full list of changes is in [CHANGELOG.md](https://github.com/SantiCa/SedCoreTool/blob/master/CHANGELOG.md).

### Downloads

| System | File |
|---|---|
| Windows 10/11, x64 | `SedCoreTool-V0.154-windows-setup.exe` or `SedCoreTool-V0.154-windows-portable.zip` |
| macOS 13 or later, Intel and Apple Silicon | `SedCoreTool-V0.154-mac-universal.dmg` |
| Linux, x64 | `SedCoreTool-V0.154-linux-x86_64.AppImage` or `SedCoreTool-V0.154-linux-amd64.deb` |
| Any system, in a browser | `SedCoreTool_V0.154.html` (single file, works offline) |
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
