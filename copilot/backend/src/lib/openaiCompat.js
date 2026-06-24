// OpenAI SDK wrapper that provides the same interface as bedrockOpenAICompat.js
// Supports: chat.completions.create, embeddings.create, streamChatCompletion
import OpenAI from 'openai';

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

class OpenAICompat {
  constructor(options = {}) {
    this.defaultModel = options.model || DEFAULT_MODEL;
    this.client = new OpenAI({
      apiKey: options.apiKey || process.env.OPENAI_API_KEY
    });

    // OpenAI-compatible interface (same as bedrockOpenAICompat)
    this.chat = {
      completions: {
        create: async (params = {}) => {
          const model = params.model && !/^(anthropic\.|amazon\.|us\.)/.test(params.model)
            ? params.model
            : this.defaultModel;
          return this.client.chat.completions.create({
            ...params,
            model
          });
        }
      }
    };

    this.embeddings = {
      create: async (params = {}) => {
        const model = params.model && !/^(amazon\.|cohere\.)/.test(params.model)
          ? params.model
          : (process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small');
        return this.client.embeddings.create({
          ...params,
          model
        });
      }
    };
  }

  /**
   * Stream a chat completion, yielding text chunks via an async generator.
   * Same interface as bedrockOpenAICompat.streamChatCompletion.
   */
  async * streamChatCompletion(params = {}) {
    const model = params.model && !/^(anthropic\.|amazon\.|us\.)/.test(params.model)
      ? params.model
      : this.defaultModel;
    const stream = await this.client.chat.completions.create({
      ...params,
      model,
      stream: true
    });
    for await (const chunk of stream) {
      const text = chunk.choices?.[0]?.delta?.content;
      if (typeof text === 'string' && text.length > 0) {
        yield text;
      }
    }
  }
}

export { OpenAICompat, OpenAICompat as OpenAI };
export default OpenAICompat;
