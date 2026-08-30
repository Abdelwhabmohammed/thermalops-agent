// Tiered Gemini client w/ fallback chains & rate limiting.
// RULE: pure logic, FLASH: cheap/fast, PRO: best reasoning.
// Structured output (JSON schema) + zod validation. Token bucket per-model.

import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';
import { config } from './config';
import { isDemoMode } from './config';
import { AgentDecisionSchema } from './schemas';

export type AgentTier = 'rule' | 'flash' | 'pro';

export class GeminiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiError';
  }
}

// -- Rate limiter (per-model token bucket) --------------------------------------

class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(private readonly rpm: number) {
    this.tokens = rpm;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    const refill = () => {
      const now = Date.now();
      const elapsedSec = (now - this.lastRefill) / 1000;
      this.tokens = Math.min(this.rpm, this.tokens + elapsedSec * (this.rpm / 60));
      this.lastRefill = now;
    };
    refill();
    if (this.tokens < 1) {
      const waitMs = ((1 - this.tokens) / (this.rpm / 60)) * 1000;
      await new Promise((r) => setTimeout(r, waitMs));
      this.tokens = 0;
    } else {
      this.tokens -= 1;
    }
  }
}

// -- JSON schema for Gemini structured output -----------------------------------

const agentDecisionJsonSchema = {
  type: Type.OBJECT,
  properties: {
    risk_level: { type: Type.STRING, enum: ['LOW', 'ELEVATED', 'CRITICAL'] },
    action: {
      type: Type.STRING,
      enum: ['clear', 'advisory', 'stop_work_order', 'emergency_escalate'],
    },
    wet_bulb_tier: { type: Type.STRING, enum: ['CAUTION', 'MODERATE', 'DANGER', 'EXTREME'] },
    aqi_note: { type: Type.STRING, description: 'One-sentence assessment of air quality risk for outdoor exposure.' },
    svi_note: { type: Type.STRING, description: 'One-sentence assessment of community vulnerability in the site census tract.' },
    explanation: { type: Type.STRING, description: 'Plain-language summary for a construction site supervisor. 2-4 sentences.' },
    recommended_mitigations: { type: Type.ARRAY, items: { type: Type.STRING } },
    confidence: { type: Type.NUMBER, description: 'Confidence in the decision, 0.0-1.0.' },
    needs_human_review: { type: Type.BOOLEAN },
  },
  required: [
    'risk_level', 'action', 'wet_bulb_tier', 'aqi_note', 'svi_note',
    'explanation', 'confidence', 'needs_human_review',
  ],
} as const;

// -- Tiered client ----------------------------------------------------------------

export interface GeminiCallArgs {
  systemPrompt: string;
  userPrompt: string;
}

/** Fallback chains — if the primary model 404s/429s/quota-fails, try the next. */
const PRO_FALLBACKS = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-flash-latest'];
const FLASH_FALLBACKS = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-flash-latest'];

export class TieredGeminiClient {
  private ai: GoogleGenAI;
  private proLimiter: RateLimiter;
  private flashLimiter: RateLimiter;

  constructor() {
    if (!config.gemini.apiKey) throw new GeminiError('GEMINI_API_KEY (or GOOGLE_API_KEY) not set');
    this.ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    this.proLimiter = new RateLimiter(config.gemini.proRpm);
    this.flashLimiter = new RateLimiter(config.gemini.flashRpm);
  }

  private async generateStructured(args: GeminiCallArgs & {
    models: string[];
    temperature: number;
    limiter: RateLimiter;
  }): Promise<Record<string, unknown>> {
    let lastError: unknown = null;
    for (const model of args.models) {
      try {
        await args.limiter.acquire();
        const response = await this.ai.models.generateContent({
          model,
          contents: args.userPrompt,
          config: {
            systemInstruction: args.systemPrompt,
            temperature: args.temperature,
            responseMimeType: 'application/json',
            responseSchema: agentDecisionJsonSchema,
          },
        });

        const text = response.text ?? '';
        if (!text) throw new GeminiError(`${model} returned empty response`);
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          throw new GeminiError(`${model} returned non-JSON: ${String(e)}`);
        }
        AgentDecisionSchema.parse(parsed);
        return parsed as Record<string, unknown>;
      } catch (e) {
        lastError = e;
        const msg = String(e);
        // Retry-worthy failures (model unavailable, rate limit, transient 5xx);
        // schema/validation errors also fall through to the next model since a
        // different model may produce valid output.
        console.warn(`[gemini] ${model} failed (${msg.slice(0, 160)}); trying next fallback…`);
      }
    }
    throw new GeminiError(
      `all models failed (${args.models.join(' → ')}): ${String(lastError)}`,
    );
  }

  async callPro(args: GeminiCallArgs): Promise<Record<string, unknown>> {
    const models = [config.gemini.proModel, ...PRO_FALLBACKS.filter((m) => m !== config.gemini.proModel)];
    return this.generateStructured({ ...args, models, temperature: 0.2, limiter: this.proLimiter });
  }

  async callFlash(args: GeminiCallArgs): Promise<Record<string, unknown>> {
    const models = [config.gemini.flashModel, ...FLASH_FALLBACKS.filter((m) => m !== config.gemini.flashModel)];
    return this.generateStructured({ ...args, models, temperature: 0.3, limiter: this.flashLimiter });
  }
}

// -- Singleton (lazily initialized; survives across requests) --------------------

const globalForGemini = globalThis as unknown as {
  thermalopsGemini?: TieredGeminiClient;
};

export async function getGeminiClient(): Promise<TieredGeminiClient> {
  if (!globalForGemini.thermalopsGemini) {
    globalForGemini.thermalopsGemini = new TieredGeminiClient();
  }
  return globalForGemini.thermalopsGemini;
}

export async function callGeminiTier(
  tier: 'pro' | 'flash',
  args: GeminiCallArgs,
): Promise<Record<string, unknown> | null> {
  if (isDemoMode() || !config.gemini.apiKey) return null;
  const gemini = await getGeminiClient();
  return tier === 'pro' ? gemini.callPro(args) : gemini.callFlash(args);
}
