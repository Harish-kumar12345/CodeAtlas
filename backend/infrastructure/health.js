// backend/infrastructure/health.js
// Health, Liveness, Readiness, Status endpoints and Maintenance Mode middleware
const fs = require("fs");
const path = require("path");
const { getAllCircuitStatuses } = require("./resilience");
const database = require("../database");

const START_TIME = Date.now();

function isMaintenanceMode() {
  return process.env.MAINTENANCE_MODE === "true";
}

// Liveness probe (/healthz): verifies the process is alive and responsive
function livenessHandler(_req, res) {
  res.status(200).json({
    status: "ok",
    uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
    timestamp: new Date().toISOString(),
  });
}

// Readiness probe (/readyz): deep check of database, cache, and dependencies
async function readinessHandler(_req, res) {
  const checks = {
    database: "unknown",
    cache: "ok",
    circuits: getAllCircuitStatuses(),
  };

  let isReady = true;

  try {
    // Probe database connectivity with a lightweight query
    const dbTest = await database.getGoal("healthcheck_probe");
    checks.database = "ok";
  } catch (err) {
    checks.database = "down";
    isReady = false;
  }

  const statusCode = isReady ? 200 : 503;
  res.status(statusCode).json({
    status: isReady ? "ready" : "not_ready",
    checks,
    timestamp: new Date().toISOString(),
  });
}

// Public Status endpoint (/status): user/monitor-facing system status
function statusHandler(req, res) {
  const circuits = getAllCircuitStatuses();
  const uptimeSeconds = Math.floor((Date.now() - START_TIME) / 1000);
  const memory = process.memoryUsage();

  const statusReport = {
    service: "LeetMatric",
    status: isMaintenanceMode() ? "maintenance" : "operational",
    uptimeSeconds,
    circuits,
    system: {
      nodeVersion: process.version,
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
    },
    timestamp: new Date().toISOString(),
  };

  if (req.accepts(["json", "html"]) === "html" && !req.xhr && !req.path.endsWith(".json")) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>System Status — LeetMatric</title>
  <link rel="stylesheet" href="/style.css" />
  <link rel="stylesheet" href="/footer.css" />
  <style>
    .status-card { max-width: 600px; margin: 4rem auto; padding: 2rem; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); }
    .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 0.35rem 0.85rem; border-radius: 999px; font-weight: 700; font-size: 0.82rem; }
    .status-badge.operational { background: rgba(50,213,131,0.15); color: var(--success); }
    .status-badge.maintenance { background: rgba(245,181,68,0.15); color: var(--warning); }
    .metric-row { display: flex; justify-content: space-between; padding: 0.75rem 0; border-bottom: 1px solid var(--border); font-size: 0.88rem; }
  </style>
</head>
<body>
  <div class="page-wrapper">
    <div class="status-card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1.5rem;">
        <h1 style="font-family:var(--font-display); font-size:1.5rem;">LeetMatric Status</h1>
        <span class="status-badge ${statusReport.status}">${statusReport.status === "operational" ? "● Operational" : "▲ Maintenance"}</span>
      </div>
      <div class="metric-row"><span>Uptime</span><strong>${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s</strong></div>
      <div class="metric-row"><span>Platform Adapters</span><strong>Active</strong></div>
      <div class="metric-row"><span>Memory (Heap)</span><strong>${statusReport.system.heapUsedMb} MB</strong></div>
      <div style="margin-top: 1.5rem; text-align: center;">
        <a href="/" class="header-link" style="color:var(--accent2); text-decoration:none;">← Return to LeetMatric</a>
      </div>
    </div>
  </div>
  <script src="/footer-config.js" defer></script>
  <script src="/footer.js" defer></script>
</body>
</html>`;
    return res.type("html").send(html);
  }

  res.status(200).json(statusReport);
}

// Maintenance Mode Interceptor
function maintenanceMiddleware(req, res, next) {
  if (!isMaintenanceMode()) return next();

  // Allow health checks, status page, and static stylesheets
  const targetPath = req.path;
  if (targetPath === "/healthz" || targetPath === "/readyz" || targetPath === "/status" || targetPath.startsWith("/style.") || targetPath.startsWith("/footer.")) {
    return next();
  }

  if (req.accepts("html") && !req.path.startsWith("/api/")) {
    const maintenancePath = path.resolve(__dirname, "../../frontend/public/maintenance.html");
    if (fs.existsSync(maintenancePath)) {
      return res.status(503).sendFile(maintenancePath);
    }
  }

  return res.status(503).json({
    code: "MAINTENANCE_MODE",
    message: "LeetMatric is currently undergoing scheduled maintenance. Please check back shortly.",
    retryable: true,
  });
}

module.exports = {
  livenessHandler,
  readinessHandler,
  statusHandler,
  maintenanceMiddleware,
  isMaintenanceMode,
};
