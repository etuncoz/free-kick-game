import { describe, expect, it } from "vitest";
import {
  STAGES,
  STAGE_GAUGE_SPEED,
  STAGE_KP_SIGMA,
  TRIES_PER_STAGE,
  WIND_UNIT_KMH,
} from "./constants";
import { createGameState, newScenario, step } from "./physics";

// builds a game state mid-flight, one frame away from crossing the goal
// plane, with the keeper parked too far away to save. `aimX` is where the
// ball crosses the plane (defaults to goal centre = certain goal).
function flightState({ stage = 1, triesLeft = TRIES_PER_STAGE, streak = 0, aimX = null } = {}) {
  const g = createGameState();
  g.stage = stage;
  g.triesLeft = triesLeft;
  newScenario(g);
  g.streak = streak;
  g.phase = "flight";
  g.flightT = 0;
  g.curlAx = 0;
  g.windAx = 0;
  g.kpDelay = 99; // keeper never starts his dive within one step
  g.kpX = g.kpStart = g.kpTarget = g.gx + 3.3;
  g.ball = { x: aimX ?? g.gx, y: 1.0, z: g.D - 0.3, vx: 0, vy: 0, vz: 25, spin: 0 };
  return g;
}

describe("newScenario (stage mode)", () => {
  it("pins the kick spot exactly to the stage table for every stage", () => {
    STAGES.forEach((st, i) => {
      const g = createGameState();
      g.stage = i + 1;
      const patch = newScenario(g);
      expect(g.D).toBe(st.d);
      expect(g.gx).toBe(st.gx);
      expect(patch.stage).toBe(i + 1);
      expect(patch.triesLeft).toBe(TRIES_PER_STAGE);
      expect(patch.distance).toBe(Math.round(st.d));
    });
  });

  it("never rolls wind above the stage cap", () => {
    STAGES.forEach((st, i) => {
      for (let roll = 0; roll < 200; roll++) {
        const g = createGameState();
        g.stage = i + 1;
        newScenario(g);
        expect(Math.abs(g.wind) * WIND_UNIT_KMH).toBeLessThanOrEqual(st.maxWindKmh + 1e-9);
      }
    });
  });

  it("is windless on stage 1", () => {
    const g = createGameState();
    newScenario(g);
    expect(g.wind).toBe(0);
    expect(g.windAx).toBe(0);
  });

  it("uses the constant keeper skill and gauge speed every stage", () => {
    for (let stage = 1; stage <= STAGES.length; stage++) {
      const g = createGameState();
      g.stage = stage;
      newScenario(g);
      expect(g.kpSigma).toBe(STAGE_KP_SIGMA);
      expect(g.gaugeSpeed).toBe(STAGE_GAUGE_SPEED);
    }
  });
});

describe("scoring (stage mode)", () => {
  it("awards 100 + 25 per spare try for a first-try goal", () => {
    const g = flightState({ triesLeft: 5 });
    const events = step(g, 0.033);
    expect(g.result).toBe("GOAL");
    expect(g.lastPoints).toBe(100 + 4 * 25);
    expect(g.score).toBe(100 + 4 * 25);
    expect(g.triesLeft).toBe(5); // goals do not consume the counter
    expect(events).toContainEqual({ type: "sfx", name: "goal" });
  });

  it("awards a bare 100 for a last-try goal", () => {
    const g = flightState({ triesLeft: 1 });
    step(g, 0.033);
    expect(g.result).toBe("GOAL");
    expect(g.lastPoints).toBe(100);
  });

  it("stacks the streak bonus on top of the spare-try bonus", () => {
    const g = flightState({ triesLeft: 5, streak: 2 });
    step(g, 0.033);
    expect(g.result).toBe("GOAL");
    // streak becomes 3: 100 + (3-1)*25 streak + 4*25 spare tries
    expect(g.streak).toBe(3);
    expect(g.lastPoints).toBe(100 + 2 * 25 + 4 * 25);
  });

  it("consumes a try and resets the streak on a miss", () => {
    const g = flightState({ triesLeft: 5, streak: 2, aimX: null });
    g.ball.x = g.gx + 5.5; // well wide of the far post
    step(g, 0.033);
    expect(g.result).toBe("WIDE");
    expect(g.triesLeft).toBe(4);
    expect(g.streak).toBe(0);
    expect(g.lastPoints).toBe(0);
    expect(g.score).toBe(0);
  });
});
