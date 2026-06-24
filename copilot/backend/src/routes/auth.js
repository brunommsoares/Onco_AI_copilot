import express from 'express';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import config from '../config/config.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { firebaseApp } from '../config/firebase.js';

const router = express.Router();

// Validation middleware
const validateLogin = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 })
];

const validateRegister = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('firstName').trim().isLength({ min: 2 }),
  body('lastName').trim().isLength({ min: 2 }),
  body('specialty').optional().trim(),
  body('institution').optional().trim()
];

const issueJwtToken = (payload, expiresIn = config.jwt.expiresIn) => {
  if (!config.jwt.secret) {
    throw new AppError('JWT secret is not configured', 500);
  }

  return jwt.sign(payload, config.jwt.secret, { expiresIn });
};

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: User login
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 user:
 *                   type: object
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', validateLogin, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    const { email, password } = req.body;

    // For development, allow any email/password combination
    // In production, this should use Firebase Auth or another auth service
    if (!firebaseApp) {
      // Development mode - create mock user
      const mockUser = {
        uid: `dev_${Date.now()}`,
        email,
        displayName: email.split('@')[0],
        customClaims: { role: 'user', permissions: ['read:evidence', 'search:evidence'] }
      };

      const token = issueJwtToken({
        uid: mockUser.uid,
        email: mockUser.email,
        role: mockUser.customClaims.role,
        permissions: mockUser.customClaims.permissions
      });

      logger.info(`User ${email} logged in successfully (development mode)`);

      return res.json({
        success: true,
        token,
        user: {
          id: mockUser.uid,
          email: mockUser.email,
          displayName: mockUser.displayName,
          role: mockUser.customClaims.role
        }
      });
    }

    // Production mode - use Firebase Auth
    try {
      const userRecord = await firebaseApp.auth().getUserByEmail(email);
      
      const token = issueJwtToken({
        uid: userRecord.uid,
        email: userRecord.email,
        role: userRecord.customClaims?.role || 'user',
        permissions: userRecord.customClaims?.permissions || []
      });

      logger.info(`User ${email} logged in successfully`);

      res.json({
        success: true,
        token,
        user: {
          id: userRecord.uid,
          email: userRecord.email,
          displayName: userRecord.displayName,
          role: userRecord.customClaims?.role || 'user'
        }
      });
    } catch (firebaseError) {
      if (firebaseError.code === 'auth/user-not-found') {
        next(new AppError('Invalid credentials', 401));
      } else {
        next(firebaseError);
      }
    }
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: User registration
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - firstName
 *               - lastName
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               firstName:
 *                 type: string
 *                 minLength: 2
 *               lastName:
 *                 type: string
 *                 minLength: 2
 *               specialty:
 *                 type: string
 *               institution:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error
 */
router.post('/register', validateRegister, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400);
    }

    const { email, password, firstName, lastName, specialty, institution } = req.body;

    if (!firebaseApp) {
      // Development mode - create mock user
      const mockUser = {
        uid: `dev_${Date.now()}`,
        email,
        displayName: `${firstName} ${lastName}`,
        customClaims: {
          role: 'user',
          permissions: ['read:evidence', 'search:evidence'],
          specialty,
          institution
        }
      };

      const token = issueJwtToken({
        uid: mockUser.uid,
        email: mockUser.email,
        role: 'user',
        permissions: ['read:evidence', 'search:evidence']
      });

      logger.info(`New user registered: ${email} (development mode)`);

      return res.status(201).json({
        success: true,
        message: 'User registered successfully',
        token,
        user: {
          id: mockUser.uid,
          email: mockUser.email,
          displayName: mockUser.displayName,
          role: 'user'
        }
      });
    }

    // Production mode - use Firebase Auth
    try {
      const userRecord = await firebaseApp.auth().createUser({
        email,
        password,
        displayName: `${firstName} ${lastName}`,
        customClaims: {
          role: 'user',
          permissions: ['read:evidence', 'search:evidence'],
          specialty,
          institution
        }
      });

      const token = issueJwtToken({
        uid: userRecord.uid,
        email: userRecord.email,
        role: 'user',
        permissions: ['read:evidence', 'search:evidence']
      });

      logger.info(`New user registered: ${email}`);

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        token,
        user: {
          id: userRecord.uid,
          email: userRecord.email,
          displayName: userRecord.displayName,
          role: 'user'
        }
      });
    } catch (firebaseError) {
      if (firebaseError.code === 'auth/email-already-exists') {
        next(new AppError('Email already registered', 409));
      } else {
        next(firebaseError);
      }
    }
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/auth/verify:
 *   get:
 *     summary: Verify authentication token
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Token is valid
 *       401:
 *         description: Invalid or expired token
 */
router.get('/verify', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Access token required', 401);
    }

    const token = authHeader.substring(7);
    if (!config.jwt.secret) {
      throw new AppError('JWT secret is not configured', 500);
    }

    const decoded = jwt.verify(token, config.jwt.secret);

    res.json({
      success: true,
      user: {
        id: decoded.uid,
        email: decoded.email,
        role: decoded.role,
        permissions: decoded.permissions
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
