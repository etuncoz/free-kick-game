import { describe, expect, it, vi } from "vitest";
import {
  CUP_EVERY,
  DIR_GOAL_WINDOW,
  GOAL_HALF,
  LAPS,
  STAGES,
  STAGES_PER_LAP,
  STAGE_GAUGE_SPEED,
  STAGE_KP_SIGMA,
  TOTAL_STAGES,
  TRIES_PER_STAGE,
  WIND_UNIT_KMH,
  stageSpec,
} from "./constants";
import {
  KP_CURL_MISREAD,
  KP_REACH_X,
  advanceOutcome,
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

  it("never rolls wind above the stage cap, all 50 stages", () => {
    for (let stage = 1; stage <= TOTAL_STAGES; stage++) {
      const cap = stageSpec(stage).maxWindKmh;
      for (let roll = 0; roll < 40; roll++) {
        const g = createGameState();
        g.stage = stage;
        newScenario(g);
        expect(Math.hypot(g.windX, g.windZ) * WIND_UNIT_KMH).toBeLessThanOrEqual(cap + 1e-9);
      }
    }
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
      expect(g.gaugeSpeed).toBe(STAGES[stage - 1].mods?.gaugeSpeed ?? STAGE_GAUGE_SPEED);
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

describe("the 50-stage marathon (stageSpec)", () => {
  it("runs five laps of the ten archetypes", () => {
    expect(TOTAL_STAGES).toBe(50);
    expect(STAGES_PER_LAP).toBe(10);
    expect(LAPS).toBe(5);
    expect(CUP_EVERY).toBe(10);
  });

  it("lap 0 is the authored table verbatim", () => {
    STAGES.forEach((st, i) => {
      const spec = stageSpec(i + 1);
      expect(spec.d).toBe(st.d);
      expect(spec.gx).toBe(st.gx);
      expect(spec.name).toBe(st.name);
      expect(spec.lap).toBe(0);
    });
  });

  it("later laps revisit the same archetype under a lap suffix", () => {
    expect(stageSpec(11).name).toBe("THE OPENER II");
    expect(stageSpec(23).name).toBe("THE CAT III");
    expect(stageSpec(50).name).toBe("THE FINAL V");
    expect(stageSpec(44).gx).toBe(STAGES[3].gx);
  });

  it("distance creeps 1.5m per lap and caps at 35", () => {
    expect(stageSpec(11).d).toBeCloseTo(STAGES[0].d + 1.5, 9);
    expect(stageSpec(41).d).toBeCloseTo(STAGES[0].d + 6, 9);
    expect(stageSpec(50).d).toBe(35); // 30 + 6 would overshoot the cap
  });

  it("the keeper sharpens a little every lap", () => {
    // stage 5 (THE SIDE ROAD) has no authored kpSigma, so it shows the
    // run default sharpening cleanly
    const lap0 = stageSpec(5).mods.kpSigma;
    const lap4 = stageSpec(45).mods.kpSigma;
    expect(lap0).toBe(STAGE_KP_SIGMA);
    expect(lap4).toBeCloseTo(STAGE_KP_SIGMA * (1 - 0.24), 9);
  });

  it("wind builds to exactly 20 km/h at THE FINAL V; calm stages stay calm", () => {
    expect(stageSpec(50).maxWindKmh).toBe(20);
    for (let lap = 0; lap < LAPS; lap++) {
      expect(stageSpec(1 + lap * STAGES_PER_LAP).maxWindKmh).toBe(0); // THE OPENER
    }
  });

  it("late laps never roll a calm day: the wind floor rises per lap", () => {
    // stage 45 = THE SIDE ROAD V: no authored windMinFrac, lap-4 floor 0.6
    const spec = stageSpec(45);
    expect(spec.mods.windMinFrac).toBeCloseTo(0.6, 9);
    const capUnits = spec.maxWindKmh / WIND_UNIT_KMH;
    for (let roll = 0; roll < 200; roll++) {
      const g = createGameState();
      g.stage = 45;
      newScenario(g);
      expect(Math.hypot(g.windX, g.windZ)).toBeGreaterThanOrEqual(0.6 * capUnits - 1e-9);
    }
    // an authored floor above the lap floor is kept (SWIRLING GALE II: 0.85)
    expect(stageSpec(16).mods.windMinFrac).toBeCloseTo(0.85, 9);
  });

  it("newScenario builds a sane scenario for every one of the 50 stages", () => {
    for (let stage = 1; stage <= TOTAL_STAGES; stage++) {
      const g = createGameState();
      g.stage = stage;
      const patch = newScenario(g);
      expect(g.D).toBeGreaterThan(0);
      expect(g.wallZ).toBeLessThanOrEqual(9.15);
      expect(patch.stageName).toBe(stageSpec(stage).name);
      expect(patch.triesLeft).toBe(TRIES_PER_STAGE);
    }
  });
});

describe("advanceOutcome (run flow)", () => {
  const after = (stage, result, triesLeft = TRIES_PER_STAGE) => {
    const g = createGameState();
    g.stage = stage;
    g.result = result;
    g.triesLeft = triesLeft;
    return advanceOutcome(g);
  };

  it("an ordinary goal moves to the next stage", () => {
    expect(after(1, "GOAL")).toBe("next");
    expect(after(49, "GOAL")).toBe("next");
  });

  it("every 10th stage cleared awards a cup mid-run", () => {
    expect(after(10, "GOAL")).toBe("cup");
    expect(after(20, "GOAL")).toBe("cup");
    expect(after(40, "GOAL")).toBe("cup");
  });

  it("clearing stage 50 wins the run outright", () => {
    expect(after(50, "GOAL")).toBe("won");
  });

  it("a miss retries while tries remain, then knocks the run out", () => {
    expect(after(7, "SAVED", 3)).toBe("retry");
    expect(after(7, "WIDE", 0)).toBe("gameover");
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
    expect(scenarioFor(3).g.kpSigma).toBe(0.45); // THE CAT
    expect(scenarioFor(9).g.kpSigma).toBe(0.7); // THE FORTRESS
    expect(scenarioFor(5).g.kpSigma).toBe(STAGE_KP_SIGMA); // no kpSigma mod
  });

  it("THE OPENER greets you with a small wall and a drowsy keeper", () => {
    const { g } = scenarioFor(1);
    expect(g.wallN).toBe(3);
    expect(g.kpSigma).toBe(1.2);
  });

  it("OFF CENTRE's keeper cheats toward the far post, near post open", () => {
    const { g } = scenarioFor(2); // gx +3.5, so the near post is the -x side
    expect(g.kpStart - g.gx).toBeCloseTo(1.2, 9);
  });

  it("THE CAT is sharper, reaches further, and brings only a token wall", () => {
    const { g } = scenarioFor(3);
    expect(g.kpReach).toBeCloseTo(KP_REACH_X * 1.15, 9);
    expect(g.wallN).toBe(3);
  });

  it("THE SIDE ROAD parks its wall dead on the near-post line", () => {
    for (let roll = 0; roll < 30; roll++) {
      const { g } = scenarioFor(5);
      const nearPostAim = g.gx - Math.sign(g.gx) * 1.7;
      expect(g.wallX).toBeCloseTo((nearPostAim * g.wallZ) / g.D, 9);
      expect(g.wallN).toBe(5);
    }
  });

  it("SWIRLING GALE's wind turns while the ball is in the air", () => {
    const g = createGameState();
    g.stage = 6;
    newScenario(g);
    expect(g.windSwirl).toBe(1.5);
    g.phase = "flight";
    g.flightT = 0;
    g.kpDelay = 99;
    g.curlAx = 0;
    g.windAx = 3.1;
    g.windAz = 0;
    g.ball = { x: 0, y: 1, z: 0.1, vx: 0, vy: 0, vz: 0.01, spin: 0 }; // hangs
    const magBefore = Math.hypot(g.windAx, g.windAz);
    for (let i = 0; i < 60; i++) step(g, 1 / 60); // one second aloft
    const turned = Math.atan2(g.windAx, g.windAz);
    expect(Math.abs(turned - Math.PI / 2)).toBeCloseTo(1.5, 5); // 1.5 rad/s x 1 s
    expect(Math.hypot(g.windAx, g.windAz)).toBeCloseTo(magBefore, 5);
  });

  it("TIGHT ANGLE's keeper hugs the near post", () => {
    const { g } = scenarioFor(7); // gx -8.5, so the near post is the +x side
    expect(g.kpStart - g.gx).toBeGreaterThan(1.5); // 1.8, clamped to his limit
  });

  it("LONG RANGE races the gauge behind a token wall", () => {
    const { g } = scenarioFor(8);
    expect(g.gaugeSpeed).toBe(1.35);
    expect(g.wallN).toBe(3);
  });

  it("THE FORTRESS fields a double-size wall that never jumps", () => {
    const { g } = scenarioFor(9);
    expect(g.wallN).toBe(5);
    expect(g.wallScale).toBe(2);
    expect(g.wallWillJump).toBe(false);
    expect(g.wallHalf).toBeCloseTo((5 * 0.56 * 2) / 2, 9);
  });

  it("a ball that clears a normal wall is stopped by the FORTRESS wall", () => {
    // crosses the wall plane at 2.5m: over a 1.86m wall, into a 3.72m one
    const cross = (stage) => {
      const g = createGameState();
      g.stage = stage;
      newScenario(g);
      g.phase = "flight";
      g.flightT = 0;
      g.curlAx = 0;
      g.windAx = 0;
      g.windAz = 0;
      g.windSwirl = 0;
      g.kpDelay = 99;
      g.wallWillJump = false;
      g.ball = { x: g.wallX, y: 2.5, z: g.wallZ - 0.3, vx: 0, vy: 0, vz: 25, spin: 0 };
      step(g, 0.033);
      return g.result;
    };
    expect(cross(9)).toBe("WALL");
    expect(cross(1)).toBe(null); // sails clean over, still in flight
  });

  it("THE FINAL's wall always jumps", () => {
    for (let roll = 0; roll < 30; roll++) {
      expect(scenarioFor(10).g.wallWillJump).toBe(true);
    }
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
      // arrival point chosen so both the straight and the curl-misread
      // predictions keep the keeper standing (no dive, no reach clamp) -
      // the poses must match for the kpTarget delta to equal the misread
      const cone = Math.atan(GOAL_HALF / g.D) / DIR_GOAL_WINDOW;
      const d = Math.atan(-1.2 / g.D) / cone; // arrival at gx - 1.2
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

  it("the same aim is saved straight but beats the keeper curled", () => {
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

  it("a true corner shot beats even a correctly-guessing keeper", () => {
    // regulation goal, reach scaled with it: the outer strip of the goal
    // mouth must stay beatable when the keeper's prediction is exact
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.5); // gauss = 0
    try {
      const resultFor = (aim) => {
        const g = createGameState();
        newScenario(g);
        const cone = Math.atan(GOAL_HALF / g.D) / DIR_GOAL_WINDOW;
        g.locked = { h: 0.35, d: Math.atan(aim / g.D) / cone, s: 0 };
        launch(g);
        g.wallHalf = -99;
        g.windAx = 0;
        g.windAz = 0;
        for (let i = 0; i < 400 && !g.result; i++) step(g, 1 / 60);
        return g.result;
      };
      expect(resultFor(-(GOAL_HALF - 0.2))).toBe("GOAL"); // low corner
      expect(resultFor(-3.0)).toBe("SAVED"); // inside his stretched reach
    } finally {
      spy.mockRestore();
    }
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
