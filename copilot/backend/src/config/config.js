import dotenv from 'dotenv';
import {
  buildRuntimeDiagnostics,
  parseBoolean,
  parseFloatNumber,
  parseInteger,
  resolveAllowedOrigins,
  resolveJwtSecret
} from './runtimeEnv.js';

// Load environment variables
dotenv.config();

const environment = process.env.NODE_ENV || 'development';
const allowedOrigins = resolveAllowedOrigins();
const jwt = resolveJwtSecret({ environment });
const runtimeDiagnostics = buildRuntimeDiagnostics({
  environment,
  requiredEnvVars: environment === 'production' ? ['JWT_SECRET'] : [],
  allowedOrigins,
  jwt
});

const config = {
  // Server configuration
  server: {
    port: parseInteger(process.env.PORT, 5000),
    environment,
    host: process.env.HOST || 'localhost'
  },

  // Database configuration
  database: {
    url: process.env.DATABASE_URL,
    type: process.env.DATABASE_TYPE || 'firebase'
  },

  // Firebase configuration
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT
  },

  // Deployment region (EU data residency)
  deployment: {
    region: process.env.DEPLOYMENT_REGION || process.env.AWS_REGION || 'us-east-1',
    firebaseLocation: process.env.FIREBASE_LOCATION || 'us-central1'
  },

  // Amazon Bedrock configuration
  bedrock: {
    region:
      process.env.DEPLOYMENT_REGION ||
      process.env.AWS_REGION ||
      process.env.BEDROCK_REGION ||
      process.env.BEDROCK_AWS_REGION ||
      'us-east-1',
    model:
      process.env.BEDROCK_MODEL_ID ||
      process.env.BEDROCK_CHAT_MODEL ||
      process.env.OPENAI_MODEL ||
      'us.anthropic.claude-sonnet-4-6',
    embeddingModel:
      process.env.BEDROCK_EMBEDDING_MODEL_ID ||
      process.env.BEDROCK_EMBED_MODEL ||
      'amazon.titan-embed-text-v1',
    maxTokens: parseInteger(process.env.BEDROCK_MAX_TOKENS || process.env.OPENAI_MAX_TOKENS, 2000),
    temperature: parseFloatNumber(process.env.BEDROCK_TEMPERATURE || process.env.OPENAI_TEMPERATURE, 0.3)
  },

  // Backward-compatible alias used by existing services
  openai: {
    apiKey:
      process.env.OPENAI_API_KEY ||
      process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_PROFILE ||
      'bedrock-iam',
    model:
      process.env.BEDROCK_MODEL_ID ||
      process.env.BEDROCK_CHAT_MODEL ||
      process.env.OPENAI_MODEL ||
      'us.anthropic.claude-sonnet-4-6',
    embeddingModel:
      process.env.BEDROCK_EMBEDDING_MODEL_ID ||
      process.env.BEDROCK_EMBED_MODEL ||
      'amazon.titan-embed-text-v1',
    region:
      process.env.DEPLOYMENT_REGION ||
      process.env.AWS_REGION ||
      process.env.BEDROCK_REGION ||
      process.env.BEDROCK_AWS_REGION ||
      'us-east-1',
    maxTokens: parseInteger(process.env.BEDROCK_MAX_TOKENS || process.env.OPENAI_MAX_TOKENS, 2000),
    temperature: parseFloatNumber(process.env.BEDROCK_TEMPERATURE || process.env.OPENAI_TEMPERATURE, 0.3)
  },

  // Groq configuration (fast auxiliary model for rewrite, extraction, repair)
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    enabled: parseBoolean(process.env.ENABLE_GROQ_FAST_MODEL, true)
  },

  // Pinecone configuration
  pinecone: {
    apiKey: process.env.PINECONE_API_KEY,
    indexName: process.env.PINECONE_INDEX_NAME,
    environment: process.env.PINECONE_ENVIRONMENT
  },

  // NCBI configuration
  ncbi: {
    apiKey: process.env.NCBI_API_KEY,
    baseUrl: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'
  },

  // JWT configuration
  jwt: {
    secret: jwt.value,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  },

  // Rate limiting configuration
  rateLimit: {
    windowMs: parseInteger(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000), // 15 minutes
    max: parseInteger(process.env.RATE_LIMIT_MAX, 1000),
    message: 'Too many requests from this IP, please try again later.'
  },

  // Search configuration
  search: {
    maxResults: parseInteger(process.env.SEARCH_MAX_RESULTS, 100),
    timeout: parseInteger(process.env.SEARCH_TIMEOUT, 25000),
    enableSemanticSearch: parseBoolean(process.env.ENABLE_SEMANTIC_SEARCH, false),
    enableVectorSearch: parseBoolean(process.env.ENABLE_VECTOR_SEARCH, false)
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableFileLogging: parseBoolean(process.env.ENABLE_FILE_LOGGING, true),
    logDirectory: process.env.LOG_DIRECTORY || 'logs'
  },

  // Security configuration
  security: {
    enableCORS: parseBoolean(process.env.ENABLE_CORS, true),
    corsOrigin: allowedOrigins,
    corsOrigins: allowedOrigins,
    enableHelmet: parseBoolean(process.env.ENABLE_HELMET, true),
    enableCompression: parseBoolean(process.env.ENABLE_COMPRESSION, true)
  },

  // Feature flags
  features: {
    enableAIEnhancement: parseBoolean(process.env.ENABLE_AI_ENHANCEMENT, false),
    enableAnalytics: parseBoolean(process.env.ENABLE_ANALYTICS, false),
    enableRecommendations: parseBoolean(process.env.ENABLE_RECOMMENDATIONS, false),
    enableExport: parseBoolean(process.env.ENABLE_EXPORT, false)
  },

  // External services
  external: {
    enablePubMed: parseBoolean(process.env.ENABLE_PUBMED, false),
    enableCochrane: parseBoolean(process.env.ENABLE_COCHRANE, false),
    enableClinicalTrials: parseBoolean(process.env.ENABLE_CLINICAL_TRIALS, false),
    enableGuidelines: parseBoolean(process.env.ENABLE_GUIDELINES, false),
    enableEma: parseBoolean(process.env.ENABLE_EMA, false),
    enableEsmoGuidelines: parseBoolean(process.env.ENABLE_ESMO_GUIDELINES, false),
    enableEpistemonikos: parseBoolean(process.env.ENABLE_EPISTEMONIKOS, false),
    enableGradeAssessment: parseBoolean(process.env.ENABLE_GRADE_ASSESSMENT, false)
  },

  runtimeDiagnostics
};

// Validate required configuration
const validateConfig = () => {
  if (config.runtimeDiagnostics.missingEnvVars.length > 0) {
    console.warn(`Warning: Missing required configuration: ${config.runtimeDiagnostics.missingEnvVars.join(', ')}`);
  }

  if (config.runtimeDiagnostics.warnings.length > 0) {
    for (const warning of config.runtimeDiagnostics.warnings) {
      console.warn(`Warning: ${warning}`);
    }
  }
};

// Validate configuration on load
validateConfig();

export default config;
