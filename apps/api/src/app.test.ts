import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDemoSession } from "./data-provider.js";
import { sealSession } from "./session.js";

describe("IPD Summary API contract", () => {
  const config = loadConfig({ NODE_ENV: "test", APP_MODE: "demo" });
  const app = buildApp({ config });

  it("exposes health and demo session without returning a secret", async () => {
    const health = await app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(200);
    const session = await app.inject({ method: "GET", url: "/api/session" });
    expect(session.statusCode).toBe(200);
    expect(session.json().status.mode).toBe("demo");
    expect(session.body).not.toContain("bearerToken");
    const handshake = await app.inject({ method: "POST", url: "/api/session", payload: { sessionId: "demo" } });
    expect(handshake.statusCode).toBe(200);
  });

  it("requires the session cookie for case data and supports synthetic detail", async () => {
    const session = await app.inject({ method: "GET", url: "/api/session" });
    const setCookie = session.headers["set-cookie"];
    const cookie = Array.isArray(setCookie) ? setCookie[0]?.split(";", 1)[0] : setCookie?.split(";", 1)[0];
    expect(cookie).toBeTruthy();
    const page = await app.inject({ method: "GET", url: "/api/cases?limit=10", headers: { cookie: cookie! } });
    expect(page.statusCode).toBe(200);
    expect(page.json().rows).toHaveLength(2);
    const caseRef = page.json().rows[0].caseRef as string;
    expect(caseRef).not.toContain("AN-DEMO-001");
    const detail = await app.inject({ method: "GET", url: `/api/cases/${encodeURIComponent(caseRef)}`, headers: { cookie: cookie! } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().audit.scope.tdrgVersion).toBe("6.3.3");
    const firstPage = await app.inject({ method: "GET", url: "/api/cases?limit=1", headers: { cookie: cookie! } });
    expect(firstPage.json().nextCursor).toBe("1");
    const secondPage = await app.inject({ method: "GET", url: "/api/cases?limit=1&cursor=1", headers: { cookie: cookie! } });
    expect(secondPage.json().rows[0].grouper.responseStatus).toBe("empty");
  });

  it("does not fabricate AI output when AI is disabled", async () => {
    const session = await app.inject({ method: "GET", url: "/api/session" });
    const setCookie = session.headers["set-cookie"];
    const cookie = Array.isArray(setCookie) ? setCookie[0]?.split(";", 1)[0] : setCookie?.split(";", 1)[0];
    const page = await app.inject({ method: "GET", url: "/api/cases", headers: { cookie: cookie! } });
    const caseRef = page.json().rows[0].caseRef as string;
    const ai = await app.inject({ method: "POST", url: `/api/audits/${encodeURIComponent(caseRef)}/ai`, headers: { cookie: cookie! }, payload: {} });
    expect(ai.statusCode).toBe(503);
    expect(ai.json().code).toBe("AI_DISABLED");
  });

  it("enforces expiry and role boundaries", async () => {
    const expired = { ...createDemoSession(), expiresAt: new Date(Date.now() - 1_000).toISOString() };
    const expiredResponse = await app.inject({ method: "GET", url: "/api/cases", headers: { cookie: `ipd_session=${sealSession(expired, config)}` } });
    expect(expiredResponse.statusCode).toBe(401);
    const viewer = { ...createDemoSession(), actor: { id: "viewer", displayName: "Viewer", roles: ["viewer"] } };
    const denied = await app.inject({ method: "POST", url: "/api/audits/demo-case/events", headers: { cookie: `ipd_session=${sealSession(viewer, config)}` }, payload: { type: "human_review", payload: {} } });
    expect(denied.statusCode).toBe(403);
  });
});
