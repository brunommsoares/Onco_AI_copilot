# `data/` — local runtime data (not committed)

This directory is intentionally empty in the public repository.

At runtime the backend expects:

- `*.sqlite` databases (trial registry, EMA products, ESMO guidelines) — these are
  generated/populated by the sync jobs and seed scripts (see `backend/scripts/`).
- `esmo_pdfs/` — source ESMO guideline slide sets used to build the guideline corpus.

The PDF/spreadsheet source material is **third-party copyrighted content** and is
excluded from version control (see the root `.gitignore`). Supply your own copies
locally to reproduce the guideline database.
