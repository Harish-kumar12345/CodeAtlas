// backend/infrastructure/sentry.js
// Optional Sentry Error Monitoring Integration with Strict PII Scrubbing
const packageJson = require("../package.json");

let Sentry = null;
let isInitialized = false;

function initSentry(app) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return {
      enabled: false,
      captureException: (err) => {
        // Fallback no-op when Sentry is not configured
        if (process.env.NODE_ENV === "development") {
          console.error("[Sentry Disabled] Exception:", err?.message || err);
        }
      },
      requestHandler: () => (_req, _res, next) => next(),
      errorHandler: () => (err, _req, _res, next) => next(err),
    };
  }

  try {
    Sentry = require("@sentry/node");

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "production",
      release: `leetmatric@${packageJson.version || "1.0.0"}`,
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
      beforeSend(event) {
        // Strip sensitive headers and request body fields
        if (event.request) {
          if (event.request.headers) {
            delete event.request.headers.cookie;
            delete event.request.headers.authorization;
            delete event.request.headers["x-csrf-token"];
          }
          if (event.request.data && typeof event.request.data === "object") {
            const sanitized = { ...event.request.data };
            ["password", "token", "secret", "newPassword", "oldPassword"].forEach((k) => {
              if (k in sanitized) sanitized[k] = "[REDACTED]";
            });
            event.request.data = sanitized;
          }
        }
        // Scrub user email if present
        if (event.user) {
          delete event.user.email;
          delete event.user.ip_address;
        }
        return event;
      },
    });

    isInitialized = true;

    return {
      enabled: true,
      captureException: (err, context) => Sentry.captureException(err, context),
      requestHandler: () => (Sentry.Handlers?.requestHandler ? Sentry.Handlers.requestHandler() : (_req, _res, next) => next()),
      errorHandler: () => (Sentry.Handlers?.errorHandler ? Sentry.Handlers.errorHandler() : (err, _req, _res, next) => next(err)),
    };
  } catch (err) {
    console.warn("[Sentry] Optional package @sentry/node is not installed. Sentry monitoring is disabled.");
    return {
      enabled: false,
      captureException: () => {},
      requestHandler: () => (_req, _res, next) => next(),
      errorHandler: () => (err, _req, _res, next) => next(err),
    };
  }
}

module.exports = {
  initSentry,
  isInitialized: () => isInitialized,
};
