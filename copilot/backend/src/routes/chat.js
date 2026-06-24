import express from 'express';
import { body, validationResult } from 'express-validator';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import chatService from '../services/chatService.js';

const router = express.Router();

// Validation middleware
const validateChatMessage = [
  body('prompt').trim().isLength({ min: 1, max: 2000 }).withMessage('Prompt deve ter entre 1 e 2000 caracteres'),
  body('context').optional().isObject().withMessage('Context deve ser um objeto válido'),
  body('context.specialty').optional().isString().trim(),
  body('context.institution').optional().isString().trim(),
  body('context.experienceLevel').optional().isString().trim()
];

/**
 * @swagger
 * /api/chat:
 *   post:
 *     summary: Send a chat message and get AI response
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - prompt
 *             properties:
 *               prompt:
 *                 type: string
 *                 description: User's question or message
 *                 minLength: 1
 *                 maxLength: 2000
 *               context:
 *                 type: object
 *                 properties:
 *                   specialty:
 *                     type: string
 *                     description: User's medical specialty
 *                   institution:
 *                     type: string
 *                     description: User's institution
 *                   experienceLevel:
 *                     type: string
 *                     description: User's experience level
 *     responses:
 *       200:
 *         description: AI response generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 answer:
 *                   type: string
 *                   description: AI-generated response
 *                 sources:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Recommended sources for further reading
 *                 confidence:
 *                   type: number
 *                   minimum: 0
 *                   maximum: 1
 *                   description: Confidence level of the response
 *                 clinicalRelevance:
 *                   type: string
 *                   enum: [high, medium, low]
 *                   description: Clinical relevance of the response
 *                 requiresMedicalReview:
 *                   type: boolean
 *                   description: Whether the question requires medical review
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/', validateChatMessage, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    const { prompt, context = {} } = req.body;
    const userId = req.user?.id || 'anonymous';

    logger.info(`Chat request from user ${userId}: ${prompt.substring(0, 100)}...`);

    // Generate AI response
    const response = await chatService.generateResponse(prompt, context);

    // Save chat message (optional)
    try {
      await chatService.saveChatMessage(userId, prompt, response.answer, {
        confidence: response.confidence,
        clinicalRelevance: response.clinicalRelevance,
        requiresMedicalReview: response.requiresMedicalReview,
        timestamp: new Date().toISOString()
      });
    } catch (saveError) {
      logger.warn(`Failed to save chat message: ${saveError.message}`);
    }

    logger.info(`Chat response generated for user ${userId} with confidence: ${response.confidence}`);

    res.json({
      success: true,
      ...response
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/chat/history:
 *   get:
 *     summary: Get user's chat history
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Maximum number of messages to return
 *     responses:
 *       200:
 *         description: Chat history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 messages:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       question:
 *                         type: string
 *                       answer:
 *                         type: string
 *                       timestamp:
 *                         type: string
 *                       confidence:
 *                         type: number
 *       401:
 *         description: Unauthorized
 */
router.get('/history', async (req, res, next) => {
  try {
    const userId = req.user?.uid || req.user?.id || 'anonymous';
    const limit = parseInt(req.query.limit) || 50;

    logger.info(`Fetching chat history for user ${userId}, limit: ${limit}`);

    const messages = await chatService.getChatHistory(userId, limit);

    res.json({
      success: true,
      messages
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/chat/suggestions:
 *   get:
 *     summary: Get chat suggestions based on user context
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: specialty
 *         schema:
 *           type: string
 *         description: User's medical specialty
 *     responses:
 *       200:
 *         description: Suggestions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 suggestions:
 *                   type: array
 *                   items:
 *                     type: string
 *       401:
 *         description: Unauthorized
 */
router.get('/suggestions', async (req, res, next) => {
  try {
    const userId = req.user?.id || 'anonymous';
    const { specialty } = req.query;

    logger.info(`Fetching chat suggestions for user ${userId}, specialty: ${specialty || 'none'}`);

    const suggestions = await chatService.getChatSuggestions(userId, specialty);

    res.json({
      success: true,
      suggestions
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/chat:
 *   head:
 *     summary: Health check for chat service root endpoint
 *     tags: [Chat]
 *     responses:
 *       200:
 *         description: Chat service is healthy
 *       500:
 *         description: Chat service is unhealthy
 */
router.head('/', (req, res) => {
  try {
    // Basic health check
    const isHealthy = chatService.openai !== null;
    
    if (isHealthy) {
      res.status(200).end();
    } else {
      res.status(500).end();
    }
  } catch (error) {
    logger.error(`Chat health check failed: ${error.message}`);
    res.status(500).end();
  }
});

/**
 * @swagger
 * /api/chat/health:
 *   head:
 *     summary: Health check for chat service
 *     tags: [Chat]
 *     responses:
 *       200:
 *         description: Chat service is healthy
 *       500:
 *         description: Chat service is unhealthy
 */
router.head('/health', (req, res) => {
  try {
    // Basic health check
    const isHealthy = chatService.openai !== null;
    
    if (isHealthy) {
      res.status(200).end();
    } else {
      res.status(500).end();
    }
  } catch (error) {
    logger.error(`Chat health check failed: ${error.message}`);
    res.status(500).end();
    }
  });

export default router;
