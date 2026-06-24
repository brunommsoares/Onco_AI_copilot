import { logger } from '../utils/logger.js';
import { searchEpistemonikos } from './search/epistemonikosClient.js';

const DEFAULT_ARTICLE_LIMIT = 20;
const NCBI_API_KEY = process.env.NCBI_API_KEY || '';

export class EvidenceSelectionService {
  constructor(dependencies = {}) {
    this.dependencies = dependencies;
    this.validateDependencies();
  }

  validateDependencies() {
    const required = [
      'buildSearchQueries',
      'searchPubMed',
      'mergeArticles',
      'applyRecencyFilterToQuery',
      'buildFallbackSearchQueries',
      'rankArticlesByRelevance',
      'filterFocusedContextArticles',
      'enrichContextArticles',
      'extractEvidenceSummaries',
      'filterForPlaceboComparator',
      'computeQuickReviewStats'
    ];

    const missing = required.filter(name => typeof this.dependencies[name] !== 'function');
    if (missing.length > 0) {
      throw new Error(`EvidenceSelectionService missing dependencies: ${missing.join(', ')}`);
    }
  }

  async selectEvidence({ question, standaloneQuestion, options = {}, maxContextArticles = 5 }) {
    const candidateLimit = Math.max(
      Number.parseInt(options.maxCandidateArticles, 10) || 0,
      maxContextArticles * 4,
      DEFAULT_ARTICLE_LIMIT
    );
    const retrieval = await this.retrieveCandidateArticles(question, standaloneQuestion, options, candidateLimit);
    const organization = await this.organizeEvidenceContext(
      retrieval.articles,
      standaloneQuestion,
      options,
      maxContextArticles
    );

    return {
      ...retrieval,
      ...organization,
      selectionTrace: this.buildSelectionTrace({
        retrievedCount: retrieval.articles.length,
        rankedCount: organization.rankedArticles.length,
        focusedCount: organization.focusedArticles.length,
        contextCount: organization.contextArticles.length,
        evidenceSummaryCount: organization.evidenceSummaries.length,
        endpointSignalCount: organization.endpointSignalCount,
        comparatorFilteredCount: organization.comparatorFilteredCount,
        comparatorFilterApplied: organization.comparatorFilterApplied,
        usedFallbackQueries: retrieval.usedFallbackQueries,
        queriesUsed: retrieval.queriesUsed,
        rankedDiagnostics: organization.rankedDiagnostics,
        selectedContextDiagnostics: organization.selectedContextDiagnostics
      })
    };
  }

  async retrieveCandidateArticles(question, standaloneQuestion, options = {}, candidateLimit = DEFAULT_ARTICLE_LIMIT) {
    const {
      buildSearchQueries,
      searchPubMed,
      mergeArticles,
      applyRecencyFilterToQuery,
      buildFallbackSearchQueries
    } = this.dependencies;

    const queriesUsed = [];
    const primaryQueries = await buildSearchQueries(question, standaloneQuestion, options);

    // Run PubMed + Cochrane + Epistemonikos in parallel
    const enableCochrane = process.env.ENABLE_COCHRANE !== 'false';
    const enableEpistemonikos = process.env.ENABLE_EPISTEMONIKOS !== 'false';
    const searchQuery = standaloneQuestion || question;

    const [pubmedArticles, cochraneResults, epistemonikosResults] = await Promise.all([
      this.collectArticlesFromQueries(primaryQueries, options, queriesUsed, candidateLimit),
      enableCochrane ? this.searchCochranePubMed(searchQuery, 5).catch(() => []) : [],
      enableEpistemonikos ? this.searchEpistemonikosReviews(searchQuery, 5).catch(() => []) : []
    ]);

    // Merge Cochrane PMIDs into PubMed results (they'll get full abstracts from PubMed efetch)
    let articles = pubmedArticles;
    if (cochraneResults.length > 0) {
      const existingPmids = new Set(articles.map(a => a.pmid));
      const newCochraneIds = cochraneResults.filter(c => c.pmid && !existingPmids.has(c.pmid));
      if (newCochraneIds.length > 0) {
        // Fetch full articles for Cochrane PMIDs via PubMed
        const cochraneArticles = await this.dependencies.searchPubMed(
          newCochraneIds.map(c => c.pmid).join(','),
          newCochraneIds.length
        ).catch(() => []);
        articles = mergeArticles(articles, cochraneArticles);
        logger.info(`[Cochrane] Added ${cochraneArticles.length} systematic reviews`);
      }
    }

    // Add Epistemonikos results as supplementary evidence
    if (epistemonikosResults.length > 0) {
      const existingTitles = new Set(articles.map(a => (a.title || '').toLowerCase().slice(0, 60)));
      const newEpist = epistemonikosResults.filter(e =>
        e.title && !existingTitles.has(e.title.toLowerCase().slice(0, 60))
      );
      if (newEpist.length > 0) {
        logger.info(`[Epistemonikos] Added ${newEpist.length} systematic reviews`);
        // Map to article format compatible with the pipeline
        const epistArticles = newEpist.map(e => ({
          pmid: e.id || '',
          title: e.title,
          authors: e.authors || [],
          journal: e.journal || 'Epistemonikos',
          year: e.year || '',
          abstract: e.abstract || '',
          studyDesign: 'systematic-review',
          source: 'epistemonikos',
          url: e.url || ''
        }));
        articles = mergeArticles(articles, epistArticles);
      }
    }

    if (articles.length === 0 && standaloneQuestion !== question) {
      logger.info('No results after rewrite; retrying with original question');
      const originalQuery = applyRecencyFilterToQuery(question, options.recency);
      articles = await searchPubMed(originalQuery, candidateLimit);
      queriesUsed.push(question);
    }

    let usedFallbackQueries = false;
    if (articles.length === 0) {
      const fallbackQueries = buildFallbackSearchQueries(question, standaloneQuestion, options);
      if (fallbackQueries.length > 0) {
        usedFallbackQueries = true;
        logger.info(`No direct hits; trying ${fallbackQueries.length} fallback query variant(s)`);
      }

      const fallbackArticles = await this.collectArticlesFromQueries(
        fallbackQueries,
        options,
        queriesUsed,
        candidateLimit
      );
      articles = mergeArticles(articles, fallbackArticles);
    }

    return {
      articles,
      queriesUsed,
      usedFallbackQueries
    };
  }

  /**
   * Search Cochrane Systematic Reviews via PubMed journal filter.
   */
  async searchCochranePubMed(query, maxResults = 5) {
    try {
      const cochranePubmedQuery = `${query} AND "Cochrane Database Syst Rev"[Journal]`;
      const apiKeySuffix = NCBI_API_KEY ? `&api_key=${NCBI_API_KEY}` : '';
      const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(cochranePubmedQuery)}&retmax=${maxResults}&sort=relevance&retmode=json${apiKeySuffix}`;

      const searchRes = await fetch(searchUrl);
      if (!searchRes.ok) return [];
      const searchData = await searchRes.json();
      const ids = searchData?.esearchresult?.idlist || [];
      if (ids.length === 0) return [];

      const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(',')}&rettype=abstract&retmode=xml${apiKeySuffix}`;
      const fetchRes = await fetch(fetchUrl);
      if (!fetchRes.ok) return [];
      // Return PMIDs so the main PubMed pipeline can fetch full abstracts
      return ids.map(id => ({
        pmid: id,
        source: 'cochrane',
        journal: 'Cochrane Database of Systematic Reviews',
        studyDesign: 'systematic-review'
      }));
    } catch (err) {
      logger.warn(`[Cochrane] Search failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Search Epistemonikos for systematic reviews.
   */
  async searchEpistemonikosReviews(query, maxResults = 5) {
    try {
      const results = await searchEpistemonikos(query, { maxResults, logger });
      return results;
    } catch (err) {
      logger.warn(`[Epistemonikos] Search failed: ${err.message}`);
      return [];
    }
  }

  async collectArticlesFromQueries(queries = [], options = {}, queriesUsed = [], candidateLimit = DEFAULT_ARTICLE_LIMIT) {
    const { searchPubMed, mergeArticles, applyRecencyFilterToQuery } = this.dependencies;

    const uniqueQueries = [...new Set(
      (Array.isArray(queries) ? queries : [])
        .map(query => String(query || '').trim())
        .filter(Boolean)
    )];

    if (uniqueQueries.length === 0) {
      return [];
    }

    for (const q of uniqueQueries) queriesUsed.push(q);

    // Strategy: combine all queries into a single OR query to reduce PubMed round-trips
    // from N×2 HTTP calls (N esearch + N efetch) to 1 esearch + 1 efetch.
    // Also run the first (most specific) query individually for relevance-ranked results.
    if (uniqueQueries.length >= 2) {
      const combinedQuery = uniqueQueries.map(q => `(${q})`).join(' OR ');
      const firstQuery = applyRecencyFilterToQuery(uniqueQueries[0], options.recency);
      const combinedWithRecency = applyRecencyFilterToQuery(combinedQuery, options.recency);

      const [firstResults, combinedResults] = await Promise.all([
        searchPubMed(firstQuery, Math.min(candidateLimit, 15)).catch(() => []),
        searchPubMed(combinedWithRecency, candidateLimit).catch(() => [])
      ]);

      // First query results come first (better relevance ordering from PubMed)
      const articles = mergeArticles(firstResults, combinedResults);
      return articles.slice(0, candidateLimit);
    }

    // Single query — direct search
    const queryWithRecency = applyRecencyFilterToQuery(uniqueQueries[0], options.recency);
    const articles = await searchPubMed(queryWithRecency, candidateLimit).catch(() => []);
    return articles.slice(0, candidateLimit);
  }

  /**
   * Comparison-aware search: runs SEPARATE PubMed searches per entity in parallel,
   * guaranteeing minimum coverage for each drug/treatment being compared.
   * Falls back to class-level search if an entity has too few results.
   */
  async collectComparisonArticles(entity1Queries, entity2Queries, sharedQueries, options = {}, candidateLimit = DEFAULT_ARTICLE_LIMIT) {
    const { searchPubMed, mergeArticles, applyRecencyFilterToQuery } = this.dependencies;
    const perEntityLimit = Math.max(Math.floor(candidateLimit / 2), 10);
    const MIN_ARTICLES_PER_ENTITY = 3;

    // Run all three search streams in parallel
    const [entity1Articles, entity2Articles, sharedArticles] = await Promise.all([
      this._runEntitySearch(entity1Queries, options, perEntityLimit),
      this._runEntitySearch(entity2Queries, options, perEntityLimit),
      sharedQueries.length > 0
        ? this._runEntitySearch(sharedQueries, options, Math.min(candidateLimit, 10))
        : Promise.resolve([])
    ]);

    logger.info(`[ComparisonSearch] Entity1: ${entity1Articles.length} articles | Entity2: ${entity2Articles.length} articles | Shared: ${sharedArticles.length} articles`);

    // Merge: entity1 first, then entity2, then shared (head-to-head or class-level)
    // This ensures both entities are represented before shared results fill gaps
    let merged = mergeArticles(entity1Articles, entity2Articles);
    merged = mergeArticles(merged, sharedArticles);

    return {
      articles: merged.slice(0, candidateLimit),
      entity1Count: entity1Articles.length,
      entity2Count: entity2Articles.length,
      sharedCount: sharedArticles.length,
      needsEntity1Fallback: entity1Articles.length < MIN_ARTICLES_PER_ENTITY,
      needsEntity2Fallback: entity2Articles.length < MIN_ARTICLES_PER_ENTITY
    };
  }

  /** Run a set of queries for a single entity (combines with OR if multiple) */
  async _runEntitySearch(queries, options, limit) {
    const { searchPubMed, applyRecencyFilterToQuery } = this.dependencies;
    const unique = [...new Set(queries.map(q => String(q || '').trim()).filter(Boolean))];
    if (unique.length === 0) return [];

    try {
      if (unique.length >= 2) {
        const combined = unique.map(q => `(${q})`).join(' OR ');
        const withRecency = applyRecencyFilterToQuery(combined, options.recency);
        return await searchPubMed(withRecency, limit).catch(() => []);
      }
      const withRecency = applyRecencyFilterToQuery(unique[0], options.recency);
      return await searchPubMed(withRecency, limit).catch(() => []);
    } catch {
      return [];
    }
  }

  async organizeEvidenceContext(articles = [], question = '', options = {}, maxContextArticles = 5) {
    const {
      rankArticlesByRelevance,
      rankArticlesWithDiagnostics,
      filterFocusedContextArticles,
      enrichContextArticles,
      extractEvidenceSummaries,
      filterForPlaceboComparator,
      computeQuickReviewStats
    } = this.dependencies;

    const rankedDiagnostics = typeof rankArticlesWithDiagnostics === 'function'
      ? rankArticlesWithDiagnostics(articles, question, options)
      : [];
    const rankedArticles = rankedDiagnostics.length > 0
      ? rankedDiagnostics.map(item => item.article)
      : rankArticlesByRelevance(articles, question, options);
    const focusedArticles = filterFocusedContextArticles(rankedArticles, question, options);
    let contextArticles = focusedArticles.slice(0, maxContextArticles);

    contextArticles = await enrichContextArticles(contextArticles, question);

    const endpointSignalCount = this.countEndpointSignals(contextArticles);
    // Skip structured extraction when articles already have rich abstracts (>300 chars avg).
    // generateResponse prefers abstracts directly; extraction is only needed as fallback.
    const totalAbstractLen = contextArticles.reduce((sum, a) => sum + (a.abstract?.length || 0), 0);
    const avgAbstractLen = contextArticles.length > 0 ? totalAbstractLen / contextArticles.length : 0;
    const hasRichAbstracts = avgAbstractLen > 300;
    let evidenceSummaries = hasRichAbstracts ? [] : await extractEvidenceSummaries(contextArticles);

    const comparatorFilterApplied = this.shouldRequirePlaceboComparator(options);
    let comparatorFilteredCount = 0;
    if (comparatorFilterApplied) {
      const gated = filterForPlaceboComparator(contextArticles, evidenceSummaries);
      comparatorFilteredCount = Math.max(contextArticles.length - gated.articles.length, 0);
      contextArticles = gated.articles;
      evidenceSummaries = gated.evidenceSummaries;
    }

    const quickStats = computeQuickReviewStats(contextArticles);
    const selectedContextDiagnostics = rankedDiagnostics
      .filter(item => contextArticles.some(article => article?.pmid && article.pmid === item?.article?.pmid))
      .slice(0, maxContextArticles);

    return {
      rankedArticles,
      rankedDiagnostics,
      focusedArticles,
      contextArticles,
      selectedContextDiagnostics,
      evidenceSummaries,
      quickStats,
      endpointSignalCount,
      comparatorFilteredCount,
      comparatorFilterApplied
    };
  }

  shouldRequirePlaceboComparator(options = {}) {
    return options.requirePlaceboComparator === true ||
      /\bplacebo\b/i.test(String(options.comparator || '')) ||
      /\bplacebo\b/i.test(String(options.comparatorText || '')) ||
      /\bplacebo\b/i.test(String(options.interventionComparator || ''));
  }

  countEndpointSignals(articles = []) {
    return articles.filter(article =>
      ['pcr', 'efs', 'dfs', 'pfs', 'os', 'orr', 'grade34ae'].some(key => article?.endpointMetrics?.[key])
    ).length;
  }

  buildSelectionTrace({
    retrievedCount = 0,
    rankedCount = 0,
    focusedCount = 0,
    contextCount = 0,
    evidenceSummaryCount = 0,
    endpointSignalCount = 0,
    comparatorFilteredCount = 0,
    comparatorFilterApplied = false,
    usedFallbackQueries = false,
    queriesUsed = [],
    rankedDiagnostics = [],
    selectedContextDiagnostics = []
  } = {}) {
    return {
      queriesUsed,
      usedFallbackQueries,
      comparatorFilterApplied,
      rankedDiagnostics: rankedDiagnostics.slice(0, 8).map(item => ({
        pmid: item?.article?.pmid || null,
        title: item?.article?.title || null,
        score: Number.isFinite(item?.score) ? Number(item.score.toFixed(3)) : null,
        evidenceTier: item?.evidenceTier || null,
        include: item?.include !== false,
        rationale: Array.isArray(item?.rationale) ? item.rationale.slice(0, 6) : []
      })),
      selectedContext: selectedContextDiagnostics.slice(0, 5).map(item => ({
        pmid: item?.article?.pmid || null,
        title: item?.article?.title || null,
        score: Number.isFinite(item?.score) ? Number(item.score.toFixed(3)) : null,
        evidenceTier: item?.evidenceTier || null,
        rationale: Array.isArray(item?.rationale) ? item.rationale.slice(0, 6) : []
      })),
      counts: {
        retrieved: retrievedCount,
        ranked: rankedCount,
        focused: focusedCount,
        context: contextCount,
        evidenceSummaries: evidenceSummaryCount,
        endpointSignals: endpointSignalCount,
        comparatorFilteredOut: comparatorFilteredCount
      }
    };
  }
}

export default EvidenceSelectionService;
