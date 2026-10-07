// backend/features/revision/algorithm.js
// Pure function spaced repetition scheduling algorithm

const INTERVAL_TIERS = [1, 3, 7, 14, 30];
const MIN_EASE_FACTOR = 1.3;
const DEFAULT_EASE_FACTOR = 2.5;

/**
 * Calculates the next review date and updated repetition state.
 * @param {Object} state - Current repetition state
 * @param {number} state.interval_days - Current interval in days
 * @param {number} state.repetitions - Count of consecutive successful reviews
 * @param {number} state.ease_factor - Current ease multiplier
 * @param {"easy"|"medium"|"hard"} rating - User recall assessment
 * @param {Date|string|number} [today] - Reference date for calculation
 * @returns {Object} { next_review_date, interval_days, repetitions, ease_factor }
 */
function next_review(state = {}, rating = "medium", today = new Date()) {
  const s = state || {};
  const currentInterval = Number(s.interval_days) || 1;
  const currentReps = Number(s.repetitions) || 0;
  const currentEase = Number(s.ease_factor) || DEFAULT_EASE_FACTOR;

  const normalizedRating = String(rating || "").toLowerCase().trim();

  let nextInterval = 1;
  let nextReps = currentReps;
  let nextEase = currentEase;

  if (normalizedRating === "hard") {
    // Reset interval and reduce ease factor
    nextReps = 0;
    nextInterval = 1;
    nextEase = Math.max(MIN_EASE_FACTOR, Number((currentEase - 0.2).toFixed(2)));
  } else if (normalizedRating === "easy") {
    // Accelerate interval and increase ease factor
    nextReps = currentReps + 1;
    nextEase = Number((currentEase + 0.15).toFixed(2));
    if (nextReps === 1) {
      nextInterval = 3;
    } else if (nextReps === 2) {
      nextInterval = 7;
    } else if (nextReps === 3) {
      nextInterval = 14;
    } else if (nextReps === 4) {
      nextInterval = 30;
    } else {
      nextInterval = Math.min(90, Math.round(currentInterval * nextEase));
      if (nextInterval <= currentInterval) nextInterval = currentInterval + 7;
    }
  } else {
    // Standard progression (medium recall)
    nextReps = currentReps + 1;
    if (nextReps === 1) {
      nextInterval = 3;
    } else if (nextReps === 2) {
      nextInterval = 7;
    } else if (nextReps === 3) {
      nextInterval = 14;
    } else if (nextReps === 4) {
      nextInterval = 30;
    } else {
      nextInterval = Math.min(60, Math.round(currentInterval * nextEase));
      if (nextInterval <= currentInterval) nextInterval = currentInterval + 3;
    }
  }

  // Parse reference date safely
  let refDate;
  if (today instanceof Date && !isNaN(today.getTime())) {
    refDate = new Date(today);
  } else if (typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today)) {
    refDate = new Date(`${today}T00:00:00.000Z`);
  } else {
    refDate = new Date(today);
    if (isNaN(refDate.getTime())) refDate = new Date();
  }

  // Use UTC day boundaries to prevent daylight savings / timezone drift
  const nextDateObj = new Date(refDate.getTime() + nextInterval * 86400000);
  const next_review_date = nextDateObj.toISOString().slice(0, 10);

  return {
    next_review_date,
    interval_days: nextInterval,
    repetitions: nextReps,
    ease_factor: nextEase,
  };
}

module.exports = {
  next_review,
  INTERVAL_TIERS,
  MIN_EASE_FACTOR,
  DEFAULT_EASE_FACTOR,
};
