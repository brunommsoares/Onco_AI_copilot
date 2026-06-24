import { logger } from '../utils/logger.js';

// Custom error class
export class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Error handling middleware
const errorHandler = (error, req, res, next) => {
  const statusCode = error.statusCode || error.status || 500;

  const logMessage = `[${statusCode}] ${req.method} ${req.path}: ${error.message}`;
  if (statusCode >= 500) {
    logger.error(logMessage);
  } else {
    logger.warn(logMessage);
  }

  res.status(statusCode).json({
    error: error.message || 'Internal Server Error',
    status: statusCode,
    timestamp: new Date().toISOString()
  });
};

const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    message: `The endpoint ${req.method} ${req.path} was not found`,
    timestamp: new Date().toISOString()
  });
};

export { errorHandler, notFoundHandler };
