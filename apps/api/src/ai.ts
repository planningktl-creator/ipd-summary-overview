import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CaseDetail, CodingCandidate, AuditLedger } from "@ipd-summary/contracts";
import type { AppConfig } from "./config.js";
import { sha256 } from "./crypto.js";

export interface AiAnalysisResult {
  artifactId: string;
  provider: string;
  model: string;
  synthetic: boolean;
  candidates: CodingCandidate[];
  neutralQuery: string | null;
  discrepancyClass: string | null;
  humanReviewRequired: true;
  inputHash: string;
}

export interface AiProvider {
  analyze(detail: CaseDetail, audit: AuditLedger): Promise<AiAnalysisResult>;
}

const AiResponseSchema = z.object({
  candidates: z.array(z.object({
    candidateCode: z.string().max(32), role: z.enum(["PDX", "SDX", "PROC"]), description: z.string().max(500),
    evidenceLocation: z.array(z.string().max(300)).max(20), clinicalAction: z.enum(["evaluation", "treatment", "monitoring", "nursing-care", "none"]),
    providerStatus: z.enum(["documented", "absent", "conflicting"]), status: z.enum(["documented", "needs_query", "documentation_gap", "conflict", "rejected"]),
    rulePath: z.array(z.string().max(200)).max(20), version: z.string().max(200),
  })).max(50),
  neutralQuery: z.string().max(1000).nullable(),
  discrepancyClass: z.string().max(200).nullable(),
});

function inputHash(detail: CaseDetail, audit: AuditLedger): string {
  return sha256(JSON.stringify({
    masked: { hn: detail.hnMasked, patient: detail.patientNameMasked, ward: detail.ward, status: detail.status },
    diagnoses: detail.diagnoses, notes: detail.doctorNotes.map((note) => ({ text: note.text, recordedAt: note.recordedAt })),
    evidence: audit.evidence, versions: audit.scope,
  }));
}

function asCandidate(raw: z.infer<typeof AiResponseSchema>["candidates"][number], evidence: AuditLedger["evidence"]): CodingCandidate {
  const linkedEvidence = evidence.filter((item) => raw.evidenceLocation.some((location) => location.toLowerCase().includes(item.documentType.toLowerCase()) || location.toLowerCase().includes(item.id.toLowerCase())));
  return {
    id: `ai-${randomUUID()}`,
    candidateCode: raw.candidateCode,
    role: raw.role,
    description: raw.description,
    evidence: linkedEvidence,
    providerStatus: raw.providerStatus,
    status: raw.status,
    rulePath: raw.rulePath,
    version: raw.version,
    drgSensitivity: "QA/what-if only",
    humanReview: "required",
  };
}

function safePrompt(detail: CaseDetail, audit: AuditLedger): string {
  return JSON.stringify({
    task: "Propose evidence-bound DRG coding candidates for human review. Do not assign a code from inference alone.",
    constraints: [
      "Use Thai DRG 6.3.3, ICD-10/ICD-10-TM 2016 and ICD-9-CM 2015 only.",
      "A procedure candidate requires documented performed evidence; planned or inferred is not performed.",
      "If documentation conflicts or is insufficient, return a neutral query; never upcode or optimize RW.",
      "Return evidenceLocation, clinicalAction, providerStatus, rulePath and version for every candidate.",
    ],
    case: {
      ward: detail.ward, status: detail.status, diagnoses: detail.diagnoses, notes: detail.doctorNotes,
      labs: detail.labs, imaging: detail.imaging, nursing: detail.nursing, procedures: detail.procedures,
    },
    audit: { scope: audit.scope, evidence: audit.evidence, validation: audit.validation, grouper: audit.grouper },
  });
}

export class DisabledAiProvider implements AiProvider {
  async analyze(): Promise<AiAnalysisResult> { throw new Error("AI_DISABLED"); }
}

export class DemoAiProvider implements AiProvider {
  async analyze(detail: CaseDetail, audit: AuditLedger): Promise<AiAnalysisResult> {
    return {
      artifactId: `demo-ai-${randomUUID()}`, provider: "synthetic-demo", model: "contract-fixture", synthetic: true,
      candidates: audit.candidates.map((candidate) => ({ ...candidate, humanReview: "required" as const })),
      neutralQuery: audit.status === "needs_query" ? "กรุณายืนยันการวินิจฉัยหลักและสถานะการรักษาจากเอกสารของแพทย์" : null,
      discrepancyClass: audit.discrepancy.category,
      humanReviewRequired: true,
      inputHash: inputHash(detail, audit),
    };
  }
}

export class OpenAICompatibleAiProvider implements AiProvider {
  constructor(private readonly config: AppConfig) {}

  async analyze(detail: CaseDetail, audit: AuditLedger): Promise<AiAnalysisResult> {
    if (!this.config.aiBaseUrl || !this.config.aiApiKey) throw new Error("AI_CREDENTIALS_NOT_CONFIGURED");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.aiTimeoutMs);
    try {
      const response = await fetch(`${this.config.aiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST", signal: controller.signal,
        headers: { authorization: `Bearer ${this.config.aiApiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: this.config.aiModel, temperature: 0, response_format: { type: "json_object" }, messages: [
          { role: "system", content: "You are an evidence-first clinical coding assistant. Output JSON only. Human review is mandatory." },
          { role: "user", content: safePrompt(detail, audit) },
        ] }),
      });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(`AI_HTTP_${response.status}`);
      const choices = Array.isArray(body.choices) ? body.choices : [];
      const content = (choices[0] as Record<string, unknown> | undefined)?.message;
      const text = typeof content === "object" && content ? (content as Record<string, unknown>).content : null;
      if (typeof text !== "string") throw new Error("AI_RESPONSE_INVALID");
      const parsed = AiResponseSchema.parse(JSON.parse(text.replace(/^```json\s*|\s*```$/g, "")));
      return {
        artifactId: `ai-${randomUUID()}`, provider: "openai-compatible", model: this.config.aiModel, synthetic: false,
        candidates: parsed.candidates.map((candidate) => asCandidate(candidate, audit.evidence)), neutralQuery: parsed.neutralQuery,
        discrepancyClass: parsed.discrepancyClass, humanReviewRequired: true, inputHash: inputHash(detail, audit),
      };
    } finally { clearTimeout(timeout); }
  }
}

export function createAiProvider(config: AppConfig): AiProvider {
  if (config.demoAi) return new DemoAiProvider();
  if (config.aiBaseUrl && config.aiApiKey) return new OpenAICompatibleAiProvider(config);
  return new DisabledAiProvider();
}
