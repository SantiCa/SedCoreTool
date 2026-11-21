# Security policy

SedCoreTool runs locally: projects and images stay in the browser (IndexedDB) or on the computer (desktop program).
Network requests are made only for optional downloads (map backgrounds from Esri/GEBCO after consent, the DINOv2
vision model from Hugging Face, and libraries from jsDelivr/SheetJS when the bundled copies are missing).

## Supported versions
Only the latest delivery (`V0.<n>`, see [CHANGELOG.md](CHANGELOG.md)) receives fixes.

## Reporting a vulnerability
Please do **not** open a public issue. Use GitHub's private reporting (*Security → Report a vulnerability*) or write
to the maintainer (address in `desktop/package.json`). Include the version, the steps to reproduce and, if possible,
a file that triggers the problem. You will get an answer within two weeks.

Files from other people (projects, spreadsheets, images) are parsed in the browser; reports about crafted files that
crash the program or run code are especially welcome.

## Desktop program: what a page can do (card M8.4.34)

The desktop program runs the web application in a sandboxed window (context isolation on, no Node in the page). If a script ever ran inside
that page (the code builds a few hundred fragments of HTML), these limits apply to it:

- **Scripts.** Pages served from `app://corantool` carry a content security policy header that allows scripts from the program itself only
  (`script-src 'self' 'wasm-unsafe-eval'`), in addition to the policy in the page, which also names `cdn.jsdelivr.net` and `cdn.sheetjs.com`
  for the browser build. A script from any other origin is blocked on the desktop. The desktop build carries every library it needs (`app/vendor`).
- **Navigation and links.** Navigation (also by redirect, and in the program's own extra windows) to an address outside the app origin is
  refused. Links that open outside the program go to the system only if they are `https:`, `http:` or `mailto:`; `file:`, `javascript:`, `data:`,
  other custom schemes and another `app:` host open nothing.
- **Project stores on disk.** The main process cannot tell the page from a script in it, so the right to remove stored data follows what this
  program session wrote, not what the page says it works on. A store whose folder did not exist when the session first named it is this session's:
  it may be cleaned up and deleted without a question. Any other store (a project saved earlier, also one the page reopened) is deleted only if the
  page opened or announced it and the user agrees in a window of the main process (default: Cancel); a clean-up (`mask.retain`) there removes only
  versions this session wrote and keeps every earlier one. An identifier the page neither opened, announced nor created is refused by every store
  operation. A copy goes only into a folder this session created. The protection against a script that can also open or announce a project is
  the user's answer and the rule on earlier versions, not the code's knowledge of what the user opened.
- **Training.** Only the top frame of an app page may call the training channels. A training request is checked against fixed options, types
  and bounds (core names never start with `-`, the encoder is one of a short list, the training ZIP has a ZIP signature and at most 2 GiB)
  before anything is written; the trainer never runs a command synchronously in the main process, and cancelling it ends every process it started.
- **Not covered.** A script in the page can still read and change what the page itself can (its projects in the browser database, its open
  images), read the stores of projects it opens or announces, add versions to them and replace their reopening caches (which are checked when
  read), and start a training with valid options.

## Desktop scientific runtime

Desktop build preparation downloads the exact CPython archives from Astral's GitHub releases and wheels from
`files.pythonhosted.org` listed in `desktop/runtime-lock.json`. This is build-time network access, not an
installed-program download. Artifact byte lengths and SHA-256 hashes are checked before extraction/install;
pip uses only the verified local wheels, with dependency resolution and index access disabled. An offline
rebuild requires the complete verified cache. Training installation remains a separate optional operation
managed by `desktop/trainer.js`; its environment matrix is still tracked in roadmap M3.2.4.

The experimental desktop engine verifies its resource inventory and application-source hashes before spawning
the included interpreter. Runtime resources are application files, not a writable project environment. No
automatic runtime update, package installation, system-Python search or silent fallback occurs at launch.
After one full verification the program stores a fingerprint of file identity (size, times, inode) in the
user-data folder and later launches skip content hashing only while it still matches; see the technical manual §26.3.
Checksums detect corruption and mismatches relative to the application's trusted lock and manifest; they do
not replace installer signing or protect against an attacker who can replace the application and its lock.

Runtime updates require an explicit lock change: obtain hashes from the upstream release/PyPI metadata,
rebuild offline from verified artifacts, run native scientific/image and lifecycle checks, and validate the
packaged resources on each supported architecture. Record the tested versions and limitations in the technical
documentation and changelog. Keep the previous complete runtime until its replacement is verified; failed
staging does not merge into or overwrite that working directory.
