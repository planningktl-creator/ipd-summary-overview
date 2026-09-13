import { z } from "zod";
import type { AppConfig } from "./config.js";
import { openJson, sealJson } from "./crypto.js";

const CaseRefSchema = z.object({
  hospitalCode: z.string().min(1).max(128),
  an: z.string().min(1).max(128),
  expiresAt: z.number().int().positive(),
});

export type CaseRefPayload = z.infer<typeof CaseRefSchema>;

export function createCaseRef(an: string, hospitalCode: string, config: AppConfig, ttlMs = 24 * 60 * 60 * 1000): string {
  const payload: CaseRefPayload = { hospitalCode, an, expiresAt: Date.now() + ttlMs };
  return sealJson(payload, config.caseRefSecret);
}

export function resolveCaseRef(caseRef: string, config: AppConfig): CaseRefPayload | null {
  try {
    const payload = CaseRefSchema.parse(openJson<unknown>(caseRef, config.caseRefSecret));
    return payload.expiresAt > Date.now() ? payload : null;
  } catch {
    return null;
  }
}
