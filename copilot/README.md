# MEDLINE Comparative Review AI Agent

An oncology-focused assistant that plans MeSH searches, retrieves MEDLINE/PubMed evidence, and produces comparative reviews with inline citations and AMA references.

## What This Does
- Builds an agentic search plan (PICO + MeSH terms + study type + recency filters)
- Queries MEDLINE via the NCBI E-utilities (PubMed API)
- Ranks and filters evidence by relevance and quality
- Generates comparative, evidence-linked reviews with numbered citations
- Outputs AMA-formatted references
- UI includes a Comparative Review Builder to structure PICO inputs

## Core Workflow
1. Parse the question and create a search plan.
2. Run MeSH-first queries with fallback text search.
3. Fetch and score MEDLINE abstracts.
4. Generate a comparative review with inline citations.
5. Append AMA references and return structured output.

## Architecture
- Frontend: React + Vite, single-page UI (SimpleChat)
- Backend: Node.js + Express (`backend/src/server.js` is the canonical runtime entrypoint)
- Optional: Pinecone for vector search and retrieval augmentation

## Quick Start
1. Install dependencies.

```bash
cd backend
npm install

cd ../frontend
npm install
```

2. Configure environment variables in `backend/.env`.

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0
BEDROCK_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v1
NCBI_API_KEY=your_ncbi_api_key
PORT=3004
PINECONE_API_KEY=your_pinecone_api_key  # optional
```

3. Run backend and frontend.

```bash
cd backend
npm run dev

cd ../frontend
npm run dev
```

Backend runs on `http://localhost:3004` and the UI on `http://localhost:5173`.

The backend also exposes `backend/src/app.js` for app-only imports, keeps `backend/index.js` as a compatibility wrapper, and routes the repo root `index.js` to the same modular server.

## API

### POST `/api/simple-chat`
Public endpoint used by the SimpleChat UI. It executes the MEDLINE comparative review pipeline.

Request:
```json
{
  "question": "Compare carboplatin + paclitaxel vs cisplatin-based regimens for metastatic anal cancer."
}
```

Response:
```json
{
  "success": true,
  "answer": "Comparative review with inline citations [1][2]...",
  "references": [
    {
      "id": 1,
      "title": "Article title",
      "journal": "Journal name",
      "year": "2024",
      "pmid": "12345678",
      "doi": "10.0000/example",
      "url": "https://pubmed.ncbi.nlm.nih.gov/12345678/",
      "publicationType": "Randomized Controlled Trial",
      "qualityScore": 42
    }
  ],
  "articlesFound": 12
}
```

## Notes
- MEDLINE is accessed through PubMed (NCBI E-utilities).
- Responses are evidence-led and include limitations when appropriate.
- Pinecone is optional and used only when configured.

## License
MIT
