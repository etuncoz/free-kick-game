import { describe, expect, it, vi } from "vitest";
import {
  GOAL_HALF,
  STAGES,
  STAGE_GAUGE_SPEED,
  STAGE_KP_SIGMA,
  TRIES_PER_STAGE,
  WIND_UNIT_KMH,
} from "./constants";
import { createGameState, launch, newScenario, step } from "./physics";

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

  it("keeps the wall's player count fixed across the tries of a stage", () => {
    for (let run = 0; run < 50; run++) {
      const g = createGameState();
      newScenario(g); // first try rolls the stage's wall
      const n = g.wallN;
      for (let miss = 0; miss < TRIES_PER_STAGE - 1; miss++) {
        g.triesLeft -= 1;
        newScenario(g); // retries must not re-roll it
        expect(g.wallN).toBe(n);
      }
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
    g.ball.x = g.gx + GOAL_HALF + 2.0; // well wide of the far post
    step(g, 0.033);
    expect(g.result).toBe("WIDE");
    expect(g.triesLeft).toBe(4);
    expect(g.streak).toBe(0);
    expect(g.lastPoints).toBe(0);
    expect(g.score).toBe(0);
  });
});

describe("aiming and swerve (original-game feel)", () => {
  // runs a real launch on stage 1 (gx = 0, no wind) with the wall and the
  // keeper taken out of the equation, and simulates to the result
  function simulate(locked) {
    const g = createGameState();
    newScenario(g);
    g.locked = locked;
    launch(g);
    g.wallHalf = -99;
    g.kpX = g.kpStart = g.kpTarget = g.gx - 4.5;
    g.kpDiveAngle = 0;
    let maxX = 0;
    for (let i = 0; i < 400 && !g.result; i++) {
      step(g, 1 / 60);
      if (g.phase === "flight") maxX = Math.max(maxX, g.ball.x);
    }
    return { g, maxX };
  }

  it("full direction deflection sends the ball far wide of the goal", () => {
    const { g } = simulate({ h: 0.35, d: 1, s: 0 });
    expect(g.result).toBe("WIDE");
  });

  it("centre of the goal window scores when nothing is in the way", () => {
    const { g } = simulate({ h: 0.35, d: 0, s: 0 });
    expect(g.result).toBe("GOAL");
  });

  it("right swerve bows out right, then curls back to the aimed line", () => {
    const { g, maxX } = simulate({ h: 0.35, d: 0, s: 1 });
    expect(maxX).toBeGreaterThan(0.7); // it visibly leaves the aim line
    expect(g.result).toBe("GOAL"); // ...and still arrives on target
    expect(Math.abs(g.netHitX - g.gx)).toBeLessThan(1.0);
  });

  it("newScenario reports the goal window on the direction gauge", () => {
    const g = createGameState();
    g.stage = 2; // gx = 2.0, D = 20
    const patch = newScenario(g);
    expect(patch.goalDir).toBeGreaterThan(0.5); // goal sits right of centre
    expect(patch.goalDir).toBeLessThan(0.65);
    // window shrinks with distance
    const g10 = createGameState();
    g10.stage = 10;
    const patch10 = newScenario(g10);
    expect(patch10.goalDirHalf).toBeLessThan(patch.goalDirHalf);
  });
});

describe("keeper save geometry", () => {
  // freezes the keeper in an explicit pose (feet at goal centre, rotated by
  // `angle`, lifted by `lift`) and crosses the ball at gx + ballAt, ballY -
  // the save must be exactly "the ball touched the drawn body"
  function poseCase({ angle = 0, lift = 0, ballAt, ballY = 1.0 }) {
    const g = flightState({ aimX: null });
    g.kpX = g.kpStart = g.kpTarget = g.gx;
    g.kpAngle = angle;
    g.kpLift = lift;
    g.ball.x = g.gx + ballAt;
    g.ball.y = ballY;
    step(g, 0.033);
    return g.result;
  }

  it("standing keeper covers only his body column", () => {
    expect(poseCase({ ballAt: 0.4 })).toBe("SAVED");
    expect(poseCase({ ballAt: 1.2 })).toBe("GOAL");
  });

  it("a diving keeper covers his body line, not the space around it", () => {
    const dive = { angle: 1.15, lift: 0.12 }; // full low dive to the right
    // on the body: saved
    expect(poseCase({ ...dive, ballAt: 0.9, ballY: 0.5 })).toBe("SAVED");
    // the reported bug: ball passes just behind the feet of a diving keeper
    expect(poseCase({ ...dive, ballAt: -0.5, ballY: 1.0 })).toBe("GOAL");
    // over his near-horizontal body: goal
    expect(poseCase({ ...dive, ballAt: 0.9, ballY: 1.6 })).toBe("GOAL");
  });

  it("a correctly-predicted dive still saves: the body lands on the ball", () => {
    // gauss noise of exactly 0 via mocked randomness -> perfect prediction
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const g = createGameState();
      newScenario(g);
      g.kpX = g.kpStart = g.gx - 2.5; // far enough away to force a dive
      g.locked = { h: 0.35, d: 0, s: 0 }; // straight mid-height shot at centre
      launch(g);
      g.wallHalf = -99; // the wall is not under test
      for (let i = 0; i < 400 && !g.result; i++) step(g, 1 / 60);
      expect(Math.abs(g.kpDiveAngle)).toBeGreaterThan(0); // it was a dive
      expect(g.result).toBe("SAVED");
    } finally {
      spy.mockRestore();
    }
  });
});
