import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import type { CaseDetail, CaseListItem, CaseStatus, SessionStatus } from "@ipd-summary/contracts";
import { getCase, getCases, getSession, requestAi, uploadMarkdown } from "./api";

type Tab = "overview" | "clinical" | "orders" | "labs" | "nursing" | "finance" | "audit" | "files";

const tabs: Array<{ id: Tab; label: string; short: string }> = [
  { id: "overview", label: "ภาพรวม", short: "Overview" }, { id: "clinical", label: "Clinical", short: "Clinical" },
  { id: "orders", label: "Orders & Meds", short: "Orders" }, { id: "labs", label: "Lab / X-ray", short: "Labs" },
  { id: "nursing", label: "Nursing", short: "Nursing" }, { id: "finance", label: "Finance", short: "Finance" },
  { id: "audit", label: "DRG Audit", short: "Audit" }, { id: "files", label: "Files", short: "Files" },
];

function dateLabel(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function money(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(value);
}

function statusLabel(status: CaseStatus): string {
  return status === "discharged" ? "จำหน่ายแล้ว" : status === "admitted" ? "กำลังรักษา" : "ไม่ทราบสถานะ";
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "danger" }): ReactElement {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function EmptyState({ text }: { text: string }): ReactElement { return <div className="empty-state">{text}</div>; }

function Metric({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint: string; tone?: string }): ReactElement {
  return <article className={`metric metric-${tone}`}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

function FluidChart({ detail }: { detail: CaseDetail }): ReactElement {
  const max = Math.max(...detail.fluidBalance.map((row) => Math.max(row.intake, row.output)), 1);
  return <div className="fluid-chart">{detail.fluidBalance.map((row) => <div className="fluid-row" key={row.date}>
    <time>{row.date.slice(5)}</time><div className="fluid-bars"><span className="fluid-in" style={{ width: `${(row.intake / max) * 100}%` }} /><span className="fluid-out" style={{ width: `${(row.output / max) * 100}%` }} /></div><strong className={row.net >= 0 ? "positive" : "negative"}>{row.net > 0 ? "+" : ""}{row.net} ml</strong>
  </div>)}</div>;
}

function AuditRail({ detail, onAi, aiBusy }: { detail: CaseDetail; onAi: () => void; aiBusy: boolean }): ReactElement {
  const validation = detail.audit.validation;
  const errorTone = validation.errorCode ? "danger" : validation.warningMask ? "warn" : "good";
  return <aside className="audit-rail" aria-label="DRG audit evidence">
    <div className="rail-heading"><div><p className="eyebrow">Evidence rail</p><h2>DRG audit</h2></div><Badge tone={errorTone}>{detail.audit.status.replaceAll("_", " ")}</Badge></div>
    <div className="version-lock"><span className="lock-mark">✓</span><div><strong>Version fence</strong><p>TDRG {detail.audit.scope.tdrgVersion} · ICD-10-TM 2016</p><p>Procedure {detail.audit.scope.procedureVersion}</p></div></div>
    <div className="rail-section"><div className="section-label">Validation</div><div className="validation-grid"><span>Error code</span><strong>{validation.errorCode ?? "none"}</strong><span>Warning mask</span><strong>{validation.warningMask}</strong></div></div>
    <div className="rail-section"><div className="section-label">Grouper response</div><div className="grouper-card"><div><span className="grouper-label">DRG</span><strong>{detail.grouper.drg ?? "empty"}</strong></div><div><span className="grouper-label">RW / AdjRW</span><strong>{detail.grouper.rw ?? "—"} / {detail.grouper.adjrw ?? "—"}</strong></div><p>{detail.grouper.responseStatus === "empty" ? "HTTP response ไม่มีผลจัดกลุ่ม — ต้องตรวจสอบ ไม่ใช่ success" : detail.grouper.responseStatus}</p></div></div>
    <div className="rail-section"><div className="section-label">Candidate trail</div>{detail.audit.candidates.length ? detail.audit.candidates.map((candidate) => <div className="candidate" key={candidate.id}><div className="candidate-top"><strong>{candidate.role} · {candidate.candidateCode}</strong><Badge tone={candidate.status === "documented" ? "good" : "warn"}>{candidate.status.replaceAll("_", " ")}</Badge></div><p>{candidate.description}</p><small>{candidate.evidence.length} evidence · {candidate.rulePath.join(" → ")}</small></div>) : <EmptyState text="ยังไม่มี candidate ที่ผ่าน evidence contract" />}</div>
    <div className="rail-section"><div className="section-label">Evidence locations</div>{detail.audit.evidence.map((item) => <div className="evidence-item" key={item.id}><span className="evidence-dot" /><div><strong>{item.documentType}</strong><p>{item.section ?? "source"} · {item.clinicalAction}</p><small>{item.textSpan}</small></div></div>)}</div>
    <button className="ai-button" type="button" onClick={onAi} disabled={aiBusy}><span>{aiBusy ? "กำลังตรวจ…" : "Run evidence review"}</span><small>AI candidate · human review required</small></button>
  </aside>;
}

function DetailPanel({ detail, tab, setTab, onAi, aiBusy, message, onUpload }: { detail: CaseDetail; tab: Tab; setTab: (tab: Tab) => void; onAi: () => void; aiBusy: boolean; message: string; onUpload: (file: File) => void }): ReactElement {
  return <section className="detail-panel">
    <header className="detail-header"><div><p className="eyebrow">Case reference</p><h2>{detail.an}</h2><div className="case-subline"><Badge tone={detail.status === "discharged" ? "good" : "warn"}>{statusLabel(detail.status)}</Badge><span>{detail.wardName ?? detail.ward ?? "ไม่ระบุ ward"}</span><span>admit {dateLabel(detail.admitAt)}</span></div></div><div className="detail-actions"><button className="ghost-button" type="button" onClick={onAi} disabled={aiBusy}>✦ {aiBusy ? "ตรวจอยู่" : "AI review"}</button><span className="privacy-note">synthetic-safe UI</span></div></header>
    <nav className="tab-strip" aria-label="Case sections">{tabs.map((item) => <button className={tab === item.id ? "tab active" : "tab"} key={item.id} type="button" onClick={() => setTab(item.id)} aria-current={tab === item.id ? "page" : undefined}><span>{item.label}</span><small>{item.short}</small></button>)}</nav>
    {message && <div className="inline-message" role="status">{message}</div>}
    <div className="detail-content">
      {tab === "overview" && <div className="overview-grid"><article className="content-card span-2"><div className="card-heading"><div><p className="eyebrow">Patient context</p><h3>Demographics & signal</h3></div><Badge tone="neutral">{detail.sourceAsOf.slice(0, 10)}</Badge></div><div className="context-grid"><div><span>ชื่อสำหรับหน้าจอ</span><strong>{detail.patientNameMasked ?? "ไม่ระบุ"}</strong></div><div><span>HN</span><strong>{detail.hnMasked ?? "—"}</strong></div><div><span>อายุ / เพศ</span><strong>{detail.demographics.age ?? "—"} · {detail.demographics.sex ?? "—"}</strong></div><div><span>Allergy</span><strong>{detail.demographics.allergy.join(", ") || "ไม่พบข้อมูล"}</strong></div></div></article><article className="content-card"><div className="card-heading"><div><p className="eyebrow">Finance pulse</p><h3>ค่าใช้จ่าย</h3></div><span className="data-status">{detail.finance.status}</span></div><div className="finance-number">฿{money(detail.finance.itemMoney)}</div><div className="finance-lines"><span>รับชำระ <strong>฿{money(detail.finance.receivedMoney)}</strong></span><span>ค้าง <strong>฿{money(detail.finance.waitingMoney)}</strong></span></div></article><article className="content-card"><div className="card-heading"><div><p className="eyebrow">Fluid balance</p><h3>สมดุลน้ำ</h3></div><span className="data-status">24h</span></div><FluidChart detail={detail} /></article><article className="content-card span-2"><div className="card-heading"><div><p className="eyebrow">Latest clinical signal</p><h3>สัญญาณชีพล่าสุด</h3></div><Badge tone="good">monitoring</Badge></div><div className="vitals-grid">{detail.vitals.slice(0, 4).map((vital) => <div key={vital.recordedAt}><span>{dateLabel(vital.recordedAt)}</span><strong>{vital.spo2 ?? "—"}<small> SpO₂</small></strong><p>{vital.bp ?? "—"} · {vital.pulse ?? "—"} bpm · pain {vital.painScore ?? "—"}</p></div>)}</div></article></div>}
      {tab === "clinical" && <div className="two-column"><article className="content-card"><div className="card-heading"><div><p className="eyebrow">Problem list</p><h3>Diagnoses</h3></div></div>{detail.diagnoses.length ? <div className="data-list">{detail.diagnoses.map((item) => <div className="data-row" key={`${item.code}-${item.type}`}><div><strong>{item.code}</strong><span>{item.name}</span></div><Badge tone={item.type === "PDx" ? "good" : "neutral"}>{item.type}</Badge></div>)}</div> : <EmptyState text="ยังไม่มี diagnosis ที่แสดงได้" />}</article><article className="content-card"><div className="card-heading"><div><p className="eyebrow">Clinician record</p><h3>Doctor notes</h3></div></div>{detail.doctorNotes.length ? detail.doctorNotes.map((note, index) => <div className="note-block" key={`${note.recordedAt}-${index}`}><p>{note.text}</p><small>{note.doctor ?? "ผู้บันทึกไม่ระบุ"} · {dateLabel(note.recordedAt)}</small></div>) : <EmptyState text="ไม่พบ doctor note" />}</article></div>}
      {tab === "orders" && <TableCard title="Orders & medication" eyebrow="Treatment trace" headers={["รายการ", "ขนาด / วิธีใช้", "เวลา", "สถานะ"]} rows={detail.medications.map((item) => [item.name, `${item.dose ?? "—"} · ${item.route ?? "—"}`, dateLabel(item.orderedAt), item.status])} />}
      {tab === "labs" && <div className="two-column"><TableCard title="Laboratory" eyebrow="Results" headers={["รายการ", "ผล", "เวลา"]} rows={detail.labs.map((item) => [item.name, item.result, dateLabel(item.collectedAt)])} /><TableCard title="X-ray / imaging" eyebrow="Lazy-load boundary" headers={["รายการ", "รายงาน", "เวลา"]} rows={detail.imaging.map((item) => [item.name, item.report, dateLabel(item.reportedAt)])} /></div>}
      {tab === "nursing" && <div className="two-column"><TableCard title="Nursing notes" eyebrow="Care actions" headers={["บันทึก", "กะ", "เวลา"]} rows={detail.nursing.map((item) => [item.note, item.shift ?? "—", dateLabel(item.recordedAt)])} /><article className="content-card"><div className="card-heading"><div><p className="eyebrow">Input / output</p><h3>Fluid balance</h3></div></div><FluidChart detail={detail} /></article></div>}
      {tab === "finance" && <div className="finance-grid"><Metric label="Item total" value={`฿${money(detail.finance.itemMoney)}`} hint="จาก source registry" tone="teal" /><Metric label="Paid" value={`฿${money(detail.finance.paidMoney)}`} hint="ยืนยันเมื่อมีข้อมูล source" tone="blue" /><Metric label="Received" value={`฿${money(detail.finance.receivedMoney)}`} hint="ไม่รวม inferred" tone="amber" /></div>}
      {tab === "audit" && <div className="audit-inline"><div className="content-card"><div className="card-heading"><div><p className="eyebrow">Audit ledger</p><h3>Validation steps</h3></div><Badge tone={detail.audit.validation.errorCode ? "danger" : detail.audit.validation.warningMask ? "warn" : "good"}>{detail.audit.validation.checks.length} checks</Badge></div>{detail.audit.validation.checks.map((check) => <div className="check-row" key={check.key}><span className={`check-icon ${check.status}`}>{check.status === "pass" ? "✓" : "!"}</span><div><strong>{check.key}</strong><p>{check.detail}</p></div></div>)}</div><div className="content-card"><div className="card-heading"><div><p className="eyebrow">Grouping trace</p><h3>Rule path</h3></div></div>{detail.audit.groupingTrace.map((step) => <div className="trace-row" key={step.step}><span>{step.step}</span><strong>{step.result}</strong><small>{step.sourceReference}</small></div>)}</div></div>}
      {tab === "files" && <div className="files-layout"><article className="content-card"><div className="card-heading"><div><p className="eyebrow">Markdown evidence</p><h3>Case attachments</h3></div><label className="upload-button">+ upload .md<input type="file" accept=".md,text/markdown,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.currentTarget.value = ""; }} /></label></div>{detail.attachments.length ? <div className="data-list">{detail.attachments.map((file) => <div className="data-row" key={file.id}><div><strong>{file.filename}</strong><span>{file.size.toLocaleString()} bytes · {file.sha256.slice(0, 12)}…</span></div><small>{dateLabel(file.uploadedAt)}</small></div>)}</div> : <EmptyState text="ยังไม่มี attachment — รองรับเฉพาะ Markdown ที่ sanitize แล้ว" />}</article><div className="file-note"><span className="lock-mark">⌁</span><strong>Evidence boundary</strong><p>ไฟล์จะถูกจำกัดขนาด, sanitize HTML/script/path traversal และเก็บ access log โดยไม่เก็บเนื้อหาใน log</p></div></div>}
    </div>
  </section>;
}

function TableCard({ title, eyebrow, headers, rows }: { title: string; eyebrow: string; headers: string[]; rows: string[][] }): ReactElement {
  return <article className="content-card table-card"><div className="card-heading"><div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></div><span className="data-status">{rows.length} rows</span></div>{rows.length ? <div className="table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div> : <EmptyState text="ไม่มีข้อมูลสำหรับช่วงนี้" />}</article>;
}

export default function App(): ReactElement {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | CaseStatus>("all");
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadCases = useCallback(async (): Promise<void> => {
    const page = await getCases({ q: query, status, limit: 20 });
    setCases(page.rows);
    setSelectedRef((current) => current && page.rows.some((item) => item.caseRef === current) ? current : page.rows[0]?.caseRef ?? null);
  }, [query, status]);

  useEffect(() => { getSession().then(setSession).catch((error: Error) => setMessage(`เชื่อมต่อไม่ได้: ${error.message}`)).finally(() => setBusy(false)); }, []);
  useEffect(() => { if (!session?.connected) return; const timer = window.setTimeout(() => { loadCases().catch((error: Error) => setMessage(`โหลดรายการไม่สำเร็จ: ${error.message}`)); }, 120); return () => window.clearTimeout(timer); }, [session?.connected, loadCases]);
  useEffect(() => { if (!selectedRef) { setDetail(null); return; } setMessage(""); getCase(selectedRef).then(setDetail).catch((error: Error) => setMessage(`โหลดรายละเอียดไม่สำเร็จ: ${error.message}`)); }, [selectedRef]);

  const metrics = useMemo(() => ({ total: cases.length, admitted: cases.filter((item) => item.status === "admitted").length, discharged: cases.filter((item) => item.status === "discharged").length, attention: cases.filter((item) => item.grouper.responseStatus === "empty" || item.dataWarnings.length).length }), [cases]);
  const runAi = async (): Promise<void> => {
    if (!selectedRef) return;
    setAiBusy(true); setMessage("");
    try { const result = await requestAi(selectedRef); setMessage(result.synthetic ? "ได้รับผล synthetic AI แล้ว — ต้อง human review ก่อนใช้ทุกครั้ง" : "ได้รับ candidate แล้ว — ต้อง human review ก่อนใช้ทุกครั้ง"); } catch (error) { setMessage(`AI review ยังไม่พร้อม: ${(error as Error).message}`); } finally { setAiBusy(false); }
  };

  const upload = async (file: File): Promise<void> => {
    if (!selectedRef) return;
    try { await uploadMarkdown(selectedRef, file); setDetail(await getCase(selectedRef)); setMessage("บันทึก Markdown evidence แล้ว"); } catch (error) { setMessage(`อัปโหลดไม่สำเร็จ: ${(error as Error).message}`); }
  };

  return <main className="app-shell"><header className="topbar"><div className="brand"><div className="brand-mark">IPD</div><div><strong>Summary Overview</strong><span>evidence-first inpatient operations</span></div></div><div className="topbar-actions"><span className="env-pill"><i />{session?.mode === "demo" ? "DEMO / synthetic" : session?.connected ? "BMS / connected" : "DISCONNECTED"}</span><button className="icon-button" type="button" title="Keyboard shortcuts">?</button><div className="actor"><span className="actor-avatar">A</span><div><strong>{session?.actor?.displayName ?? "Guest"}</strong><small>{session?.actor?.roles.join(" · ") ?? "viewer"}</small></div></div></div></header><div className="workspace"><section className="overview-pane"><div className="page-intro"><div><p className="eyebrow">{new Intl.DateTimeFormat("th-TH", { dateStyle: "full" }).format(new Date())}</p><h1>ผู้ป่วยในวันนี้ <span>/ inpatient board</span></h1><p className="lede">คัดกรองภาพรวมก่อนลงรายละเอียด พร้อม audit trail ที่ย้อนกลับไปยังหลักฐานได้</p></div><div className="baseline-chip"><span>release baseline</span><strong>summary p95 ≤ 5s</strong><small>detail p95 ≤ 3s · not an SLA</small></div></div><div className="metric-strip"><Metric label="Admissions in view" value={String(metrics.total).padStart(2, "0")} hint="รายการตามตัวกรอง" tone="blue" /><Metric label="กำลังรักษา" value={String(metrics.admitted).padStart(2, "0")} hint="active encounters" tone="teal" /><Metric label="จำหน่ายแล้ว" value={String(metrics.discharged).padStart(2, "0")} hint="ready for review" tone="neutral" /><Metric label="Attention" value={String(metrics.attention).padStart(2, "0")} hint="needs query / warning" tone="amber" /></div><div className="filter-bar"><label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหา HN, AN, ชื่อ หรือ diagnosis…" aria-label="ค้นหาผู้ป่วย" /></label><div className="filter-group"><button className={status === "all" ? "filter active" : "filter"} type="button" onClick={() => setStatus("all")}>ทั้งหมด</button><button className={status === "admitted" ? "filter active" : "filter"} type="button" onClick={() => setStatus("admitted")}>กำลังรักษา</button><button className={status === "discharged" ? "filter active" : "filter"} type="button" onClick={() => setStatus("discharged")}>จำหน่ายแล้ว</button></div><button className="date-filter" type="button">ช่วง admit · 7 วัน <span>⌄</span></button></div>{busy ? <div className="loading-card">กำลังเปิด secure workspace…</div> : <div className="case-list" aria-label="Admission list">{cases.length ? cases.map((item) => <button className={item.caseRef === selectedRef ? "case-card selected" : "case-card"} key={item.caseRef} type="button" onClick={() => { setSelectedRef(item.caseRef); setTab("overview"); }}><div className="case-card-top"><span className={item.status === "discharged" ? "status-dot good" : "status-dot warn"} /><strong>{item.an}</strong><span className="case-time">{item.status === "discharged" ? `d/c ${dateLabel(item.dischargeAt)}` : `admit ${dateLabel(item.admitAt)}`}</span></div><div className="case-card-body"><div><strong>{item.patientNameMasked ?? "ผู้ป่วยไม่ระบุชื่อ"}</strong><span>{item.hnMasked ?? "HN —"} · {item.wardName ?? `Ward ${item.ward ?? "—"}`}</span></div><div className="case-card-drg">{item.grouper.responseStatus === "empty" ? <Badge tone="warn">Grouper empty</Badge> : item.drg ? <><strong>DRG {item.drg}</strong><span>RW {item.rw ?? "—"}</span></> : <Badge>not run</Badge>}</div></div>{item.dataWarnings.length > 0 && <div className="case-warning">! {item.dataWarnings[0]}</div>}</button>) : <EmptyState text="ไม่พบ case ตามตัวกรอง" />}</div>}</section><div className="right-workspace">{detail ? <><DetailPanel detail={detail} tab={tab} setTab={setTab} onAi={() => void runAi()} aiBusy={aiBusy} message={message} onUpload={(file) => void upload(file)} /><AuditRail detail={detail} onAi={() => void runAi()} aiBusy={aiBusy} /></> : <section className="detail-panel empty-detail"><div><span className="empty-orbit">+</span><h2>เลือก admission เพื่อเริ่ม audit</h2><p>ข้อมูลในโหมดนี้เป็น synthetic fixture สำหรับตรวจ flow และ security boundary</p></div></section>}</div></div><footer className="app-footer"><span>IPD Summary Overview · v0.1.0</span><span>Raw input ≠ normalized input · inferred ≠ coded</span><span>⌘K search · keyboard friendly</span></footer></main>;
}
