// backend/infrastructure/resilience.js
// Production Circuit Breaker & Exponential Backoff with Jitter for Upstream APIs

const STATES = {
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN",
};

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 3;
    this.cooldownMs = options.cooldownMs || 30000;
    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.successCount = 0;
  }

  isOpen() {
    if (this.state === STATES.OPEN) {
      const now = Date.now();
      if (now - this.lastFailureTime > this.cooldownMs) {
        this.state = STATES.HALF_OPEN;
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess() {
    this.failureCount = 0;
    this.state = STATES.CLOSED;
    this.successCount++;
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = STATES.OPEN;
    }
  }

  getStatus() {
    return {
      name: this.name,
      state: this.isOpen() ? STATES.OPEN : this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
    };
  }
}

const circuits = new Map();
const DEFAULT_SERVICES = ["leetcode", "codeforces", "codechef", "github", "gemini", "email"];

function initDefaultCircuits() {
  DEFAULT_SERVICES.forEach((name) => {
    circuits.set(name, new CircuitBreaker(name));
  });
}
initDefaultCircuits();

function getCircuit(name) {
  if (!circuits.has(name)) {
    circuits.set(name, new CircuitBreaker(name));
  }
  return circuits.get(name);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an upstream call with Circuit Breaking, Exponential Backoff, and Jitter.
 * @param {string} serviceName - e.g. 'leetcode', 'codeforces', 'codechef', 'github', 'gemini'
 * @param {Function} action - Async function executing the external request
 * @param {Function} [fallback] - Optional fallback function when circuit is open or attempts exhausted
 * @param {Object} [options] - Retry options
 */
async function execute(serviceName, action, fallback = null, options = {}) {
  const circuit = getCircuit(serviceName);
  const maxRetries = options.retries !== undefined ? options.retries : 1;
  const baseDelayMs = options.baseDelayMs || 250;
  const maxDelayMs = options.maxDelayMs || 2000;

  if (circuit.isOpen()) {
    if (typeof fallback === "function") {
      return fallback(new Error(`Circuit open for ${serviceName}`));
    }
    const err = new Error(`Service ${serviceName} is temporarily unavailable (circuit open)`);
    err.code = "CIRCUIT_OPEN";
    err.retryable = true;
    throw err;
  }

  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const result = await action();
      circuit.recordSuccess();
      return result;
    } catch (error) {
      attempt++;
      circuit.recordFailure();

      if (attempt > maxRetries) {
        if (typeof fallback === "function") {
          return fallback(error);
        }
        throw error;
      }

      // Calculate exponential backoff with full jitter
      const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
      const jitteredDelay = Math.floor(exponential * (0.5 + Math.random() * 0.5));
      await sleep(jitteredDelay);
    }
  }
}

function getAllCircuitStatuses() {
  const result = {};
  for (const [name, circuit] of circuits.entries()) {
    result[name] = circuit.getStatus();
  }
  return result;
}

function resetAllCircuits() {
  circuits.clear();
  initDefaultCircuits();
}

module.exports = {
  execute,
  getCircuit,
  getAllCircuitStatuses,
  resetAllCircuits,
  STATES,
};
