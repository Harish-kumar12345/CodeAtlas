const crypto = require("crypto");

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const isProduction = process.env.NODE_ENV === "production";
const secret = process.env.SESSION_SECRET || "local-development-session-secret";

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function createToken(payload, ttlSeconds = SESSION_TTL_SECONDS) {
  const body = encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  return `${body}.${sign(body)}`;
}

function readToken(token) {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = sign(body);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
  } catch {
    return null;
  }
}

function setCookie(res, name, value, maxAge = SESSION_TTL_SECONDS) {
  const flags = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (isProduction) flags.push("Secure");
  res.set("Set-Cookie", flags.join("; "));
}

function clearCookie(res, name) {
  setCookie(res, name, "", 0);
}

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || "").split(";").map((value) => value.trim());
  const entry = cookies.find((value) => value.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

module.exports = { clearCookie, createToken, getCookie, readToken, setCookie };
