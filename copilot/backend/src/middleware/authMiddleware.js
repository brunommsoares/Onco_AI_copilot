import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler.js';
import config from '../config/config.js';
import { logger } from '../utils/logger.js';

export const authenticateUser = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Access token required', 401);
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    if (!token) {
      throw new AppError('Access token required', 401);
    }

    if (!config.jwt.secret) {
      throw new AppError('JWT secret is not configured', 500);
    }

    try {
      const decoded = jwt.verify(token, config.jwt.secret);

      req.user = {
        id: decoded.uid,
        email: decoded.email,
        role: decoded.role || 'user',
        permissions: decoded.permissions || []
      };

      logger.info(`User ${req.user.email} authenticated for ${req.method} ${req.originalUrl}`);
      next();
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        throw new AppError('Token expired', 401);
      }

      if (jwtError.name === 'JsonWebTokenError') {
        throw new AppError('Invalid token', 401);
      }

      throw jwtError;
    }
  } catch (error) {
    next(error);
  }
};

export const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(new AppError('Insufficient permissions', 403));
    }

    next();
  };
};

export const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    if (!req.user.permissions.includes(permission)) {
      return next(new AppError('Insufficient permissions', 403));
    }

    next();
  };
};

// Alias for backward compatibility
export const authMiddleware = authenticateUser;
