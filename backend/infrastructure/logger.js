// backend/infrastructure/logger.js
// Structured JSON Logger with Request Correlation and Sensitive Data Scrubbing
const crypto = require("crypto");

const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const CURRENT_LEVEL = LOG_LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] || LOG_LEVELS.info;

const SENSITIVE_KEYS = new Set([
  "password",
  "newpassword",
  "oldpassword",
  "token",
  "refreshtoken",
  "accesstoken",
  "secret",
  "clientsecret",
  "apikey",
  "cookie",
  "authorization",
  "csrftoken",
  "session",
]);

function redactSensitive(data, depth = 0) {
  if (depth > 5 || data === null || data === undefined) return data;
  if (typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitive(item, depth + 1));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey) || lowerKey.includes("password") || lowerKey.includes("secret")) {
      sanitized[key] = "[REDACTED]";
    } else if (lowerKey === "authorization") {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = redactSensitive(value, depth + 1);
    }
  }
  return sanitized;
}

function formatLog(level, event, message, metadata = {}) {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level,
    event,
    message,
    ...redactSensitive(metadata),
  };
  return JSON.stringify(entry);
}

const logger = {
  debug(event, message, meta) {
    if (CURRENT_LEVEL <= LOG_LEVELS.debug) {
      console.log(formatLog("DEBUG", event, message, meta));
    }
  },
  info(event, message, meta) {
    if (CURRENT_LEVEL <= LOG_LEVELS.info) {
      console.log(formatLog("INFO", event, message, meta));
    }
  },
  warn(event, message, meta) {
    if (CURRENT_LEVEL <= LOG_LEVELS.warn) {
      console.warn(formatLog("WARN", event, message, meta));
    }
  },
  error(event, message, meta) {
    if (CURRENT_LEVEL <= LOG_LEVELS.error) {
      console.error(formatLog("ERROR", event, message, meta));
    }
  },
  middleware() {
    return (req, res, next) => {
      const incomingId = req.headers["x-request-id"];
      const requestId = (typeof incomingId === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(incomingId))
        ? incomingId
        : crypto.randomUUID();

      req.requestId = requestId;
      res.setHeader("X-Request-ID", requestId);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");

      const startTime = Date.now();

      res.on("finish", () => {
        const durationMs = Date.now() - startTime;
        const meta = {
          requestId,
          method: req.method,
          path: req.originalUrl || req.url,
          status: res.statusCode,
          durationMs,
          ip: req.ip || req.socket?.remoteAddress,
          userAgent: req.headers["user-agent"],
        };

        if (res.statusCode >= 500) {
          logger.error("http_request_failed", `${req.method} ${req.originalUrl} returned ${res.statusCode}`, meta);
        } else if (res.statusCode >= 400) {
          logger.warn("http_client_error", `${req.method} ${req.originalUrl} returned ${res.statusCode}`, meta);
        } else {
          logger.info("http_request", `${req.method} ${req.originalUrl} returned ${res.statusCode}`, meta);
        }
      });

      next();
    };
  },
};

module.exports = logger;
