import app from './app.js';
import config from './config/config.js';
import { firebaseApp } from './config/firebase.js';
import trialRegistryService from './services/trialRegistryService.js';
import infarmedReimbursementService from './services/infarmedReimbursementService.js';
import emaService from './services/emaService.js';
import esmoGuidelinesService from './services/esmoGuidelinesService.js';
import { logger } from './utils/logger.js';

const PORT = config.server.port;

const registerGracefulShutdown = (server) => {
  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down gracefully`);
    trialRegistryService.stop();
    infarmedReimbursementService.stop();
    emaService.stop();
    esmoGuidelinesService.stop();

    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

const handleStartupError = (error) => {
  if (error?.code === 'EADDRINUSE') {
    logger.error(
      `Port ${PORT} is already in use. Reuse the running backend on http://localhost:${PORT} or stop the other process before retrying.`
    );
  } else {
    logger.error(`Server failed to start on port ${PORT}: ${error.message}`);
  }

  process.exit(1);
};

const server = app.listen(PORT);

server.once('error', handleStartupError);

server.once('listening', () => {
  logger.info(`Oncology Evidence Platform server running on port ${PORT}`);
  logger.info(`API documentation available at http://localhost:${PORT}/api-docs`);
  logger.info(`Health check available at http://localhost:${PORT}/health`);

  if (firebaseApp) {
    logger.info('Firebase Admin SDK initialized successfully');
  } else {
    logger.warn('Firebase Admin SDK not initialized; authentication features will be limited');
  }

  trialRegistryService.start().catch((error) => {
    logger.warn(`Trial registry startup skipped: ${error.message}`);
  });

  infarmedReimbursementService.start().catch((error) => {
    logger.warn(`INFARMED reimbursement startup skipped: ${error.message}`);
  });

  emaService.start().catch((error) => {
    logger.warn(`EMA service startup skipped: ${error.message}`);
  });

  esmoGuidelinesService.start().catch((error) => {
    logger.warn(`ESMO guidelines service startup skipped: ${error.message}`);
  });
});

registerGracefulShutdown(server);

export { app, server };
export default server;
