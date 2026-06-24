# Oncology Evidence Platform Backend

This backend now has one canonical runtime path:

- `src/app.js`: builds the Express app
- `src/server.js`: starts the HTTP server
- `index.js`: compatibility wrapper that forwards to `src/server.js`

The previous monolithic backend entrypoint has been removed in favor of the modular `src/` application.

## Prerequisites

- Node.js 18+
- npm 9+
- AWS access for Amazon Bedrock
- Optional: Firebase and Pinecone credentials

## Setup

1. Install dependencies.

```bash
npm install
```

2. Create `backend/.env` from `backend/.env.example`.

3. Fill in only the secrets you actually use locally. Do not commit real credentials or paste them into docs/logs.

## Common Commands

```bash
npm run dev
npm start
npm test
npm run test:watch
npm run test:config
npm run regression:simple-chat
```

## Test Runner

Tests use Node's built-in `node:test` runner. The old Jest script has been removed from the workflow because the repository tests are authored for `node:test`.

## Health and Docs

- Health check: `GET /health`
- Swagger UI: `GET /api-docs`
- Simple chat API: `POST /api/simple-chat`

## Notes

- `JWT_SECRET` is required in production.
- If `ENABLE_FILE_LOGGING=false`, logs stay on the console only.
- Firebase is optional for local development; the server can start without it.
