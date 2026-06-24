import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import pdfProcessingService from './pdfProcessingService.js';
import vectorDatabaseService from './vectorDatabaseService.js';
import referenceService from './referenceService.js';
import { OpenAI } from '../lib/bedrockOpenAICompat.js';

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_CHUNK_OVERLAP = 100;

export class RAGService {
  constructor() {
    this.openai = new OpenAI({
      region: process.env.AWS_REGION || process.env.BEDROCK_REGION || process.env.BEDROCK_AWS_REGION,
      model: process.env.BEDROCK_MODEL_ID || process.env.BEDROCK_CHAT_MODEL,
      embeddingModel: process.env.BEDROCK_EMBEDDING_MODEL_ID || process.env.BEDROCK_EMBED_MODEL
    });
    
    this.isInitialized = false;
    this.processedDocuments = new Map();
    this.datasetSource = 'breast';
    this.datasetLabel = 'Breast Cancer PDFs';
    this.activeSources = new Set();
  }

  /**
   * Initialize RAG system with PDF documents
   */
  async initialize(options = {}) {
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
        ocrEngine,
        maxParsePages
      } = options;

      logger.info('Initializing RAG system...');

      // Process PDF documents
      const { processingResult, datasetLabel, datasetSource } = await this.resolveAndProcessSource({
        source,
        directory,
        maxFiles,
        includeMetadata: true,
        chunkSize,
        overlap,
        enableOcr,
        ocrMaxPages,
        ocrScale,
        ocrLanguage,
        ocrEngine,
        maxParsePages
      });

      if (!processingResult.success) {
        const processingFailureMessage = processingResult?.message || 'PDF processing failed';
        throw new AppError(processingFailureMessage, 500);
      }

      // Store processed documents in vector database
      for (const document of processingResult.results) {
        if (document.success) {
          await this.storeDocumentInVectorDB(document, {
            datasetSource,
            datasetLabel
          });
        }
      }

      this.isInitialized = true;
      this.datasetSource = datasetSource;
      this.datasetLabel = datasetLabel;
      this.activeSources.add(datasetSource);
      logger.info(`RAG system initialized with ${processingResult.stats.processedFiles} documents`);

      return {
        success: true,
        stats: processingResult.stats,
        message: 'RAG system initialized successfully'
      };

    } catch (error) {
      logger.error(`RAG initialization failed: ${error.message}`);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(`RAG initialization failed: ${error.message}`, 500);
    }
  }

  /**
   * Resolve and process a data source for RAG
   */
  async resolveAndProcessSource(options = {}) {
    const { source = 'breast', directory = null, ...processingOptions } = options;

    if (directory) {
      return {
        processingResult: await pdfProcessingService.processPDFsInDirectory(directory, {
          ...processingOptions,
          sourceLabel: directory
        }),
        datasetLabel: directory,
        datasetSource: 'custom'
      };
    }

    if (source === 'curia_materials') {
      const curiaOptions = {
        ...processingOptions,
        enableOcr: processingOptions.enableOcr ?? true
      };
      return {
        processingResult: await pdfProcessingService.processCuriaMaterialsPDFs(curiaOptions),
        datasetLabel: 'Curia 2026 - Material de Apoio',
        datasetSource: 'curia_materials'
      };
    }

    if (source === 'asco_sep') {
      const ascoOptions = {
        ...processingOptions,
        enableOcr: processingOptions.enableOcr ?? true,
        maxParsePages: Number.isFinite(processingOptions.maxParsePages)
          ? processingOptions.maxParsePages
          : 200
      };
      return {
        processingResult: await pdfProcessingService.processAscoSepPDFs(ascoOptions),
        datasetLabel: 'ASCO SEP Medical Oncology',
        datasetSource: 'asco_sep'
      };
    }

    return {
      processingResult: await pdfProcessingService.processBreastCancerPDFs(processingOptions),
      datasetLabel: 'Breast Cancer PDFs',
      datasetSource: 'breast'
    };
  }

  /**
   * Store document in vector database
   */
  async storeDocumentInVectorDB(document, sourceContext = {}) {
    try {
      const documentId = document.fileName.replace(/\.(pdf|PDF)$/, '');
      const datasetSource = sourceContext?.datasetSource || this.datasetSource || 'unknown';
      const datasetLabel = sourceContext?.datasetLabel || this.datasetLabel || 'Unknown';
      
      // Store chunks with embeddings
      await vectorDatabaseService.storeDocumentChunks(documentId, document.chunks, {
        fileName: document.fileName,
        filePath: document.filePath,
        totalPages: document.pages,
        textLength: document.textLength,
        wordCount: document.wordCount,
        citation: document.metadata.citation,
        datasetSource,
        datasetLabel
      });

      this.processedDocuments.set(documentId, document);
      logger.info(`Stored document ${documentId} in vector database`);

    } catch (error) {
      logger.error(`Failed to store document ${document.fileName}: ${error.message}`);
    }
  }

  /**
   * Search for relevant information using RAG
   */
  async search(query, options = {}) {
    try {
      const {
        maxResults = 10,
        includeReferences = true,
        similarityThreshold = 0.7,
        useHybridSearch = true,
        sourceFilter = null
      } = options;

      logger.info(`RAG search for: "${query}"`);

      if (!this.isInitialized) {
        throw new AppError('RAG system not initialized', 400);
      }

      let searchResults;

      if (useHybridSearch) {
        // Use hybrid search (vector + keyword)
        searchResults = await vectorDatabaseService.hybridSearch(query, {
          maxResults: maxResults * 2, // Get more results for better ranking
          similarityThreshold
        });
      } else {
        // Use vector search only
        searchResults = await vectorDatabaseService.searchSimilarChunks(query, {
          maxResults: maxResults * 2,
          similarityThreshold
        });
      }

      const normalizedSourceFilters = (Array.isArray(sourceFilter) ? sourceFilter : [sourceFilter])
        .map(source => String(source || '').trim().toLowerCase())
        .filter(Boolean);
      if (normalizedSourceFilters.length > 0) {
        searchResults = (searchResults || []).filter(result => {
          const source = String(
            result?.metadata?.datasetSource || result?.metadata?.source || ''
          ).trim().toLowerCase();
          return normalizedSourceFilters.includes(source);
        });
      }

      // Enhance results with reference information
      const enhancedResults = await this.enhanceSearchResults(searchResults, query, {
        includeReferences
      });

      return {
        success: true,
        query,
        results: enhancedResults.slice(0, maxResults),
        totalResults: enhancedResults.length,
        searchMethod: useHybridSearch ? 'hybrid' : 'vector'
      };

    } catch (error) {
      logger.error(`RAG search failed: ${error.message}`);
      throw new AppError('RAG search failed', 500);
    }
  }

  /**
   * Generate response using RAG
   */
  async generateResponse(query, options = {}) {
    try {
      const {
        maxContextChunks = 5,
        includeReferences = true,
        language = 'pt',
        responseStyle = 'professional'
      } = options;

      logger.info(`Generating RAG response for: "${query}"`);

      // Search for relevant information
      const searchResults = await this.search(query, {
        maxResults: maxContextChunks * 2,
        includeReferences
      });

      if (searchResults.results.length === 0) {
        return {
          success: false,
          response: 'Não foram encontradas informações relevantes nos documentos processados.',
          sources: [],
          references: []
        };
      }

      // Prepare context for AI generation
      const context = this.prepareContext(searchResults.results, query);
      const references = this.prepareReferences(searchResults.results);

      // Generate response using AI
      const response = await this.generateAIResponse(query, context, references, {
        language,
        responseStyle
      });

      return {
        success: true,
        response: response.text,
        sources: searchResults.results,
        references: references,
        metadata: {
          contextChunks: searchResults.results.length,
          totalReferences: references.length,
          searchMethod: searchResults.searchMethod
        }
      };

    } catch (error) {
      logger.error(`RAG response generation failed: ${error.message}`);
      throw new AppError('RAG response generation failed', 500);
    }
  }

  /**
   * Enhance search results with additional information
   */
  async enhanceSearchResults(searchResults, query, options = {}) {
    const { includeReferences = true } = options;

    return searchResults.map(result => {
      const enhanced = {
        ...result,
        relevanceScore: result.similarity || result.combinedScore || result.relevance,
        sourceFile: result.metadata?.fileName || 'Unknown',
        chunkIndex: result.chunkIndex,
        textPreview: result.text.substring(0, 200) + '...'
      };

      if (includeReferences && result.metadata?.citation) {
        enhanced.citation = result.metadata.citation;
        enhanced.amaReference = referenceService.formatAMAReference(result.metadata.citation);
        enhanced.inTextCitation = `^${result.chunkIndex + 1}^`;
      }

      return enhanced;
    });
  }

  /**
   * Prepare context for AI generation
   */
  prepareContext(searchResults, query) {
    const contextChunks = searchResults
      .sort((a, b) => (b.similarity || b.combinedScore || b.relevance) - (a.similarity || a.combinedScore || a.relevance))
      .slice(0, 5)
      .map((result, index) => ({
        chunk: index + 1,
        text: result.text,
        source: result.metadata?.fileName || 'Unknown',
        relevance: result.similarity || result.combinedScore || result.relevance
      }));

    return {
      query,
      relevantChunks: contextChunks,
      totalChunks: searchResults.length
    };
  }

  /**
   * Prepare references for the response
   */
  prepareReferences(searchResults) {
    const referenceMap = new Map();

    searchResults.forEach(result => {
      if (result.metadata?.citation) {
        const citation = result.metadata.citation;
        const citationKey = `${citation.authors?.join(',')}_${citation.title}_${citation.year}`;
        
        if (!referenceMap.has(citationKey)) {
          referenceMap.set(citationKey, {
            citation,
            amaReference: referenceService.formatAMAReference(citation),
            inTextCitation: `^${referenceMap.size + 1}^`
          });
        }
      }
    });

    return Array.from(referenceMap.values());
  }

  /**
   * Generate AI response using context and references
   */
  async generateAIResponse(query, context, references, options = {}) {
    try {
      const { language = 'pt', responseStyle = 'professional' } = options;

      const systemPrompt = this.buildSystemPrompt(language, responseStyle);
      const userPrompt = this.buildUserPrompt(query, context, references, language);

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 1500,
        temperature: 0.3,
        top_p: 0.9
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
   * Build system prompt for AI
   */
  buildSystemPrompt(language, responseStyle) {
    const datasetLabel = this.datasetLabel || 'documentos científicos em oncologia';
    const basePrompt = `Tu és um assistente de IA especializado em oncologia, com acesso a uma base de dados de documentos científicos (${datasetLabel}).

PRINCÍPIOS FUNDAMENTAIS:
- Forneces informações baseadas em evidências científicas dos documentos processados
- Sempre incluis referências adequadas quando utilizas informação dos documentos
- Explicas a evidência: desenho do estudo, população, intervenção/comparador, desfechos e direção do efeito
- Só usas números/efeitos quantitativos se estiverem explicitamente nos textos fornecidos
- Se um detalhe não estiver no texto fornecido, diz "não reportado no texto fornecido"
- Mencionas limitações e incertezas quando apropriado
- Recomendas consultar literatura médica primária para decisões clínicas
- Manténs um tom profissional mas acessível
- Reconheces quando uma questão requer consulta médica especializada

FORMATO DE RESPOSTA:
- Resposta clara e estruturada (podes usar secções curtas com títulos)
- Usa citações no texto no formato [1], [2], etc., correspondentes às referências fornecidas
- Identifica nível de evidência (quando aplicável)
- Sugere recursos adicionais para aprofundamento

IMPORTANTE: Esta informação é para fins educativos e de investigação. Para decisões clínicas, consulta sempre um profissional de saúde qualificado.`;

    return basePrompt;
  }

  /**
   * Build user prompt with context
   */
  buildUserPrompt(query, context, references, language) {
    let prompt = `Pergunta: ${query}

CONTEXTO RELEVANTE DOS DOCUMENTOS:
`;

    context.relevantChunks.forEach((chunk, index) => {
      prompt += `\n${index + 1}. Fonte: ${chunk.source}
Conteúdo: ${chunk.text}
Relevância: ${(chunk.relevance * 100).toFixed(1)}%
---`;
    });

    if (references.length > 0) {
      prompt += `\n\nREFERÊNCIAS DISPONÍVEIS:
`;
      references.forEach((ref, index) => {
        prompt += `${index + 1}. ${ref.amaReference}
`;
      });
    }

    prompt += `\n\nPor favor, responde à pergunta utilizando a informação dos documentos fornecidos. Inclui citações no texto em [n] correspondentes às referências fornecidas e não inventes referências.`;

    return prompt;
  }

  /**
   * Get RAG system status
   */
  getStatus() {
    const vectorStats = vectorDatabaseService.getDatabaseStats();
    
    return {
      isInitialized: this.isInitialized,
      datasetSource: this.datasetSource,
      datasetLabel: this.datasetLabel,
      activeSources: Array.from(this.activeSources),
      totalDocuments: this.processedDocuments.size,
      totalChunks: vectorStats.totalChunks,
      totalEmbeddings: vectorStats.totalEmbeddings,
      averageChunkLength: vectorStats.averageChunkLength,
      processedDocuments: Array.from(this.processedDocuments.keys())
    };
  }

  /**
   * Clear RAG system
   */
  clearSystem() {
    this.isInitialized = false;
    this.processedDocuments.clear();
    this.datasetSource = 'breast';
    this.datasetLabel = 'Breast Cancer PDFs';
    this.activeSources.clear();
    vectorDatabaseService.clearDatabase();
    pdfProcessingService.clearProcessedFiles();
    logger.info('RAG system cleared');
  }

  /**
   * Get document by ID
   */
  getDocument(documentId) {
    return this.processedDocuments.get(documentId);
  }

  /**
   * Get all processed documents
   */
  getAllDocuments() {
    return Array.from(this.processedDocuments.values());
  }
}

export default new RAGService();

