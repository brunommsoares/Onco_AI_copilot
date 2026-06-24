import express from 'express';
import cors from 'cors';
import { logger } from './utils/logger.js';
import simpleChatRoutes from './routes/simpleChat.js';
import config from './config/config.js';

const app = express();

// Basic middleware
app.use(cors({
  origin: '*', // Allow all origins for simplicity
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Simple Oncology Chat API'
  });
});

// API routes
app.use('/api/chat', simpleChatRoutes);
app.use('/api/simple-chat', simpleChatRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error(`Error: ${err.message}`);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

const PORT = config.server?.port || process.env.PORT || 3002;

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 Simple Oncology Chat API running on port ${PORT}`);
  logger.info(`📝 Health check: http://localhost:${PORT}/health`);
  logger.info(`💬 Chat endpoint: http://localhost:${PORT}/api/chat`);
});

export default app;
