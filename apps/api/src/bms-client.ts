import type { AppConfig } from "./config.js";
import { getRegisteredQuery, assertReadOnlyQuery, type QueryKey, type SqlParam } from "./query-registry.js";
import type { SessionPayload } from "./session.js";

export type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringAt(record: JsonRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function nested(record: JsonRecord, ...keys: string[]): unknown {
  let current: unknown = record;
  for (const key of keys) current = asRecord(current)[key];
  return current;
}

function assertAllowedApiUrl(value: string, config: AppConfig): string {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(config.nodeEnv !== "production" && loopback && url.protocol === "http:")) {
    throw new Error("BMS_API_URL_MUST_USE_HTTPS");
  }
  if (!loopback && !config.bmsAllowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error("BMS_API_HOST_NOT_ALLOWED");
  }
  return url.toString().replace(/\/$/, "");
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { throw new Error("BMS_INVALID_JSON"); }
    if (!response.ok) throw new Error(`BMS_HTTP_${response.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export async function retrieveBmsSession(sessionId: string, marketplaceToken: string | undefined, config: AppConfig): Promise<SessionPayload> {
  const url = new URL(config.bmsPasteUrl);
  url.searchParams.set("Action", "GET");
  url.searchParams.set("code", sessionId);
  const payload = asRecord(await fetchJson(url.toString(), { method: "GET", headers: { accept: "application/json" } }, config.bmsRequestTimeoutMs));
  const result = asRecord(payload.result ?? payload.data ?? payload);
  const userInfo = asRecord(result.user_info ?? result.userInfo ?? payload.user_info);
  const apiUrl = stringAt(userInfo, "bms_url", "bmsUrl", "api_url", "apiUrl") ?? stringAt(result, "bms_url", "bmsUrl", "api_url", "apiUrl");
  const bearerToken = stringAt(userInfo, "bms_session_code", "bmsSessionCode", "session_code") ?? stringAt(result, "key_value", "bms_session_code", "session_code");
  if (!apiUrl || !bearerToken) throw new Error("BMS_SESSION_PAYLOAD_INCOMPLETE");
  const actorId = stringAt(userInfo, "user_id", "userid", "id") ?? "bms-user";
  const displayName = stringAt(userInfo, "user_name", "username", "name") ?? "BMS user";
  const rolesValue = userInfo.roles;
  const roles = Array.isArray(rolesValue) ? rolesValue.filter((item): item is string => typeof item === "string").slice(0, 20) : ["viewer"];
  const databaseType = (stringAt(userInfo, "database_type", "databaseType") ?? "postgresql").toLowerCase();
  if (databaseType !== "postgresql") throw new Error("BMS_DATABASE_TYPE_UNSUPPORTED");
  return {
    sessionId,
    apiUrl: assertAllowedApiUrl(apiUrl, config),
    bearerToken,
    marketplaceToken: marketplaceToken ?? config.bmsMarketplaceToken,
    databaseType: "postgresql",
    hospitalCode: stringAt(userInfo, "hospital_code", "hospitalCode", "hospcode"),
    actor: { id: actorId, displayName, roles: roles.length ? roles : ["viewer"] },
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  };
}

export async function executeSql(session: SessionPayload, queryKey: QueryKey, params: Record<string, SqlParam>, config: AppConfig): Promise<JsonRecord[]> {
  const sql = getRegisteredQuery(queryKey);
  assertReadOnlyQuery(sql);
  const body: JsonRecord = { sql, app: config.bmsAppIdentifier, params };
  if (session.marketplaceToken) body["marketplace-token"] = session.marketplaceToken;
  const response = asRecord(await fetchJson(`${session.apiUrl}/api/sql`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.bearerToken}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  }, config.bmsRequestTimeoutMs));
  const result = response.result ?? response.data ?? response.rows ?? response;
  const rowsValue = Array.isArray(result) ? result : asRecord(result).rows ?? asRecord(result).data ?? [];
  if (!Array.isArray(rowsValue)) throw new Error("BMS_ROWS_INVALID");
  return rowsValue.map((row) => asRecord(row));
}

export function bmsIdentityForAudit(session: SessionPayload): { actorId: string; hospitalCode: string | null } {
  return { actorId: session.actor.id, hospitalCode: session.hospitalCode ?? null };
}

export function readNestedValue(record: JsonRecord, ...keys: string[]): unknown {
  return nested(record, ...keys);
}
