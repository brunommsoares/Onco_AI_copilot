import OpenAI from '../lib/bedrockOpenAICompat.js';
import { logger } from '../utils/logger.js';
import config from '../config/config.js';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

class ChatService {
  constructor() {
    this.openai = null;
    this.db = null;
    this.initializeOpenAI();
    this.initializeFirebase();
  }

  initializeOpenAI() {
    this.openai = new OpenAI({
      region: config.bedrock?.region,
      model: config.bedrock?.model,
      embeddingModel: config.bedrock?.embeddingModel
    });
    logger.info(
      `Bedrock client initialized successfully (region=${config.bedrock?.region}, model=${config.bedrock?.model})`
    );
  }

  initializeFirebase() {
    try {
      // Initialize Firebase Admin if not already initialized
      if (getApps().length === 0) {
        initializeApp({
          projectId: 'silvercancer-38551',
          // Note: In production, use service account key or environment variables
        });
      }
      
      this.db = getFirestore();
      logger.info('Firebase Firestore initialized successfully');
    } catch (error) {
      logger.warn(`Firebase initialization failed: ${error.message}`);
      this.db = null;
    }
  }

  async generateResponse(prompt, userContext = {}) {
    try {
      if (!this.openai) {
        return {
          answer: "Desculpe, o serviço de IA não está disponível no momento. Por favor, contacte o administrador.",
          sources: [],
          confidence: 0.5
        };
      }

      // Create a comprehensive system prompt for oncology
      const systemPrompt = `Tu és um assistente de IA especializado em oncologia, desenvolvido para ajudar profissionais de saúde, investigadores e estudantes num contexto clínico europeu e português.

PRINCÍPIOS FUNDAMENTAIS:
- Fornece informações baseadas em evidências científicas
- Sempre menciona limitações e incertezas quando apropriado
- Recomenda consultar literatura médica primária para decisões clínicas
- Mantém um tom profissional mas acessível
- Reconhece quando uma questão requer consulta médica especializada

CONTEXTO REGULAMENTAR E CLÍNICO:
- Privilegia guidelines ESMO (European Society for Medical Oncology) como referência primária para recomendações clínicas na Europa
- Referencia NCCN apenas como complemento ou quando não existem guidelines ESMO aplicáveis
- Para aprovação de medicamentos, referencia EMA (European Medicines Agency) em vez de FDA
- Quando relevante, menciona o estado de aprovação/comparticipação pelo INFARMED (Autoridade Nacional do Medicamento, Portugal)
- Utiliza a escala ESMO-MCBS (Magnitude of Clinical Benefit Scale) quando disponível para quantificar o benefício clínico
- Tem em conta a prática clínica europeia e o acesso a medicamentos no contexto do SNS (Serviço Nacional de Saúde) português

ÁREAS DE ESPECIALIZAÇÃO:
- Oncologia médica, cirúrgica e radioterápica
- Farmacologia oncológica e terapias dirigidas
- Epidemiologia e fatores de risco
- Diagnóstico e estadiamento
- Tratamentos emergentes e ensaios clínicos
- Cuidados paliativos e qualidade de vida

FORMATO DE RESPOSTA:
- Resposta clara e estruturada
- Menciona fontes de evidência quando relevante (ESMO guidelines, Cochrane reviews, ensaios clínicos)
- Identifica nível de evidência (quando aplicável) e score ESMO-MCBS se disponível
- Sugere recursos adicionais para aprofundamento (ESMO, EMA, Cochrane)

IDIOMA DE RESPOSTA:
- SEMPRE responde no MESMO idioma da pergunta do utilizador.
- Se a pergunta for em português, responde em português europeu (pt-PT, NÃO brasileiro).
- Se a pergunta for em inglês, responde em inglês.
- Se a pergunta for em espanhol, responde em espanhol.
- Se a pergunta for em francês, responde em francês.

IMPORTANTE: Esta informação é para fins educativos e de investigação. Para decisões clínicas, consulte sempre um profissional de saúde qualificado.`;

      // Build user message with context
      const userMessage = this.buildUserMessage(prompt, userContext);

      const completion = await this.openai.chat.completions.create({
        model: config.openai.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        max_tokens: config.openai.maxTokens,
        temperature: config.openai.temperature,
        top_p: 0.9,
        frequency_penalty: 0.1,
        presence_penalty: 0.1
      });

      const answer = completion.choices[0]?.message?.content || 'Desculpe, não consegui gerar uma resposta.';

      // Analyze response for clinical relevance and confidence
      const analysis = await this.analyzeResponse(prompt, answer);

      return {
        answer,
        sources: analysis.sources,
        confidence: analysis.confidence,
        clinicalRelevance: analysis.clinicalRelevance,
        requiresMedicalReview: analysis.requiresMedicalReview
      };

    } catch (error) {
      logger.error(`Error generating chat response: ${error.message}`);
      
      if (error.code === 'insufficient_quota') {
        return {
          answer: "Desculpe, o serviço de IA atingiu o limite de utilização. Por favor, tente novamente mais tarde.",
          sources: [],
          confidence: 0.3
        };
      }

      return {
        answer: "Ocorreu um erro ao processar a sua pergunta. Por favor, tente novamente ou contacte o suporte.",
        sources: [],
        confidence: 0.2
      };
    }
  }

  buildUserMessage(prompt, userContext) {
    let message = prompt;

    if (userContext.specialty) {
      message += `\n\nContexto do utilizador: Especialidade em ${userContext.specialty}`;
    }

    if (userContext.institution) {
      message += `\nInstituição: ${userContext.institution}`;
    }

    if (userContext.experienceLevel) {
      message += `\nNível de experiência: ${userContext.experienceLevel}`;
    }

    return message;
  }

  async analyzeResponse(question, answer) {
    try {
      if (!this.openai) {
        return {
          sources: [],
          confidence: 0.7,
          clinicalRelevance: 'medium',
          requiresMedicalReview: false
        };
      }

      const analysisPrompt = `Analisa a seguinte pergunta e resposta sobre oncologia:

PERGUNTA: ${question}
RESPOSTA: ${answer}

Fornece uma análise em formato JSON com:
1. "sources": array de tipos de fontes recomendadas (ex: ["ensaios clínicos", "guidelines", "meta-análises"])
2. "confidence": número entre 0-1 indicando confiança na resposta
3. "clinicalRelevance": "high", "medium", ou "low"
4. "requiresMedicalReview": true se a questão requer revisão médica, false caso contrário

Resposta apenas em JSON válido:`;

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: analysisPrompt }],
        max_tokens: 200,
        temperature: 0.1
      });

      const analysisText = completion.choices[0]?.message?.content || '{}';
      
      try {
        return JSON.parse(analysisText);
      } catch (parseError) {
        logger.warn('Failed to parse response analysis, using defaults');
        return {
          sources: ['literatura médica'],
          confidence: 0.7,
          clinicalRelevance: 'medium',
          requiresMedicalReview: false
        };
      }

    } catch (error) {
      logger.warn(`Response analysis failed: ${error.message}`);
      return {
        sources: ['literatura médica'],
        confidence: 0.7,
        clinicalRelevance: 'medium',
        requiresMedicalReview: false
      };
    }
  }

  async getChatHistory(userId, limit = 50) {
    try {
      if (!this.db) {
        logger.warn('Firebase not available for chat history retrieval');
        return [];
      }

      const conversationsRef = this.db.collection('conversations');
      const snapshot = await conversationsRef
        .where('uid', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      const messages = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        messages.push({
          id: doc.id,
          question: data.question,
          answer: data.answer,
          timestamp: data.timestamp?.toDate?.() || new Date(data.timestamp),
          username: data.username || 'Utilizador'
        });
      });

      logger.info(`Retrieved ${messages.length} chat messages for user ${userId}`);
      return messages;

    } catch (error) {
      logger.error(`Error retrieving chat history for user ${userId}: ${error.message}`);
      return [];
    }
  }

  async saveChatMessage(userId, question, answer, metadata = {}) {
    try {
      if (!this.db) {
        logger.warn('Firebase not available for saving chat message');
        return false;
      }

      const conversationsRef = this.db.collection('conversations');
      await conversationsRef.add({
        uid: userId,
        question: question,
        answer: answer,
        timestamp: new Date(),
        username: metadata.username || 'Utilizador',
        metadata: metadata
      });

      logger.info(`Chat message saved for user ${userId}`);
      return true;

    } catch (error) {
      logger.error(`Error saving chat message for user ${userId}: ${error.message}`);
      return false;
    }
  }

  async getChatSuggestions(userId, specialty = null) {
    const suggestions = [
      "Quais são os fatores de risco para cancro da mama?",
      "Como funciona a imunoterapia em oncologia?",
      "Quais são os tratamentos emergentes para cancro do pulmão?",
      "Como interpretar resultados de biópsia?",
      "Quais são as guidelines para rastreio do cancro colorretal?"
    ];

    if (specialty) {
      // Add specialty-specific suggestions
      const specialtySuggestions = {
        'oncologia médica': [
          "Protocolos de quimioterapia para cancro avançado",
          "Gestão de efeitos secundários da terapia dirigida"
        ],
        'cirurgia oncológica': [
          "Critérios de ressecabilidade tumoral",
          "Técnicas minimamente invasivas em oncologia"
        ],
        'radioterapia': [
          "Planeamento de radioterapia conformacional",
          "Proteção de órgãos em risco"
        ]
      };

      if (specialtySuggestions[specialty.toLowerCase()]) {
        suggestions.push(...specialtySuggestions[specialty.toLowerCase()]);
      }
    }

    return suggestions.slice(0, 8); // Return max 8 suggestions
  }
}

export default new ChatService();

