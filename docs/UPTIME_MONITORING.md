# Uptime Monitoring & Keep-Alive Guide — LeetMatric

## Background: Render Free Tier Sleep Behavior
Render's free tier web services spin down to zero after **15 minutes of inbound network inactivity**.
- When an instance is sleeping, the first incoming request triggers a **cold start**, which takes **50–65 seconds** while Render provisions and boots the container.
- Background intervals (such as snapshot jobs or Sunday digests) freeze while the container is sleeping.

---

## Solution: Automated Keep-Alive Pings

By configuring a free external monitor (such as **UptimeRobot** or **BetterStack**) to ping the lightweight `/healthz` endpoint every **5 to 10 minutes**, the instance remains warm during daytime usage hours.

> [!NOTE]
> Render provides **750 free instance hours per calendar month** per account. 1 instance running 24/7 consumes 744 hours in a 31-day month, which fits within the free allotment if LeetMatric is the only running service. If you have multiple services, schedule pings only during daytime (e.g. 08:00–22:00 UTC) via cron-job.org.

---

## Step-by-Step Setup with UptimeRobot (Free)

1. **Sign up / Log in:**
   Visit [UptimeRobot.com](https://uptimerobot.com) and create a free account.
2. **Add New Monitor:**
   - **Monitor Type:** `HTTP(s)`
   - **Friendly Name:** `LeetMatric Liveness`
   - **URL (or IP):** `https://leetlytics.onrender.com/healthz`
   - **Monitoring Interval:** `5 minutes`
   - **Monitor Timeout:** `30 seconds`
3. **Configure Notifications:**
   - Select your notification email or Discord/Telegram webhook.
4. **Save Monitor:** Click **Create Monitor**.

---

## Available Health & Status Endpoints

| Endpoint | Purpose | External Dependencies | Response Code | Rate Limited? |
|---|---|---|---|:---:|
| `GET /healthz` | **Liveness Probe:** Confirms Node.js event loop is responding | None | `200 OK` | **No** (exempt) |
| `GET /readyz` | **Readiness Probe:** Verifies Database, Cache, and Circuit states | DB ping, circuits | `200` or `503` | **No** (exempt) |
| `GET /status` | **Public Status Dashboard:** HTML & JSON overview of health | Internal telemetry | `200 OK` | **No** (exempt) |
| `GET /health` | **Legacy Compatibility:** Backwards-compatible endpoint | LeetCode circuit | `200` or `503` | **No** (exempt) |

---

## Incident Response & Triage

1. **If `/healthz` returns 5xx or fails to respond within 30s:**
   - Container has crashed or Render is undergoing platform maintenance.
   - Check Render Dashboard logs for OOM (Out Of Memory) or uncaught exception stack traces.
2. **If `/readyz` returns 503:**
   - The Node.js process is alive, but the database connection (`DATABASE_URL`) failed or timed out.
   - Check Postgres connection credentials or disk availability.
