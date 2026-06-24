import express from 'express';
import { body, validationResult } from 'express-validator';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { UserService } from '../services/userService.js';

const router = express.Router();
const userService = new UserService();

// Validation middleware
const validateProfileUpdate = [
  body('firstName').optional().trim().isLength({ min: 2, max: 50 }),
  body('lastName').optional().trim().isLength({ min: 2, max: 50 }),
  body('specialty').optional().trim().isLength({ max: 100 }),
  body('institution').optional().trim().isLength({ max: 200 }),
  body('bio').optional().trim().isLength({ max: 1000 }),
  body('preferences').optional().isObject()
];

/**
 * @swagger
 * /api/user/profile:
 *   get:
 *     summary: Get user profile
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile data
 */
router.get('/profile', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const profile = await userService.getUserProfile(userId);

    res.json({
      success: true,
      profile
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/user/profile:
 *   put:
 *     summary: Update user profile
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               specialty:
 *                 type: string
 *               institution:
 *                 type: string
 *               bio:
 *                 type: string
 *               preferences:
 *                 type: object
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       400:
 *         description: Validation error
 */
router.put('/profile', validateProfileUpdate, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    const updateData = req.body;
    const userId = req.user.id;

    logger.info(`User ${userId} updating profile`);

    const updatedProfile = await userService.updateUserProfile(userId, updateData);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      profile: updatedProfile
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/user/preferences:
 *   get:
 *     summary: Get user preferences
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User preferences
 */
router.get('/preferences', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const preferences = await userService.getUserPreferences(userId);

    res.json({
      success: true,
      preferences
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/user/preferences:
 *   put:
 *     summary: Update user preferences
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Preferences updated successfully
 */
router.put('/preferences', async (req, res, next) => {
  try {
    const preferences = req.body;
    const userId = req.user.id;

    const updatedPreferences = await userService.updateUserPreferences(userId, preferences);

    res.json({
      success: true,
      message: 'Preferences updated successfully',
      preferences: updatedPreferences
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/user/activity:
 *   get:
 *     summary: Get user activity summary
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [week, month, quarter, year]
 *         description: Time period for activity
 *     responses:
 *       200:
 *         description: User activity data
 */
router.get('/activity', async (req, res, next) => {
  try {
    const { period = 'month' } = req.query;
    const userId = req.user.id;

    const activity = await userService.getUserActivity(userId, period);

    res.json({
      success: true,
      activity,
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
 * /api/user/export:
 *   post:
 *     summary: Export user data
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               format:
 *                 type: string
 *                 enum: [json, csv, pdf]
 *               includeData:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [profile, evidence, searches, activity]
 *     responses:
 *       200:
 *         description: Data export successful
 */
router.post('/export', [
  body('format').isIn(['json', 'csv', 'pdf']),
  body('includeData').isArray()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    const { format, includeData } = req.body;
    const userId = req.user.id;

    logger.info(`User ${userId} exporting data in ${format} format`);

    const exportData = await userService.exportUserData(userId, format, includeData);

    res.json({
      success: true,
      message: 'Data export successful',
      export: exportData
    });
  } catch (error) {
    next(error);
  }
});

export default router;
