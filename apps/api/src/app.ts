import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { CaseListParams, SessionStatus } from "@ipd-summary/contracts";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { retrieveBmsSession } from "./bms-client.js";
import { createAiProvider, type AiProvider } from "./ai.js";
import { createDataProvider, createDemoSession, type DataProvider } from "./data-provider.js";
import { normalizeMarkdown, parseMarkdownBuffer, validateMarkdownFilename } from "./markdown.js";
import { clearSessionCookie, getSessionFromRequest, readSessionId, setSessionCookie, toSessionStatus, type SessionPayload } from "./session.js";
import { createAttachmentRecord, createRepository, type AuditEvent, type AuditRepository } from "./repository.js";

export interface AppOptions {
  config?: AppConfig;
  dataProvider?: DataProvider;
  repository?: AuditRepository;
  aiProvider?: AiProvider;
  logger?: boolean;
}

class HttpError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message = code) { super(message); }
}

const caseQuerySchema = z.object({
  q: z.string().trim().max(120).optional(), ward: z.string().trim().max(64).optional(), status: z.enum(["all", "admitted", "discharged", "unknown"]).optional(),
  admitFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), admitTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dischargeFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), dischargeTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cursor: z.string().regex(/^\d+$/).optional(), limit: z.coerce.number().int().min(1).max(50).default(20),
});

const sessionSchema = z.object({ sessionId: z.unknown(), marketplaceToken: z.string().max(8192).optional() });
const eventSchema = z.object({ type: z.enum(["human_review", "candidate_decision", "neutral_query", "evidence_added", "status_changed"]), payload: z.record(z.unknown()).default({}) });
const allowedSections = new Set(["overview", "clinical", "orders", "labs", "nursing", "finance", "audit", "files"]);

function queryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function correlationId(request: FastifyRequest): string {
  const value = request.headers["x-correlation-id"];
  return typeof value === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(value) ? value : randomUUID();
}

function hasRole(session: SessionPayload, roles: string[]): boolean {
  return roles.some((role) => session.actor.roles.includes(role));
}

function requireRole(session: SessionPayload, roles: string[]): void {
  if (!hasRole(session, roles)) throw new HttpError(403, "ROLE_FORBIDDEN");
}

function requireSession(request: FastifyRequest, config: AppConfig): SessionPayload {
  const session = getSessionFromRequest(request, config);
  if (!session) throw new HttpError(401, "SESSION_REQUIRED");
  return session;
}

function mapError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof HttpError) return { status: error.statusCode, code: error.code, message: error.message };
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  if (["CASE_NOT_FOUND", "CASE_REF_INVALID"].includes(code)) return { status: 404, code, message: code };
  if (["MARKDOWN_TOO_LARGE"].includes(code)) return { status: 413, code, message: code };
  if (["AI_DISABLED", "AI_CREDENTIALS_NOT_CONFIGURED"].includes(code)) return { status: 503, code, message: code };
  if (/^(BMS_|QUERY_|MARKDOWN_|SESSION_|CASE_|AI_)/.test(code)) return { status: 400, code, message: code };
  return { status: 500, code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาดภายในระบบ" };
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const repository = options.repository ?? createRepository(config);
  const dataProvider = options.dataProvider ?? createDataProvider(config);
  const aiProvider = options.aiProvider ?? createAiProvider(config);
  const app = Fastify({
    logger: options.logger ? { serializers: {
      req: (request: { method: string; id: string }) => ({ method: request.method, requestId: request.id }),
      res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
    } } : false,
    bodyLimit: 1_000_000,
    routerOptions: { maxParamLength: 512 },
  });

  app.register(cookie);
  app.register(cors, { origin: config.corsOrigins, credentials: true });
  app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], connectSrc: ["'self'"], imgSrc: ["'self'", "data:"], objectSrc: ["'none'"], frameAncestors: ["'none'"] } },
    referrerPolicy: { policy: "no-referrer" },
  });
  app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.register(multipart, { limits: { fileSize: config.maxMdBytes, files: 1, fields: 4 } });

  const access = async (request: FastifyRequest, caseRef: string | null, action: string, outcome: "success" | "denied" | "error", actorId = "anonymous") => {
    try { await repository.logAccess({ actorId, action, caseRef, outcome, correlationId: correlationId(request), occurredAt: new Date().toISOString() }); } catch { /* access logging cannot break the request */ }
  };

  const activeSession = (request: FastifyRequest, reply: FastifyReply): SessionPayload | null => {
    const session = getSessionFromRequest(request, config);
    if (session) return session;
    if (config.appMode === "demo") {
      const demo = createDemoSession();
      setSessionCookie(reply, demo, config);
      return demo;
    }
    return null;
  };

  app.get("/healthz", async () => ({ ok: true, service: "ipd-summary-api" }));
  app.get("/readyz", async (_request, reply) => {
    const ready = await repository.ready();
    return reply.code(ready ? 200 : 503).send({ ok: ready, database: ready ? "ready" : "not_ready" });
  });

  app.get("/api/session", async (request, reply) => {
    const session = activeSession(request, reply);
    return { status: toSessionStatus(session) satisfies SessionStatus };
  });

  const sessionHandshake = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = sessionSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, "SESSION_INPUT_INVALID");
    const sessionId = readSessionId(parsed.data.sessionId);
    let session: SessionPayload;
    if (config.appMode === "demo") {
      if (sessionId !== "demo") throw new HttpError(400, "DEMO_SESSION_ONLY");
      session = createDemoSession();
    } else {
      session = await retrieveBmsSession(sessionId, parsed.data.marketplaceToken, config);
    }
    setSessionCookie(reply, session, config);
    await access(request, null, "session.handshake", "success", session.actor.id);
    return { status: toSessionStatus(session) satisfies SessionStatus };
  };
  app.post("/api/session", sessionHandshake);
  app.post("/api/session/handshake", sessionHandshake);

  app.delete("/api/session", async (request, reply) => {
    const session = getSessionFromRequest(request, config);
    clearSessionCookie(reply);
    await access(request, null, "session.delete", "success", session?.actor.id ?? "anonymous");
    return { status: toSessionStatus(null) satisfies SessionStatus };
  });

  app.get("/api/cases", async (request) => {
    const session = requireSession(request, config);
    const raw = Object.fromEntries(Object.entries((request.query ?? {}) as Record<string, unknown>).map(([key, value]) => [key, queryValue(value)]));
    const parsed = caseQuerySchema.safeParse(raw);
    if (!parsed.success) throw new HttpError(400, "CASE_QUERY_INVALID");
    const page = await dataProvider.getCases(parsed.data as CaseListParams, session);
    await access(request, null, "cases.list", "success", session.actor.id);
    return page;
  });

  async function getDetail(request: FastifyRequest, caseRef: string): Promise<{ session: SessionPayload; detail: Awaited<ReturnType<DataProvider["getCase"]>> }> {
    const session = requireSession(request, config);
    const detail = await dataProvider.getCase(caseRef, session);
    const storedAudit = await repository.getAudit(caseRef);
    if (!storedAudit) await repository.saveAudit(caseRef, detail.audit, session.actor.id);
    else detail.audit = storedAudit;
    detail.attachments = await repository.listAttachments(caseRef);
    await access(request, caseRef, "case.detail", "success", session.actor.id);
    return { session, detail };
  }

  app.get("/api/cases/:caseRef", async (request) => {
    const { caseRef } = request.params as { caseRef: string };
    const { detail } = await getDetail(request, caseRef);
    return detail;
  });

  app.get("/api/cases/:caseRef/:section", async (request) => {
    const { caseRef, section } = request.params as { caseRef: string; section: string };
    if (!allowedSections.has(section)) throw new HttpError(404, "CASE_SECTION_NOT_FOUND");
    const { detail } = await getDetail(request, caseRef);
    if (section === "overview") return { ...detail, audit: undefined };
    if (section === "clinical") return { demographics: detail.demographics, vitals: detail.vitals, diagnoses: detail.diagnoses, doctorNotes: detail.doctorNotes, procedures: detail.procedures };
    if (section === "orders") return { medications: detail.medications };
    if (section === "labs") return { labs: detail.labs, imaging: detail.imaging };
    if (section === "nursing") return { nursing: detail.nursing, fluidBalance: detail.fluidBalance };
    if (section === "finance") return { finance: detail.finance };
    if (section === "files") return { attachments: detail.attachments };
    return { audit: detail.audit };
  });

  app.get("/api/audits/:caseRef", async (request) => {
    const { caseRef } = request.params as { caseRef: string };
    const session = requireSession(request, config);
    let audit = await repository.getAudit(caseRef);
    if (!audit) audit = (await dataProvider.getCase(caseRef, session)).audit;
    await access(request, caseRef, "audit.read", "success", session.actor.id);
    return audit;
  });

  app.post("/api/audits/:caseRef/events", async (request) => {
    const { caseRef } = request.params as { caseRef: string };
    const session = requireSession(request, config);
    requireRole(session, ["coder", "auditor", "admin"]);
    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, "AUDIT_EVENT_INVALID");
    const event: AuditEvent = { type: parsed.data.type, payload: parsed.data.payload, actorId: session.actor.id, occurredAt: new Date().toISOString() };
    await repository.appendEvent(caseRef, event);
    await access(request, caseRef, "audit.event", "success", session.actor.id);
    return { accepted: true, occurredAt: event.occurredAt };
  });

  app.post("/api/audits/:caseRef/ai", async (request) => {
    const { caseRef } = request.params as { caseRef: string };
    const session = requireSession(request, config);
    requireRole(session, ["coder", "auditor", "admin"]);
    const detail = await dataProvider.getCase(caseRef, session);
    const audit = await repository.getAudit(caseRef) ?? detail.audit;
    const result = await aiProvider.analyze(detail, audit);
    await repository.saveAiArtifact({ id: result.artifactId, caseRef, provider: result.provider, model: result.model, createdAt: new Date().toISOString(), inputHash: result.inputHash, output: result as unknown as Record<string, unknown>, synthetic: result.synthetic });
    await access(request, caseRef, "audit.ai", "success", session.actor.id);
    return result;
  });

  app.get("/api/cases/:caseRef/attachments", async (request) => {
    const { caseRef } = request.params as { caseRef: string };
    const session = requireSession(request, config);
    requireRole(session, ["viewer", "coder", "auditor", "admin"]);
    const attachments = await repository.listAttachments(caseRef);
    await access(request, caseRef, "attachment.list", "success", session.actor.id);
    return { attachments };
  });

  app.post("/api/cases/:caseRef/attachments", async (request) => {
    const { caseRef } = request.params as { caseRef: string };
    const session = requireSession(request, config);
    requireRole(session, ["coder", "auditor", "admin"]);
    const multipartRequest = request as FastifyRequest & { file: (options?: unknown) => Promise<{ filename: string; mimetype: string; toBuffer: () => Promise<Buffer> } | undefined> };
    const file = await multipartRequest.file({ limits: { fileSize: config.maxMdBytes } });
    if (!file) throw new HttpError(400, "MARKDOWN_FILE_REQUIRED");
    if (!["text/markdown", "text/plain", "application/octet-stream"].includes(file.mimetype)) throw new HttpError(400, "MARKDOWN_MIME_INVALID");
    const filename = validateMarkdownFilename(file.filename);
    const content = parseMarkdownBuffer(await file.toBuffer(), config);
    const attachment = createAttachmentRecord(randomUUID(), filename, content, session.actor.id);
    await repository.addAttachment(caseRef, attachment);
    await access(request, caseRef, "attachment.upload", "success", session.actor.id);
    const meta = { id: attachment.id, filename: attachment.filename, size: attachment.size, sha256: attachment.sha256, uploadedBy: attachment.uploadedBy, uploadedAt: attachment.uploadedAt };
    return { attachment: meta };
  });

  app.get("/api/cases/:caseRef/attachments/:attachmentId", async (request, reply) => {
    const { caseRef, attachmentId } = request.params as { caseRef: string; attachmentId: string };
    const session = requireSession(request, config);
    requireRole(session, ["viewer", "coder", "auditor", "admin"]);
    const attachment = await repository.getAttachment(caseRef, attachmentId);
    if (!attachment) throw new HttpError(404, "ATTACHMENT_NOT_FOUND");
    const safeContent = normalizeMarkdown(attachment.content, config);
    await access(request, caseRef, "attachment.read", "success", session.actor.id);
    return reply.type("text/markdown; charset=utf-8").send(safeContent);
  });

  app.setErrorHandler(async (error, request, reply) => {
    const mapped = mapError(error);
    const caseRef = typeof (request.params as Record<string, unknown>)?.caseRef === "string" ? String((request.params as Record<string, unknown>).caseRef) : null;
    await access(request, caseRef, "request.error", "error");
    return reply.code(mapped.status).send({ error: mapped.message, code: mapped.code, correlationId: correlationId(request) });
  });

  return app;
}
