import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBests, saveRunEnd } from "./storage";

// in-memory localStorage stand-in (vitest runs in node, which has none)
function stubStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  });
  return map;
}

afterEach(() => vi.unstubAllGlobals());

describe("run record persistence", () => {
  it("starts blank with nothing persisted", () => {
    stubStorage();
    expect(loadBests()).toEqual({ bestStage: 0, bestScore: 0, cups: 0, cupWon: false });
  });

  it("round-trips a run end through localStorage", () => {
    stubStorage();
    const b = saveRunEnd({ stage: 23, score: 1450, cups: 2 });
    expect(b).toEqual({ bestStage: 23, bestScore: 1450, cups: 2, cupWon: true });
    expect(loadBests()).toEqual(b);
  });

  it("only improves records, never regresses them", () => {
    stubStorage();
    saveRunEnd({ stage: 30, score: 2000, cups: 3 });
    const b = saveRunEnd({ stage: 12, score: 700, cups: 1 });
    expect(b).toEqual({ bestStage: 30, bestScore: 2000, cups: 3, cupWon: true });
  });

  it("folds the legacy single-cup flag into the cup count", () => {
    stubStorage({ "fkl.cupWon": "1" });
    const b = loadBests();
    expect(b.cups).toBe(1);
    expect(b.cupWon).toBe(true);
  });

  it("behaves as unpersisted when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(loadBests()).toEqual({ bestStage: 0, bestScore: 0, cups: 0, cupWon: false });
    expect(() => saveRunEnd({ stage: 5, score: 100, cups: 0 })).not.toThrow();
  });
});
