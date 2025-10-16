// netlify/functions/submit-booking-2-0.js
// Seven Tattoo — Booking Intake (CORS, safer honeypot, SendGrid, diagnostics)

const sgMail = require("@sendgrid/mail");

// ---- CORS allowlist (covers live site + Shopify preview/editor) ----
const EXACT_ORIGINS = new Set([
  "https://seventattoolv.com",
  "https://www.seventattoolv.com",
  "https://admin.shopify.com",
]);
// Allow any *.myshopify.com origin (theme preview / draft)
function isAllowedOrigin(origin = "") {
  try {
    const u = new URL(origin);
    return EXACT_ORIGINS.has(origin) || u.hostname.endsWith(".myshopify.com");
  } catch {
    return false;
  }
}
function corsHeaders(origin = "") {
  const allow = isAllowedOrigin(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

// ---- Env (using your existing keys) ----
const SENDGRID_KEY = process.env.SENDGRID_API_KEY || process.env.SENDGRID || "";
const FROM_EMAIL =
  process.env.FROM_EMAIL ||
  process.env.SEND_FROM ||
  "no-reply@seventattoolv.com";
const TO_EMAIL =
  process.env.INTERNAL_EMAIL ||
  process.env.BACKOFFICE_RECEIVER ||
  "careers@seventattoolv.com";
if (SENDGRID_KEY) sgMail.setApiKey(SENDGRID_KEY);

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders(event.headers.origin),
      body: "",
    };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders(event.headers.origin),
      body: JSON.stringify({ ok: false, message: "Method not allowed" }),
    };
  }

  // Parse + basic fields
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {}

  // ---- Honeypot (safer): only treat as spam if it looks like a real URL/text, otherwise ignore ----
  const hp = String(body.website || "").trim();
  const honeypotLooksReal = hp.length > 0 && /https?:\/\//i.test(hp);
  if (honeypotLooksReal) {
    // Silent success to mislead bots
    return {
      statusCode: 200,
      headers: corsHeaders(event.headers.origin),
      body: JSON.stringify({ ok: true, skipped: "honeypot" }),
    };
  }

  // Validate
  const errors = [];
  const req = (k, label = k) => {
    if (!body[k] || String(body[k]).trim() === "")
      errors.push(`${label} is required`);
  };
  req("meaning", "Meaning behind the piece");
  req("fullName", "Full name");
  req("email", "Email");
  req("phone", "Phone number");
  req("placement", "Placement");
  req("scale", "Scale");
  req("hear", "How did you hear about us");
  if (!body.consent) errors.push("Consent checkbox must be checked");

  if (errors.length) {
    return {
      statusCode: 400,
      headers: corsHeaders(event.headers.origin),
      body: JSON.stringify({ ok: false, errors }),
    };
  }

  // Compose email
  const submittedAt = new Date().toISOString();
  const artist = String(body.artist || "").trim();
  const sourceLink = String(body.source_link || "").trim();

  const subject = `Booking Intake — ${body.fullName} (${body.scale}, ${body.placement})`;
  const text = [
    "— Seven Tattoo: Booking Intake —",
    `Submitted: ${submittedAt}`,
    "",
    `Meaning: ${body.meaning}`,
    `Full Name: ${body.fullName}`,
    `Email: ${body.email}`,
    `Phone: ${body.phone}`,
    `Placement: ${body.placement}`,
    `Scale: ${body.scale}`,
    `Heard About Us: ${body.hear}`,
    `Artist (param): ${artist || "(none)"}`,
    `Source Link: ${sourceLink || "(none)"}`,
  ].join("\n");

  const msg = {
    to: TO_EMAIL,
    from: { email: FROM_EMAIL, name: "Seven Tattoo" },
    subject,
    text,
    html: `
      <div style="font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111;">
        <h2 style="margin:0 0 12px;">Seven Tattoo — Booking Intake</h2>
        <p style="margin:0 0 12px;"><strong>Submitted:</strong> ${submittedAt}</p>
        <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
          <tr><td><strong>Meaning</strong></td><td>${escapeHtml(
            body.meaning
          )}</td></tr>
          <tr><td><strong>Full Name</strong></td><td>${escapeHtml(
            body.fullName
          )}</td></tr>
          <tr><td><strong>Email</strong></td><td>${escapeHtml(
            body.email
          )}</td></tr>
          <tr><td><strong>Phone</strong></td><td>${escapeHtml(
            body.phone
          )}</td></tr>
          <tr><td><strong>Placement</strong></td><td>${escapeHtml(
            body.placement
          )}</td></tr>
          <tr><td><strong>Scale</strong></td><td>${escapeHtml(
            body.scale
          )}</td></tr>
          <tr><td><strong>Heard About Us</strong></td><td>${escapeHtml(
            body.hear
          )}</td></tr>
          <tr><td><strong>Artist (param)</strong></td><td>${escapeHtml(
            artist || "(none)"
          )}</td></tr>
          <tr><td><strong>Source Link</strong></td><td>${
            sourceLink
              ? `<a href="${escapeAttr(sourceLink)}">${escapeHtml(
                  sourceLink
                )}</a>`
              : "(none)"
          }</td></tr>
        </table>
      </div>`,
  };

  // Send (with diagnostics in response)
  let attemptedSend = false,
    sgStatus = null,
    sgError = null;
  try {
    if (!SENDGRID_KEY) throw new Error("Missing SENDGRID_API_KEY");
    attemptedSend = true;
    const sgRes = await sgMail.send(msg);
    sgStatus = Array.isArray(sgRes) && sgRes[0] ? sgRes[0].statusCode : null;
  } catch (e) {
    sgError = (e && e.message) || String(e);
    console.error("SendGrid error:", e);
  }

  const ok = !!sgStatus && sgStatus >= 200 && sgStatus < 300;
  const bodyOut = {
    ok,
    diagnostics: {
      origin: event.headers.origin || null,
      allowed: isAllowedOrigin(event.headers.origin || ""),
      haveKey: !!SENDGRID_KEY,
      to: TO_EMAIL || null,
      from: FROM_EMAIL || null,
      attemptedSend,
      sendgridStatus: sgStatus,
      sendgridError: sgError,
    },
  };

  return {
    statusCode: ok ? 200 : 500,
    headers: corsHeaders(event.headers.origin),
    body: JSON.stringify(bodyOut),
  };
};

// helpers
function escapeHtml(s = "") {
  return String(s).replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        m
      ])
  );
}
function escapeAttr(s = "") {
  return String(s).replace(/"/g, "&quot;");
}
