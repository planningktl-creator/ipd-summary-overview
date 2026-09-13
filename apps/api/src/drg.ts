import type { AuditLedger, GrouperResult } from "@ipd-summary/contracts";

export const DRG_VERSION = "Thai DRG 6.3.3" as const;
export const ICD10_VERSION = "WHO/ICD-10-TM 2016" as const;
export const PROCEDURE_VERSION = "ICD-9-CM 2015 + Thai extension rules" as const;

export const WARNING_CODES = Object.freeze({
  duplicateDiagnosis: 1,
  ageMismatch: 2,
  sexMismatch: 4,
  invalidProcedure: 8,
  procedureSexMismatch: 16,
  missingSex: 32,
  missingDischargeType: 64,
  invalidAdmissionTime: 128,
  invalidDischargeTime: 256,
});

export interface DrgInput {
  pdx?: string | null;
  sdx?: string[];
  procedures?: string[];
  age?: number | null;
  ageDay?: number | null;
  sex?: string | null;
  admWt?: number | null;
  discht?: string | null;
  dateAdm?: string | null;
  timeAdm?: string | null;
  dateDsc?: string | null;
  timeDsc?: string | null;
  leaveDay?: number | null;
  los?: number | null;
}

export interface ValidationResult {
  errorCode: number | null;
  warningMask: number;
  checks: Array<{ key: string; status: "pass" | "warning" | "error"; detail: string }>;
}

const code = (value: string | null | undefined): string => (value ?? "").replaceAll(".", "").trim().toUpperCase();

function validIcd10(value: string): boolean {
  return /^[A-Z][0-9][0-9A-Z]{1,5}$/.test(value);
}

function validProcedure(value: string): boolean {
  return /^\d{3,5}$/.test(value);
}

function validTime(value: string | null | undefined): boolean {
  if (!value) return false;
  const match = /^(\d{2}):?(\d{2})$/.exec(value);
  if (!match) return false;
  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

export function validateDrgInput(input: DrgInput): ValidationResult {
  const checks: ValidationResult["checks"] = [];
  let errorCode: number | null = null;
  let warningMask = 0;
  const setError = (codeNumber: number, key: string, detail: string) => {
    if (errorCode === null || codeNumber < errorCode) errorCode = codeNumber;
    checks.push({ key, status: "error", detail });
  };
  const setWarning = (warning: number, key: string, detail: string) => {
    warningMask |= warning;
    checks.push({ key, status: "warning", detail });
  };

  const pdx = code(input.pdx);
  const sdx = (input.sdx ?? []).map(code).filter(Boolean);
  const procedures = (input.procedures ?? []).map(code).filter(Boolean);

  if (!pdx) setError(1, "pdx", "ยังไม่มี Principal Diagnosis");
  else if (!validIcd10(pdx) || /^[VWXY]/.test(pdx)) setError(2, "pdx-format", "PDx ไม่ผ่านรูปแบบหรือเป็น external cause");
  else if (/^Z(?:00|01|02|03|04|08|09|10|11|12|13|20|21|22|28|29|76)/.test(pdx)) setError(3, "pdx-acceptable", "PDx เป็นกลุ่มที่ต้องทบทวนความเหมาะสมสำหรับผู้ป่วยใน");
  else checks.push({ key: "pdx", status: "pass", detail: "PDx มีรูปแบบที่ตรวจได้" });

  const seen = new Set<string>();
  for (const value of sdx) {
    if (!validIcd10(value) || value === pdx || seen.has(value)) setWarning(WARNING_CODES.duplicateDiagnosis, "sdx", `SDx ${value} ซ้ำหรือรูปแบบไม่ถูกต้อง`);
    seen.add(value);
  }
  for (const value of procedures) {
    if (!validProcedure(value)) setWarning(WARNING_CODES.invalidProcedure, "procedure", `Procedure ${value} ไม่ผ่านรูปแบบตัวเลข`);
  }
  if (input.age === null || input.age === undefined || input.age < 0 || input.age > 124) setError(6, "age", "Age หายหรืออยู่นอกช่วงที่รองรับ");
  else checks.push({ key: "age", status: "pass", detail: "Age อยู่ในช่วงที่รองรับ" });
  if (!input.sex || !["1", "2"].includes(input.sex)) setWarning(WARNING_CODES.missingSex, "sex", "ไม่พบเพศหรือเพศอยู่นอกค่าที่รองรับ");
  if (!input.discht) setWarning(WARNING_CODES.missingDischargeType, "discharge-type", "ไม่พบ discharge type");
  if (input.dateAdm && input.timeAdm && !validTime(input.timeAdm)) setWarning(WARNING_CODES.invalidAdmissionTime, "admission-time", "เวลา admit ไม่ถูกต้อง");
  if (input.dateDsc && input.timeDsc && !validTime(input.timeDsc)) setWarning(WARNING_CODES.invalidDischargeTime, "discharge-time", "เวลา discharge ไม่ถูกต้อง");
  if (input.los !== null && input.los !== undefined && input.los < 0) setError(9, "los", "LOS ติดลบ");
  else checks.push({ key: "los", status: "pass", detail: "LOS พร้อมใช้สำหรับการทบทวน" });

  return { errorCode, warningMask, checks };
}

function coefficientSet(rw: number, drg: string | null): { b12: number; b23: number } {
  const isProcedure = Boolean(drg && Number(drg.slice(2, 4)) < 50);
  if (isProcedure) return rw < 2 ? { b12: 0.0904, b23: 0.0584 } : { b12: 0.158, b23: 0.1268 };
  return rw < 0.7 ? { b12: 0.077, b23: 0.048 } : { b12: 0.1212, b23: 0.0743 };
}

export function calculateAdjRw(input: {
  los: number;
  rw: number;
  rw0d: number;
  wtlos: number;
  ot: number;
  of: number;
  drg?: string | null;
}): number {
  const { los, rw, rw0d, wtlos, ot, of, drg = null } = input;
  if (los < 1) return rw0d !== 0 ? rw0d : rw;
  if (wtlos > 3 && los < wtlos / 3) return rw0d + (los * (rw - rw0d)) / Math.ceil(wtlos / 3);
  if (los <= ot) return rw;
  const { b12, b23 } = coefficientSet(rw, drg);
  if (los <= ot * 2) return rw + of * b12 * (los - ot);
  if (los <= ot * 3) return rw + of * b12 * ot + of * b23 * (los - ot * 2);
  return rw + of * ot * (b12 + b23);
}

export function initialAuditLedger(input: DrgInput, grouper: GrouperResult): AuditLedger {
  const validation = validateDrgInput(input);
  const status = validation.errorCode ? "insufficient_documentation" : validation.warningMask ? "needs_query" : "ready_for_review";
  return {
    scope: {
      tdrgVersion: "6.3.3",
      icd10Version: ICD10_VERSION,
      procedureVersion: PROCEDURE_VERSION,
      fund: null,
      grouperEngine: grouper.engine,
      grouperBuild: grouper.executableVersion,
      policy: null,
    },
    rawInput: { ...input },
    normalizedInput: {
      pdx: code(input.pdx),
      sdx: (input.sdx ?? []).map(code).filter(Boolean),
      procedures: (input.procedures ?? []).map(code).filter(Boolean),
      los: input.los ?? null,
    },
    evidence: [],
    candidates: [],
    validation,
    groupingTrace: [
      { step: "input-validation", result: validation.errorCode ? `error-${validation.errorCode}` : "passed", sourceReference: "DRG 6.3.3/04" },
      { step: "mdc-path", result: "pending-human-review", sourceReference: "DRG 6.3.3/05" },
      { step: "complexity", result: "pending-human-review", sourceReference: "DRG 6.3.3/08" },
      { step: "rw-adjrw", result: grouper.responseStatus, sourceReference: "DRG 6.3.3/09 + Appendix H" },
    ],
    discrepancy: { category: null, summary: null },
    grouper,
    status,
    updatedAt: new Date().toISOString(),
  };
}
