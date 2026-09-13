// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

const fixtures = vi.hoisted(() => {
  const grouper = { engine: "none", executableVersion: null, responseStatus: "not_run", requestHash: null, drg: null, mdc: null, dc: null, err: null, warn: null, rw: null, adjrw: null, wtlos: null, ot: null, sourceAsOf: null };
  const audit = { scope: { tdrgVersion: "6.3.3", icd10Version: "WHO/ICD-10-TM 2016", procedureVersion: "ICD-9-CM 2015 + Thai extension rules", fund: null, grouperEngine: "none", grouperBuild: null, policy: null }, rawInput: {}, normalizedInput: {}, evidence: [], candidates: [], validation: { errorCode: null, warningMask: 0, checks: [] }, groupingTrace: [], discrepancy: { category: null, summary: null }, grouper, status: "ready_for_review", updatedAt: "2026-09-13T00:00:00.000Z" };
  const list = { caseRef: "demo-case-ref", an: "AN-DEMO-001", hnMasked: "HN •••• 102", patientNameMasked: "ผู้ป่วยตัวอย่าง ก", ward: "06", wardName: "อายุรกรรมชาย", admitAt: "2026-09-10T09:10:00.000Z", dischargeAt: null, status: "admitted", admissionSnapshot: { bedNo: "B-06", bedType: "สามัญ", roomNo: "R-06", roomName: "ห้องอายุรกรรมชาย", bedOrder: 1, pdxName: "Pneumonia, unspecified organism", diagnosisCount: 2, ageYears: 54, ageMonths: null, ageDays: null, admitDoctorName: "แพทย์รับไว้ตัวอย่าง", inchargeDoctorName: "แพทย์เจ้าของไข้ตัวอย่าง", ownerDoctorName: "แพทย์เจ้าของไข้ตัวอย่าง", dischargeDoctorName: null, currentDepartmentName: "อายุรกรรม", admitTypeName: "รับไว้รักษาแบบปกติ", rightCode: "UC-DEMO", rightName: "สิทธิ์ตัวอย่าง", financeStatus: "open", financeStatusName: "พร้อมตรวจสอบ", debtMoney: 0, waitingPaidMoney: 100, waitingDebtMoney: 0, dischargeOrderStatus: "สั่งจำหน่ายแล้ว", dischargeTypeName: "กลับบ้าน", dischargeStatusName: "จำหน่ายแล้ว", finalSummaryStatus: "ยืนยันแล้ว", auditSummaryStatus: "ยืนยันแล้ว", summaryStatusName: "สรุปแล้ว", summaryAckStatus: "รับทราบแล้ว", summaryMedicationStatus: "ทบทวนแล้ว", operationStatusName: "ไม่มีรายการผ่าตัด", infectionFlag: "ไม่พบสัญญาณ", physicStatusId: null, collectionStatusName: "ครบถ้วน", drgDescription: null, lastSyncAt: "2026-09-13T00:00:00.000Z" }, pdx: "J189", drg: null, rw: null, adjrw: null, finance: { itemMoney: 100, paidMoney: 0, receivedMoney: 0, waitingMoney: 100, status: "available" }, grouper, dataWarnings: [], sourceAsOf: "2026-09-13T00:00:00.000Z" };
  const detail = { ...list, demographics: { age: 54, sex: "ชาย", birthDate: null, allergy: [] }, vitals: [], diagnoses: [], doctorNotes: [], medications: [], labs: [], imaging: [], nursing: [], fluidBalance: [{ date: "2026-09-12", intake: 100, output: 80, net: 20 }], procedures: [], attachments: [], audit };
  return { session: { connected: true, mode: "demo", databaseType: "postgresql", hospitalCode: "DEMO", actor: { id: "demo", displayName: "Demo auditor", roles: ["viewer", "auditor"] }, expiresAt: "2026-09-14T00:00:00.000Z" }, page: { rows: [list], nextCursor: null, total: 1, sourceAsOf: "2026-09-13T00:00:00.000Z" }, detail };
});

vi.mock("./api", () => ({
  getSession: vi.fn(() => Promise.resolve(fixtures.session)),
  getCases: vi.fn(() => Promise.resolve(fixtures.page)),
  getCase: vi.fn(() => Promise.resolve(fixtures.detail)),
  requestAi: vi.fn(),
  uploadMarkdown: vi.fn(),
}));

import App from "./App";

describe("IPD summary dashboard", () => {
  it("renders the admission board and evidence rail from an API fixture", async () => {
    render(<App />);
    expect(await screen.findByText("AN-DEMO-001")).toBeInTheDocument();
    expect(await screen.findByText("เตียง / ห้อง")).toBeInTheDocument();
    expect(await screen.findByText("สิทธิ์ตัวอย่าง")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "DRG audit" })).toBeInTheDocument();
    expect(await screen.findByText("Version fence")).toBeInTheDocument();
    expect(screen.queryByText(/bearerToken/i)).not.toBeInTheDocument();
  });
});
