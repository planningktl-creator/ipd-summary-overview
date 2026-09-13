export type CaseStatus = "admitted" | "discharged" | "unknown";
export type DataAvailability = "available" | "partial" | "missing";
export type AuditStatus =
  | "draft"
  | "needs_query"
  | "conflict"
  | "insufficient_documentation"
  | "ready_for_review"
  | "complete";

export type EvidenceType = "documented" | "supported-care" | "inferred";
export type CandidateStatus =
  | "documented"
  | "needs_query"
  | "documentation_gap"
  | "conflict"
  | "rejected";
export type CandidateRole = "PDX" | "SDX" | "PROC";

export interface SessionStatus {
  connected: boolean;
  mode: "demo" | "bms" | "disconnected";
  databaseType: "postgresql" | "unknown";
  hospitalCode: string | null;
  actor: {
    id: string;
    displayName: string;
    roles: string[];
  } | null;
  expiresAt: string | null;
}

export interface CaseListParams {
  q?: string;
  ward?: string;
  status?: "all" | CaseStatus;
  admitFrom?: string;
  admitTo?: string;
  dischargeFrom?: string;
  dischargeTo?: string;
  cursor?: string;
  limit?: number;
}

export interface FinanceSummary {
  itemMoney: number | null;
  paidMoney: number | null;
  receivedMoney: number | null;
  waitingMoney: number | null;
  status: DataAvailability;
}

export interface AdmissionListSnapshot {
  bedNo: string | null;
  bedType: string | null;
  roomNo: string | null;
  roomName: string | null;
  bedOrder: number | null;
  pdxName: string | null;
  diagnosisCount: number | null;
  ageYears: number | null;
  ageMonths: number | null;
  ageDays: number | null;
  admitDoctorName: string | null;
  inchargeDoctorName: string | null;
  ownerDoctorName: string | null;
  dischargeDoctorName: string | null;
  currentDepartmentName: string | null;
  admitTypeName: string | null;
  rightCode: string | null;
  rightName: string | null;
  financeStatus: string | null;
  financeStatusName: string | null;
  debtMoney: number | null;
  waitingPaidMoney: number | null;
  waitingDebtMoney: number | null;
  dischargeOrderStatus: string | null;
  dischargeTypeName: string | null;
  dischargeStatusName: string | null;
  finalSummaryStatus: string | null;
  auditSummaryStatus: string | null;
  summaryStatusName: string | null;
  summaryAckStatus: string | null;
  summaryMedicationStatus: string | null;
  operationStatusName: string | null;
  infectionFlag: string | null;
  physicStatusId: number | null;
  collectionStatusName: string | null;
  drgDescription: string | null;
  lastSyncAt: string | null;
}

export interface GrouperResult {
  engine: "TGrp" | "TDS" | "CMI_API" | "none";
  executableVersion: string | null;
  responseStatus: "valid" | "empty" | "transport_error" | "invalid_input" | "not_run";
  requestHash: string | null;
  drg: string | null;
  mdc: string | null;
  dc: string | null;
  err: number | null;
  warn: number | null;
  rw: number | null;
  adjrw: number | null;
  wtlos: number | null;
  ot: number | null;
  sourceAsOf: string | null;
}

export interface CaseListItem {
  caseRef: string;
  an: string;
  hnMasked: string | null;
  patientNameMasked: string | null;
  ward: string | null;
  wardName: string | null;
  admitAt: string | null;
  dischargeAt: string | null;
  status: CaseStatus;
  admissionSnapshot: AdmissionListSnapshot;
  pdx: string | null;
  drg: string | null;
  rw: number | null;
  adjrw: number | null;
  finance: FinanceSummary;
  grouper: GrouperResult;
  dataWarnings: string[];
  sourceAsOf: string;
}

export interface VitalReading {
  recordedAt: string;
  temperature: number | null;
  pulse: number | null;
  respiratoryRate: number | null;
  bp: string | null;
  spo2: number | null;
  painScore: number | null;
  news2: number | null;
}

export interface EvidenceItem {
  id: string;
  documentType: string;
  authorRole: string | null;
  occurredAt: string | null;
  section: string | null;
  textSpan: string;
  evidenceType: EvidenceType;
  clinicalAction: "evaluation" | "treatment" | "monitoring" | "nursing-care" | "none";
  sourceHash: string;
}

export interface CodingCandidate {
  id: string;
  candidateCode: string;
  role: CandidateRole;
  description: string;
  evidence: EvidenceItem[];
  providerStatus: "documented" | "absent" | "conflicting";
  status: CandidateStatus;
  rulePath: string[];
  version: string;
  drgSensitivity: "QA/what-if only";
  humanReview: "required" | "reviewed";
}

export interface AuditScope {
  tdrgVersion: "6.3.3";
  icd10Version: "WHO/ICD-10-TM 2016";
  procedureVersion: "ICD-9-CM 2015 + Thai extension rules";
  fund: string | null;
  grouperEngine: string;
  grouperBuild: string | null;
  policy: string | null;
}

export interface AuditLedger {
  scope: AuditScope;
  rawInput: Record<string, unknown>;
  normalizedInput: Record<string, unknown>;
  evidence: EvidenceItem[];
  candidates: CodingCandidate[];
  validation: {
    errorCode: number | null;
    warningMask: number;
    checks: Array<{ key: string; status: "pass" | "warning" | "error"; detail: string }>;
  };
  groupingTrace: Array<{
    step: string;
    result: string;
    sourceReference: string;
  }>;
  discrepancy: {
    category: string | null;
    summary: string | null;
  };
  grouper: GrouperResult;
  status: AuditStatus;
  updatedAt: string;
}

export interface AttachmentMeta {
  id: string;
  filename: string;
  size: number;
  sha256: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface CaseDetail extends CaseListItem {
  demographics: {
    age: number | null;
    sex: string | null;
    birthDate: string | null;
    allergy: string[];
  };
  vitals: VitalReading[];
  diagnoses: Array<{ code: string; name: string; type: string; recordedAt: string | null }>;
  doctorNotes: Array<{ text: string; doctor: string | null; recordedAt: string | null }>;
  medications: Array<{ name: string; dose: string | null; route: string | null; orderedAt: string | null; status: string }>;
  labs: Array<{ id: string; name: string; result: string; unit: string | null; collectedAt: string | null; imageCount: number }>;
  imaging: Array<{ id: string; name: string; report: string; reportedAt: string | null; imageAvailable: boolean }>;
  nursing: Array<{ note: string; recordedAt: string | null; shift: string | null }>;
  fluidBalance: Array<{ date: string; intake: number; output: number; net: number }>;
  procedures: Array<{ code: string; name: string; performedAt: string | null; status: "performed" | "planned" | "unclear" }>;
  finance: FinanceSummary;
  attachments: AttachmentMeta[];
  audit: AuditLedger;
}

export interface CasePage {
  rows: CaseListItem[];
  nextCursor: string | null;
  total: number;
  sourceAsOf: string;
}

export interface ApiError {
  error: string;
  code: string;
  correlationId?: string;
}
