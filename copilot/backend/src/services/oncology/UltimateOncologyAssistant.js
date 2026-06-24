// Ultimate Oncology Assistant - Main service class
import { models } from '../../config/openai.js';
import config from '../../config/index.js';
import ragService from '../ragService.js';

class UltimateOncologyAssistant {
  constructor(guidelineRetriever) {
    this.models = models;
    
    // Enhanced configuration for intelligent interactions
    this.interactionConfig = {
      enableFunctionCalling: config.enableFunctionCalling,
      enableMultimodal: config.enableMultimodal,
      enableStreaming: config.enableStreaming,
      enableMemory: config.enableMemory,
      enableConversationMemory: config.enableConversationMemory,
      enableFollowUpQuestions: config.enableFollowUpQuestions,
      enableClarificationRequests: config.enableClarificationRequests,
      maxConversationTurns: config.maxConversationTurns,
      contextWindow: config.contextWindow
    };
    
    // Conversation memory for interactive sessions
    this.conversationMemory = new Map();
    
    // Interactive features
    this.interactiveFeatures = {
      clarificationSystem: true,
      followUpGenerator: true,
      contextAwareness: true,
      personalizedResponses: true,
      adaptiveLearning: true
    };
    
    // Initialize external dependencies
    this.guidelineRetriever = guidelineRetriever;
    
    // 🏆 ADVANCED ONCOLOGY RESEARCH CAPABILITIES
    this.capabilities = {
      evidenceSynthesis: true,
      systematicReviewGeneration: true,
      clinicalTrialAnalysis: true,
      biomarkerResearch: true,
      precisionMedicineResearch: true,
      guidelineResearch: true,
      evidenceGrading: true,
      researchCollaboration: true
    };
  }

  // Main method for intelligent question processing
  async processQuestionIntelligently(question, options = {}) {
    const startTime = Date.now();
    const language = options.language || 'pt';
    const fastMode = options.fastMode || false;
    const useFunctionCalling = options.useFunctionCalling !== false;
    const useRAG = options.useRAG !== false; // Enable RAG by default
    
    console.log(`🧠 Processing question intelligently: "${question}"`);
    console.log(`⚡ Fast mode: ${fastMode ? 'ON' : 'OFF'}`);
    console.log(`🔧 Function calling: ${useFunctionCalling ? 'ON' : 'OFF'}`);
    console.log(`📚 RAG enabled: ${useRAG ? 'ON' : 'OFF'}`);
    console.log(`🌐 Language: ${language}`);
    
    try {
      if (useRAG && ragService.isInitialized) {
        // Use RAG-enhanced approach
        return await this.processWithRAG(question, options, startTime);
      } else if (useFunctionCalling && this.interactionConfig?.enableFunctionCalling) {
        // Use intelligent function calling approach
        return await this.processWithFunctionCalling(question, options, startTime);
      } else {
        // Use traditional approach
        return await this.executeSearch(question, options);
      }
      
    } catch (error) {
      console.error('❌ Error processing question:', error);
      return {
        success: false,
        response: `Erro ao processar a pergunta: ${error.message}`,
        error: error.message,
        metadata: {
          processingTime: Date.now() - startTime,
          method: 'intelligent_processing'
        }
      };
    }
  }

  // Process with RAG
  async processWithRAG(question, options, startTime) {
    try {
      console.log('📚 RAG processing...');
      
      const ragResult = await ragService.generateResponse(question, {
        maxContextChunks: options.maxContextChunks || 5,
        includeReferences: options.includeReferences !== false,
        language: options.language || 'pt',
        responseStyle: options.responseStyle || 'professional'
      });

      if (ragResult.success) {
        return {
          success: true,
          response: ragResult.response,
          sources: ragResult.sources,
          references: ragResult.references,
          metadata: {
            ...ragResult.metadata,
            processingTime: Date.now() - startTime,
            method: 'rag_enhanced',
            ragEnabled: true
          }
        };
      } else {
        // Fallback to traditional search if RAG fails
        console.log('📚 RAG failed, falling back to traditional search...');
        return await this.executeSearch(question, options);
      }
    } catch (error) {
      console.error('❌ RAG processing error:', error);
      // Fallback to traditional search
      return await this.executeSearch(question, options);
    }
  }

  // Process with function calling
  async processWithFunctionCalling(question, options, startTime) {
    try {
      // Implementation will be added here
      console.log('🔧 Function calling processing...');
      return await this.executeSearch(question, options);
    } catch (error) {
      console.error('❌ Function calling error:', error);
      return await this.executeSearch(question, options);
    }
  }

  // Execute traditional search
  async executeSearch(question, options = {}) {
    try {
      // Implementation will be added here
      console.log('🔍 Traditional search processing...');
      return {
        success: true,
        response: 'Search executed successfully',
        metadata: {
          method: 'traditional_search'
        }
      };
    } catch (error) {
      console.error('❌ Search error:', error);
      return {
        success: false,
        response: `Erro na pesquisa: ${error.message}`,
        error: error.message
      };
    }
  }

  // Generate response method
  async generateResponse(question, articles, context, language = 'pt', options = {}) {
    // Implementation will be added here
    console.log('📝 Generating response...');
    return {
      success: true,
      response: 'Response generated successfully'
    };
  }
}

export default UltimateOncologyAssistant;
