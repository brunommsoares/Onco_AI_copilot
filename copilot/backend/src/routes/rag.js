import express from 'express';
import { authenticateUser } from '../middleware/authMiddleware.js';
import { logger } from '../utils/logger.js';
import ragService from '../services/ragService.js';
import pdfProcessingService from '../services/pdfProcessingService.js';
import vectorDatabaseService from '../services/vectorDatabaseService.js';

const router = express.Router();
const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_CHUNK_OVERLAP = 100;

/**
 * Initialize RAG system with PDF documents
 */
router.post('/initialize', authenticateUser, async (req, res) => {
  try {
    const {
      maxFiles = null,
      chunkSize = DEFAULT_CHUNK_SIZE,
      overlap = DEFAULT_CHUNK_OVERLAP,
      forceReprocess = false,
      source = 'breast',
      directory = null,
      enableOcr,
      ocrMaxPages,
      ocrScale,
      ocrLanguage,
      ocrEngine
    } = req.body;

    logger.info(`RAG initialization requested by user ${req.user.email}`);

    const result = await ragService.initialize({
      maxFiles,
      chunkSize,
      overlap,
      forceReprocess,
      source,
      directory,
      enableOcr,
      ocrMaxPages,
      ocrScale,
      ocrLanguage,
      ocrEngine
    });

    res.json({
      success: true,
      message: 'RAG system initialized successfully',
      ...result
    });

  } catch (error) {
    logger.error(`RAG initialization failed: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to initialize RAG system'
    });
  }
});

/**
 * Get RAG system status
 */
router.get('/status', authenticateUser, async (req, res) => {
  try {
    const status = ragService.getStatus();
    
    res.json({
      success: true,
      status
    });

  } catch (error) {
    logger.error(`Failed to get RAG status: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Search using RAG
 */
router.post('/search', authenticateUser, async (req, res) => {
  try {
    const {
      query,
      maxResults = 10,
      includeReferences = true,
      similarityThreshold = 0.7,
      useHybridSearch = true,
      sourceFilter = null
    } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Query is required and must be a non-empty string'
      });
    }

    logger.info(`RAG search requested by user ${req.user.email}: "${query}"`);

    const result = await ragService.search(query, {
      maxResults,
      includeReferences,
      similarityThreshold,
      useHybridSearch,
      sourceFilter
    });

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error(`RAG search failed: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'RAG search failed'
    });
  }
});

/**
 * Generate response using RAG
 */
router.post('/generate', authenticateUser, async (req, res) => {
  try {
    const {
      query,
      maxContextChunks = 5,
      includeReferences = true,
      language = 'pt',
      responseStyle = 'professional'
    } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Query is required and must be a non-empty string'
      });
    }

    logger.info(`RAG response generation requested by user ${req.user.email}: "${query}"`);

    const result = await ragService.generateResponse(query, {
      maxContextChunks,
      includeReferences,
      language,
      responseStyle
    });

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error(`RAG response generation failed: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'RAG response generation failed'
    });
  }
});

/**
 * Process PDF documents
 */
router.post('/process-pdfs', authenticateUser, async (req, res) => {
  try {
    const {
      maxFiles = null,
      chunkSize = DEFAULT_CHUNK_SIZE,
      overlap = DEFAULT_CHUNK_OVERLAP,
      includeMetadata = true,
      source = 'breast',
      directory = null,
      enableOcr,
      ocrMaxPages,
      ocrScale,
      ocrLanguage,
      ocrEngine
    } = req.body;

    logger.info(`PDF processing requested by user ${req.user.email}`);

    let result;
    if (directory) {
      result = await pdfProcessingService.processPDFsInDirectory(directory, {
        maxFiles,
        chunkSize,
        overlap,
        includeMetadata,
        sourceLabel: directory,
        enableOcr,
        ocrMaxPages,
        ocrScale,
        ocrLanguage,
        ocrEngine
      });
    } else if (source === 'asco_sep') {
      const ascoEnableOcr = enableOcr ?? false;
      result = await pdfProcessingService.processAscoSepPDFs({
        maxFiles,
        chunkSize,
        overlap,
        includeMetadata,
        enableOcr: ascoEnableOcr,
        ocrMaxPages,
        ocrScale,
        ocrLanguage,
        ocrEngine
      });
    } else if (source === 'curia_materials') {
      const curiaEnableOcr = enableOcr ?? true;
      result = await pdfProcessingService.processCuriaMaterialsPDFs({
        maxFiles,
        chunkSize,
        overlap,
        includeMetadata,
        enableOcr: curiaEnableOcr,
        ocrMaxPages,
        ocrScale,
        ocrLanguage,
        ocrEngine
      });
    } else {
      result = await pdfProcessingService.processBreastCancerPDFs({
        maxFiles,
        chunkSize,
        overlap,
        includeMetadata,
        enableOcr,
        ocrMaxPages,
        ocrScale,
        ocrLanguage,
        ocrEngine
      });
    }

    res.json({
      success: true,
      message: 'PDF processing completed',
      ...result
    });

  } catch (error) {
    logger.error(`PDF processing failed: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'PDF processing failed'
    });
  }
});

/**
 * Get processed PDF files list
 */
router.get('/pdfs', authenticateUser, async (req, res) => {
  try {
    const files = pdfProcessingService.getProcessedFilesList();
    const stats = pdfProcessingService.getProcessingStats();

    res.json({
      success: true,
      files,
      stats
    });

  } catch (error) {
    logger.error(`Failed to get PDF files: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Search within PDFs
 */
router.post('/search-pdfs', authenticateUser, async (req, res) => {
  try {
    const {
      query,
      maxResults = 10,
      includeContext = true,
      contextLength = 200
    } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Query is required and must be a non-empty string'
      });
    }

    logger.info(`PDF search requested by user ${req.user.email}: "${query}"`);

    const result = await pdfProcessingService.searchInPDFs(query, {
      maxResults,
      includeContext,
      contextLength
    });

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error(`PDF search failed: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'PDF search failed'
    });
  }
});

/**
 * Search with references
 */
router.post('/search-with-references', authenticateUser, async (req, res) => {
  try {
    const {
      query,
      maxResults = 10,
      includeContext = true,
      contextLength = 200
    } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Query is required and must be a non-empty string'
      });
    }

    logger.info(`PDF search with references requested by user ${req.user.email}: "${query}"`);

    const result = await pdfProcessingService.searchWithReferences(query, {
      maxResults,
      includeContext,
      contextLength
    });

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error(`PDF search with references failed: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'PDF search with references failed'
    });
  }
});

/**
 * Get vector database statistics
 */
router.get('/vector-stats', authenticateUser, async (req, res) => {
  try {
    const stats = vectorDatabaseService.getDatabaseStats();

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    logger.error(`Failed to get vector stats: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Clear RAG system
 */
router.delete('/clear', authenticateUser, async (req, res) => {
  try {
    ragService.clearSystem();

    res.json({
      success: true,
      message: 'RAG system cleared successfully'
    });

  } catch (error) {
    logger.error(`Failed to clear RAG system: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Export vector database
 */
router.post('/export', authenticateUser, async (req, res) => {
  try {
    const { filePath = './vector_database_export.json' } = req.body;

    const result = await vectorDatabaseService.exportDatabase(filePath);

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error(`Vector database export failed: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Vector database export failed'
    });
  }
});

/**
 * Import vector database
 */
router.post('/import', authenticateUser, async (req, res) => {
  try {
    const { filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: 'File path is required'
      });
    }

    const result = await vectorDatabaseService.importDatabase(filePath);

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error(`Vector database import failed: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Vector database import failed'
    });
  }
});

export default router;
