export type QueryKey =
  | "casePage"
  | "caseDetailOverview"
  | "caseDiagnoses"
  | "caseNotes"
  | "caseOrders"
  | "caseLabs"
  | "caseImaging"
  | "caseNursing"
  | "caseFinance";

export interface SqlParam {
  value: string | number | boolean | null;
  value_type: "text" | "int" | "numeric" | "date" | "timestamp" | "boolean";
}

const registry: Record<QueryKey, string> = {
  casePage: `
    WITH admit AS (
      SELECT DISTINCT ON (a.an) a.an, a.bedno, a.bedtype, a.roomno
      FROM iptadm a
      ORDER BY a.an, a.bedno DESC
    ),
    coverage AS (
      SELECT DISTINCT ON (p.an) p.an, p.pttype, p.hospmain, p.hospsub
      FROM ipt_pttype p
      WHERE p.pttype_number = 1
      ORDER BY p.an, p.pttype_number
    ),
    doctor_list AS (
      SELECT DISTINCT ON (l.an) l.an, d.name AS owner_doctor_name
      FROM ipt_doctor_list l
      LEFT JOIN doctor d ON d.code = l.doctor
      WHERE l.ipt_doctor_type_id = 1
      ORDER BY l.an, l.active_doctor DESC, l.doctor
    ),
    discharge_state AS (
      SELECT DISTINCT ON (d.an) d.an, d.discharge_order_status, d.confirm_final_summary,
             d.confirm_audit_summary
      FROM ipt_discharge d
      ORDER BY d.an
    ),
    finance_state AS (
      SELECT DISTINCT ON (f.an) f.an, f.finance_status
      FROM ipt_finance_status f
      ORDER BY f.an, f.finance_status
    ),
    order_summary AS (
      SELECT DISTINCT ON (s.an) s.an, s.summary_ack_status, s.summary_med_status
      FROM ipd_doctor_order_summary s
      ORDER BY s.an, s.order_date DESC
    ),
    infection_state AS (
      SELECT DISTINCT ON (i.an) i.an, i.is_infect
      FROM ipt_reg_infection i
      ORDER BY i.an
    ),
    collection_state AS (
      SELECT DISTINCT ON (c.an) c.an, c.ipt_coll_status_type_id
      FROM ipt_coll_stat c
      ORDER BY c.an, c.ipt_coll_status_type_id
    ),
    physic_state AS (
      SELECT DISTINCT ON (p.anvn) p.anvn, p.physic_status_id
      FROM physic_pt_send p
      ORDER BY p.anvn
    ),
    drg_lookup AS (
      SELECT dg, MAX(description) AS description
      FROM drgmdc
      GROUP BY dg
    ),
    candidate AS (
      SELECT i.an, i.hn, i.regdate, i.regtime, i.dchdate, i.dchtime, i.ward, i.dchtype, i.dchstts,
             a.bedno, a.bedtype, a.roomno, r.name AS room_name,
             p.pname, p.fname, p.lname, w.name AS ward_name,
             d_adm.name AS admit_doctor_name, d_incharge.name AS incharge_doctor_name,
             d_dch.name AS discharge_doctor_name, dep.department AS current_department_name,
             admit_type.ipt_admit_type_name AS admit_type_name,
             coverage.pttype AS right_code, rights.name AS right_name,
             discharge.discharge_order_status, discharge.confirm_final_summary,
             discharge.confirm_audit_summary, dchtype.name AS discharge_type_name,
             dchstts.name AS discharge_status_name,
             finance.finance_status, finance_name.name AS finance_status_name,
             summary_status.ipt_summary_status_name AS summary_status_name,
             summary.summary_ack_status, summary.summary_med_status,
             operation.name AS operation_status_name, infection.is_infect AS infection_flag,
             collection.ipt_coll_status_type_id AS collection_status_id,
             collection_name.ipt_coll_status_type_name AS collection_status_name,
             owner.owner_doctor_name, physic.physic_status_id
      FROM ipt i
      JOIN patient p ON p.hn = i.hn
      LEFT JOIN ward w ON w.ward = i.ward
      LEFT JOIN admit a ON a.an = i.an
      LEFT JOIN roomno r ON r.roomno = a.roomno
      LEFT JOIN doctor d_adm ON d_adm.code = i.admdoctor
      LEFT JOIN doctor d_incharge ON d_incharge.code = i.incharge_doctor
      LEFT JOIN doctor d_dch ON d_dch.code = i.dch_doctor
      LEFT JOIN kskdepartment dep ON dep.depcode = i.cur_dep_code
      LEFT JOIN ipt_admit_type admit_type ON admit_type.ipt_admit_type_id = i.ipt_admit_type_id
      LEFT JOIN coverage ON coverage.an = i.an
      LEFT JOIN pttype rights ON rights.pttype = coverage.pttype
      LEFT JOIN discharge_state discharge ON discharge.an = i.an
      LEFT JOIN dchtype ON dchtype.dchtype = i.dchtype
      LEFT JOIN dchstts ON dchstts.dchstts = i.dchstts
      LEFT JOIN finance_state finance ON finance.an = i.an
      LEFT JOIN finance_status finance_name ON finance_name.finance_status = finance.finance_status
      LEFT JOIN ipt_summary_status summary_status ON summary_status.ipt_summary_status_id = i.ipt_summary_status_id
      LEFT JOIN order_summary summary ON summary.an = i.an
      LEFT JOIN operation_status operation ON operation.status_id = i.operation_status_id
      LEFT JOIN infection_state infection ON infection.an = i.an
      LEFT JOIN collection_state collection ON collection.an = i.an
      LEFT JOIN ipt_coll_status_type collection_name ON collection_name.ipt_coll_status_type_id = collection.ipt_coll_status_type_id
      LEFT JOIN doctor_list owner ON owner.an = i.an
      LEFT JOIN physic_state physic ON physic.anvn = i.an
      WHERE (:q = '' OR i.an = :q OR i.hn = :q OR CONCAT(COALESCE(p.fname, ''), ' ', COALESCE(p.lname, '')) ILIKE CONCAT('%', :q, '%')
             OR EXISTS (SELECT 1 FROM iptdiag search_diag WHERE search_diag.an = i.an AND search_diag.icd10 ILIKE CONCAT('%', :q, '%')))
        AND (:ward = '' OR i.ward = :ward)
        AND (:status = 'all' OR (:status = 'admitted' AND i.dchdate IS NULL) OR (:status = 'discharged' AND i.dchdate IS NOT NULL) OR (:status = 'unknown' AND i.regdate IS NULL AND i.dchdate IS NULL))
        AND (:admit_from = '' OR i.regdate >= CAST(:admit_from AS date))
        AND (:admit_to = '' OR i.regdate <= CAST(:admit_to AS date))
        AND (:discharge_from = '' OR i.dchdate >= CAST(:discharge_from AS date))
        AND (:discharge_to = '' OR i.dchdate <= CAST(:discharge_to AS date))
    ),
    base AS (
      SELECT c.an, c.hn, c.regdate, c.regtime, c.dchdate, c.dchtime, c.ward, c.dchtype, c.dchstts,
             c.bedno, c.bedtype, c.roomno, c.room_name, c.pname, c.fname, c.lname, c.ward_name,
             c.admit_doctor_name, c.incharge_doctor_name, c.discharge_doctor_name, c.current_department_name,
             c.admit_type_name, c.right_code, c.right_name, c.discharge_order_status,
             c.confirm_final_summary, c.confirm_audit_summary, c.discharge_type_name, c.discharge_status_name,
             c.finance_status, c.finance_status_name, c.summary_status_name, c.summary_ack_status,
             c.summary_med_status, c.operation_status_name, c.infection_flag, c.collection_status_id,
             c.collection_status_name, c.owner_doctor_name, c.physic_status_id,
             COUNT(*) OVER() AS total_count
      FROM candidate c
      ORDER BY c.regdate DESC, c.regtime DESC, c.an DESC
      LIMIT :limit OFFSET :offset
    ),
    stats AS (
      SELECT DISTINCT ON (s.an) s.an, s.pdx, s.drg, s.rw, s.wtlos, s.ot, s.adjrw, s.los,
             s.age_y, s.age_m, s.age_d, s.item_money, s.uc_money, s.debt_money,
             s.paid_money, s.rcpt_money, s.last_sync_datetime,
             s.grouper_version, s.grouper_err, s.grouper_warn
      FROM an_stat s
      JOIN base b ON b.an = s.an
      ORDER BY s.an, (s.drg IS NULL), s.drg DESC
    ),
    diagnoses AS (
      SELECT od.an, MAX(CASE WHEN od.diagtype = '1' THEN od.icd10 END) AS pdx,
             MAX(CASE WHEN od.diagtype = '1' THEN icd.name END) AS pdx_name,
             COUNT(*) AS diagnosis_count
      FROM iptdiag od
      LEFT JOIN icd101 icd ON icd.code = substring(od.icd10, 1, 3)
      JOIN base b ON b.an = od.an
      GROUP BY od.an
    )
    SELECT b.total_count, b.an, b.hn, b.pname, b.fname, b.lname, b.ward, b.ward_name,
           b.regdate, b.regtime, b.dchdate, b.dchtime, b.dchtype,
           b.bedno, b.bedtype, b.roomno, b.room_name, b.admit_doctor_name,
           b.incharge_doctor_name, b.owner_doctor_name, b.discharge_doctor_name,
           b.current_department_name, b.admit_type_name, b.right_code, b.right_name,
           b.finance_status, b.finance_status_name, b.discharge_order_status,
           b.discharge_type_name, b.discharge_status_name, b.confirm_final_summary,
           b.confirm_audit_summary, b.summary_status_name, b.summary_ack_status,
           b.summary_med_status, b.operation_status_name, b.infection_flag,
           b.collection_status_id, b.collection_status_name, b.physic_status_id,
           COALESCE(s.pdx, d.pdx) AS pdx, d.pdx_name, d.diagnosis_count,
           s.drg, drg.description AS drg_description, s.rw, s.wtlos, s.ot, s.adjrw,
           s.los, s.age_y, s.age_m, s.age_d, s.item_money, s.uc_money, s.debt_money,
           s.paid_money, s.rcpt_money,
           CASE WHEN s.paid_money IS NULL OR s.rcpt_money IS NULL THEN NULL ELSE s.paid_money - s.rcpt_money END AS wait_paid_money,
           CASE WHEN s.uc_money IS NULL OR s.debt_money IS NULL THEN NULL ELSE s.uc_money - s.debt_money END AS wait_debt_money,
           s.last_sync_datetime, s.grouper_version, s.grouper_err, s.grouper_warn
    FROM base b
    LEFT JOIN diagnoses d ON d.an = b.an
    LEFT JOIN stats s ON s.an = b.an
    LEFT JOIN drg_lookup drg ON drg.dg = s.drg
    ORDER BY b.regdate DESC, b.regtime DESC, b.an DESC`,
  caseDetailOverview: `
    SELECT i.an, i.hn, i.regdate, i.regtime, i.dchdate, i.dchtime, i.ward, i.dchtype,
           p.pname, p.fname, p.lname, p.birthday, p.sex, w.name AS ward_name,
           s.pdx, s.drg, s.rw, s.wtlos, s.ot, s.adjrw, s.los, s.age_y, s.age_m, s.age_d,
           s.item_money, s.paid_money, s.grouper_version, s.grouper_err, s.grouper_warn
    FROM ipt i
    JOIN patient p ON p.hn = i.hn
    LEFT JOIN ward w ON w.ward = i.ward
    LEFT JOIN an_stat s ON s.an = i.an
    WHERE i.an = :an
    LIMIT 1`,
  caseDiagnoses: `
    SELECT od.icd10 AS code, od.diagtype AS type, NULL::text AS recorded_at
    FROM iptdiag od WHERE od.an = :an ORDER BY od.diagtype, od.diag_no`,
  caseNotes: `
    SELECT n.order_text AS text, NULL::text AS doctor, n.order_date AS recorded_at
    FROM ipd_doctor_order n WHERE n.an = :an ORDER BY n.order_date DESC LIMIT :limit`,
  caseOrders: `
    SELECT o.icode AS code, o.qty, o.unitprice, o.rxdate AS ordered_at, NULL::text AS usage_line
    FROM opitemrece o WHERE o.an = :an ORDER BY o.rxdate DESC LIMIT :limit`,
  caseLabs: `
    SELECT l.lab_order_number AS id, l.lab_items_code AS code, l.lab_order_result AS result,
           l.order_date AS collected_at
    FROM lab_order l WHERE l.an = :an ORDER BY l.order_date DESC LIMIT :limit`,
  caseImaging: `
    SELECT r.request_number AS id, r.request_name AS name, r.report_text AS report,
           r.report_date AS reported_at
    FROM xray_report r WHERE r.an = :an ORDER BY r.report_date DESC LIMIT :limit`,
  caseNursing: `
    SELECT n.note_text AS note, n.note_date AS recorded_at, n.shift
    FROM ipd_nurse_note n WHERE n.an = :an ORDER BY n.note_date DESC LIMIT :limit`,
  caseFinance: `
    SELECT s.item_money, s.uc_money, s.paid_money
    FROM an_stat s WHERE s.an = :an LIMIT 1`,
};

export function getRegisteredQuery(key: QueryKey): string {
  const query = registry[key];
  if (!query) throw new Error("QUERY_KEY_NOT_ALLOWED");
  return query.trim();
}

export function assertReadOnlyQuery(sql: string): void {
  const normalized = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
  const upper = normalized.toUpperCase();
  if (!/^(SELECT|WITH)\b/.test(upper)) throw new Error("QUERY_NOT_READ_ONLY");
  if (normalized.includes(";") || /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|DROP|ALTER|CREATE|TRUNCATE|COPY|DO|CALL|EXECUTE|GRANT|REVOKE)\b/i.test(normalized)) {
    throw new Error("QUERY_NOT_READ_ONLY");
  }
  if (/SELECT\s+\*/i.test(normalized)) throw new Error("QUERY_SELECT_STAR_FORBIDDEN");
}

export function makeParam(value: SqlParam["value"], value_type: SqlParam["value_type"]): SqlParam {
  return { value, value_type };
}
