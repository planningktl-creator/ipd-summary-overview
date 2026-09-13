import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { AuditLedger, AttachmentMeta } from "@ipd-summary/contracts";
import type { AppConfig } from "./config.js";
import { openJson, sealJson, sha256, stableHash } from "./crypto.js";

export interface AuditEvent {
  type: string;
  payload: Record<string, unknown>;
  actorId: string;
  occurredAt: string;
}

export interface AttachmentRecord extends AttachmentMeta {
  content: string;
}

export interface AiArtifact {
  id: string;
  caseRef: string;
  provider: string;
  model: string;
  createdAt: string;
  inputHash: string;
  output: Record<string, unknown>;
  synthetic: boolean;
}

export interface AccessLogEntry {
  actorId: string;
  action: string;
  caseRef: string | null;
  outcome: "success" | "denied" | "error";
  correlationId: string;
  occurredAt: string;
}

export interface AuditRepository {
  getAudit(caseRef: string): Promise<AuditLedger | null>;
  saveAudit(caseRef: string, ledger: AuditLedger, actorId: string): Promise<void>;
  appendEvent(caseRef: string, event: AuditEvent): Promise<void>;
  saveAiArtifact(artifact: AiArtifact): Promise<void>;
  listAttachments(caseRef: string): Promise<AttachmentMeta[]>;
  addAttachment(caseRef: string, attachment: AttachmentRecord): Promise<void>;
  getAttachment(caseRef: string, attachmentId: string): Promise<AttachmentRecord | null>;
  logAccess(entry: AccessLogEntry): Promise<void>;
  ready(): Promise<boolean>;
}

export class MemoryAuditRepository implements AuditRepository {
  private readonly audits = new Map<string, AuditLedger>();
  private readonly events: AuditEvent[] = [];
  private readonly artifacts: AiArtifact[] = [];
  private readonly attachments = new Map<string, AttachmentRecord[]>();
  private readonly access: AccessLogEntry[] = [];

  async getAudit(caseRef: string): Promise<AuditLedger | null> { return this.audits.get(caseRef) ?? null; }
  async saveAudit(caseRef: string, ledger: AuditLedger): Promise<void> { this.audits.set(caseRef, ledger); }
  async appendEvent(_caseRef: string, event: AuditEvent): Promise<void> { this.events.push(event); }
  async saveAiArtifact(artifact: AiArtifact): Promise<void> { this.artifacts.push(artifact); }
  async listAttachments(caseRef: string): Promise<AttachmentMeta[]> { return (this.attachments.get(caseRef) ?? []).map(({ content: _content, ...meta }) => meta); }
  async addAttachment(caseRef: string, attachment: AttachmentRecord): Promise<void> { this.attachments.set(caseRef, [...(this.attachments.get(caseRef) ?? []), attachment]); }
  async getAttachment(caseRef: string, attachmentId: string): Promise<AttachmentRecord | null> { return (this.attachments.get(caseRef) ?? []).find((item) => item.id === attachmentId) ?? null; }
  async logAccess(entry: AccessLogEntry): Promise<void> { this.access.push(entry); }
  async ready(): Promise<boolean> { return true; }
}

export class PostgresAuditRepository implements AuditRepository {
  private readonly pool: Pool;

  constructor(private readonly config: AppConfig) {
    if (!config.databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
    this.pool = new Pool({ connectionString: config.databaseUrl, max: 5, maxLifetimeSeconds: 300 });
  }

  async getAudit(caseRef: string): Promise<AuditLedger | null> {
    const result = await this.pool.query<{ payload_ciphertext: string }>("SELECT payload_ciphertext FROM audit_cases WHERE case_ref = $1 LIMIT 1", [stableHash(caseRef, this.config.dataEncryptionKey)]);
    const ciphertext = result.rows[0]?.payload_ciphertext;
    return ciphertext ? openJson<AuditLedger>(ciphertext, this.config.dataEncryptionKey) : null;
  }

  async saveAudit(caseRef: string, ledger: AuditLedger, actorId: string): Promise<void> {
    const hashedRef = stableHash(caseRef, this.config.dataEncryptionKey);
    await this.pool.query(
      `INSERT INTO audit_cases (case_ref, status, payload_ciphertext, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (case_ref) DO UPDATE SET status = EXCLUDED.status, payload_ciphertext = EXCLUDED.payload_ciphertext, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [hashedRef, ledger.status, sealJson(ledger, this.config.dataEncryptionKey), actorId],
    );
  }

  async appendEvent(caseRef: string, event: AuditEvent): Promise<void> {
    await this.pool.query(
      "INSERT INTO audit_events (event_id, case_ref, event_type, actor_id, payload_ciphertext, occurred_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [randomUUID(), stableHash(caseRef, this.config.dataEncryptionKey), event.type, event.actorId, sealJson(event.payload, this.config.dataEncryptionKey), event.occurredAt],
    );
  }

  async saveAiArtifact(artifact: AiArtifact): Promise<void> {
    await this.pool.query(
      "INSERT INTO ai_artifacts (artifact_id, case_ref, provider, model, input_hash, output_ciphertext, synthetic, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [artifact.id, stableHash(artifact.caseRef, this.config.dataEncryptionKey), artifact.provider, artifact.model, artifact.inputHash, sealJson(artifact.output, this.config.dataEncryptionKey), artifact.synthetic, artifact.createdAt],
    );
  }

  async listAttachments(caseRef: string): Promise<AttachmentMeta[]> {
    const result = await this.pool.query<AttachmentMeta>("SELECT attachment_id AS id, filename, size_bytes AS size, sha256, uploaded_by AS \"uploadedBy\", uploaded_at AS \"uploadedAt\" FROM attachments WHERE case_ref = $1 ORDER BY uploaded_at DESC", [stableHash(caseRef, this.config.dataEncryptionKey)]);
    return result.rows;
  }

  async addAttachment(caseRef: string, attachment: AttachmentRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO attachments (attachment_id, case_ref, filename, size_bytes, sha256, uploaded_by, content_ciphertext, uploaded_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [attachment.id, stableHash(caseRef, this.config.dataEncryptionKey), attachment.filename, attachment.size, attachment.sha256, attachment.uploadedBy, sealJson(attachment.content, this.config.dataEncryptionKey), attachment.uploadedAt],
    );
  }

  async getAttachment(caseRef: string, attachmentId: string): Promise<AttachmentRecord | null> {
    const result = await this.pool.query<AttachmentMeta & { content_ciphertext: string }>("SELECT attachment_id AS id, filename, size_bytes AS size, sha256, uploaded_by AS \"uploadedBy\", uploaded_at AS \"uploadedAt\", content_ciphertext FROM attachments WHERE case_ref = $1 AND attachment_id = $2 LIMIT 1", [stableHash(caseRef, this.config.dataEncryptionKey), attachmentId]);
    const row = result.rows[0];
    if (!row) return null;
    return { id: row.id, filename: row.filename, size: row.size, sha256: row.sha256, uploadedBy: row.uploadedBy, uploadedAt: row.uploadedAt, content: openJson<string>(row.content_ciphertext, this.config.dataEncryptionKey) ?? "" };
  }

  async logAccess(entry: AccessLogEntry): Promise<void> {
    await this.pool.query(
      "INSERT INTO access_logs (access_id, actor_id, action, case_hash, outcome, correlation_id, occurred_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [randomUUID(), entry.actorId, entry.action, entry.caseRef ? stableHash(entry.caseRef, this.config.dataEncryptionKey) : null, entry.outcome, entry.correlationId, entry.occurredAt],
    );
  }

  async ready(): Promise<boolean> {
    try { await this.pool.query("SELECT 1"); return true; } catch { return false; }
  }
}

export function createRepository(config: AppConfig): AuditRepository {
  if (config.databaseUrl) return new PostgresAuditRepository(config);
  return new MemoryAuditRepository();
}

export function createAttachmentRecord(id: string, filename: string, content: string, uploadedBy: string): AttachmentRecord {
  return { id, filename, content, size: Buffer.byteLength(content, "utf8"), sha256: sha256(content), uploadedBy, uploadedAt: new Date().toISOString() };
}
