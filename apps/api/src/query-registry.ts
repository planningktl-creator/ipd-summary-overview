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
    WITH base AS (
      SELECT i.an, i.hn, i.regdate, i.regtime, i.dchdate, i.dchtime, i.ward, i.dchtype,
             p.pname, p.fname, p.lname, w.name AS ward_name
      FROM ipt i
      JOIN patient p ON p.hn = i.hn
      LEFT JOIN ward w ON w.ward = i.ward
      WHERE (:q = '' OR i.an = :q OR i.hn = :q OR CONCAT(COALESCE(p.fname, ''), ' ', COALESCE(p.lname, '')) ILIKE CONCAT('%', :q, '%'))
        AND (:ward = '' OR i.ward = :ward)
        AND (:admit_from = '' OR i.regdate >= CAST(:admit_from AS date))
        AND (:admit_to = '' OR i.regdate <= CAST(:admit_to AS date))
      ORDER BY i.regdate DESC, i.regtime DESC, i.an DESC
      LIMIT :limit OFFSET :offset
    ),
    stats AS (
      SELECT DISTINCT ON (s.an) s.an, s.pdx, s.drg, s.rw, s.wtlos, s.ot, s.adjrw,
             s.item_money, s.paid_money, s.grouper_version, s.grouper_err, s.grouper_warn
      FROM an_stat s
      JOIN base b ON b.an = s.an
      ORDER BY s.an, (s.drg IS NULL), s.drg DESC
    ),
    diagnoses AS (
      SELECT od.an,
             MAX(CASE WHEN od.diagtype = '1' THEN od.icd10 END) AS pdx,
             COUNT(*) AS diagnosis_count
      FROM iptdiag od
      JOIN base b ON b.an = od.an
      GROUP BY od.an
    ),
    finance AS (SELECT s.an, s.item_money, s.paid_money FROM stats s)
    SELECT b.an, b.hn, b.pname, b.fname, b.lname, b.ward, b.ward_name,
           b.regdate, b.regtime, b.dchdate, b.dchtime, b.dchtype,
           COALESCE(s.pdx, d.pdx) AS pdx, d.diagnosis_count,
           s.drg, s.rw, s.wtlos, s.ot, s.adjrw, s.grouper_version, s.grouper_err, s.grouper_warn,
           f.item_money, f.paid_money
    FROM base b
    LEFT JOIN diagnoses d ON d.an = b.an
    LEFT JOIN stats s ON s.an = b.an
    LEFT JOIN finance f ON f.an = b.an
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
