import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { fileURLToPath } from 'url';
import path from 'path';

import config from './config/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { buildCorsOptions } from './config/runtimeEnv.js';
import { logger } from './utils/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { authMiddleware } from './middleware/authMiddleware.js';
import { firebaseApp } from './config/firebase.js';

import authRoutes from './routes/auth.js';
import evidenceRoutes from './routes/evidence.js';
import searchRoutes from './routes/search.js';
import userRoutes from './routes/user.js';
import analyticsRoutes from './routes/analytics.js';
import simpleChatRoutes from './routes/simpleChat.js';
import trialRegistryRoutes from './routes/trialRegistry.js';
import infarmedReimbursementRoutes from './routes/infarmedReimbursement.js';
import emaRoutes from './routes/ema.js';
import esmoGuidelinesRoutes from './routes/esmoGuidelines.js';

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'https:'],
      connectSrc: ["'self'", 'https:'],
    },
  },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
}));

app.use(cors({
  ...buildCorsOptions(config.security.corsOrigins),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.server.environment === 'production' ? config.rateLimit.max : config.rateLimit.max * 5,
  message: {
    error: config.rateLimit.message,
    retryAfter: Math.floor(config.rateLimit.windowMs / (1000 * 60))
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression({
  filter: (req, res) => {
    // Never compress SSE streams — compression buffers the entire response,
    // which kills token-by-token streaming from the LLM.
    // Check both the Accept header (set before response) and Content-Type (set during response).
    if (req.headers.accept === 'text/event-stream') return false;
    if (req.path.includes('/stream')) return false;
    const ct = res.getHeader('Content-Type');
    if (ct && String(ct).includes('text/event-stream')) return false;
    return compression.filter(req, res);
  }
}));
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

app.get('/health', (req, res) => {
  const ready = config.runtimeDiagnostics.missingEnvVars.length === 0;

  res.status(ready ? 200 : 503).json({
    status: ready ? 'OK' : 'DEGRADED',
    ready,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.server.environment,
    version: '2.0.0',
    deploymentRegion: config.deployment?.region || 'us-east-1',
    warnings: config.runtimeDiagnostics.warnings,
    missingEnvVars: config.runtimeDiagnostics.missingEnvVars,
    services: {
      firebase: !!firebaseApp
    }
  });
});

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Oncology Evidence Platform API',
      version: '2.0.0',
      description: 'Professional oncology evidence synthesis and clinical decision support platform',
      contact: {
        name: 'Oncology Evidence Platform Team',
        email: 'support@oncology-evidence.com'
      }
    },
    servers: [
      {
        url: `http://localhost:${config.server.port}`,
        description: 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    }
  },
  apis: ['./src/routes/*.js']
};

const specs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

app.use('/api/auth', authRoutes);
app.use('/api/evidence', authMiddleware, evidenceRoutes);
app.use('/api/search', authMiddleware, searchRoutes);
app.use('/api/user', authMiddleware, userRoutes);
app.use('/api/analytics', authMiddleware, analyticsRoutes);
app.use('/api/simple-chat', simpleChatRoutes);
// Legacy alias — redirect /api/chat to /api/simple-chat
app.use('/api/chat', (req, res, next) => {
  req.url = req.url; // preserve URL
  simpleChatRoutes(req, res, next);
});
app.use('/api/trial-registry', trialRegistryRoutes);
app.use('/api/infarmed-reimbursement', infarmedReimbursementRoutes);
app.use('/api/ema', emaRoutes);
app.use('/api/esmo-guidelines', esmoGuidelinesRoutes);

// Production: serve built React frontend as static files
if (config.server.environment === 'production') {
  const frontendPath = path.join(__dirname, '..', 'public');
  app.use(express.static(frontendPath));
  // SPA catch-all — serve index.html for any non-API route
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/health') || req.path.startsWith('/api-docs')) {
      return next();
    }
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
