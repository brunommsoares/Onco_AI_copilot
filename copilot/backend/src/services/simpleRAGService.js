/**
 * Simple RAG Service - No PDF processing for now
 * This demonstrates the RAG concept with mock data
 */

import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import referenceService from './referenceService.js';
import { OpenAI } from '../lib/bedrockOpenAICompat.js';

export class SimpleRAGService {
  constructor() {
    this.openai = new OpenAI({
      region: process.env.AWS_REGION || process.env.BEDROCK_REGION || process.env.BEDROCK_AWS_REGION,
      model: process.env.BEDROCK_MODEL_ID || process.env.BEDROCK_CHAT_MODEL,
      embeddingModel: process.env.BEDROCK_EMBEDDING_MODEL_ID || process.env.BEDROCK_EMBED_MODEL
    });
    
    this.isInitialized = false;
    this.documents = new Map();
    this.embeddings = new Map();
  }

  /**
   * Initialize with mock breast cancer documents
   */
  async initialize() {
    try {
      logger.info('Initializing Simple RAG Service with mock data...');

      // Mock breast cancer documents with proper citations
      const mockDocuments = [
        {
          id: 'doc_1',
          title: 'Immunotherapy in Triple-Negative Breast Cancer',
          authors: ['Smith, J', 'Johnson, A', 'Brown, M'],
          journal: 'Journal of Clinical Oncology',
          year: 2023,
          doi: '10.1200/JCO.2023.41.15.1234',
          content: 'Immunotherapy has shown remarkable efficacy in triple-negative breast cancer, with response rates reaching 85% in recent clinical trials. The combination of pembrolizumab with chemotherapy has become the standard of care for PD-L1 positive patients.',
          keywords: ['immunotherapy', 'triple-negative', 'breast cancer', 'pembrolizumab']
        },
        {
          id: 'doc_2',
          title: 'CDK4/6 Inhibitors in Hormone Receptor Positive Breast Cancer',
          authors: ['Wilson, K', 'Davis, L'],
          journal: 'The Lancet Oncology',
          year: 2023,
          doi: '10.1016/S1470-2045(23)00123-4',
          content: 'CDK4/6 inhibitors such as palbociclib, ribociclib, and abemaciclib have revolutionized the treatment of hormone receptor-positive breast cancer. These agents significantly improve progression-free survival when combined with endocrine therapy.',
          keywords: ['CDK4/6 inhibitors', 'hormone receptor positive', 'palbociclib', 'endocrine therapy']
        },
        {
          id: 'doc_3',
          title: 'Liquid Biopsy in Breast Cancer Management',
          authors: ['Garcia, M', 'Lee, S', 'Chen, W'],
          journal: 'Nature Reviews Clinical Oncology',
          year: 2023,
          doi: '10.1038/s41571-023-00789-2',
          content: 'Liquid biopsy techniques, particularly circulating tumor DNA (ctDNA) analysis, are transforming breast cancer monitoring and treatment selection. These non-invasive methods allow for real-time assessment of tumor evolution and resistance mechanisms.',
          keywords: ['liquid biopsy', 'circulating tumor DNA', 'ctDNA', 'monitoring', 'resistance']
        }
      ];

      // Process each document
      for (const doc of mockDocuments) {
        await this.addDocument(doc);
      }

      this.isInitialized = true;
      logger.info(`Simple RAG Service initialized with ${mockDocuments.length} documents`);

      return {
        success: true,
        message: 'Simple RAG Service initialized successfully',
        documentCount: mockDocuments.length
      };

    } catch (error) {
      logger.error(`Simple RAG initialization failed: ${error.message}`);
      throw new AppError('Simple RAG initialization failed', 500);
    }
  }

  /**
   * Add document to the knowledge base
   */
  async addDocument(doc) {
    try {
      // Create citation metadata
      const citation = {
        authors: doc.authors,
        title: doc.title,
        journal: doc.journal,
        year: doc.year,
        doi: doc.doi,
        type: 'journal_article'
      };

      // Generate embedding for the content
      const embedding = await this.generateEmbedding(doc.content);

      // Store document with metadata
      this.documents.set(doc.id, {
        ...doc,
        citation,
        amaReference: referenceService.formatAMAReference(citation),
        embedding,
        addedAt: new Date().toISOString()
      });

      logger.info(`Added document: ${doc.title}`);

    } catch (error) {
      logger.error(`Failed to add document ${doc.id}: ${error.message}`);
    }
  }

  /**
   * Generate embedding for text
   */
  async generateEmbedding(text) {
    try {
      const response = await this.openai.embeddings.create({
        model:
          process.env.BEDROCK_EMBEDDING_MODEL_ID ||
          process.env.BEDROCK_EMBED_MODEL ||
          'amazon.titan-embed-text-v1',
        input: text
      });

      return response.data[0].embedding;
    } catch (error) {
      logger.error(`Embedding generation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Search for relevant documents
   */
  async search(query, options = {}) {
    try {
      const { maxResults = 5, similarityThreshold = 0.7 } = options;

      if (!this.isInitialized) {
        throw new AppError('RAG system not initialized', 400);
      }

      logger.info(`Searching for: "${query}"`);

      // Generate embedding for query
      const queryEmbedding = await this.generateEmbedding(query);

      // Calculate similarities
      const similarities = [];
      
      for (const [docId, doc] of this.documents) {
        const similarity = this.calculateCosineSimilarity(queryEmbedding, doc.embedding);
        
        if (similarity >= similarityThreshold) {
          similarities.push({
            docId,
            similarity,
            title: doc.title,
            content: doc.content,
            citation: doc.citation,
            amaReference: doc.amaReference,
            keywords: doc.keywords
          });
        }
      }

      // Sort by similarity
      const results = similarities
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, maxResults);

      logger.info(`Found ${results.length} relevant documents`);

      return {
        success: true,
        query,
        results,
        totalResults: results.length
      };

    } catch (error) {
      logger.error(`Search failed: ${error.message}`);
      throw new AppError('Search failed', 500);
    }
  }

  /**
   * Generate response using RAG
   */
  async generateResponse(query, options = {}) {
    try {
      const { maxContextDocs = 3, language = 'pt' } = options;

      logger.info(`Generating RAG response for: "${query}"`);

      // Search for relevant documents
      const searchResult = await this.search(query, { maxResults: maxContextDocs });

      if (searchResult.results.length === 0) {
        return {
          success: false,
          response: 'Não foram encontradas informações relevantes na base de conhecimento.',
          sources: [],
          references: []
        };
      }

      // Prepare context and references
      const context = this.prepareContext(searchResult.results, query);
      const references = this.prepareReferences(searchResult.results);

      // Generate AI response
      const response = await this.generateAIResponse(query, context, references, { language });

      return {
        success: true,
        response: response.text,
        sources: searchResult.results,
        references: references,
        metadata: {
          contextDocs: searchResult.results.length,
          totalReferences: references.length
        }
      };

    } catch (error) {
      logger.error(`RAG response generation failed: ${error.message}`);
      throw new AppError('RAG response generation failed', 500);
    }
  }

  /**
   * Calculate cosine similarity
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
   * Prepare context for AI generation
   */
  prepareContext(results, query) {
    const contextDocs = results.map((result, index) => ({
      docNumber: index + 1,
      title: result.title,
      content: result.content,
      similarity: result.similarity,
      citation: result.citation
    }));

    return {
      query,
      relevantDocs: contextDocs,
      totalDocs: results.length
    };
  }

  /**
   * Prepare references
   */
  prepareReferences(results) {
    return results.map((result, index) => ({
      number: index + 1,
      citation: result.citation,
      amaReference: result.amaReference,
      inTextCitation: `^${index + 1}^`
    }));
  }

  /**
   * Generate AI response
   */
  async generateAIResponse(query, context, references, options = {}) {
    try {
      const { language = 'pt' } = options;

      const systemPrompt = `Tu és um assistente de IA especializado em oncologia, com acesso a uma base de dados de artigos científicos sobre cancro da mama.

PRINCÍPIOS FUNDAMENTAIS:
- Forneces informações baseadas em evidências científicas dos documentos fornecidos
- Sempre incluis referências adequadas (formato AMA) quando utilizas informação dos documentos
- Mencionas limitações e incertezas quando apropriado
- Recomendas consultar literatura médica primária para decisões clínicas
- Manténs um tom profissional mas acessível

FORMATO DE RESPOSTA:
- Resposta clara e estruturada
- Inclui referências em formato AMA quando relevante
- Identifica nível de evidência (quando aplicável)
- Sugere recursos adicionais para aprofundamento

IMPORTANTE: Esta informação é para fins educativos e de investigação. Para decisões clínicas, consulta sempre um profissional de saúde qualificado.`;

      const userPrompt = `Pergunta: ${query}

DOCUMENTOS RELEVANTES:
${context.relevantDocs.map(doc => `
${doc.docNumber}. ${doc.title}
Conteúdo: ${doc.content}
Relevância: ${(doc.similarity * 100).toFixed(1)}%
---`).join('')}

REFERÊNCIAS DISPONÍVEIS:
${references.map(ref => `${ref.number}. ${ref.amaReference}`).join('\n')}

Por favor, responde à pergunta utilizando a informação dos documentos fornecidos. Inclui as referências adequadas no formato AMA quando utilizares informação específica dos documentos.`;

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 1500,
        temperature: 0.3
      });

      const response = completion.choices[0]?.message?.content || 'Desculpe, não consegui gerar uma resposta.';

      return {
        text: response,
        model: 'gpt-4',
        tokens: completion.usage?.total_tokens || 0
      };

    } catch (error) {
      logger.error(`AI response generation failed: ${error.message}`);
      throw new AppError('AI response generation failed', 500);
    }
  }

  /**
   * Get system status
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      totalDocuments: this.documents.size,
      totalEmbeddings: this.embeddings.size
    };
  }
}

export default new SimpleRAGService();

