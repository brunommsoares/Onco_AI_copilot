import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import { OpenAI } from '../lib/bedrockOpenAICompat.js';
import fs from 'fs/promises';
import path from 'path';

export class VectorDatabaseService {
  constructor() {
    this.openai = new OpenAI({
      region: process.env.AWS_REGION || process.env.BEDROCK_REGION || process.env.BEDROCK_AWS_REGION,
      model: process.env.BEDROCK_MODEL_ID || process.env.BEDROCK_CHAT_MODEL,
      embeddingModel: process.env.BEDROCK_EMBEDDING_MODEL_ID || process.env.BEDROCK_EMBED_MODEL
    });
    
    this.embeddingsCache = new Map();
    this.vectorIndex = new Map();
    this.embeddingModel =
      process.env.BEDROCK_EMBEDDING_MODEL_ID ||
      process.env.BEDROCK_EMBED_MODEL ||
      'amazon.titan-embed-text-v1';
    this.embeddingDimensions = parseInt(process.env.BEDROCK_EMBEDDING_DIMENSIONS, 10) || 1536;
  }

  /**
   * Generate embeddings for text
   */
  async generateEmbedding(text) {
    try {
      // Check cache first
      const cacheKey = this.getCacheKey(text);
      if (this.embeddingsCache.has(cacheKey)) {
        return this.embeddingsCache.get(cacheKey);
      }

      const response = await this.openai.embeddings.create({
        model: this.embeddingModel,
        input: text
      });

      const embedding = response.data[0].embedding;
      
      // Cache the embedding
      this.embeddingsCache.set(cacheKey, embedding);
      
      return embedding;
    } catch (error) {
      logger.error(`Embedding generation failed: ${error.message}`);
      throw new AppError('Embedding generation failed', 500);
    }
  }

  /**
   * Generate embeddings for multiple texts
   */
  async generateEmbeddings(texts) {
    try {
      const embeddings = [];
      
      for (const text of texts) {
        const embedding = await this.generateEmbedding(text);
        embeddings.push(embedding);
      }
      
      return embeddings;
    } catch (error) {
      logger.error(`Batch embedding generation failed: ${error.message}`);
      throw new AppError('Batch embedding generation failed', 500);
    }
  }

  /**
   * Store document chunks with embeddings
   */
  async storeDocumentChunks(documentId, chunks, metadata = {}) {
    try {
      logger.info(`Storing ${chunks.length} chunks for document ${documentId}`);
      
      const storedChunks = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkId = `${documentId}_chunk_${i}`;
        
        // Generate embedding for the chunk text
        const embedding = await this.generateEmbedding(chunk.text);
        
        // Create vector entry
        const vectorEntry = {
          id: chunkId,
          documentId,
          chunkIndex: i,
          text: chunk.text,
          embedding,
          metadata: {
            ...chunk,
            ...metadata,
            storedAt: new Date().toISOString()
          }
        };
        
        // Store in vector index
        this.vectorIndex.set(chunkId, vectorEntry);
        storedChunks.push(vectorEntry);
      }
      
      logger.info(`Successfully stored ${storedChunks.length} chunks for document ${documentId}`);
      return storedChunks;
      
    } catch (error) {
      logger.error(`Document storage failed for ${documentId}: ${error.message}`);
      throw new AppError('Document storage failed', 500);
    }
  }

  /**
   * Search for similar chunks using vector similarity
   */
  async searchSimilarChunks(query, options = {}) {
    try {
      const {
        maxResults = 10,
        similarityThreshold = 0.7,
        includeMetadata = true
      } = options;

      logger.info(`Searching for similar chunks to: "${query}"`);
      
      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query);
      
      // Calculate similarities
      const similarities = [];
      
      for (const [chunkId, vectorEntry] of this.vectorIndex) {
        const similarity = this.calculateCosineSimilarity(queryEmbedding, vectorEntry.embedding);
        
        if (similarity >= similarityThreshold) {
          similarities.push({
            chunkId,
            similarity,
            text: vectorEntry.text,
            metadata: includeMetadata ? vectorEntry.metadata : null,
            documentId: vectorEntry.documentId,
            chunkIndex: vectorEntry.chunkIndex
          });
        }
      }
      
      // Sort by similarity and limit results
      const sortedResults = similarities
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, maxResults);
      
      logger.info(`Found ${sortedResults.length} similar chunks`);
      return sortedResults;
      
    } catch (error) {
      logger.error(`Vector search failed: ${error.message}`);
      throw new AppError('Vector search failed', 500);
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  calculateCosineSimilarity(vectorA, vectorB) {
    if (vectorA.length !== vectorB.length) {
      throw new Error('Vectors must have the same length');
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i];
      normA += vectorA[i] * vectorA[i];
      normB += vectorB[i] * vectorB[i];
    }
    
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Get document by ID
   */
  getDocument(documentId) {
    const documentChunks = [];
    
    for (const [chunkId, vectorEntry] of this.vectorIndex) {
      if (vectorEntry.documentId === documentId) {
        documentChunks.push(vectorEntry);
      }
    }
    
    return documentChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
  }

  /**
   * Get chunk by ID
   */
  getChunk(chunkId) {
    return this.vectorIndex.get(chunkId);
  }

  /**
   * Delete document and all its chunks
   */
  deleteDocument(documentId) {
    const chunksToDelete = [];
    
    for (const [chunkId, vectorEntry] of this.vectorIndex) {
      if (vectorEntry.documentId === documentId) {
        chunksToDelete.push(chunkId);
      }
    }
    
    chunksToDelete.forEach(chunkId => {
      this.vectorIndex.delete(chunkId);
    });
    
    logger.info(`Deleted ${chunksToDelete.length} chunks for document ${documentId}`);
    return chunksToDelete.length;
  }

  /**
   * Get database statistics
   */
  getDatabaseStats() {
    const stats = {
      totalChunks: this.vectorIndex.size,
      totalDocuments: new Set(),
      totalEmbeddings: this.embeddingsCache.size,
      averageChunkLength: 0,
      totalTextLength: 0
    };
    
    for (const [chunkId, vectorEntry] of this.vectorIndex) {
      stats.totalDocuments.add(vectorEntry.documentId);
      stats.totalTextLength += vectorEntry.text.length;
    }
    
    stats.totalDocuments = stats.totalDocuments.size;
    stats.averageChunkLength = stats.totalChunks > 0 ? stats.totalTextLength / stats.totalChunks : 0;
    
    return stats;
  }

  /**
   * Export vector database to file
   */
  async exportDatabase(filePath) {
    try {
      const exportData = {
        metadata: {
          exportDate: new Date().toISOString(),
          totalChunks: this.vectorIndex.size,
          embeddingModel: this.embeddingModel,
          embeddingDimensions: this.embeddingDimensions
        },
        vectors: Array.from(this.vectorIndex.entries())
      };
      
      await fs.writeFile(filePath, JSON.stringify(exportData, null, 2));
      logger.info(`Vector database exported to ${filePath}`);
      
      return {
        success: true,
        filePath,
        totalChunks: this.vectorIndex.size
      };
      
    } catch (error) {
      logger.error(`Database export failed: ${error.message}`);
      throw new AppError('Database export failed', 500);
    }
  }

  /**
   * Import vector database from file
   */
  async importDatabase(filePath) {
    try {
      const importData = JSON.parse(await fs.readFile(filePath, 'utf8'));
      
      // Clear existing data
      this.vectorIndex.clear();
      this.embeddingsCache.clear();
      
      // Import vectors
      for (const [chunkId, vectorEntry] of importData.vectors) {
        this.vectorIndex.set(chunkId, vectorEntry);
      }
      
      logger.info(`Vector database imported from ${filePath}`);
      
      return {
        success: true,
        totalChunks: this.vectorIndex.size,
        metadata: importData.metadata
      };
      
    } catch (error) {
      logger.error(`Database import failed: ${error.message}`);
      throw new AppError('Database import failed', 500);
    }
  }

  /**
   * Clear all data
   */
  clearDatabase() {
    this.vectorIndex.clear();
    this.embeddingsCache.clear();
    logger.info('Vector database cleared');
  }

  /**
   * Get cache key for text
   */
  getCacheKey(text) {
    return Buffer.from(text).toString('base64').substring(0, 50);
  }

  /**
   * Search with hybrid approach (vector + keyword)
   */
  async hybridSearch(query, options = {}) {
    try {
      const {
        maxResults = 10,
        vectorWeight = 0.7,
        keywordWeight = 0.3,
        similarityThreshold = 0.6
      } = options;

      // Vector search
      const vectorResults = await this.searchSimilarChunks(query, {
        maxResults: Math.ceil(maxResults * 1.5),
        similarityThreshold
      });

      // Keyword search (simple text matching)
      const keywordResults = this.keywordSearch(query, {
        maxResults: Math.ceil(maxResults * 1.5)
      });

      // Combine and rank results
      const combinedResults = this.combineSearchResults(
        vectorResults,
        keywordResults,
        query,
        { vectorWeight, keywordWeight }
      );

      return combinedResults.slice(0, maxResults);

    } catch (error) {
      logger.error(`Hybrid search failed: ${error.message}`);
      throw new AppError('Hybrid search failed', 500);
    }
  }

  /**
   * Simple keyword search
   */
  keywordSearch(query, options = {}) {
    const { maxResults = 10 } = options;
    const queryLower = query.toLowerCase();
    const results = [];

    for (const [chunkId, vectorEntry] of this.vectorIndex) {
      const textLower = vectorEntry.text.toLowerCase();
      const relevance = this.calculateKeywordRelevance(textLower, queryLower);
      
      if (relevance > 0) {
        results.push({
          chunkId,
          relevance,
          text: vectorEntry.text,
          metadata: vectorEntry.metadata,
          documentId: vectorEntry.documentId,
          chunkIndex: vectorEntry.chunkIndex
        });
      }
    }

    return results
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, maxResults);
  }

  /**
   * Calculate keyword relevance
   */
  calculateKeywordRelevance(text, query) {
    const queryWords = query.split(/\s+/);
    const textWords = text.split(/\s+/);
    
    let score = 0;
    let matches = 0;
    
    for (const queryWord of queryWords) {
      for (const textWord of textWords) {
        if (textWord.includes(queryWord)) {
          score += 1;
          matches++;
        }
      }
    }
    
    return matches > 0 ? score / queryWords.length : 0;
  }

  /**
   * Combine search results from different methods
   */
  combineSearchResults(vectorResults, keywordResults, query, weights) {
    const combinedMap = new Map();
    
    // Add vector results
    vectorResults.forEach(result => {
      combinedMap.set(result.chunkId, {
        ...result,
        vectorScore: result.similarity,
        keywordScore: 0,
        combinedScore: result.similarity * weights.vectorWeight
      });
    });
    
    // Add keyword results
    keywordResults.forEach(result => {
      const existing = combinedMap.get(result.chunkId);
      if (existing) {
        existing.keywordScore = result.relevance;
        existing.combinedScore = (existing.vectorScore * weights.vectorWeight) + 
                               (result.relevance * weights.keywordWeight);
      } else {
        combinedMap.set(result.chunkId, {
          ...result,
          vectorScore: 0,
          keywordScore: result.relevance,
          combinedScore: result.relevance * weights.keywordWeight
        });
      }
    });
    
    return Array.from(combinedMap.values())
      .sort((a, b) => b.combinedScore - a.combinedScore);
  }
}

export default new VectorDatabaseService();

