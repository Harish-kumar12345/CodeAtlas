const crypto = require("crypto");
const argon2 = require("argon2");

// Common weak passwords blocklist
const COMMON_PASSWORDS = new Set([
  "password", "password123", "12345678", "123456789", "qwertyuiop",
  "admin123", "letmein123", "welcome123", "iloveyou", "monkey123",
  "dragon123", "master123", "football", "baseball", "superman",
  "shadow123", "sunshine", "princess", "trustno1", "passw0rd"
]);

/**
 * Validates password strength according to security requirements:
 * - min 8 characters
 * - not in common password blocklist
 * Returns { valid: boolean, error?: string, score: number }
 */
function validatePasswordStrength(password) {
  if (typeof password !== "string" || password.length < 8) {
    return { valid: false, error: "Password must be at least 8 characters long.", score: 0 };
  }
  if (password.length > 128) {
    return { valid: false, error: "Password must not exceed 128 characters.", score: 0 };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { valid: false, error: "This password is too common and easily guessed. Please choose a stronger password.", score: 1 };
  }

  let score = 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  return { valid: true, score: Math.min(score, 5) };
}

/**
 * Hash password using Argon2id
 */
async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB
    timeCost: 3,
    parallelism: 4,
  });
}

/**
 * Verify password against Argon2id hash
 */
async function verifyPassword(hash, password) {
  try {
    if (!hash || !password) return false;
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Generate cryptographically secure random token (hex)
 */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * Hash single-use token with SHA-256 for secure database storage
 */
function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/**
 * Generate standard UUID v4
 */
function generateUuid() {
  return crypto.randomUUID();
}

/**
 * Constant-time string equality check
 */
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
  validatePasswordStrength,
  hashPassword,
  verifyPassword,
  randomToken,
  hashToken,
  generateUuid,
  timingSafeEqual,
};
