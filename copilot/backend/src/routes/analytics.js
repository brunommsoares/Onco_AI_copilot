import express from 'express';
import { query, validationResult } from 'express-validator';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { AnalyticsService } from '../services/analyticsService.js';

const router = express.Router();
const analyticsService = new AnalyticsService();

// Validation middleware
const validateAnalyticsQuery = [
  query('period').optional().isIn(['day', 'week', 'month', 'quarter', 'year']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('specialty').optional().trim(),
  query('cancerType').optional().trim()
];

/**
 * @swagger
 * /api/analytics/overview:
 *   get:
 *     summary: Get analytics overview
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [day, week, month, quarter, year]
 *         description: Time period for analytics
 *     responses:
 *       200:
 *         description: Analytics overview data
 */
router.get('/overview', validateAnalyticsQuery, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    const { period = 'month', startDate, endDate, specialty, cancerType } = req.query;
    const userId = req.user.id;

    const overview = await analyticsService.getOverview(userId, {
      period,
      startDate,
      endDate,
      specialty,
      cancerType
    });

    res.json({
      success: true,
      overview,
      metadata: {
        period,
        startDate,
        endDate,
        specialty,
        cancerType
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/analytics/trends:
 *   get:
 *     summary: Get analytics trends
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: metric
 *         required: true
 *         schema:
 *           type: string
 *           enum: [searches, evidence_saved, citations, impact_factor]
 *         description: Metric to analyze
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [week, month, quarter, year]
 *         description: Time period for trends
 *     responses:
 *       200:
 *         description: Trends data
 */
router.get('/trends', [
  query('metric').isIn(['searches', 'evidence_saved', 'citations', 'impact_factor']),
  query('period').optional().isIn(['week', 'month', 'quarter', 'year'])
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    const { metric, period = 'month' } = req.query;
    const userId = req.user.id;

    const trends = await analyticsService.getTrends(userId, metric, period);

    res.json({
      success: true,
      trends,
      metadata: {
        metric,
        period,
        userId
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/analytics/insights:
 *   get:
 *     summary: Get AI-powered insights
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [research_gaps, emerging_trends, collaboration_opportunities, clinical_relevance]
 *         description: Type of insights
 *       - in: query
 *         name: specialty
 *         schema:
 *           type: string
 *         description: Medical specialty filter
 *     responses:
 *       200:
 *         description: AI insights data
 */
router.get('/insights', [
  query('type').optional().isIn(['research_gaps', 'emerging_trends', 'collaboration_opportunities', 'clinical_relevance']),
  query('specialty').optional().trim()
], async (req, res, next) => {
  try {
    const { type = 'general', specialty } = req.query;
    const userId = req.user.id;

    const insights = await analyticsService.getInsights(userId, type, specialty);

    res.json({
      success: true,
      insights,
      metadata: {
        type,
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
 * /api/analytics/performance:
 *   get:
 *     summary: Get performance metrics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [week, month, quarter, year]
 *         description: Time period for performance metrics
 *     responses:
 *       200:
 *         description: Performance metrics data
 */
router.get('/performance', [
  query('period').optional().isIn(['week', 'month', 'quarter', 'year'])
], async (req, res, next) => {
  try {
    const { period = 'month' } = req.query;
    const userId = req.user.id;

    const performance = await analyticsService.getPerformanceMetrics(userId, period);

    res.json({
      success: true,
      performance,
      metadata: {
        period,
        userId
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/analytics/recommendations:
 *   get:
 *     summary: Get personalized recommendations
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [research, clinical, collaboration, learning]
 *         description: Category of recommendations
 *     responses:
 *       200:
 *         description: Personalized recommendations
 */
router.get('/recommendations', [
  query('category').optional().isIn(['research', 'clinical', 'collaboration', 'learning'])
], async (req, res, next) => {
  try {
    const { category = 'general' } = req.query;
    const userId = req.user.id;

    const recommendations = await analyticsService.getRecommendations(userId, category);

    res.json({
      success: true,
      recommendations,
      metadata: {
        category,
        userId,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
