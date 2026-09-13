import { calculateAdjRw, validateDrgInput } from "./drg.js";

describe("DRG validation contract", () => {
  it("returns a hard error when PDx is absent and a warning for duplicate SDx", () => {
    const result = validateDrgInput({ pdx: null, sdx: ["I10", "I10"], age: 50, sex: "1", discht: "1", los: 2 });
    expect(result.errorCode).toBe(1);
    expect(result.warningMask & 1).toBe(1);
  });

  it("keeps AdjRW branches deterministic at OT and long-stay boundaries", () => {
    expect(calculateAdjRw({ los: 0, rw: 1.2, rw0d: 0.4, wtlos: 4, ot: 10, of: 1, drg: "04522" })).toBe(0.4);
    expect(calculateAdjRw({ los: 10, rw: 1.2, rw0d: 0.4, wtlos: 4, ot: 10, of: 1, drg: "04522" })).toBe(1.2);
    expect(calculateAdjRw({ los: 31, rw: 1.2, rw0d: 0.4, wtlos: 4, ot: 10, of: 1, drg: "04522" })).toBeGreaterThan(1.2);
  });
});
