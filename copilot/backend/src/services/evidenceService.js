import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import { SearchService } from './searchService.js';
import { OpenAI } from '../lib/bedrockOpenAICompat.js';

export class EvidenceService {
  constructor() {
    this.searchService = new SearchService();
    this.openai = new OpenAI({
      region: process.env.AWS_REGION || process.env.BEDROCK_REGION || process.env.BEDROCK_AWS_REGION,
      model: process.env.BEDROCK_MODEL_ID || process.env.BEDROCK_CHAT_MODEL,
      embeddingModel: process.env.BEDROCK_EMBEDDING_MODEL_ID || process.env.BEDROCK_EMBED_MODEL
    });
  }

  /**
   * Search for evidence-based literature
   */
  async searchEvidence(searchParams) {
    try {
      const { query, filters, maxResults, includeAbstracts, sortBy, userId } = searchParams;

      logger.info(`Evidence search initiated: ${query} by user ${userId}`);

      // Perform search across multiple sources
      const searchResults = await this.searchService.multiSourceSearch({
        query,
        sources: ['pubmed', 'cochrane', 'clinicaltrials'],
        filters,
        maxResults,
        includeAbstracts,
        sortBy
      });

      // Enhance results with AI analysis
      const enhancedResults = await this.enhanceResultsWithAI(searchResults, query);

      // Log search activity
      await this.logSearchActivity(userId, query, enhancedResults.length);

      return enhancedResults;
    } catch (error) {
      logger.error(`Evidence search failed: ${error.message}`);
      throw new AppError('Evidence search failed', 500);
    }
  }

  /**
   * Save evidence to user's library
   */
  async saveEvidence(evidenceData, userId) {
    try {
      // Validate evidence data
      const validatedEvidence = await this.validateEvidenceData(evidenceData);

      // Create evidence record
      const evidence = {
        id: this.generateEvidenceId(),
        ...validatedEvidence,
        userId,
        dateAdded: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        metadata: {
          source: 'user_input',
          qualityScore: await this.calculateQualityScore(validatedEvidence),
          clinicalRelevance: validatedEvidence.clinicalRelevance || 'medium'
        }
      };

      // Store in database (placeholder implementation)
      // await this.database.evidence.create(evidence);

      logger.info(`Evidence saved: ${evidence.title} by user ${userId}`);

      return evidence;
    } catch (error) {
      logger.error(`Evidence save failed: ${error.message}`);
      throw new AppError('Failed to save evidence', 500);
    }
  }

  /**
   * Get user's evidence library
   */
  async getUserLibrary(userId, options = {}) {
    try {
      const { page = 1, limit = 20, sortBy = 'date_added', order = 'desc' } = options;

      // Fetch from database (placeholder implementation)
      // const library = await this.database.evidence.findMany({
      //   where: { userId },
      //   orderBy: { [sortBy]: order },
      //   skip: (page - 1) * limit,
      //   take: limit
      // });

      // Placeholder data
      const library = {
        items: [],
        total: 0
      };

      return library;
    } catch (error) {
      logger.error(`Failed to get user library: ${error.message}`);
      throw new AppError('Failed to retrieve evidence library', 500);
    }
  }

  /**
   * Get evidence by ID
   */
  async getEvidenceById(id, userId) {
    void id;
    void userId;

    // Placeholder implementation until persistence is wired in.
    return null;
  }

  /**
   * Update evidence
   */
  async updateEvidence(id, updateData, userId) {
    try {
      // Validate update data
      const validatedData = await this.validateEvidenceData(updateData, true);

      // Update in database (placeholder implementation)
      // const updatedEvidence = await this.database.evidence.update({
      //   where: { id, userId },
      //   data: {
      //     ...validatedData,
      //     lastModified: new Date().toISOString()
      //   }
      // });

      logger.info(`Evidence updated: ${id} by user ${userId}`);

      // Placeholder return
      return { id, ...validatedData, lastModified: new Date().toISOString() };
    } catch (error) {
      logger.error(`Evidence update failed: ${error.message}`);
      throw new AppError('Failed to update evidence', 500);
    }
  }

  /**
   * Delete evidence
   */
  async deleteEvidence(id, userId) {
    try {
      // Delete from database (placeholder implementation)
      // await this.database.evidence.delete({
      //   where: { id, userId }
      // });

      logger.info(`Evidence deleted: ${id} by user ${userId}`);
    } catch (error) {
      logger.error(`Evidence deletion failed: ${error.message}`);
      throw new AppError('Failed to delete evidence', 500);
    }
  }

  /**
   * Enhance search results with AI analysis
   */
  async enhanceResultsWithAI(results, query) {
    try {
      const enhancedResults = [];

      for (const result of results) {
        // Analyze clinical relevance
        const clinicalAnalysis = await this.analyzeClinicalRelevance(result, query);
        
        // Generate summary
        const summary = await this.generateEvidenceSummary(result);
        
        // Calculate evidence level
        const evidenceLevel = await this.calculateEvidenceLevel(result);

        enhancedResults.push({
          ...result,
          aiEnhancement: {
            clinicalRelevance: clinicalAnalysis,
            summary,
            evidenceLevel,
            confidence: this.calculateConfidenceScore(result)
          }
        });
      }

      return enhancedResults;
    } catch (error) {
      logger.warn(`AI enhancement failed: ${error.message}`);
      return results; // Return original results if AI enhancement fails
    }
  }

  /**
   * Analyze clinical relevance using AI
   */
  async analyzeClinicalRelevance(result, query) {
    try {
      const prompt = `Analyze the clinical relevance of this research for oncologists searching for "${query}":
      
      Title: ${result.title}
      Abstract: ${result.abstract || 'N/A'}
      
      Rate the clinical relevance as high, medium, or low and provide a brief explanation.`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0.3
      });

      return response.choices[0].message.content;
    } catch (error) {
      logger.warn(`Clinical relevance analysis failed: ${error.message}`);
      return 'medium';
    }
  }

  /**
   * Generate evidence summary using AI
   */
  async generateEvidenceSummary(result) {
    try {
      const prompt = `Provide a concise, clinical summary of this research for oncologists:
      
      Title: ${result.title}
      Abstract: ${result.abstract || 'N/A'}
      
      Focus on key findings, clinical implications, and limitations. Keep it under 100 words.`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.3
      });

      return response.choices[0].message.content;
    } catch (error) {
      logger.warn(`Summary generation failed: ${error.message}`);
      return result.abstract || 'Summary not available';
    }
  }

  /**
   * Calculate evidence level
   */
  async calculateEvidenceLevel(result) {
    // Simple heuristic-based calculation
    const hasRandomization = result.title?.toLowerCase().includes('randomized') || 
                            result.abstract?.toLowerCase().includes('randomized');
    const hasControl = result.title?.toLowerCase().includes('control') || 
                      result.abstract?.toLowerCase().includes('control');
    const isSystematicReview = result.title?.toLowerCase().includes('systematic review') || 
                              result.abstract?.toLowerCase().includes('systematic review');
    const isMetaAnalysis = result.title?.toLowerCase().includes('meta-analysis') || 
                          result.abstract?.toLowerCase().includes('meta-analysis');

    if (isSystematicReview || isMetaAnalysis) return '1a';
    if (hasRandomization && hasControl) return '1b';
    if (hasControl) return '2b';
    if (hasRandomization) return '2a';
    return '3b';
  }

  /**
   * Calculate quality score
   */
  async calculateQualityScore(evidence) {
    let score = 0;
    
    if (evidence.doi) score += 10;
    if (evidence.abstract) score += 15;
    if (evidence.keywords && evidence.keywords.length > 0) score += 10;
    if (evidence.evidenceLevel) score += 20;
    if (evidence.clinicalRelevance) score += 15;
    if (evidence.notes) score += 10;
    
    return Math.min(score, 100);
  }

  /**
   * Calculate confidence score
   */
  calculateConfidenceScore(result) {
    let confidence = 0.5; // Base confidence
    
    if (result.citations > 100) confidence += 0.3;
    else if (result.citations > 50) confidence += 0.2;
    else if (result.citations > 10) confidence += 0.1;
    
    if (result.impactFactor > 5) confidence += 0.2;
    else if (result.impactFactor > 3) confidence += 0.1;
    
    return Math.min(confidence, 1.0);
  }

  /**
   * Validate evidence data
   */
  async validateEvidenceData(data, isUpdate = false) {
    const requiredFields = isUpdate ? [] : ['title', 'authors', 'journal', 'year'];
    
    for (const field of requiredFields) {
      if (!data[field]) {
        throw new AppError(`Missing required field: ${field}`, 400);
      }
    }

    // Validate year
    if (data.year && (data.year < 1900 || data.year > new Date().getFullYear())) {
      throw new AppError('Invalid year', 400);
    }

    // Validate evidence level
    if (data.evidenceLevel && !['1a', '1b', '2a', '2b', '3a', '3b', '4', '5'].includes(data.evidenceLevel)) {
      throw new AppError('Invalid evidence level', 400);
    }

    return data;
  }

  /**
   * Generate unique evidence ID
   */
  generateEvidenceId() {
    return `ev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Log search activity
   */
  async logSearchActivity(userId, query, resultCount) {
    try {
      // Log to database (placeholder implementation)
      const activity = {
        userId,
        query,
        resultCount,
        timestamp: new Date().toISOString(),
        type: 'evidence_search'
      };

      // await this.database.searchActivity.create(activity);
      logger.info(`Search activity logged: ${query} returned ${resultCount} results`);
    } catch (error) {
      logger.warn(`Failed to log search activity: ${error.message}`);
    }
  }
}

