import express from 'express';
import { body, validationResult } from 'express-validator';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { requirePermission } from '../middleware/authMiddleware.js';
import { SciFactTestService } from '../services/scifactTestService.js';

const router = express.Router();
const scifactTestService = new SciFactTestService();

// Middleware de validação
const validateTestRequest = [
  body('testType').isIn(['single', 'complete', 'category']),
  body('questionId').optional().isInt({ min: 1, max: 148 }),
  body('category').optional().isString(),
  body('enableTestMode').optional().isBoolean()
];

/**
 * @swagger
 * /api/test/scifact/enable:
 *   post:
 *     summary: Enable SciFact test mode
 *     tags: [SciFact Test]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Test mode enabled successfully
 *       401:
 *         description: Unauthorized
 */
router.post('/enable', requirePermission('admin'), async (req, res) => {
  try {
    scifactTestService.enableTestMode();
    
    logger.info(`SciFact test mode enabled by user: ${req.user.email}`);
    
    res.json({
      success: true,
      message: 'SciFact test mode enabled',
      testMode: true,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error enabling test mode: ${error.message}`);
    throw new AppError('Failed to enable test mode', 500);
  }
});

/**
 * @swagger
 * /api/test/scifact/disable:
 *   post:
 *     summary: Disable SciFact test mode
 *     tags: [SciFact Test]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Test mode disabled successfully
 *       401:
 *         description: Unauthorized
 */
router.post('/disable', requirePermission('admin'), async (req, res) => {
  try {
    scifactTestService.disableTestMode();
    
    logger.info(`SciFact test mode disabled by user: ${req.user.email}`);
    
    res.json({
      success: true,
      message: 'SciFact test mode disabled',
      testMode: false,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error disabling test mode: ${error.message}`);
    throw new AppError('Failed to disable test mode', 500);
  }
});

/**
 * @swagger
 * /api/test/scifact/status:
 *   get:
 *     summary: Get SciFact test mode status
 *     tags: [SciFact Test]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Test mode status
 */
router.get('/status', requirePermission('admin'), async (req, res) => {
  try {
    const report = scifactTestService.getDetailedReport();
    
    res.json({
      testMode: report.testMode,
      totalQuestions: report.totalQuestions,
      hasResults: report.testResults.length > 0,
      lastTest: report.testResults.length > 0 ? report.testResults[report.testResults.length - 1].timestamp : null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error getting test status: ${error.message}`);
    throw new AppError('Failed to get test status', 500);
  }
});

/**
 * @swagger
 * /api/test/scifact/run-complete:
 *   post:
 *     summary: Run complete oncology test with all 148 SciFact questions
 *     tags: [SciFact Test]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Complete test results
 *       400:
 *         description: Test mode not enabled
 *       401:
 *         description: Unauthorized
 */
router.post('/run-complete', requirePermission('admin'), async (req, res) => {
  try {
    if (!scifactTestService.testMode) {
      return res.status(400).json({
        error: 'Test mode is not enabled',
        message: 'Please enable test mode before running tests',
        code: 'TEST_MODE_DISABLED'
      });
    }

    logger.info(`Starting complete SciFact test by user: ${req.user.email}`);
    
    const results = await scifactTestService.runCompleteOncologyTest();
    
    logger.info(`Complete SciFact test completed by user: ${req.user.email}. Results: ${results.successfulTests}/${results.totalQuestions} successful`);
    
    res.json({
      success: true,
      message: 'Complete oncology test completed',
      results: results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error running complete test: ${error.message}`);
    throw new AppError('Failed to run complete test', 500);
  }
});

/**
 * @swagger
 * /api/test/scifact/run-single:
 *   post:
 *     summary: Run test for a single question
 *     tags: [SciFact Test]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - questionId
 *             properties:
 *               questionId:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 148
 *     responses:
 *       200:
 *         description: Single test result
 *       400:
 *         description: Invalid question ID or test mode not enabled
 *       401:
 *         description: Unauthorized
 */
router.post('/run-single', requirePermission('admin'), validateTestRequest, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { questionId } = req.body;

    if (!scifactTestService.testMode) {
      return res.status(400).json({
        error: 'Test mode is not enabled',
        message: 'Please enable test mode before running tests',
        code: 'TEST_MODE_DISABLED'
      });
    }

    // Encontrar a pergunta pelo ID
    const question = scifactTestService.oncologyQuestions.find(q => q.id === questionId);
    if (!question) {
      return res.status(400).json({
        error: 'Question not found',
        message: `Question with ID ${questionId} not found`,
        code: 'QUESTION_NOT_FOUND'
      });
    }

    logger.info(`Running single SciFact test for question ${questionId} by user: ${req.user.email}`);
    
    const result = await scifactTestService.testSingleQuestion(question);
    
    logger.info(`Single SciFact test completed for question ${questionId} by user: ${req.user.email}`);
    
    res.json({
      success: true,
      message: 'Single test completed',
      result: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error running single test: ${error.message}`);
    throw new AppError('Failed to run single test', 500);
  }
});

/**
 * @swagger
 * /api/test/scifact/run-category:
 *   post:
 *     summary: Run test for questions in a specific category
 *     tags: [SciFact Test]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - category
 *             properties:
 *               category:
 *                 type: string
 *                 enum: [immunotherapy, chemotherapy, targeted_therapy, neoadjuvant, radiotherapy, adjuvant_therapy, high_dose_chemotherapy]
 *     responses:
 *       200:
 *         description: Category test results
 *       400:
 *         description: Invalid category or test mode not enabled
 *       401:
 *         description: Unauthorized
 */
router.post('/run-category', requirePermission('admin'), validateTestRequest, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { category } = req.body;

    if (!scifactTestService.testMode) {
      return res.status(400).json({
        error: 'Test mode is not enabled',
        message: 'Please enable test mode before running tests',
        code: 'TEST_MODE_DISABLED'
      });
    }

    // Filtrar perguntas por categoria
    const categoryQuestions = scifactTestService.oncologyQuestions.filter(q => q.category === category);
    if (categoryQuestions.length === 0) {
      return res.status(400).json({
        error: 'No questions found',
        message: `No questions found for category: ${category}`,
        code: 'CATEGORY_NOT_FOUND'
      });
    }

    logger.info(`Running category SciFact test for ${category} (${categoryQuestions.length} questions) by user: ${req.user.email}`);
    
    const results = [];
    for (const question of categoryQuestions) {
      const result = await scifactTestService.testSingleQuestion(question);
      results.push(result);
      await scifactTestService.delay(100); // Pequena pausa entre testes
    }
    
    const summary = scifactTestService.generateTestSummary(results);
    
    logger.info(`Category SciFact test completed for ${category} by user: ${req.user.email}. Results: ${summary.successfulTests}/${summary.totalTests} successful`);
    
    res.json({
      success: true,
      message: `Category test completed for ${category}`,
      category: category,
      results: results,
      summary: summary,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error running category test: ${error.message}`);
    throw new AppError('Failed to run category test', 500);
  }
});

/**
 * @swagger
 * /api/test/scifact/results:
 *   get:
 *     summary: Get detailed test results and report
 *     tags: [SciFact Test]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Detailed test results
 *       401:
 *         description: Unauthorized
 */
router.get('/results', requirePermission('admin'), async (req, res) => {
  try {
    const report = scifactTestService.getDetailedReport();
    
    res.json({
      success: true,
      report: report,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error getting test results: ${error.message}`);
    throw new AppError('Failed to get test results', 500);
  }
});

/**
 * @swagger
 * /api/test/scifact/clear:
 *   post:
 *     summary: Clear all test results
 *     tags: [SciFact Test]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Test results cleared successfully
 *       401:
 *         description: Unauthorized
 */
router.post('/clear', requirePermission('admin'), async (req, res) => {
  try {
    scifactTestService.clearTestResults();
    
    logger.info(`SciFact test results cleared by user: ${req.user.email}`);
    
    res.json({
      success: true,
      message: 'Test results cleared successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error clearing test results: ${error.message}`);
    throw new AppError('Failed to clear test results', 500);
  }
});

/**
 * @swagger
 * /api/test/scifact/questions:
 *   get:
 *     summary: Get list of available test questions
 *     tags: [SciFact Test]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of test questions
 *       401:
 *         description: Unauthorized
 */
router.get('/questions', requirePermission('admin'), async (req, res) => {
  try {
    const questions = scifactTestService.oncologyQuestions.map(q => ({
      id: q.id,
      claim: q.claim,
      category: q.category,
      subcategory: q.subcategory,
      expectedLabel: q.expectedLabel,
      confidence: q.confidence
    }));
    
    res.json({
      success: true,
      questions: questions,
      total: questions.length,
      categories: [...new Set(questions.map(q => q.category))],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error getting questions: ${error.message}`);
    throw new AppError('Failed to get questions', 500);
  }
});

export default router;
