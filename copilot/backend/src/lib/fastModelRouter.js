/**
 * Fast Model Router — routes auxiliary LLM calls to Groq (fast)
 * and falls back to Bedrock if Groq is unavailable.
 *
 * Auxiliary tasks: question rewrite, evidence extraction, claim repair.
 * These are simpler tasks where Llama 3.3 70B quality is sufficient
 * and Groq's speed (500-800 tok/s) gives a major latency win.
 *
 * Usage:
 *   import { createFastModelRouter } from './fastModelRouter.js';
 *   const fastModel = createFastModelRouter(bedrockClient);
 *   // Same interface as bedrockOpenAICompat — chat.completions.create()
 *   const res = await fastModel.chat.completions.create({ messages, max_tokens });
 */

import { createGroqClient } from './groqClient.js';
import { logger } from '../utils/logger.js';
import config from '../config/config.js';

class FastModelRouter {
  constructor(bedrockClient) {
    this.bedrock = bedrockClient;
    this.groq = null;
    this._initAttempted = false;
    this._groqErrorCount = 0;
    this._groqDisabledUntil = 0;
    this._GROQ_COOLDOWN_MS = 5 * 60 * 1000; // 5 min cooldown after repeated failures
    this._GROQ_ERROR_THRESHOLD = 3; // disable after 3 consecutive errors

    this.chat = {
      completions: {
        create: async (params = {}) => this._routeCompletion(params)
      }
    };
  }

  _initGroq() {
    if (this._initAttempted) return;
    this._initAttempted = true;

    const groqEnabled = config.groq?.enabled !== false;
    const groqApiKey = config.groq?.apiKey || process.env.GROQ_API_KEY;

    if (!groqEnabled || !groqApiKey) {
      logger.info('[FastModelRouter] Groq disabled or API key missing — using Bedrock for all calls');
      return;
    }

    this.groq = createGroqClient({
      apiKey: groqApiKey,
      model: config.groq?.model || 'llama-3.3-70b-versatile'
    });

    if (this.groq) {
      logger.info(`[FastModelRouter] Groq initialized (model: ${config.groq?.model || 'llama-3.3-70b-versatile'})`);
    } else {
      logger.warn('[FastModelRouter] Groq client creation failed — falling back to Bedrock');
    }
  }

  _isGroqAvailable() {
    this._initGroq();
    if (!this.groq) return false;
    if (Date.now() < this._groqDisabledUntil) return false;
    return true;
  }

  _onGroqSuccess() {
    this._groqErrorCount = 0;
  }

  _onGroqError(error) {
    this._groqErrorCount++;
    logger.warn(`[FastModelRouter] Groq error (${this._groqErrorCount}/${this._GROQ_ERROR_THRESHOLD}): ${error.message}`);

    if (this._groqErrorCount >= this._GROQ_ERROR_THRESHOLD) {
      this._groqDisabledUntil = Date.now() + this._GROQ_COOLDOWN_MS;
      this._groqErrorCount = 0;
      logger.warn(`[FastModelRouter] Groq disabled for ${this._GROQ_COOLDOWN_MS / 1000}s after repeated failures`);
    }
  }

  async _routeCompletion(params = {}) {
    if (this._isGroqAvailable()) {
      try {
        const start = Date.now();
        const result = await this.groq.chat.completions.create(params);
        const elapsed = Date.now() - start;
        logger.info(`[FastModelRouter] Groq responded in ${elapsed}ms (${result.usage?.total_tokens || '?'} tokens)`);
        this._onGroqSuccess();
        return result;
      } catch (error) {
        this._onGroqError(error);
        // Fall through to Bedrock
      }
    }

    // Fallback: use Bedrock
    return this.bedrock.chat.completions.create(params);
  }

  /**
   * Streaming — tries Groq first, falls back to Bedrock.
   */
  async *streamChatCompletion(params = {}) {
    if (this._isGroqAvailable()) {
      try {
        let firstChunkReceived = false;
        for await (const chunk of this.groq.streamChatCompletion(params)) {
          firstChunkReceived = true;
          yield chunk;
        }
        if (firstChunkReceived) {
          this._onGroqSuccess();
          return;
        }
      } catch (error) {
        this._onGroqError(error);
        // Fall through to Bedrock streaming
      }
    }

    for await (const chunk of this.bedrock.streamChatCompletion(params)) {
      yield chunk;
    }
  }
}

export function createFastModelRouter(bedrockClient) {
  return new FastModelRouter(bedrockClient);
}

export default FastModelRouter;
