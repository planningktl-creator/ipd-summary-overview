import type { AppConfig } from "./config.js";
import { executeSql, type JsonRecord } from "./bms-client.js";
import { createCaseRef, resolveCaseRef } from "./case-ref.js";
import { initialAuditLedger } from "./drg.js";
import type { SessionPayload } from "./session.js";
import { buildSyntheticCase } from "./synthetic.js";
import type { AdmissionListSnapshot, CaseDetail, CaseListItem, CasePage, CaseListParams, FinanceSummary, GrouperResult } from "@ipd-summary/contracts";

const sourceAsOf = new Date().toISOString();

export interface DataProvider {
  getCases(params: CaseListParams, session: SessionPayload): Promise<CasePage>;
  getCase(caseRef: string, session: SessionPayload): Promise<CaseDetail>;
}

function text(row: JsonRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function number(row: JsonRecord, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function dateTime(row: JsonRecord, dateKey: string, timeKey: string): string | null {
  const date = text(row, dateKey);
  if (!date) return null;
  const time = text(row, timeKey) ?? "00:00:00";
  const iso = new Date(`${date.slice(0, 10)}T${time.slice(0, 8)}`);
  return Number.isNaN(iso.getTime()) ? date : iso.toISOString();
}

function maskIdentifier(value: string | null): string {
  if (!value) return "ไม่ระบุ";
  return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
}

function maskName(row: JsonRecord): string | null {
  const parts = [text(row, "pname"), text(row, "fname"), text(row, "lname")].filter((value): value is string => Boolean(value));
  return parts.length ? parts.map((part) => part.length <= 1 ? "•" : `${part.slice(0, 1)}•••`).join(" ") : null;
}

function grouperFromRow(row: JsonRecord): GrouperResult {
  const drg = text(row, "drg");
  const rw = number(row, "rw");
  const error = number(row, "grouper_err", "err");
  const warning = number(row, "grouper_warn", "warn");
  const executableVersion = text(row, "grouper_version");
  const hasError = error !== null && error !== 0;
  const responseStatus = hasError ? "invalid_input" : drg || rw !== null ? "valid" : executableVersion || error !== null || warning !== null ? "empty" : "not_run";
  return {
    engine: executableVersion ? "TGrp" : "none",
    executableVersion,
    responseStatus,
    requestHash: null,
    drg,
    mdc: text(row, "mdc"),
    dc: text(row, "dc"),
    err: error,
    warn: warning,
    rw,
    adjrw: number(row, "adjrw"),
    wtlos: number(row, "wtlos"),
    ot: number(row, "ot"),
    sourceAsOf,
  };
}

function financeFromRow(row: JsonRecord): FinanceSummary {
  const itemMoney = number(row, "item_money", "itemMoney");
  const paidMoney = number(row, "paid_money", "paidMoney");
  const receivedMoney = number(row, "rcpt_money", "ipt_rcpt_money", "received_money", "receivedMoney");
  const waitingMoney = number(row, "wait_paid_money", "remain_paid_money", "waiting_money", "waitingMoney")
    ?? (itemMoney !== null && receivedMoney !== null ? Math.max(itemMoney - receivedMoney, 0) : null);
  return { itemMoney, paidMoney, receivedMoney, waitingMoney, status: itemMoney === null ? "missing" : receivedMoney === null ? "partial" : "available" };
}

function admissionSnapshotFromRow(row: JsonRecord): AdmissionListSnapshot {
  return {
    bedNo: text(row, "bedno", "bed_no"), bedType: text(row, "bedtype", "bed_type"), roomNo: text(row, "roomno", "room_no"), roomName: text(row, "room_name", "roomname"), bedOrder: number(row, "bed_order"),
    pdxName: text(row, "pdx_name", "icdname"), diagnosisCount: number(row, "diagnosis_count"), ageYears: number(row, "age_y"), ageMonths: number(row, "age_m"), ageDays: number(row, "age_d"),
    admitDoctorName: text(row, "admit_doctor_name", "admdoctor_name"), inchargeDoctorName: text(row, "incharge_doctor_name"), ownerDoctorName: text(row, "owner_doctor_name"), dischargeDoctorName: text(row, "discharge_doctor_name", "dch_doctor_name"), currentDepartmentName: text(row, "current_department_name"),
    admitTypeName: text(row, "admit_type_name", "ipt_admit_type_name"), rightCode: text(row, "right_code", "rtcode"), rightName: text(row, "right_name", "rtname", "pttype_name"), financeStatus: text(row, "finance_status"), financeStatusName: text(row, "finance_status_name"),
    debtMoney: number(row, "debt_money"), waitingPaidMoney: number(row, "wait_paid_money", "remain_paid_money"), waitingDebtMoney: number(row, "wait_debt_money"), dischargeOrderStatus: text(row, "discharge_order_status"), dischargeTypeName: text(row, "discharge_type_name", "dchtype_name"), dischargeStatusName: text(row, "discharge_status_name", "dchstts_name"),
    finalSummaryStatus: text(row, "confirm_final_summary"), auditSummaryStatus: text(row, "confirm_audit_summary"), summaryStatusName: text(row, "summary_status_name", "ipt_summary_status_name"), summaryAckStatus: text(row, "summary_ack_status", "do_summary_status"), summaryMedicationStatus: text(row, "summary_med_status", "do_summary_med_status"), operationStatusName: text(row, "operation_status_name"),
    infectionFlag: text(row, "infection_flag", "is_infect"), physicStatusId: number(row, "physic_status_id"), collectionStatusName: text(row, "collection_status_name", "ipt_coll_status_type_name"), drgDescription: text(row, "drg_description"), lastSyncAt: text(row, "last_sync_datetime", "last_sync_at"),
  };
}

function mapCaseRow(row: JsonRecord, config: AppConfig, session: SessionPayload): CaseListItem {
  const an = text(row, "an") ?? "unknown";
  const caseRef = createCaseRef(an, session.hospitalCode ?? "bms", config);
  const admitAt = dateTime(row, "regdate", "regtime");
  const dischargeAt = dateTime(row, "dchdate", "dchtime");
  const grouper = grouperFromRow(row);
  const status = dischargeAt ? "discharged" : admitAt ? "admitted" : "unknown";
  const admissionSnapshot = admissionSnapshotFromRow(row);
  return {
    caseRef,
    an: maskIdentifier(an),
    hnMasked: maskIdentifier(text(row, "hn")),
    patientNameMasked: maskName(row),
    ward: text(row, "ward"),
    wardName: text(row, "ward_name", "wardName"),
    admitAt,
    dischargeAt,
    status,
    pdx: text(row, "pdx"),
    admissionSnapshot,
    drg: grouper.drg,
    rw: grouper.rw,
    adjrw: grouper.adjrw,
    finance: financeFromRow(row),
    grouper,
    dataWarnings: grouper.responseStatus === "not_run" ? ["ยังไม่มีผล DRG grouper จากระบบต้นทาง"] : grouper.responseStatus === "invalid_input" ? ["ผล grouper มี error code ต้องทบทวน validation"] : [],
    sourceAsOf: sourceAsOf,
  };
}

class DemoProvider implements DataProvider {
  private readonly cases: CaseDetail[];

  constructor(private readonly config: AppConfig) {
    this.cases = [
      buildSyntheticCase(createCaseRef("AN-DEMO-001", "DEMO", config), "ready"),
      buildSyntheticCase(createCaseRef("AN-DEMO-002", "DEMO", config), "attention"),
    ];
  }

  async getCases(params: CaseListParams, _session?: SessionPayload): Promise<CasePage> {
    const q = params.q?.trim().toLowerCase() ?? "";
    const filtered = this.cases.filter((item) => {
      if (params.status && params.status !== "all" && item.status !== params.status) return false;
      if (params.ward && params.ward !== item.ward) return false;
      if (q && ![item.an, item.hnMasked, item.patientNameMasked, item.pdx, item.drg].filter(Boolean).join(" ").toLowerCase().includes(q)) return false;
      if (params.admitFrom && (!item.admitAt || item.admitAt.slice(0, 10) < params.admitFrom)) return false;
      if (params.admitTo && (!item.admitAt || item.admitAt.slice(0, 10) > params.admitTo)) return false;
      if (params.dischargeFrom && (!item.dischargeAt || item.dischargeAt.slice(0, 10) < params.dischargeFrom)) return false;
      if (params.dischargeTo && (!item.dischargeAt || item.dischargeAt.slice(0, 10) > params.dischargeTo)) return false;
      return true;
    });
    const offset = params.cursor ? Number.parseInt(params.cursor, 10) || 0 : 0;
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
    const rows = filtered.slice(offset, offset + limit).map(({ audit: _audit, ...item }) => item);
    const next = offset + rows.length < filtered.length ? String(offset + rows.length) : null;
    return { rows, nextCursor: next, total: filtered.length, sourceAsOf };
  }

  async getCase(caseRef: string, _session?: SessionPayload): Promise<CaseDetail> {
    const item = this.cases.find((candidate) => candidate.caseRef === caseRef);
    if (!item) throw new Error("CASE_NOT_FOUND");
    return item;
  }
}

class BmsProvider implements DataProvider {
  constructor(private readonly config: AppConfig) {}

  async getCases(params: CaseListParams, session: SessionPayload): Promise<CasePage> {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
    const offset = params.cursor ? Number.parseInt(params.cursor, 10) || 0 : 0;
    const rows = await executeSql(session, "casePage", {
      q: { value: params.q ?? "", value_type: "text" }, ward: { value: params.ward ?? "", value_type: "text" },
      status: { value: params.status ?? "all", value_type: "text" },
      admit_from: { value: params.admitFrom ?? "", value_type: "date" }, admit_to: { value: params.admitTo ?? "", value_type: "date" },
      discharge_from: { value: params.dischargeFrom ?? "", value_type: "date" }, discharge_to: { value: params.dischargeTo ?? "", value_type: "date" },
      limit: { value: limit + 1, value_type: "int" }, offset: { value: offset, value_type: "int" },
    }, this.config);
    const pageRows = rows.slice(0, limit).map((row) => mapCaseRow(row, this.config, session));
    const nextCursor = rows.length > limit ? String(offset + limit) : null;
    const total = number(rows[0] ?? {}, "total_count") ?? pageRows.length + (nextCursor ? 1 : 0);
    return { rows: pageRows, nextCursor, total, sourceAsOf };
  }

  async getCase(caseRef: string, session: SessionPayload): Promise<CaseDetail> {
    const ref = resolveCaseRef(caseRef, this.config);
    if (!ref || ref.hospitalCode !== (session.hospitalCode ?? ref.hospitalCode)) throw new Error("CASE_REF_INVALID");
    const params = { an: { value: ref.an, value_type: "text" as const }, limit: { value: 100, value_type: "int" as const } };
    const [overviewRows, diagnosisRows, noteRows, orderRows, labRows, imagingRows, nursingRows, financeRows] = await Promise.all([
      executeSql(session, "caseDetailOverview", params, this.config), executeSql(session, "caseDiagnoses", params, this.config),
      executeSql(session, "caseNotes", params, this.config), executeSql(session, "caseOrders", params, this.config),
      executeSql(session, "caseLabs", params, this.config), executeSql(session, "caseImaging", params, this.config),
      executeSql(session, "caseNursing", params, this.config), executeSql(session, "caseFinance", params, this.config),
    ]);
    const overview = overviewRows[0] ?? {};
    const base = mapCaseRow({ ...overview, ...(financeRows[0] ?? {}), an: ref.an }, this.config, session);
    const audit = initialAuditLedger({
      pdx: base.pdx, sdx: diagnosisRows.filter((row) => text(row, "type") !== "1").map((row) => text(row, "code")).filter((value): value is string => Boolean(value)), procedures: [],
      age: number(overview, "age_y"), ageDay: number(overview, "age_d"), sex: text(overview, "sex"), discht: text(overview, "dchtype"), dateAdm: base.admitAt?.slice(0, 10) ?? null,
      timeAdm: base.admitAt?.slice(11, 16) ?? null, dateDsc: base.dischargeAt?.slice(0, 10) ?? null, timeDsc: base.dischargeAt?.slice(11, 16) ?? null, leaveDay: null, los: null,
    }, base.grouper);
    const detail: CaseDetail = {
      ...base, patientNameMasked: maskName(overview), demographics: { age: number(overview, "age_y"), sex: text(overview, "sex"), birthDate: text(overview, "birthday"), allergy: [] }, vitals: [],
      diagnoses: diagnosisRows.map((row) => ({ code: text(row, "code") ?? "", name: "ข้อมูลจาก HOSxP", type: text(row, "type") ?? "", recordedAt: text(row, "recorded_at") })),
      doctorNotes: noteRows.map((row) => ({ text: text(row, "text") ?? "", doctor: text(row, "doctor"), recordedAt: text(row, "recorded_at") })),
      medications: orderRows.map((row) => ({ name: text(row, "code") ?? "", dose: text(row, "qty"), route: text(row, "usage_line"), orderedAt: text(row, "ordered_at"), status: "source" })),
      labs: labRows.map((row) => ({ id: text(row, "id") ?? "", name: text(row, "code") ?? "", result: text(row, "result") ?? "", unit: null, collectedAt: text(row, "collected_at"), imageCount: 0 })),
      imaging: imagingRows.map((row) => ({ id: text(row, "id") ?? "", name: text(row, "name") ?? "", report: text(row, "report") ?? "", reportedAt: text(row, "reported_at"), imageAvailable: false })),
      nursing: nursingRows.map((row) => ({ note: text(row, "note") ?? "", recordedAt: text(row, "recorded_at"), shift: text(row, "shift") })), fluidBalance: [], procedures: [], finance: financeFromRow(financeRows[0] ?? {}), attachments: [], audit,
    };
    return detail;
  }
}

export function createDataProvider(config: AppConfig): DataProvider {
  const demo = new DemoProvider(config);
  const bms = new BmsProvider(config);
  return {
    getCases: (params, session) => session.sessionId === "demo" ? demo.getCases(params, session) : bms.getCases(params, session),
    getCase: (caseRef, session) => session.sessionId === "demo" ? demo.getCase(caseRef, session) : bms.getCase(caseRef, session),
  };
}

export function createDemoSession(): SessionPayload {
  return { sessionId: "demo", apiUrl: "http://127.0.0.1", bearerToken: "demo", databaseType: "postgresql", hospitalCode: "DEMO", actor: { id: "demo-auditor", displayName: "Demo auditor", roles: ["viewer", "coder", "auditor"] }, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
}
