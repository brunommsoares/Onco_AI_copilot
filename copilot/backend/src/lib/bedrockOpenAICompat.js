import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  InvokeModelCommand
} from '@aws-sdk/client-bedrock-runtime';

const DEFAULT_REGION =
  process.env.AWS_REGION ||
  process.env.BEDROCK_REGION ||
  process.env.BEDROCK_AWS_REGION ||
  'us-east-1';

const DEFAULT_CHAT_MODEL =
  process.env.BEDROCK_MODEL_ID ||
  process.env.BEDROCK_CHAT_MODEL ||
  'us.anthropic.claude-sonnet-4-6';

const parseCsvModels = (value = '') =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const scoreFallbackModel = (model = '') => {
  const normalized = String(model || '').toLowerCase();
  if (normalized.includes('nova-pro')) return 40;
  if (normalized.includes('sonnet')) return 30;
  if (normalized.includes('nova-lite')) return 20;
  if (normalized.includes('haiku')) return 10;
  if (normalized.includes('nova-micro')) return 5;
  return 0;
};

const sortFallbackModelsByQuality = (models = []) =>
  [...models]
    .map((model, index) => ({ model, index }))
    .sort((a, b) => {
      const qualityDelta = scoreFallbackModel(b.model) - scoreFallbackModel(a.model);
      return qualityDelta !== 0 ? qualityDelta : (a.index - b.index);
    })
    .map((entry) => entry.model);

const DEFAULT_FALLBACK_CHAT_MODELS = [
  process.env.BEDROCK_FALLBACK_MODEL_ID,
  ...parseCsvModels(process.env.BEDROCK_FALLBACK_MODELS),
  'amazon.nova-pro-v1:0',
  'amazon.nova-lite-v1:0'
].filter(Boolean);

const DEFAULT_EMBED_MODEL =
  process.env.BEDROCK_EMBEDDING_MODEL_ID ||
  process.env.BEDROCK_EMBED_MODEL ||
  'amazon.titan-embed-text-v1';

const LEGACY_CHAT_MODEL_PATTERN = /^(gpt-|o[0-9]|text-davinci|chatgpt)/i;
const LEGACY_EMBED_MODEL_PATTERN = /^text-embedding-/i;

const mapStopReason = (stopReason) => {
  if (!stopReason) return 'stop';
  const normalized = String(stopReason).toLowerCase();
  if (normalized.includes('max')) return 'length';
  if (normalized.includes('stop')) return 'stop';
  if (normalized.includes('tool')) return 'tool_calls';
  if (normalized.includes('content')) return 'content_filter';
  return 'stop';
};

const safeStringify = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? '');
  }
};

const normalizeContentToText = (content, role = 'user') => {
  if (typeof content === 'string') return content;
  if (content == null) return '';

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        if (part.type === 'text' || part.type === 'input_text') return String(part.text || '');
        if (part.type === 'image_url') {
          const url = part.image_url?.url || part.url || '';
          return url ? `[image-url] ${url}` : '[image-url]';
        }
        if (part.type === 'tool_result') return String(part.content || '');
        if (typeof part.text === 'string') return part.text;
        return safeStringify(part);
      })
      .filter(Boolean)
      .join('\n');
  }

  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (role === 'tool') return safeStringify(content);
    return safeStringify(content);
  }

  return String(content);
};

const toBedrockMessage = (message) => {
  const role = message?.role === 'assistant' ? 'assistant' : 'user';
  const text = normalizeContentToText(message?.content, message?.role).trim();

  const enrichedText = (() => {
    if (text) return text;
    if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
      return `Tool calls: ${safeStringify(message.tool_calls)}`;
    }
    if (message?.role === 'tool' && message?.name) {
      return `Tool "${message.name}" returned no content`;
    }
    return '';
  })();

  return {
    role,
    content: [{ text: enrichedText || '[empty]' }]
  };
};

const normalizeMessages = (messages = []) => {
  const input = Array.isArray(messages) ? messages : [];
  const systemTexts = [];
  const bedrockMessages = [];

  for (const message of input) {
    if (!message || typeof message !== 'object') continue;
    const role = String(message.role || '').toLowerCase();
    if (role === 'system') {
      const systemText = normalizeContentToText(message.content, 'system').trim();
      if (systemText) systemTexts.push(systemText);
      continue;
    }
    bedrockMessages.push(toBedrockMessage(message));
  }

  if (bedrockMessages.length === 0) {
    bedrockMessages.push({
      role: 'user',
      content: [{ text: 'Continue.' }]
    });
  }

  return { systemTexts, bedrockMessages };
};

const decodeResponseBody = (body) => {
  if (!body) return {};
  if (typeof body === 'string') return JSON.parse(body);
  if (body instanceof Uint8Array) {
    return JSON.parse(new TextDecoder('utf-8').decode(body));
  }
  if (typeof body.transformToString === 'function') {
    return body.transformToString().then((raw) => JSON.parse(raw));
  }
  return body;
};

const uniqueModels = (models = []) => {
  const dedup = [];
  const seen = new Set();
  for (const model of models) {
    const normalized = String(model || '').trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    dedup.push(normalized);
  }
  return dedup;
};

const MODEL_SWITCHABLE_ERROR_PATTERNS = [
  /use case details have not been submitted/i,
  /on-demand throughput isn.?t supported/i,
  /retry your request with the id or arn of an inference profile/i,
  /inference profile/i,
  /provided model identifier is invalid/i,
  /model .* not found/i,
  /not authorized to invoke/i,
  /access denied/i,
  /validationexception/i
];

class BedrockOpenAICompat {
  constructor(options = {}) {
    this.region = options.region || DEFAULT_REGION;
    this.defaultChatModel = options.model || DEFAULT_CHAT_MODEL;
    this.defaultEmbeddingModel = options.embeddingModel || DEFAULT_EMBED_MODEL;
    this.fallbackChatModels = sortFallbackModelsByQuality(uniqueModels(
      Array.isArray(options.fallbackChatModels) && options.fallbackChatModels.length > 0
        ? options.fallbackChatModels
        : DEFAULT_FALLBACK_CHAT_MODELS
    ));
    this.modelCooldownMs = Number.isFinite(Number(options.modelCooldownMs))
      ? Math.max(30_000, Number(options.modelCooldownMs))
      : (Number.isFinite(Number(process.env.BEDROCK_MODEL_COOLDOWN_MS))
          ? Math.max(30_000, Number(process.env.BEDROCK_MODEL_COOLDOWN_MS))
          : 15 * 60 * 1000);
    this.modelCooldownUntil = new Map();
    this.fallbackNoticeAt = new Map();
    this.client = new BedrockRuntimeClient({ region: this.region });

    this.chat = {
      completions: {
        create: async (params = {}) => this.createChatCompletionsApi(params)
      }
    };

    this.embeddings = {
      create: async (params = {}) => this.createEmbeddingsApi(params)
    };
  }

  resolveChatModel(model) {
    if (!model) return this.defaultChatModel;
    return LEGACY_CHAT_MODEL_PATTERN.test(String(model)) ? this.defaultChatModel : String(model);
  }

  resolveEmbeddingModel(model) {
    if (!model) return this.defaultEmbeddingModel;
    return LEGACY_EMBED_MODEL_PATTERN.test(String(model)) ? this.defaultEmbeddingModel : String(model);
  }

  buildChatModelCandidates(model) {
    const requested = this.resolveChatModel(model);
    const candidates = [requested];

    if (/^anthropic\./i.test(requested)) {
      candidates.push(`us.${requested}`);
    } else if (/^us\.anthropic\./i.test(requested)) {
      candidates.push(requested.replace(/^us\./i, ''));
    }

    for (const fallbackModel of this.fallbackChatModels) {
      candidates.push(fallbackModel);
    }

    const deduped = uniqueModels(candidates);
    const available = deduped.filter((candidate) => !this.isModelInCooldown(candidate));
    return available.length > 0 ? available : deduped;
  }

  isSwitchableModelError(error) {
    const errorName = String(error?.name || error?.code || error?.Code || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();

    if (['validationexception', 'accessdeniedexception', 'resourcenotfoundexception'].includes(errorName)) {
      return true;
    }

    return MODEL_SWITCHABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
  }

  isModelInCooldown(model) {
    const key = String(model || '').trim();
    if (!key) return false;
    const until = this.modelCooldownUntil.get(key);
    if (!until) return false;
    if (Date.now() >= until) {
      this.modelCooldownUntil.delete(key);
      return false;
    }
    return true;
  }

  markModelCooldown(model, error) {
    const key = String(model || '').trim();
    if (!key) return;
    const until = Date.now() + this.modelCooldownMs;
    this.modelCooldownUntil.set(key, until);
    const seconds = Math.round(this.modelCooldownMs / 1000);
    console.warn(
      `⚠️ Bedrock model "${key}" on cooldown for ${seconds}s after error: ${error?.message || 'unknown error'}`
    );
  }

  logFallbackUsage(requestedModel, selectedModel) {
    const key = `${requestedModel}=>${selectedModel}`;
    const now = Date.now();
    const lastLogAt = this.fallbackNoticeAt.get(key) || 0;
    if ((now - lastLogAt) < 60_000) return;
    this.fallbackNoticeAt.set(key, now);
    console.warn(
      `⚠️ Bedrock model fallback in use: ${selectedModel} (requested: ${requestedModel})`
    );
  }

  async createChatCompletionsApi(params = {}) {
    const requestedModel = this.resolveChatModel(params.model);
    const modelCandidates = this.buildChatModelCandidates(requestedModel);
    const { systemTexts, bedrockMessages } = normalizeMessages(params.messages);

    const maxTokensRaw = params.max_tokens ?? params.max_completion_tokens;
    const maxTokens = Number.isFinite(Number(maxTokensRaw))
      ? Math.max(1, Math.floor(Number(maxTokensRaw)))
      : undefined;

    const temperature = Number(params.temperature);
    const topP = Number(params.top_p);

    const stopSequences = Array.isArray(params.stop)
      ? params.stop.map((item) => String(item || '')).filter(Boolean)
      : (typeof params.stop === 'string' && params.stop.trim() ? [params.stop.trim()] : undefined);

    const inputBase = {
      messages: bedrockMessages
    };

    if (systemTexts.length > 0) {
      inputBase.system = systemTexts.map((text) => ({ text }));
    }

    const inferenceConfig = {};
    if (maxTokens) inferenceConfig.maxTokens = maxTokens;
    if (Number.isFinite(temperature)) inferenceConfig.temperature = temperature;
    if (Number.isFinite(topP)) inferenceConfig.topP = topP;
    if (stopSequences?.length) inferenceConfig.stopSequences = stopSequences;
    if (Object.keys(inferenceConfig).length > 0) {
      inputBase.inferenceConfig = inferenceConfig;
    }

    let response = null;
    let selectedModel = requestedModel;
    let lastError = null;

    for (let index = 0; index < modelCandidates.length; index += 1) {
      const candidateModel = modelCandidates[index];
      try {
        response = await this.client.send(
          new ConverseCommand({
            modelId: candidateModel,
            ...inputBase
          })
        );
        selectedModel = candidateModel;
        if (candidateModel !== requestedModel) {
          this.logFallbackUsage(requestedModel, candidateModel);
        }
        break;
      } catch (error) {
        lastError = error;
        const hasAlternative = index < (modelCandidates.length - 1);
        if (hasAlternative && this.isSwitchableModelError(error)) {
          this.markModelCooldown(candidateModel, error);
          continue;
        }
        throw error;
      }
    }

    if (!response && lastError) {
      throw lastError;
    }

    const messageBlocks = response?.output?.message?.content || [];
    const text = messageBlocks
      .map((block) => block?.text)
      .filter(Boolean)
      .join('\n')
      .trim();

    const promptTokens = Number(response?.usage?.inputTokens || 0);
    const completionTokens = Number(response?.usage?.outputTokens || 0);
    const totalTokens = Number(response?.usage?.totalTokens || promptTokens + completionTokens);

    return {
      id: response?.$metadata?.requestId || `bedrock-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: selectedModel,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: text || ''
          },
          finish_reason: mapStopReason(response?.stopReason)
        }
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens
      }
    };
  }

  /**
   * Stream a chat completion, yielding text chunks via an async generator.
   * Usage: for await (const chunk of client.streamChatCompletion(params)) { ... }
   * Each yielded value is a string chunk of the assistant's response.
   */
  async * streamChatCompletion(params = {}) {
    const requestedModel = this.resolveChatModel(params.model);
    const modelCandidates = this.buildChatModelCandidates(requestedModel);
    const { systemTexts, bedrockMessages } = normalizeMessages(params.messages);

    const maxTokensRaw = params.max_tokens ?? params.max_completion_tokens;
    const maxTokens = Number.isFinite(Number(maxTokensRaw))
      ? Math.max(1, Math.floor(Number(maxTokensRaw)))
      : undefined;

    const temperature = Number(params.temperature);
    const topP = Number(params.top_p);

    const inputBase = { messages: bedrockMessages };
    if (systemTexts.length > 0) {
      inputBase.system = systemTexts.map((text) => ({ text }));
    }

    const inferenceConfig = {};
    if (maxTokens) inferenceConfig.maxTokens = maxTokens;
    if (Number.isFinite(temperature)) inferenceConfig.temperature = temperature;
    if (Number.isFinite(topP)) inferenceConfig.topP = topP;
    if (Object.keys(inferenceConfig).length > 0) {
      inputBase.inferenceConfig = inferenceConfig;
    }

    let lastError = null;
    for (let index = 0; index < modelCandidates.length; index += 1) {
      const candidateModel = modelCandidates[index];
      try {
        const stream = await this.client.send(
          new ConverseStreamCommand({ modelId: candidateModel, ...inputBase })
        );
        if (candidateModel !== requestedModel) {
          this.logFallbackUsage(requestedModel, candidateModel);
        }
        for await (const event of stream.stream) {
          const text = event?.contentBlockDelta?.delta?.text;
          if (typeof text === 'string' && text.length > 0) {
            yield text;
          }
        }
        return; // success — stop iterating candidates
      } catch (error) {
        lastError = error;
        const hasAlternative = index < (modelCandidates.length - 1);
        if (hasAlternative && this.isSwitchableModelError(error)) {
          this.markModelCooldown(candidateModel, error);
          continue;
        }
        throw error;
      }
    }
    if (lastError) throw lastError;
  }

  async createEmbeddingsApi(params = {}) {
    const model = this.resolveEmbeddingModel(params.model);
    const input = Array.isArray(params.input) ? params.input : [params.input];

    const data = [];
    let promptTokens = 0;

    for (let index = 0; index < input.length; index += 1) {
      const text = String(input[index] ?? '');
      const embeddingResult = await this.invokeEmbeddingModel(model, text);
      data.push({
        object: 'embedding',
        embedding: embeddingResult.embedding,
        index
      });
      promptTokens += Number(embeddingResult.inputTextTokenCount || 0);
    }

    return {
      object: 'list',
      data,
      model,
      usage: {
        prompt_tokens: promptTokens,
        total_tokens: promptTokens
      }
    };
  }

  async invokeEmbeddingModel(modelId, text) {
    const lowerModel = String(modelId || '').toLowerCase();

    if (lowerModel.includes('cohere.embed')) {
      const response = await this.client.send(
        new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            texts: [text],
            input_type: 'search_document'
          })
        })
      );
      const parsed = await decodeResponseBody(response.body);
      const embedding = Array.isArray(parsed?.embeddings) ? parsed.embeddings[0] : null;
      if (!Array.isArray(embedding)) {
        throw new Error('Bedrock embedding response did not include a valid vector.');
      }
      return {
        embedding,
        inputTextTokenCount: Number(parsed?.meta?.billed_units?.input_tokens || 0)
      };
    }

    const response = await this.client.send(
      new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          inputText: text
        })
      })
    );
    const parsed = await decodeResponseBody(response.body);
    const embedding = Array.isArray(parsed?.embedding)
      ? parsed.embedding
      : (Array.isArray(parsed?.embeddingsByType?.float) ? parsed.embeddingsByType.float : null);

    if (!Array.isArray(embedding)) {
      throw new Error('Bedrock embedding response did not include a valid vector.');
    }

    return {
      embedding,
      inputTextTokenCount: Number(parsed?.inputTextTokenCount || 0)
    };
  }

  // Backward-compatible methods for older OpenAI SDK call patterns.
  async createChatCompletion(params = {}) {
    const data = await this.createChatCompletionsApi(params);
    return { data };
  }

  async createEmbedding(params = {}) {
    const data = await this.createEmbeddingsApi(params);
    return {
      data: {
        data: data.data,
        model: data.model,
        usage: data.usage
      }
    };
  }
}

export { BedrockOpenAICompat, BedrockOpenAICompat as OpenAI };
export default BedrockOpenAICompat;
