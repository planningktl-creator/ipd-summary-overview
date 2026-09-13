// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSession } from "./api";

function response(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

describe("BMS session bootstrap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("handshakes the URL session once and removes it from browser history", async () => {
    window.history.replaceState(null, "", "/?bms-session-id=demo-session");
    const status = { connected: true, mode: "bms", databaseType: "postgresql", hospitalCode: "DEMO", actor: { id: "actor", displayName: "BMS user", roles: ["viewer"] }, expiresAt: "2026-09-14T00:00:00.000Z" };
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ status })).mockResolvedValueOnce(response({ status }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSession()).resolves.toEqual(status);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/session/handshake");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).body).toBe(JSON.stringify({ sessionId: "demo-session" }));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/session");
    expect(window.location.search).toBe("");
  });
});
