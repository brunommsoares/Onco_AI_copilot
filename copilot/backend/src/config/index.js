// Configuration management
const config = {
  environment: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3001,
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 100, // requests per window
  maxConversationTurns: parseInt(process.env.MAX_CONVERSATION_TURNS) || 50,
  contextWindow: parseInt(process.env.CONTEXT_WINDOW) || 128000,
  enableFunctionCalling: process.env.ENABLE_FUNCTION_CALLING === 'true',
  enableMultimodal: process.env.ENABLE_MULTIMODAL !== 'false',
  enableStreaming: process.env.ENABLE_STREAMING !== 'false',
  enableMemory: process.env.ENABLE_MEMORY !== 'false',
  enableConversationMemory: process.env.ENABLE_CONVERSATION_MEMORY !== 'false',
  enableFollowUpQuestions: process.env.ENABLE_FOLLOW_UP_QUESTIONS !== 'false',
  enableClarificationRequests: process.env.ENABLE_CLARIFICATION_REQUESTS !== 'false'
};

export default config;
