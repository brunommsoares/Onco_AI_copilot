/**
 * Simple Server for RAG Testing
 * Bypasses PDF processing issues
 */

import express from 'express';
import cors from 'cors';
import simpleRAGService from './src/services/simpleRAGService.js';

const app = express();
const PORT = 3003;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Simple RAG Server is running',
    timestamp: new Date().toISOString()
  });
});

// Initialize RAG system
app.post('/api/rag/initialize', async (req, res) => {
  try {
    console.log('📚 Initializing Simple RAG system...');
    const result = await simpleRAGService.initialize();
    
    res.json({
      success: true,
      message: 'Simple RAG system initialized successfully',
      ...result
    });
  } catch (error) {
    console.error('❌ RAG initialization failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to initialize RAG system'
    });
  }
});

// Search endpoint
app.post('/api/rag/search', async (req, res) => {
  try {
    const { query, maxResults = 5, similarityThreshold = 0.7 } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Query is required and must be a non-empty string'
      });
    }

    console.log(`🔍 Searching for: "${query}"`);
    const result = await simpleRAGService.search(query, { maxResults, similarityThreshold });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('❌ Search failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Search failed'
    });
  }
});

// Generate response endpoint
app.post('/api/rag/generate', async (req, res) => {
  try {
    const { 
      query, 
      maxContextDocs = 3, 
      language = 'pt' 
    } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Query is required and must be a non-empty string'
      });
    }

    console.log(`🤖 Generating response for: "${query}"`);
    const result = await simpleRAGService.generateResponse(query, { 
      maxContextDocs, 
      language 
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('❌ Response generation failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Response generation failed'
    });
  }
});

// Get system status
app.get('/api/rag/status', (req, res) => {
  try {
    const status = simpleRAGService.getStatus();
    res.json({
      success: true,
      status
    });
  } catch (error) {
    console.error('❌ Failed to get status:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`
🚀 Simple RAG Server is running!

🌐 Server: http://localhost:${PORT}
📊 Health: http://localhost:${PORT}/health
📚 API: http://localhost:${PORT}/api/rag

🎯 Available endpoints:
   POST /api/rag/initialize - Initialize RAG system
   POST /api/rag/search - Search documents
   POST /api/rag/generate - Generate AI responses
   GET /api/rag/status - Get system status

💡 This server demonstrates RAG with:
   ✅ Local document storage
   ✅ OpenAI embeddings
   ✅ Semantic search
   ✅ Automatic citations
   ✅ AMA reference formatting
  `);
});

export default app;
