import fetch from 'node-fetch';
import { logger as defaultLogger } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Epistemonikos API Client
//
// Wraps the Epistemonikos REST API (https://api.epistemonikos.org) for
// systematic review search. Free, no authentication required.
//
// Epistemonikos indexes Cochrane reviews + other systematic reviews,
// making it a strong complement to the PubMed-Cochrane journal filter.
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = process.env.EPISTEMONIKOS_API_URL || 'https://api.epistemonikos.org/v1';
const REQUEST_TIMEOUT = 15_000;

/**
 * Search Epistemonikos for systematic reviews and structured summaries.
 *
 * @param {string} query - Search query
 * @param {Object} options
 * @param {number} options.maxResults - Maximum results to return (default 10)
 * @param {string} options.type - Document type filter: 'systematic-review', 'structured-summary', 'primary-study'
 * @param {Object} options.logger - Logger instance
 * @returns {Object[]} Array of search results
 */
export const searchEpistemonikos = async (query, options = {}) => {
  const {
    maxResults = 10,
    type = 'systematic-review',
    logger = defaultLogger
  } = options;

  if (!query?.trim()) return [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const url = new URL(`${DEFAULT_BASE_URL}/documents`);
    url.searchParams.set('q', query);
    url.searchParams.set('classification', type);
    url.searchParams.set('per_page', String(maxResults));
    url.searchParams.set('page', '1');

    logger.info(`[Epistemonikos] Searching: ${query} (type: ${type})`);

    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SilverCancer-Oncology-Platform/1.0 (clinical-research)'
      }
    });

    clearTimeout(timeout);

    if (!res.ok) {
      logger.warn(`[Epistemonikos] HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    const documents = data.documents || data.results || data || [];

    if (!Array.isArray(documents)) {
      logger.warn('[Epistemonikos] Unexpected response format');
      return [];
    }

    const results = documents.map((doc) => ({
      id: `epist_${doc.id || doc.external_id || ''}`,
      title: doc.title || '',
      authors: Array.isArray(doc.authors) ? doc.authors.slice(0, 5).map((a) => typeof a === 'string' ? a : a.name || '') : [],
      source: 'epistemonikos',
      type: mapDocType(doc.classification || type),
      journal: doc.journal || doc.source || '',
      date: doc.year ? `${doc.year}` : '',
      year: String(doc.year || ''),
      abstract: doc.abstract || '',
      relevance: 0.85,
      url: doc.url || (doc.id ? `https://www.epistemonikos.org/documents/${doc.id}` : '')
    }));

    logger.info(`[Epistemonikos] Found ${results.length} results`);
    return results;
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn('[Epistemonikos] Request timed out');
    } else {
      logger.warn(`[Epistemonikos] Search failed: ${err.message}`);
    }
    return [];
  }
};

/**
 * Map Epistemonikos document classifications to our type system.
 */
const mapDocType = (classification) => {
  const map = {
    'systematic-review': 'systematic_review',
    'structured-summary': 'structured_summary',
    'primary-study': 'research_article',
    'overview': 'systematic_review',
    'broad-synthesis': 'systematic_review'
  };
  return map[classification] || 'systematic_review';
};

export default { searchEpistemonikos };
