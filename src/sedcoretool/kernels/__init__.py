"""Pure array primitives shared by the Python API, the command line and the scientific engine.

Rules (docs/ARCHITECTURE.md §3.1): only NumPy and the standard library; no file, network or environment access, no
global state, and no import of pandas, Pillow, ``sedcoretool.engine`` or ``sedcoretool.methods``. ``tests/test_architecture.py``
enforces them.

- ``binning``: pixels per centimetre, interval edges and sums, the minimum-valid rule and percentages.
- ``counting``: per-row valid, bioturbated and per-class pixel counts from class masks, class layers or object labels.
- ``classification``: index tiers with first-match or last-match precedence.
- ``ages``: linear interpolation of an age model.
- ``jstext``: ECMAScript ``Number()``, ``trim``, ``split`` and ``toPrecision(8)``, for readers of text that must equal the program's
  JavaScript (standard library only).
"""
