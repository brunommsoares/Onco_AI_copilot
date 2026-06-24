# Simple Oncology Chat - MEDLINE Comparative Review

A simplified build focused on MEDLINE (via PubMed) plus AI to generate comparative evidence reviews.

## Features
- MEDLINE (PubMed) search via NCBI E-utilities
- AI-generated comparative review with inline citations
- AMA-formatted references
- Clean, single-page UI

## Requirements
- Node.js >= 18
- AWS account with Amazon Bedrock access
- NCBI API key (recommended)

## Setup

Backend:
```bash
cd backend
npm install
```

Frontend:
```bash
cd frontend
npm install
```

## Configuration
Create `backend/.env`:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0
BEDROCK_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v1
NCBI_API_KEY=your_ncbi_api_key
PORT=3004
```

## Run

Backend:
```bash
cd backend
npm run dev
```

Frontend:
```bash
cd frontend
npm run dev
```

## API

### POST `/api/simple-chat`
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
      "url": "https://pubmed.ncbi.nlm.nih.gov/12345678/"
    }
  ],
  "articlesFound": 10
}
```
