# SilverCancer Architecture

## High-Level Flow

```mermaid
flowchart TD
  U[Clinician / Researcher] --> UI[Frontend UI]
  UI --> SC[/api/simple-chat/]
  SC --> MSR[MeSHBasedRAGService]

  MSR --> PLAN[Agentic Plan + MeSH Builder]
  PLAN --> PUBMED[PubMed/MEDLINE Search]
  MSR --> VEC[Pinecone Vector Search]
  PUBMED --> MERGE[Merge + Rank Evidence]
  VEC --> MERGE

  MSR --> CURIA{Curia RAG Ready?}
  CURIA -->|Yes| CRAG[RAGService]
  CRAG --> PDFS[Curia 2026 Material de Apoio PDFs]
  PDFS --> PDFP[PDF Processing]
  PDFP --> VDB[In-memory Vector DB]
  VDB --> CRAG
  CRAG --> MERGE
  CURIA -->|No| MERGE

  MERGE --> SCORE[Evidence Adequacy + GRADE Profile + ASCO-SEP]
  SCORE --> GEN[LLM Synthesis with Inline Citations]
  GEN --> RESP[Response + Snapshot + Warnings]
  RESP --> UI
```

## Curia 2026 Materials
- Only **`Curia 2026/Pré-curso/Material de Apoio`** is used for evidence.
- Slide decks and tests are excluded by default.
- Initialize Curia RAG once per server session via:
  - `POST /api/rag/initialize` with `{"source":"curia_materials"}`.

## Evidence Scoring
- ASCO-SEP hierarchy + recency + quality signals.
- Readiness categories: `Adequate`, `Borderline`, `Limited`, `Insufficient`.
- Limited/insufficient evidence forces “info-only” response format.

## Outputs
- Evidence-linked narrative synthesis with inline citations.
- Clinical snapshot (GRADE, ASCO-SEP, recency, provenance).
- Exportable JSON/PDF for clinical review.
