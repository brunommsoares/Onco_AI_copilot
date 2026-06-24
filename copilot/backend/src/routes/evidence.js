import express from 'express';
import { body, validationResult } from 'express-validator';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { requirePermission } from '../middleware/authMiddleware.js';
import { EvidenceService } from '../services/evidenceService.js';
import trialRegistryService, { buildTrialRegistryInput } from '../services/trialRegistryService.js';

const router = express.Router();
const evidenceService = new EvidenceService();

// Validation middleware
const validateEvidenceQuery = [
  body('query').trim().isLength({ min: 3, max: 1000 }),
  body('filters').optional().isObject(),
  body('maxResults').optional().isInt({ min: 1, max: 100 }),
  body('includeAbstracts').optional().isBoolean(),
  body('sortBy').optional().isIn(['relevance', 'date', 'citations', 'impact_factor'])
];

const validateEvidenceSave = [
  body('title').trim().isLength({ min: 5, max: 500 }),
  body('authors').isArray({ min: 1 }),
  body('journal').trim().isLength({ min: 2, max: 200 }),
  body('year').isInt({ min: 1900, max: new Date().getFullYear() }),
  body('doi').optional().isURL(),
  body('abstract').optional().trim().isLength({ max: 5000 }),
  body('keywords').optional().isArray(),
  body('evidenceLevel').optional().isIn(['1a', '1b', '2a', '2b', '3a', '3b', '4', '5']),
  body('clinicalRelevance').optional().isIn(['high', 'medium', 'low']),
  body('notes').optional().trim().isLength({ max: 10000 })
];

/**
 * @swagger
 * /api/evidence/search:
 *   post:
 *     summary: Search for evidence-based literature
 *     tags: [Evidence]
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
 *     responses:
 *       200:
 *         description: Search results
 *       400:
 *         description: Validation error
 */
router.post('/search', validateEvidenceQuery, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    const { query, filters, maxResults, includeAbstracts, sortBy } = req.body;
    const userId = req.user.id;

    logger.info(`Evidence search by user ${userId}: ${query}`);

    const [evidenceResult, trialRegistryResult] = await Promise.allSettled([
      evidenceService.searchEvidence({
        query,
        filters,
        maxResults: maxResults || 20,
        includeAbstracts: includeAbstracts || false,
        sortBy: sortBy || 'relevance',
        userId
      }),
      trialRegistryService.findMatches(
        buildTrialRegistryInput(query, {
          population: filters?.population,
          biomarker: filters?.biomarker,
          lineOfTherapy: filters?.lineOfTherapy,
          intervention: filters?.intervention,
          comparator: filters?.comparator,
          outcomes: filters?.outcomes,
          trialPhases: filters?.trialPhases || filters?.phases,
          trialStatuses: filters?.trialStatuses || filters?.statuses,
          trialRegions: filters?.trialRegions || filters?.regions,
          trialRecruitingInPortugalOnly:
            filters?.trialRecruitingInPortugalOnly ??
            filters?.recruitingInPortugalOnly ??
            true,
          maxTrials: 20
        })
      )
    ]);

    if (evidenceResult.status !== 'fulfilled') {
      throw evidenceResult.reason;
    }

    const results = evidenceResult.value;
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
        query,
        totalResults: results.length,
        searchTime: new Date().toISOString(),
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
 * /api/evidence/save:
 *   post:
 *     summary: Save evidence to user's library
 *     tags: [Evidence]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - authors
 *               - journal
 *               - year
 *             properties:
 *               title:
 *                 type: string
 *               authors:
 *                 type: array
 *                 items:
 *                   type: string
 *               journal:
 *                 type: string
 *               year:
 *                 type: integer
 *               doi:
 *                 type: string
 *               abstract:
 *                 type: string
 *               keywords:
 *                 type: array
 *                 items:
 *                   type: string
 *               evidenceLevel:
 *                 type: string
 *                 enum: [1a, 1b, 2a, 2b, 3a, 3b, 4, 5]
 *               clinicalRelevance:
 *                 type: string
 *                 enum: [high, medium, low]
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Evidence saved successfully
 *       400:
 *         description: Validation error
 */
router.post('/save', validateEvidenceSave, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    const evidenceData = req.body;
    const userId = req.user.id;

    logger.info(`User ${userId} saving evidence: ${evidenceData.title}`);

    const savedEvidence = await evidenceService.saveEvidence(evidenceData, userId);

    res.status(201).json({
      success: true,
      message: 'Evidence saved successfully',
      evidence: savedEvidence
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/evidence/library:
 *   get:
 *     summary: Get user's evidence library
 *     tags: [Evidence]
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
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [date_added, title, year, evidence_level]
 *         description: Sort field
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: Sort order
 *     responses:
 *       200:
 *         description: User's evidence library
 */
router.get('/library', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, sortBy = 'date_added', order = 'desc' } = req.query;
    const userId = req.user.id;

    const library = await evidenceService.getUserLibrary(userId, {
      page: parseInt(page),
      limit: parseInt(limit),
      sortBy,
      order
    });

    res.json({
      success: true,
      library,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: library.total,
        pages: Math.ceil(library.total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/evidence/{id}:
 *   get:
 *     summary: Get evidence details
 *     tags: [Evidence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Evidence ID
 *     responses:
 *       200:
 *         description: Evidence details
 *       404:
 *         description: Evidence not found
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const evidence = await evidenceService.getEvidenceById(id, userId);

    if (!evidence) {
      throw new AppError('Evidence not found', 404);
    }

    res.json({
      success: true,
      evidence
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/evidence/{id}:
 *   put:
 *     summary: Update evidence
 *     tags: [Evidence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Evidence ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Evidence updated successfully
 *       404:
 *         description: Evidence not found
 */
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const userId = req.user.id;

    const updatedEvidence = await evidenceService.updateEvidence(id, updateData, userId);

    res.json({
      success: true,
      message: 'Evidence updated successfully',
      evidence: updatedEvidence
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/evidence/{id}:
 *   delete:
 *     summary: Delete evidence
 *     tags: [Evidence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Evidence ID
 *     responses:
 *       200:
 *         description: Evidence deleted successfully
 *       404:
 *         description: Evidence not found
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await evidenceService.deleteEvidence(id, userId);

    res.json({
      success: true,
      message: 'Evidence deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
