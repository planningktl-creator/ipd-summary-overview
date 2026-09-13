import type { CaseDetail, CaseListItem, GrouperResult } from "@ipd-summary/contracts";
import { initialAuditLedger } from "./drg.js";

const asOf = "2026-09-13T08:00:00.000Z";

function grouper(overrides: Partial<GrouperResult> = {}): GrouperResult {
  return {
    engine: "CMI_API",
    executableVersion: "demo-contract",
    responseStatus: "valid",
    requestHash: "demo-request-hash-c0001",
    drg: "04522",
    mdc: "04",
    dc: "05",
    err: 0,
    warn: 0,
    rw: 1.21,
    adjrw: 1.21,
    wtlos: 4.2,
    ot: 12.6,
    sourceAsOf: asOf,
    ...overrides,
  };
}

function finance(itemMoney: number, paidMoney: number, receivedMoney: number): CaseListItem["finance"] {
  return {
    itemMoney,
    paidMoney,
    receivedMoney,
    waitingMoney: Math.max(itemMoney - receivedMoney, 0),
    status: "available",
  };
}

export function buildSyntheticCase(caseRef: string, variant: "ready" | "attention" = "ready"): CaseDetail {
  const isAttention = variant === "attention";
  const currentGrouper = isAttention ? grouper({ responseStatus: "empty", drg: null, rw: null, adjrw: null, err: null, warn: null, requestHash: null }) : grouper();
  const list: CaseListItem = {
    caseRef,
    an: isAttention ? "AN-DEMO-002" : "AN-DEMO-001",
    hnMasked: isAttention ? "HN •••• 284" : "HN •••• 102",
    patientNameMasked: isAttention ? "ผู้ป่วยตัวอย่าง ข" : "ผู้ป่วยตัวอย่าง ก",
    ward: isAttention ? "12" : "06",
    wardName: isAttention ? "อายุรกรรมหญิง" : "อายุรกรรมชาย",
    admitAt: isAttention ? "2026-09-11T05:20:00+07:00" : "2026-09-10T09:10:00+07:00",
    dischargeAt: isAttention ? null : "2026-09-13T07:30:00+07:00",
    status: isAttention ? "admitted" : "discharged",
    pdx: isAttention ? null : "J189",
    drg: currentGrouper.drg,
    rw: currentGrouper.rw,
    adjrw: currentGrouper.adjrw,
    finance: finance(isAttention ? 18250 : 24780, isAttention ? 0 : 21000, isAttention ? 0 : 20500),
    grouper: currentGrouper,
    dataWarnings: isAttention ? ["ยังไม่มี PDx ที่ยืนยัน", "Grouper ตอบกลับ empty ต้องตรวจสอบ service"] : [],
    sourceAsOf: asOf,
  };
  const audit = initialAuditLedger(
    {
      pdx: list.pdx,
      sdx: isAttention ? ["I10", "I10"] : ["I10"],
      procedures: [],
      age: isAttention ? 68 : 54,
      ageDay: null,
      sex: "1",
      discht: list.status === "discharged" ? "1" : null,
      dateAdm: list.admitAt?.slice(0, 10),
      timeAdm: list.admitAt?.slice(11, 16),
      dateDsc: list.dischargeAt?.slice(0, 10),
      timeDsc: list.dischargeAt?.slice(11, 16),
      leaveDay: 0,
      los: isAttention ? 2 : 3,
    },
    currentGrouper,
  );
  const evidence = isAttention
    ? [
        { id: "ev-c0002-1", documentType: "progress_note", authorRole: "แพทย์", occurredAt: list.admitAt, section: "assessment", textSpan: "มีอาการเหนื่อย ต้องติดตามผลตรวจเพิ่มเติม", evidenceType: "supported-care" as const, clinicalAction: "monitoring" as const, sourceHash: "synthetic-evidence-2" },
      ]
    : [
        { id: "ev-c0001-1", documentType: "discharge_summary", authorRole: "แพทย์", occurredAt: list.dischargeAt, section: "final diagnosis", textSpan: "สรุปภาวะปอดอักเสบและแนวทางรักษาใน admission นี้", evidenceType: "documented" as const, clinicalAction: "treatment" as const, sourceHash: "synthetic-evidence-1" },
        { id: "ev-c0001-2", documentType: "nursing_record", authorRole: "พยาบาล", occurredAt: "2026-09-11T10:00:00+07:00", section: "monitoring", textSpan: "ติดตาม oxygen saturation และการตอบสนองต่อการรักษา", evidenceType: "supported-care" as const, clinicalAction: "nursing-care" as const, sourceHash: "synthetic-evidence-1b" },
      ];
  audit.evidence = evidence;
  audit.candidates = isAttention
    ? [
        { id: "candidate-c0002-1", candidateCode: "I10", role: "SDX", description: "ภาวะความดันโลหิตสูง", evidence: [evidence[0]!], providerStatus: "absent", status: "needs_query", rulePath: ["DRG 6.3.3/44", "DRG 6.3.3/46"], version: "ICD-10-TM 2016 / TDRG 6.3.3", drgSensitivity: "QA/what-if only", humanReview: "required" },
      ]
    : [
        { id: "candidate-c0001-1", candidateCode: "J189", role: "PDX", description: "ปอดอักเสบ ไม่ระบุเชื้อ", evidence: [evidence[0]!], providerStatus: "documented", status: "documented", rulePath: ["DRG 6.3.3/25", "DRG 6.3.3/44"], version: "ICD-10-TM 2016 / TDRG 6.3.3", drgSensitivity: "QA/what-if only", humanReview: "required" },
        { id: "candidate-c0001-2", candidateCode: "I10", role: "SDX", description: "ความดันโลหิตสูง", evidence: [evidence[1]!], providerStatus: "documented", status: "documented", rulePath: ["DRG 6.3.3/46", "DRG 6.3.3/48"], version: "ICD-10-TM 2016 / TDRG 6.3.3", drgSensitivity: "QA/what-if only", humanReview: "required" },
      ];
  audit.status = isAttention ? "needs_query" : "ready_for_review";
  const detail: CaseDetail = {
    ...list,
    demographics: { age: isAttention ? 68 : 54, sex: "ชาย", birthDate: null, allergy: ["ไม่พบประวัติแพ้ยาที่ active"] },
    vitals: [
      { recordedAt: "2026-09-13T06:45:00+07:00", temperature: 37.2, pulse: 88, respiratoryRate: 20, bp: "128/76", spo2: 96, painScore: 1, news2: 1 },
      { recordedAt: "2026-09-12T18:10:00+07:00", temperature: 37.5, pulse: 92, respiratoryRate: 22, bp: "132/80", spo2: 95, painScore: 2, news2: 2 },
    ],
    diagnoses: isAttention ? [] : [{ code: "J189", name: "Pneumonia, unspecified organism", type: "PDx", recordedAt: list.admitAt }, { code: "I10", name: "Essential hypertension", type: "SDx", recordedAt: list.admitAt }],
    doctorNotes: [{ text: "ข้อมูลจำลองสำหรับตรวจการไหลของหน้าจอและ audit evidence", doctor: "แพทย์ตัวอย่าง", recordedAt: list.admitAt }],
    medications: [{ name: "ยาตัวอย่างสำหรับทดสอบ", dose: "ตามแผนการรักษา", route: "PO", orderedAt: list.admitAt, status: "approved" }],
    labs: [{ id: "lab-demo-1", name: "CBC (synthetic)", result: "ผลจำลองสำหรับทดสอบ", unit: null, collectedAt: "2026-09-12T08:00:00+07:00", imageCount: 0 }],
    imaging: [{ id: "img-demo-1", name: "Chest X-ray (synthetic)", report: "รายงานจำลอง ไม่ใช่ผลผู้ป่วยจริง", reportedAt: "2026-09-12T11:00:00+07:00", imageAvailable: false }],
    nursing: [{ note: "ติดตามสัญญาณชีพและการตอบสนองต่อการรักษา (synthetic)", recordedAt: "2026-09-13T06:45:00+07:00", shift: "เช้า" }],
    fluidBalance: [{ date: "2026-09-12", intake: 1800, output: 1450, net: 350 }, { date: "2026-09-13", intake: 900, output: 700, net: 200 }],
    procedures: [],
    finance: list.finance,
    attachments: [],
    audit,
  };
  return detail;
}
