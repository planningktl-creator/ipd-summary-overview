import { assertReadOnlyQuery, getRegisteredQuery } from "./query-registry.js";

describe("query registry", () => {
  it("uses explicit read-only SQL without SELECT star", () => {
    const query = getRegisteredQuery("casePage");
    expect(query).toContain("WITH admit");
    expect(query).toContain("base AS");
    expect(query).toContain("total_count");
    expect(query).toContain("admit_doctor_name");
    expect(query).toContain("discharge_order_status");
    expect(query).toContain(":status");
    expect(query).toContain(":discharge_from");
    expect(query).not.toMatch(/\b\w+\.\*/i);
    expect(query).not.toMatch(/SELECT\s+\*/i);
    expect(() => assertReadOnlyQuery(query)).not.toThrow();
  });

  it("rejects mutation and multi-statement SQL", () => {
    expect(() => assertReadOnlyQuery("UPDATE patient SET fname = 'x'")).toThrow("QUERY_NOT_READ_ONLY");
    expect(() => assertReadOnlyQuery("SELECT id FROM patient; DELETE FROM patient")).toThrow("QUERY_NOT_READ_ONLY");
  });
});
