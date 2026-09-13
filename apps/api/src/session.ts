import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { openJson, sealJson } from "./crypto.js";

const SESSION_COOKIE = "ipd_session";
const SessionPayloadSchema = z.object({
  sessionId: z.string().min(1).max(256),
  apiUrl: z.string().url(),
  bearerToken: z.string().min(1).max(8192),
  marketplaceToken: z.string().max(8192).optional(),
  databaseType: z.literal("postgresql"),
  hospitalCode: z.string().max(128).optional(),
  actor: z.object({
    id: z.string().min(1).max(256),
    displayName: z.string().min(1).max(256),
    roles: z.array(z.string().min(1).max(64)).max(20),
  }),
  expiresAt: z.string().datetime(),
});

export type SessionPayload = z.infer<typeof SessionPayloadSchema>;

export function readSessionId(input: unknown): string {
  return z.string().trim().min(1).max(256).parse(input);
}

export function sealSession(session: SessionPayload, config: AppConfig): string {
  return sealJson(SessionPayloadSchema.parse(session), config.sessionSecret);
}

export function openSession(value: string | undefined, config: AppConfig): SessionPayload | null {
  if (!value) return null;
  try {
    const parsed = openJson<unknown>(value, config.sessionSecret);
    const session = SessionPayloadSchema.parse(parsed);
    if (Date.parse(session.expiresAt) <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(request: FastifyRequest, config: AppConfig): SessionPayload | null {
  return openSession(request.cookies[SESSION_COOKIE], config);
}

export function setSessionCookie(reply: FastifyReply, session: SessionPayload, config: AppConfig): void {
  reply.setCookie(SESSION_COOKIE, sealSession(session, config), {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
    expires: new Date(session.expiresAt),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", path: "/" });
}

export function toSessionStatus(session: SessionPayload | null): {
  connected: boolean;
  mode: "demo" | "bms" | "disconnected";
  databaseType: "postgresql" | "unknown";
  hospitalCode: string | null;
  actor: SessionPayload["actor"] | null;
  expiresAt: string | null;
} {
  if (!session) {
    return { connected: false, mode: "disconnected", databaseType: "unknown", hospitalCode: null, actor: null, expiresAt: null };
  }
  return {
    connected: true,
    mode: session.sessionId === "demo" ? "demo" : "bms",
    databaseType: session.databaseType,
    hospitalCode: session.hospitalCode ?? null,
    actor: session.actor,
    expiresAt: session.expiresAt,
  };
}
