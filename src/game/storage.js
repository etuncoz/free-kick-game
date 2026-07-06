/* ------------------------------------------------------------------
   localStorage persistence for run records: best stage reached, best
   score, and the most cups claimed in a single run. Every access is
   guarded - in private browsing (or with storage disabled) the game
   simply behaves as if nothing were persisted.
------------------------------------------------------------------- */

const K_BEST_STAGE = "fkl.bestStage";
const K_BEST_SCORE = "fkl.bestScore";
const K_CUPS = "fkl.cups";
// pre-50-stage-era flag meaning "won the (single) cup"; folded into cups
const K_CUP_WON_LEGACY = "fkl.cupWon";

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable - records just won't survive the session
  }
}

export function loadBests() {
  const cups = Math.max(
    0,
    parseInt(read(K_CUPS), 10) || 0,
    read(K_CUP_WON_LEGACY) === "1" ? 1 : 0
  );
  return {
    bestStage: Math.max(0, parseInt(read(K_BEST_STAGE), 10) || 0),
    bestScore: Math.max(0, parseInt(read(K_BEST_SCORE), 10) || 0),
    cups,
    cupWon: cups >= 1,
  };
}

// call once at run end (game over or the stage-50 win) with the stage the
// run reached and the cups it claimed; persists whichever records improved
// and returns the up-to-date bests for the HUD
export function saveRunEnd({ stage, score, cups }) {
  const b = loadBests();
  if (stage > b.bestStage) {
    b.bestStage = stage;
    write(K_BEST_STAGE, String(stage));
  }
  if (score > b.bestScore) {
    b.bestScore = score;
    write(K_BEST_SCORE, String(score));
  }
  if (cups > b.cups) {
    b.cups = cups;
    b.cupWon = cups >= 1;
    write(K_CUPS, String(cups));
  }
  return b;
}
