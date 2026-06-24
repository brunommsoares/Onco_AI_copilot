# Onco AI Copilot

A country-adaptive, **GRADE-aware oncology clinical decision support (CDS)** agent. It plans
literature searches, retrieves and grades evidence, reasons over clinical guidelines and trial
registries, and produces comparative, citation-backed answers tailored to a given country's
regulatory and reimbursement context.

> ⚠️ **Medical disclaimer.** This is research / educational software, **not a medical device**.
> It does not provide medical advice and must not be used as the basis for clinical decisions.
> Always rely on professional clinical judgement and primary sources. Provided "as is", without
> warranty of any kind.

## Repository layout

| Path | Description |
|------|-------------|
| `index.html`, `about.html`, `privacy.html`, `terms.html`, `resources/` | Static marketing / landing site |
| `copilot/backend/` | Node.js + Express API — agents, RAG, evidence & guideline services |
| `copilot/frontend/` | React + Vite + Tailwind single-page UI |
| `copilot/docs/` | Architecture notes |

See **[`copilot/README.md`](copilot/README.md)** for the detailed application guide.

## What it does

- **Agentic search** — builds a PICO + MeSH search plan and queries MEDLINE/PubMed via the NCBI E-utilities.
- **Evidence synthesis** — ranks and filters studies, then writes comparative reviews with inline numbered citations and AMA-formatted references.
- **Guideline grounding (RAG)** — retrieves ESMO guideline content from a curated corpus via a vector database.
- **Trial matching** — trial-family and trial-match reasoning over public clinical-trial registries.
- **GRADE-aware** — certainty-of-evidence assessment in the GRADE style.
- **Country localisation** — integrates regulatory / reimbursement signals (EMA marketing authorisation; Portugal's INFARMED as the worked example). The architecture is designed to accept additional national modules.

## Tech stack

- **Backend:** Node.js (≥ 18), Express, Pinecone (vector DB), Firebase Admin (auth), SQLite local stores, Winston logging. LLM access via Amazon Bedrock, with OpenAI / Groq options.
- **Frontend:** React, Vite, TailwindCSS, Firebase Auth.
- **Tooling / deploy:** Docker, `render.yaml`, GitHub Actions.

## Quick start

Prerequisites: **Node.js ≥ 18** and **npm ≥ 9**.

```bash
# 1. Backend
cd copilot/backend
npm install
cp .env.example .env          # then fill in your keys (see Configuration)
npm run dev                   # starts the API (default http://localhost:3004)

# 2. Frontend (second terminal)
cd copilot/frontend
npm install
npm run dev                   # serves the UI at http://localhost:5173
```

### Configuration

Copy `copilot/backend/.env.example` to `.env` and provide credentials for the services you
intend to use. **None of these are included in the repository:**

- **LLM** — Amazon Bedrock (`AWS_*`) and/or `OPENAI_API_KEY` / `GROQ_API_KEY`
- **Vector DB** — `PINECONE_API_KEY`, `PINECONE_HOST`
- **PubMed** — `NCBI_API_KEY`
- **Auth** — Firebase: supply a service account via the `FIREBASE_SERVICE_ACCOUNT` env var
  (the `firebase-service-account.json` file is intentionally **not** committed)

### Data

`copilot/backend/data/` is intentionally empty here. The guideline corpus (ESMO slide sets, etc.)
is **third-party copyrighted material** and is not distributed with this repository — supply your
own copies locally. See [`copilot/backend/data/README.md`](copilot/backend/data/README.md).

## Tests

```bash
cd copilot/backend
npm test
```

## License

Released under the [MIT License](LICENSE).
