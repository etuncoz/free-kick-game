import { describe, expect, it, vi } from "vitest";
import {
  DIR_GOAL_WINDOW,
  GOAL_HALF,
  STAGES,
  STAGE_GAUGE_SPEED,
  STAGE_KP_SIGMA,
  TRIES_PER_STAGE,
  WIND_UNIT_KMH,
} from "./constants";
import {
  KP_CURL_MISREAD,
  createGameState,
  launch,
  newScenario,
  step,
} from "./physics";

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
  g.windAz = 0;
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
        expect(Math.hypot(g.windX, g.windZ) * WIND_UNIT_KMH).toBeLessThanOrEqual(st.maxWindKmh + 1e-9);
      }
    });
  });

  it("is windless on stage 1", () => {
    const g = createGameState();
    newScenario(g);
    // == comparisons: the magnitude is 0 but a negative angle cosine can
    // produce -0, which Object.is (toBe) would flakily reject
    expect(g.windX == 0).toBe(true);
    expect(g.windZ == 0).toBe(true);
    expect(g.windAx == 0).toBe(true);
    expect(g.windAz == 0).toBe(true);
  });

  it("wind blows from all compass quadrants over many rolls", () => {
    const quadrants = new Set();
    for (let roll = 0; roll < 400 && quadrants.size < 4; roll++) {
      const g = createGameState();
      g.stage = 10;
      newScenario(g);
      if (g.windX === 0 && g.windZ === 0) continue;
      quadrants.add(`${g.windX >= 0 ? "E" : "W"}${g.windZ >= 0 ? "N" : "S"}`);
    }
    expect(quadrants.size).toBe(4);
  });

  it("uses the run-constant keeper skill and gauge speed unless a stage mod overrides", () => {
    for (let stage = 1; stage <= STAGES.length; stage++) {
      const g = createGameState();
      g.stage = stage;
      newScenario(g);
      expect(g.kpSigma).toBe(STAGES[stage - 1].mods?.kpSigma ?? STAGE_KP_SIGMA);
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
  // runs a real launch on the given stage with the wall, the wind and the
  // keeper taken out of the equation, and simulates to the result
  function simulate(locked, stage = 1) {
    const g = createGameState();
    g.stage = stage;
    newScenario(g);
    g.locked = locked;
    launch(g);
    g.wallHalf = -99;
    g.windAx = 0;
    g.windAz = 0;
    g.kpX = g.kpStart = g.kpTarget = g.gx - 14;
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

  it("gauge centre aims at the goal centre on every stage, however angled", () => {
    for (const stage of [1, 5, 10]) {
      const { g } = simulate({ h: 0.35, d: 0, s: 0 }, stage);
      expect(g.result).toBe("GOAL");
      expect(Math.abs(g.netHitX - g.gx)).toBeLessThan(1.5); // drag shortfall only
    }
  });

  it("the goal window edge maps to the post region at any distance", () => {
    // marker on the window's right edge = d equal to the window fraction;
    // the crossing must land around the right post (drag pulls it slightly
    // inside) rather than metres away - this is what keeps the static gauge
    // window honest while the cone rescales per stage
    for (const stage of [1, 10]) {
      const { g } = simulate({ h: 0.35, d: DIR_GOAL_WINDOW, s: 0 }, stage);
      const crossX = g.result === "GOAL" ? g.netHitX : g.ball.x;
      expect(crossX - g.gx).toBeGreaterThan(GOAL_HALF * 0.7);
      expect(crossX - g.gx).toBeLessThan(GOAL_HALF * 1.25);
    }
  });

  it("right swerve bows out right, then curls back to the aimed line", () => {
    const { g, maxX } = simulate({ h: 0.35, d: 0, s: 1 });
    expect(maxX).toBeGreaterThan(0.7); // it visibly leaves the aim line
    expect(g.result).toBe("GOAL"); // ...and still arrives on target
    expect(Math.abs(g.netHitX - g.gx)).toBeLessThan(1.0);
  });

  it("tailwind carries the ball to the goal faster than headwind", () => {
    const flightSteps = (windAz) => {
      const g = createGameState();
      newScenario(g);
      g.locked = { h: 0.35, d: 0, s: 0 };
      launch(g);
      g.wallHalf = -99;
      g.windAx = 0;
      g.windAz = windAz;
      g.kpX = g.kpStart = g.kpTarget = g.gx - 14;
      g.kpDiveAngle = 0;
      let steps = 0;
      while (!g.result && steps < 400) {
        step(g, 1 / 60);
        steps++;
      }
      return steps;
    };
    expect(flightSteps(2.0)).toBeLessThan(flightSteps(-2.0));
  });

  it("stages vary horizontally in both directions, not just in distance", () => {
    const lefts = STAGES.filter((s) => s.gx < -3).length;
    const rights = STAGES.filter((s) => s.gx > 3).length;
    expect(lefts).toBeGreaterThanOrEqual(3);
    expect(rights).toBeGreaterThanOrEqual(3);
  });
});

describe("stage personalities", () => {
  const scenarioFor = (stage) => {
    const g = createGameState();
    g.stage = stage;
    const patch = newScenario(g);
    return { g, patch };
  };

  it("every stage has a name, surfaced in the HUD patch", () => {
    STAGES.forEach((st, i) => {
      expect(typeof st.name).toBe("string");
      expect(st.name.length).toBeGreaterThan(0);
      expect(scenarioFor(i + 1).patch.stageName).toBe(st.name);
    });
  });

  it("THE GREAT WALL always fields six men and never jumps", () => {
    for (let roll = 0; roll < 50; roll++) {
      const { g } = scenarioFor(4);
      expect(g.wallN).toBe(6);
      expect(g.wallWillJump).toBe(false);
    }
  });

  it("keeper-sigma mods override the run constant; others keep it", () => {
    expect(scenarioFor(3).g.kpSigma).toBe(0.55); // THE CAT
    expect(scenarioFor(9).g.kpSigma).toBe(0.7); // THE FORTRESS
    expect(scenarioFor(1).g.kpSigma).toBe(STAGE_KP_SIGMA);
  });

  it("SWIRLING GALE always blows at least 75% of its cap", () => {
    const cap = STAGES[5].maxWindKmh / WIND_UNIT_KMH;
    for (let roll = 0; roll < 100; roll++) {
      const { g } = scenarioFor(6);
      const mag = Math.hypot(g.windX, g.windZ);
      expect(mag).toBeGreaterThanOrEqual(0.75 * cap - 1e-9);
      expect(mag).toBeLessThanOrEqual(cap + 1e-9);
    }
  });

  it("a modded wall size still sticks across retries", () => {
    const { g } = scenarioFor(9); // THE FORTRESS pins 5
    expect(g.wallN).toBe(5);
    g.triesLeft -= 1;
    newScenario(g);
    expect(g.wallN).toBe(5);
  });
});

describe("ghost try marks", () => {
  it("a miss records where the try crossed the goal plane", () => {
    const g = flightState({ aimX: null });
    g.ball.x = g.gx + GOAL_HALF + 2.0;
    step(g, 0.033);
    expect(g.result).toBe("WIDE");
    expect(g.tryMarks).toHaveLength(1);
    expect(g.tryMarks[0].z).toBe(g.D);
    expect(g.tryMarks[0].x).toBeCloseTo(g.gx + GOAL_HALF + 2.0, 1);
    expect(g.tryMarks[0].result).toBe("WIDE");
  });

  it("a wall block records at the wall plane", () => {
    const g = flightState({ aimX: null });
    g.ball = { x: g.wallX, y: 1.0, z: g.wallZ - 0.3, vx: 0, vy: 0, vz: 25, spin: 0 };
    g.wallJh = 0;
    step(g, 0.033);
    expect(g.result).toBe("WALL");
    expect(g.tryMarks).toHaveLength(1);
    expect(g.tryMarks[0].z).toBe(g.wallZ);
  });

  it("retries keep the marks; a fresh stage clears them", () => {
    const g = flightState({ aimX: null });
    g.ball.x = g.gx + GOAL_HALF + 2.0;
    step(g, 0.033); // miss -> 1 mark, triesLeft now 4
    newScenario(g); // retry (triesLeft < TRIES_PER_STAGE)
    expect(g.tryMarks).toHaveLength(1);
    g.triesLeft = TRIES_PER_STAGE; // stage advance resets the budget
    newScenario(g);
    expect(g.tryMarks).toHaveLength(0);
  });

  it("never keeps more marks than there are earlier tries", () => {
    const g = flightState({ aimX: null });
    for (let i = 0; i < TRIES_PER_STAGE + 2; i++) {
      g.phase = "flight";
      g.result = null;
      g.flightT = 0;
      g.ball = { x: g.gx + GOAL_HALF + 2.0, y: 1.0, z: g.D - 0.3, vx: 0, vy: 0, vz: 25, spin: 0 };
      step(g, 0.033);
    }
    expect(g.tryMarks).toHaveLength(TRIES_PER_STAGE - 1);
  });
});

describe("late-curl keeper misread", () => {
  // deterministic launch (gauss noise = 0) on stage 1, straight at a spot
  // left of centre, with/without full swerve; same aim, same arrival.
  function launched(s) {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const g = createGameState();
      newScenario(g);
      const cone = Math.atan(GOAL_HALF / g.D) / DIR_GOAL_WINDOW;
      const d = Math.atan(-3.0 / g.D) / cone; // arrival at gx - 3.0
      g.locked = { h: 0.35, d, s };
      launch(g);
      g.wallHalf = -99;
      return g;
    } finally {
      spy.mockRestore();
    }
  }

  it("shifts the keeper's prediction toward the bow side at full swerve", () => {
    const straight = launched(0);
    const curled = launched(1);
    // same dive pose (same predY), so the feet target moves by the misread
    expect(curled.kpDiveAngle).toBe(straight.kpDiveAngle);
    expect(curled.kpTarget - straight.kpTarget).toBeCloseTo(KP_CURL_MISREAD, 5);
  });

  it("the same corner aim is saved straight but beats the keeper curled", () => {
    const results = [0, 1].map((s) => {
      const g = launched(s);
      for (let i = 0; i < 400 && !g.result; i++) step(g, 1 / 60);
      return g.result;
    });
    expect(results[0]).toBe("SAVED"); // read perfectly without swerve
    expect(results[1]).toBe("GOAL"); // the late break comes back inside him
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
