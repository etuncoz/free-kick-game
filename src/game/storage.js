/* ------------------------------------------------------------------
   localStorage persistence for run records: best stage reached, best
   score, and whether the cup has ever been won. Every access is
   guarded - in private browsing (or with storage disabled) the game
   simply behaves as if nothing were persisted.
------------------------------------------------------------------- */

const K_BEST_STAGE = "fkl.bestStage";
const K_BEST_SCORE = "fkl.bestScore";
const K_CUP_WON = "fkl.cupWon";

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
  return {
    bestStage: Math.max(0, parseInt(read(K_BEST_STAGE), 10) || 0),
    bestScore: Math.max(0, parseInt(read(K_BEST_SCORE), 10) || 0),
    cupWon: read(K_CUP_WON) === "1",
  };
}

// call once at run end (game over or cup win) with the stage the run
// reached; persists whichever records improved and returns the
// up-to-date bests for the HUD
export function saveRunEnd({ stage, score, won }) {
  const b = loadBests();
  if (stage > b.bestStage) {
    b.bestStage = stage;
    write(K_BEST_STAGE, String(stage));
  }
  if (score > b.bestScore) {
    b.bestScore = score;
    write(K_BEST_SCORE, String(score));
  }
  if (won && !b.cupWon) {
    b.cupWon = true;
    write(K_CUP_WON, "1");
  }
  return b;
}
