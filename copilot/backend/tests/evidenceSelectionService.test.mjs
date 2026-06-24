import test from 'node:test';
import assert from 'node:assert/strict';

import { EvidenceSelectionService } from '../src/services/evidenceSelectionService.js';

const mergeUniqueArticles = (primary = [], secondary = []) => {
  const seen = new Set(primary.map(article => article.pmid));
  const merged = [...primary];

  for (const article of secondary) {
    if (!seen.has(article.pmid)) {
      seen.add(article.pmid);
      merged.push(article);
    }
  }

  return merged;
};

const makeArticle = (pmid, title) => ({
  pmid,
  title,
  abstract: `${title} abstract`,
  year: 2024
});

const createService = (overrides = {}) => new EvidenceSelectionService({
  buildSearchQueries: async () => ['primary-query'],
  searchPubMed: async (query) => {
    if (query === 'primary-query') {
      return [
        makeArticle('101', 'Study Alpha'),
        makeArticle('102', 'Study Beta'),
        makeArticle('103', 'Study Gamma')
      ];
    }
    if (query === 'fallback-query') {
      return [
        makeArticle('201', 'Fallback Study'),
        makeArticle('202', 'Fallback Comparator Study')
      ];
    }
    return [];
  },
  mergeArticles: mergeUniqueArticles,
  applyRecencyFilterToQuery: (query) => query,
  buildFallbackSearchQueries: () => ['fallback-query'],
  rankArticlesByRelevance: (articles) => [...articles].reverse(),
  filterFocusedContextArticles: (articles) => articles.slice(0, 2),
  enrichContextArticles: async (articles) => articles.map((article, index) => ({
    ...article,
    endpointMetrics: index === 0 ? { pcr: '55%' } : {}
  })),
  extractEvidenceSummaries: async (articles) => articles.map((article, index) => ({
    index: index + 1,
    pmid: article.pmid,
    comparator: index === 0 ? 'placebo' : 'chemotherapy'
  })),
  filterForPlaceboComparator: (articles, evidenceSummaries) => ({
    articles: articles.filter((_, index) => index === 0),
    evidenceSummaries: evidenceSummaries.filter(summary => summary.index === 1)
  }),
  computeQuickReviewStats: (articles) => ({
    readinessScore: articles.length * 10,
    grade: articles.length > 0 ? 'moderate' : 'insufficient'
  }),
  ...overrides
});

test('selectEvidence organizes the retrieval and selection stages into a traceable pipeline', async () => {
  const service = createService();

  const result = await service.selectEvidence({
    question: 'tnbc neoadjuvant chemotherapy',
    standaloneQuestion: 'tnbc neoadjuvant chemotherapy',
    options: {},
    maxContextArticles: 2
  });

  assert.equal(result.articles.length, 3);
  assert.equal(result.rankedArticles[0].pmid, '103');
  assert.equal(result.focusedArticles.length, 2);
  assert.equal(result.contextArticles.length, 2);
  assert.equal(result.evidenceSummaries.length, 2);
  assert.deepEqual(result.quickStats, {
    readinessScore: 20,
    grade: 'moderate'
  });
  assert.deepEqual(result.selectionTrace, {
    queriesUsed: ['primary-query'],
    usedFallbackQueries: false,
    comparatorFilterApplied: false,
    rankedDiagnostics: [],
    selectedContext: [],
    counts: {
      retrieved: 3,
      ranked: 3,
      focused: 2,
      context: 2,
      evidenceSummaries: 2,
      endpointSignals: 1,
      comparatorFilteredOut: 0
    }
  });
});

test('selectEvidence records fallback retrieval and comparator gating', async () => {
  const service = createService({
    searchPubMed: async (query) => query === 'fallback-query'
      ? [
        makeArticle('201', 'Fallback Study'),
        makeArticle('202', 'Fallback Comparator Study')
      ]
      : [],
    rankArticlesByRelevance: (articles) => articles,
    filterFocusedContextArticles: (articles) => articles,
    enrichContextArticles: async (articles) => articles,
    extractEvidenceSummaries: async () => ([
      { index: 1, comparator: 'placebo' },
      { index: 2, comparator: 'active comparator' }
    ]),
    computeQuickReviewStats: (articles) => ({
      readinessScore: articles.length * 10,
      grade: articles.length > 0 ? 'moderate' : 'insufficient'
    })
  });

  const result = await service.selectEvidence({
    question: 'placebo controlled trial',
    standaloneQuestion: 'placebo controlled trial',
    options: {
      comparator: 'placebo'
    },
    maxContextArticles: 5
  });

  assert.equal(result.articles.length, 2);
  assert.equal(result.contextArticles.length, 1);
  assert.equal(result.quickStats.readinessScore, 10);
  assert.equal(result.selectionTrace.usedFallbackQueries, true);
  assert.equal(result.selectionTrace.comparatorFilterApplied, true);
  assert.equal(result.selectionTrace.counts.comparatorFilteredOut, 1);
  assert.deepEqual(result.selectionTrace.queriesUsed, ['primary-query', 'fallback-query']);
  assert.deepEqual(result.selectionTrace.rankedDiagnostics, []);
  assert.deepEqual(result.selectionTrace.selectedContext, []);
});

test('collectArticlesFromQueries diversifies across the first two primary queries before stopping', async () => {
  const searchCalls = [];
  const service = createService({
    buildSearchQueries: async () => ['primary-query', 'secondary-query', 'third-query'],
    searchPubMed: async (query, maxResults) => {
      searchCalls.push({ query, maxResults });

      if (query === 'primary-query') {
        return Array.from({ length: maxResults }, (_, index) => makeArticle(`p${index}`, `Primary ${index}`));
      }

      if (query === 'secondary-query') {
        return [
          makeArticle('s1', 'Secondary one'),
          makeArticle('s2', 'Secondary two')
        ];
      }

      return [makeArticle('t1', 'Third query result')];
    },
    filterFocusedContextArticles: (articles) => articles,
    enrichContextArticles: async (articles) => articles,
    extractEvidenceSummaries: async (articles) => articles.map((article, index) => ({
      index: index + 1,
      pmid: article.pmid
    })),
  });

  const result = await service.selectEvidence({
    question: 'structured oncology query',
    standaloneQuestion: 'structured oncology query',
    options: {},
    maxContextArticles: 2
  });

  assert.deepEqual(
    searchCalls.map(call => call.query),
    ['primary-query', 'secondary-query', 'third-query']
  );
  assert.equal(searchCalls[0].maxResults, 10);
  assert.equal(searchCalls[1].maxResults, 10);
  assert.equal(searchCalls[2].maxResults, 8);
  assert.equal(result.articles.length, 13);
  assert.deepEqual(
    result.selectionTrace.queriesUsed,
    ['primary-query', 'secondary-query', 'third-query']
  );
});
