import type { AttachmentMeta, CaseDetail, CaseListParams, CasePage, SessionStatus } from "@ipd-summary/contracts";

async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, credentials: "include", headers: { accept: "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => null) as T & { error?: string; code?: string } | null;
  if (!response.ok) throw new Error(body?.code ?? body?.error ?? `HTTP_${response.status}`);
  return body as T;
}

export async function getSession(): Promise<SessionStatus> {
  const result = await request<{ status: SessionStatus }>("/api/session");
  return result.status;
}

export async function getCases(params: CaseListParams): Promise<CasePage> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  return request<CasePage>(`/api/cases?${search.toString()}`);
}

export async function getCase(caseRef: string): Promise<CaseDetail> {
  return request<CaseDetail>(`/api/cases/${encodeURIComponent(caseRef)}`);
}

export async function uploadMarkdown(caseRef: string, file: File): Promise<AttachmentMeta> {
  const form = new FormData();
  form.append("file", file, file.name);
  const result = await request<{ attachment: AttachmentMeta }>(`/api/cases/${encodeURIComponent(caseRef)}/attachments`, { method: "POST", body: form, headers: {} });
  return result.attachment;
}

export async function requestAi(caseRef: string): Promise<{ neutralQuery: string | null; candidates: CaseDetail["audit"]["candidates"]; synthetic: boolean }> {
  return request(`/api/audits/${encodeURIComponent(caseRef)}/ai`, { method: "POST", body: JSON.stringify({}), headers: { "content-type": "application/json" } });
}
