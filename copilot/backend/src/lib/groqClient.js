/**
 * Groq client wrapper — provides the same interface as bedrockOpenAICompat.js
 * so it can be used as a drop-in replacement for auxiliary (fast) LLM calls.
 *
 * Usage:
 *   import { createGroqClient } from './groqClient.js';
 *   const groq = createGroqClient();
 *   const res = await groq.chat.completions.create({ messages, max_tokens, temperature });
 *   // or streaming:
 *   for await (const chunk of groq.streamChatCompletion({ messages, max_tokens })) { ... }
 */

import Groq from 'groq-sdk';

const DEFAULT_MODEL =
  process.env.GROQ_MODEL ||
  'llama-3.3-70b-versatile';

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

class GroqOpenAICompat {
  constructor(options = {}) {
    this.apiKey = options.apiKey || GROQ_API_KEY;
    this.defaultModel = options.model || DEFAULT_MODEL;

    if (!this.apiKey) {
      console.warn('⚠️ GROQ_API_KEY not set — GroqClient will be unavailable');
    }

    this.client = this.apiKey
      ? new Groq({ apiKey: this.apiKey })
      : null;

    // OpenAI-compatible interface
    this.chat = {
      completions: {
        create: async (params = {}) => this.createChatCompletion(params)
      }
    };
  }

  isAvailable() {
    return this.client !== null;
  }

  resolveModel(model) {
    // Map Bedrock/OpenAI model names to Groq equivalents
    const m = String(model || '').toLowerCase();
    if (m.includes('claude') || m.includes('gpt') || m.includes('bedrock') || !model) {
      return this.defaultModel;
    }
    return model;
  }

  async createChatCompletion(params = {}) {
    if (!this.client) {
      throw new Error('Groq client not initialized — GROQ_API_KEY missing');
    }

    const model = this.resolveModel(params.model);
    const messages = this._normalizeMessages(params.messages || []);

    const maxTokens = params.max_tokens ?? params.max_completion_tokens ?? 1024;
    const temperature = params.temperature ?? 0.3;

    const response = await this.client.chat.completions.create({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      top_p: params.top_p ?? 0.9
    });

    return {
      id: response.id || `groq-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: response.model || model,
      choices: (response.choices || []).map((choice, index) => ({
        index,
        message: {
          role: choice.message?.role || 'assistant',
          content: choice.message?.content || ''
        },
        finish_reason: choice.finish_reason || 'stop'
      })),
      usage: {
        prompt_tokens: response.usage?.prompt_tokens || 0,
        completion_tokens: response.usage?.completion_tokens || 0,
        total_tokens: response.usage?.total_tokens || 0
      }
    };
  }

  /**
   * Streaming interface — yields text chunks, same as bedrockOpenAICompat.
   */
  async *streamChatCompletion(params = {}) {
    if (!this.client) {
      throw new Error('Groq client not initialized — GROQ_API_KEY missing');
    }

    const model = this.resolveModel(params.model);
    const messages = this._normalizeMessages(params.messages || []);

    const stream = await this.client.chat.completions.create({
      model,
      messages,
      max_tokens: params.max_tokens ?? params.max_completion_tokens ?? 1024,
      temperature: params.temperature ?? 0.3,
      top_p: params.top_p ?? 0.9,
      stream: true
    });

    for await (const chunk of stream) {
      const text = chunk.choices?.[0]?.delta?.content;
      if (typeof text === 'string' && text.length > 0) {
        yield text;
      }
    }
  }

  /**
   * Normalize messages to Groq's format (same as OpenAI).
   * Handles system/user/assistant roles; collapses array content to string.
   */
  _normalizeMessages(messages = []) {
    return messages
      .filter((m) => m && typeof m === 'object' && m.role)
      .map((m) => {
        let content = m.content;

        // Collapse array content (Bedrock format) to string
        if (Array.isArray(content)) {
          content = content
            .map((part) => {
              if (typeof part === 'string') return part;
              if (part?.type === 'text' || part?.text) return part.text || '';
              return '';
            })
            .filter(Boolean)
            .join('\n');
        }

        return {
          role: m.role,
          content: typeof content === 'string' ? content : String(content || '')
        };
      });
  }
}

/**
 * Factory function — returns null if GROQ_API_KEY is not configured
 * so callers can gracefully fall back to Bedrock.
 */
export function createGroqClient(options = {}) {
  const client = new GroqOpenAICompat(options);
  return client.isAvailable() ? client : null;
}

export { GroqOpenAICompat };
export default GroqOpenAICompat;
