// Schemas for the agent decision loop — ported from agent/schemas.py.
// AgentDecisionSchema doubles as the validation contract for Gemini output.

import { z } from 'zod';

export const RiskLevelSchema = z.enum(['LOW', 'ELEVATED', 'CRITICAL']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const AgentActionSchema = z.enum([
  'clear',
  'advisory',
  'stop_work_order',
  'emergency_escalate',
]);
export type AgentAction = z.infer<typeof AgentActionSchema>;

export const WetBulbTierSchema = z.enum(['CAUTION', 'MODERATE', 'DANGER', 'EXTREME']);
export type WetBulbTier = z.infer<typeof WetBulbTierSchema>;

export const AgentDecisionSchema = z.object({
  risk_level: RiskLevelSchema.describe('Composite risk classification'),
  action: AgentActionSchema.describe('Operational action to take'),
  wet_bulb_tier: WetBulbTierSchema.describe('OSHA/NIOSH wet-bulb category'),
  aqi_note: z.string().describe(
    'One-sentence assessment of air quality risk for outdoor exposure.',
  ),
  svi_note: z.string().describe(
    'One-sentence assessment of community vulnerability in the site census tract.',
  ),
  explanation: z.string().describe(
    'Plain-language summary for a construction site supervisor. 2-4 sentences.',
  ),
  recommended_mitigations: z.array(z.string()).default([]).describe(
    'Concrete steps the supervisor should take right now.',
  ),
  confidence: z.number().min(0).max(1).describe('Confidence in the decision, 0.0-1.0.'),
  needs_human_review: z.boolean().default(false).describe(
    'True if genuinely ambiguous and a human safety officer should review.',
  ),
});

export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
