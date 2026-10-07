const fetch = require("node-fetch");
const { execute } = require("../infrastructure/resilience");
const { randomToken, hashToken } = require("./crypto");
const authDb = require("./db");

const TOKEN_EXPIRY_VERIFY_MS = 24 * 60 * 60 * 1000; // 24 hours
const TOKEN_EXPIRY_RESET_MS = 60 * 60 * 1000; // 1 hour

function getAppBaseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (req) {
    const proto = req.get("x-forwarded-proto") || req.protocol || "http";
    const host = req.get("host") || "localhost:3000";
    return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}

/**
 * Creates an expiring, hashed single-use token in the database
 */
async function generateEmailToken(userId, type) {
  const rawToken = randomToken(32);
  const tokenHash = hashToken(rawToken);
  const expiryMs = type === "verify_email" ? TOKEN_EXPIRY_VERIFY_MS : TOKEN_EXPIRY_RESET_MS;
  const expiresAt = new Date(Date.now() + expiryMs).toISOString();

  await authDb.createEmailToken({
    userId,
    tokenHash,
    type,
    expiresAt,
  });

  return rawToken;
}

/**
 * Sends an email via configured provider (Resend, Brevo) or console in dev
 */
async function sendEmail({ to, subject, html, text }) {
  const provider = (process.env.EMAIL_PROVIDER || "console").toLowerCase();
  const apiKey = process.env.EMAIL_API_KEY;
  const from = process.env.EMAIL_FROM || "LeetMatric <noreply@leetlytics.onrender.com>";

  if (provider === "resend" && apiKey) {
    return execute("email", async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ from, to, subject, html, text }),
          signal: controller.signal,
        });
        if (!response.ok) {
          console.error("Resend delivery failed:", await response.text());
        }
        return response.ok;
      } finally {
        clearTimeout(timer);
      }
    }, () => false);
  }

  if (provider === "brevo" && apiKey) {
    return execute("email", async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sender: { email: from.includes("<") ? from.split("<")[1].replace(">", "").trim() : from, name: "LeetMatric" },
            to: [{ email: to }],
            subject,
            htmlContent: html,
            textContent: text,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          console.error("Brevo delivery failed:", await response.text());
        }
        return response.ok;
      } finally {
        clearTimeout(timer);
      }
    }, () => false);
  }

  // Development fallback: Print to console
  console.log("─────────────────────────────────────────────────────────────────");
  console.log(`[EMAIL DISPATCH] To: ${to} | Subject: ${subject}`);
  console.log(`[CONTENT]:\n${text}`);
  console.log("─────────────────────────────────────────────────────────────────");
  return true;
}

/**
 * Send email verification link
 */
async function sendVerificationEmail(req, user) {
  const token = await generateEmailToken(user.id, "verify_email");
  const baseUrl = getAppBaseUrl(req);
  const verifyUrl = `${baseUrl}/auth/verify-email?token=${token}`;

  const text = `Hello,\n\nPlease verify your email for LeetMatric by visiting the link below:\n${verifyUrl}\n\nThis link expires in 24 hours.\nIf you did not create an account, you can ignore this email.`;
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2>Verify your email address</h2>
      <p>Thank you for signing up for LeetMatric! Please click the button below to verify your email address:</p>
      <p style="margin: 30px 0;">
        <a href="${verifyUrl}" style="background-color: #7c6aff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Verify Email</a>
      </p>
      <p style="color: #666; font-size: 14px;">Or copy and paste this link into your browser:<br/><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p style="color: #999; font-size: 12px; margin-top: 40px;">This link expires in 24 hours. If you did not request this, please ignore this email.</p>
    </div>
  `;

  await sendEmail({
    to: user.email,
    subject: "Verify your email for LeetMatric",
    text,
    html,
  });
}

/**
 * Send password reset link
 */
async function sendPasswordResetEmail(req, user) {
  const token = await generateEmailToken(user.id, "reset_password");
  const baseUrl = getAppBaseUrl(req);
  const resetUrl = `${baseUrl}/auth/reset-password?token=${token}`;

  const text = `Hello,\n\nA password reset was requested for your LeetMatric account.\nYou can reset your password using the link below:\n${resetUrl}\n\nThis link expires in 1 hour.\nIf you did not request a password reset, you can safely ignore this email.`;
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2>Reset your LeetMatric password</h2>
      <p>We received a request to reset your password. Click the button below to choose a new password:</p>
      <p style="margin: 30px 0;">
        <a href="${resetUrl}" style="background-color: #7c6aff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
      </p>
      <p style="color: #666; font-size: 14px;">Or copy and paste this link into your browser:<br/><a href="${resetUrl}">${resetUrl}</a></p>
      <p style="color: #999; font-size: 12px; margin-top: 40px;">This link expires in 1 hour. If you did not request this, your account remains secure and no changes were made.</p>
    </div>
  `;

  await sendEmail({
    to: user.email,
    subject: "Reset your LeetMatric password",
    text,
    html,
  });
}

module.exports = {
  generateEmailToken,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendEmail,
};
