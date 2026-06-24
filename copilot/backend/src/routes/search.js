import express from 'express';
import { body, validationResult } from 'express-validator';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { SearchService } from '../services/searchService.js';
import trialRegistryService, { buildTrialRegistryInput } from '../services/trialRegistryService.js';

const router = express.Router();
const searchService = new SearchService();

// Validation middleware
const validateSearchQuery = [
  body('query').trim().isLength({ min: 3, max: 1000 }),
  body('sources').optional().isArray(),
  body('filters').optional().isObject(),
  body('maxResults').optional().isInt({ min: 1, max: 100 }),
  body('includeAbstracts').optional().isBoolean(),
  body('sortBy').optional().isIn(['relevance', 'date', 'citations', 'impact_factor']),
  body('evidenceLevel').optional().isIn(['1a', '1b', '2a', '2b', '3a', '3b', '4', '5']),
  body('dateRange').optional().isObject(),
  body('specialty').optional().trim(),
  body('cancerType').optional().trim()
];

/**
 * @swagger
 * /api/search/advanced:
 *   post:
 *     summary: Advanced evidence search across multiple sources
 *     tags: [Search]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 minLength: 3
 *               sources:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [pubmed, cochrane, clinicaltrials, guidelines]
 *               filters:
 *                 type: object
 *               maxResults:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 100
 *               includeAbstracts:
 *                 type: boolean
 *               sortBy:
 *                 type: string
 *                 enum: [relevance, date, citations, impact_factor]
 *               evidenceLevel:
 *                 type: string
 *                 enum: [1a, 1b, 2a, 2b, 3a, 3b, 4, 5]
 *               dateRange:
 *                 type: object
 *                 properties:
 *                   start:
 *                     type: string
 *                     format: date
 *                   end:
 *                     type: string
 *                     format: date
 *               specialty:
 *                 type: string
 *               cancerType:
 *                 type: string
 *     responses:
 *       200:
 *         description: Advanced search results
 *       400:
 *         description: Validation error
 */
router.post('/advanced', validateSearchQuery, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    const searchParams = req.body;
    const userId = req.user.id;

    logger.info(`Advanced search by user ${userId}: ${searchParams.query}`);

    const [searchResult, trialRegistryResult] = await Promise.allSettled([
      searchService.advancedSearch(searchParams, userId),
      trialRegistryService.findMatches(
        buildTrialRegistryInput(searchParams.query, {
          population: searchParams.filters?.population,
          biomarker: searchParams.filters?.biomarker,
          lineOfTherapy: searchParams.filters?.lineOfTherapy,
          intervention: searchParams.filters?.intervention,
          comparator: searchParams.filters?.comparator,
          outcomes: searchParams.filters?.outcomes,
          trialPhases: searchParams.filters?.trialPhases || searchParams.filters?.phases,
          trialStatuses: searchParams.filters?.trialStatuses || searchParams.filters?.statuses,
          trialRegions: searchParams.filters?.trialRegions || searchParams.filters?.regions,
          trialRecruitingInPortugalOnly:
            searchParams.filters?.trialRecruitingInPortugalOnly ??
            searchParams.filters?.recruitingInPortugalOnly ??
            true,
          maxTrials: searchParams.maxResults || 20
        })
      )
    ]);

    if (searchResult.status !== 'fulfilled') {
      throw searchResult.reason;
    }

    const results = searchResult.value;
    const trialRegistry = trialRegistryResult.status === 'fulfilled'
      ? trialRegistryResult.value
      : {
          available: false,
          error: trialRegistryResult.reason?.message || 'Trial registry unavailable',
          trials: [],
          conditions: [],
          weeklyTable: [],
          meta: {
            location: 'Portugal'
          }
        };

    res.json({
      success: true,
      results,
      trialRegistry,
      metadata: {
        query: searchParams.query,
        sources: searchParams.sources || ['pubmed'],
        totalResults: results.total,
        searchTime: new Date().toISOString(),
        filters: searchParams.filters || {},
        trialRegistryAvailable: trialRegistry.available === true,
        trialRegistryTrialsFound: Array.isArray(trialRegistry.trials) ? trialRegistry.trials.length : 0
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/search/semantic:
 *   post:
 *     summary: Semantic search using AI-powered understanding
 *     tags: [Search]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 minLength: 3
 *               context:
 *                 type: string
 *               maxResults:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 50
 *     responses:
 *       200:
 *         description: Semantic search results
 *       400:
 *         description: Validation error
 */
router.post('/semantic', [
  body('query').trim().isLength({ min: 3, max: 1000 }),
  body('context').optional().trim().isLength({ max: 2000 }),
  body('maxResults').optional().isInt({ min: 1, max: 50 })
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    const { query, context, maxResults } = req.body;
    const userId = req.user.id;

    logger.info(`Semantic search by user ${userId}: ${query}`);

    const results = await searchService.semanticSearch({
      query,
      context,
      maxResults: maxResults || 20
    }, userId);

    res.json({
      success: true,
      results,
      metadata: {
        query,
        searchType: 'semantic',
        totalResults: results.length,
        searchTime: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/search/suggestions:
 *   get:
 *     summary: Get search suggestions and autocomplete
 *     tags: [Search]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Partial search query
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [diseases, treatments, drugs, authors, journals]
 *         description: Type of suggestions
 *     responses:
 *       200:
 *         description: Search suggestions
 */
router.get('/suggestions', async (req, res, next) => {
  try {
    const { q, type = 'general' } = req.query;
    
    if (!q || q.length < 2) {
      throw new AppError('Query parameter required (min 2 characters)', 400);
    }

    const suggestions = await searchService.getSuggestions(q, type);

    res.json({
      success: true,
      suggestions,
      metadata: {
        query: q,
        type,
        count: suggestions.length
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/search/trends:
 *   get:
 *     summary: Get search trends and popular topics
 *     tags: [Search]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [week, month, quarter, year]
 *         description: Time period for trends
 *       - in: query
 *         name: specialty
 *         schema:
 *           type: string
 *         description: Medical specialty filter
 *     responses:
 *       200:
 *         description: Search trends data
 */
router.get('/trends', async (req, res, next) => {
  try {
    const { period = 'month', specialty } = req.query;

    const trends = await searchService.getSearchTrends(period, specialty);

    res.json({
      success: true,
      trends,
      metadata: {
        period,
        specialty,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/search/history:
 *   get:
 *     summary: Get user's search history
 *     tags: [Search]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *         description: Items per page
 *     responses:
 *       200:
 *         description: User's search history
 */
router.get('/history', async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const userId = req.user.id;

    const history = await searchService.getUserSearchHistory(userId, {
      page: parseInt(page),
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      history,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: history.total,
        pages: Math.ceil(history.total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
