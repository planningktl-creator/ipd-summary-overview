import type { AppConfig } from "./config.js";
import { executeSql, type JsonRecord } from "./bms-client.js";
import { createCaseRef, resolveCaseRef } from "./case-ref.js";
import { initialAuditLedger } from "./drg.js";
import type { SessionPayload } from "./session.js";
import { buildSyntheticCase } from "./synthetic.js";
import type { CaseDetail, CaseListItem, CasePage, CaseListParams, FinanceSummary, GrouperResult } from "@ipd-summary/contracts";

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

function grouperFromRow(row: JsonRecord): GrouperResult {
  const drg = text(row, "drg");
  const rw = number(row, "rw");
  const error = number(row, "grouper_err", "err");
  const warning = number(row, "grouper_warn", "warn");
  return {
    engine: text(row, "grouper_version") ? "TGrp" : "none",
    executableVersion: text(row, "grouper_version"),
    responseStatus: error !== null ? "invalid_input" : drg || rw !== null ? "valid" : "not_run",
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
  return { itemMoney, paidMoney, receivedMoney: null, waitingMoney: null, status: itemMoney === null ? "missing" : "partial" };
}

function mapCaseRow(row: JsonRecord, config: AppConfig, session: SessionPayload): CaseListItem {
  const an = text(row, "an") ?? "unknown";
  const caseRef = createCaseRef(an, session.hospitalCode ?? "bms", config);
  const admitAt = dateTime(row, "regdate", "regtime");
  const dischargeAt = dateTime(row, "dchdate", "dchtime");
  const grouper = grouperFromRow(row);
  const status = dischargeAt ? "discharged" : "admitted";
  return {
    caseRef,
    an: maskIdentifier(an),
    hnMasked: maskIdentifier(text(row, "hn")),
    patientNameMasked: [text(row, "pname"), text(row, "fname"), text(row, "lname")].filter(Boolean).join(" ") || null,
    ward: text(row, "ward"),
    wardName: text(row, "ward_name", "wardName"),
    admitAt,
    dischargeAt,
    status,
    pdx: text(row, "pdx"),
    drg: null,
    rw: null,
    adjrw: null,
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
      admit_from: { value: params.admitFrom ?? "", value_type: "date" }, admit_to: { value: params.admitTo ?? "", value_type: "date" },
      limit: { value: limit + 1, value_type: "int" }, offset: { value: offset, value_type: "int" },
    }, this.config);
    const pageRows = rows.slice(0, limit).map((row) => mapCaseRow(row, this.config, session));
    const nextCursor = rows.length > limit ? String(offset + limit) : null;
    return { rows: pageRows, nextCursor, total: pageRows.length + (nextCursor ? 1 : 0), sourceAsOf };
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
    const base = mapCaseRow({ ...overview, an: ref.an, item_money: financeRows[0]?.item_money }, this.config, session);
    const audit = initialAuditLedger({
      pdx: base.pdx, sdx: diagnosisRows.filter((row) => text(row, "type") !== "1").map((row) => text(row, "code")).filter((value): value is string => Boolean(value)), procedures: [],
      age: number(overview, "age_y"), ageDay: number(overview, "age_d"), sex: text(overview, "sex"), discht: text(overview, "dchtype"), dateAdm: base.admitAt?.slice(0, 10) ?? null,
      timeAdm: base.admitAt?.slice(11, 16) ?? null, dateDsc: base.dischargeAt?.slice(0, 10) ?? null, timeDsc: base.dischargeAt?.slice(11, 16) ?? null, leaveDay: null, los: null,
    }, base.grouper);
    const names = [text(overview, "pname"), text(overview, "fname"), text(overview, "lname")].filter(Boolean).join(" ") || null;
    const detail: CaseDetail = {
      ...base, patientNameMasked: names, demographics: { age: number(overview, "age_y"), sex: text(overview, "sex"), birthDate: text(overview, "birthday"), allergy: [] }, vitals: [],
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
