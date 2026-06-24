// Bedrock-backed compatibility configuration
import OpenAI from '../lib/bedrockOpenAICompat.js';

const PRIMARY_MODEL =
  process.env.BEDROCK_MODEL_ID ||
  process.env.BEDROCK_CHAT_MODEL ||
  'us.anthropic.claude-sonnet-4-6';

const openai = new OpenAI({
  region:
    process.env.AWS_REGION ||
    process.env.BEDROCK_REGION ||
    process.env.BEDROCK_AWS_REGION ||
    'us-east-1',
  model: PRIMARY_MODEL,
  embeddingModel:
    process.env.BEDROCK_EMBEDDING_MODEL_ID ||
    process.env.BEDROCK_EMBED_MODEL ||
    'amazon.titan-embed-text-v1'
});

// Enhanced model configuration
const openaiConfig = {
  model: PRIMARY_MODEL,
  maxTokens: 4000,
  temperature: 0.3,
  topP: 0.9,
  frequencyPenalty: 0.1,
  presencePenalty: 0.1
};

// Model configurations
const models = {
  primary: PRIMARY_MODEL,
  fallback:
    process.env.BEDROCK_FALLBACK_MODEL_ID ||
    'amazon.nova-pro-v1:0',
  reasoning: PRIMARY_MODEL,
  systematic: PRIMARY_MODEL,
  evidence: PRIMARY_MODEL,
  research: PRIMARY_MODEL,
  collaboration: PRIMARY_MODEL,
  multimodal: PRIMARY_MODEL,
  interactive: PRIMARY_MODEL
};

export { openai, openaiConfig, models };
