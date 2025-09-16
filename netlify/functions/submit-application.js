// netlify/functions/submit-application.js
// Seven Tattoo — Staff Application (SendGrid / CommonJS)

const sg = require("@sendgrid/mail");

// Bump to confirm what's deployed via GET ?ping=1
const VERSION = "st-2025-09-16-4";

// Configure SendGrid via Netlify env vars
sg.setApiKey(process.env.SENDGRID_API_KEY || "");

const TO_EMAIL = (process.env.TO_EMAIL || "careers@seventattoolv.com").trim();
const FROM_EMAIL = (
  process.env.FROM_EMAIL || "no-reply@seventattoolv.com"
).trim();
const FROM_NAME = (process.env.FROM_NAME || "Seven Tattoo").trim();

exports.handler = async (event) => {
  // Health check / version probe
  if (event.httpMethod === "GET") {
    return json(200, { ok: true, version: VERSION });
  }

  // CORS preflight
  if (event.httpMethod === "OPTIONS") return ok();

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const body = JSON.parse(event.body || "{}");

    // Normalize fields from the Shopify form
    const name = str(body.name);
    const email = str(body.email);
    const phone = str(body.phone);
    const role = str(body.position || "Front Desk (Staff)");
    const where = str(body.location);
    const about = str(body.about);
    const story = str(body.ownership_story);
    const video = str(body.video_url || body.resume_link);
    const consent = truthy(body.consent) ? "Yes" : "No";

    // Build the exact email text
    const text = [
      "New Seven Tattoo Application",
      "-----------------------------",
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone}`,
      `Position: ${role}`,
      "About:",
      about,
      `City/Location: ${where}`,
      "",
      "What do you need from a workplace to feel secure and grow?:",
      about,
      "",
      "Tell us about a time you took ownership when something went wrong.:",
      story,
      "",
      `Consent: ${consent}`,
      "Resume link:",
      video || "N/A",
      "Video URL:",
      video || "N/A",
      "References:",
      "__meta:",
      JSON.stringify(body.__meta || {}, null, 2),
      "",
      `(version: ${VERSION})`,
    ].join("\n");

    // Simple HTML wrapper (keeps preformatted layout)
    const html = `<div style="font:14px -apple-system,Segoe UI,Roboto,Arial;color:#111;line-height:1.6">
      <h2 style="margin:0 0 8px;font:800 20px -apple-system,Segoe UI,Roboto,Arial">New Seven Tattoo Application</h2>
      <pre style="white-space:pre-wrap;margin:0">${escapeHtml(text)}</pre>
    </div>`;

    const subject = `Application: ${name || "Applicant"} (${role})`;

    // If no API key set, return a dry-run response so you can verify formatting
    if (!process.env.SENDGRID_API_KEY) {
      return json(200, {
        ok: true,
        dryRun: true,
        to: TO_EMAIL,
        subject,
        version: VERSION,
        preview: text.slice(0, 800),
      });
    }

    await sg.send({
      to: TO_EMAIL,
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject,
      text,
      html,
      trackingSettings: { clickTracking: { enable: true, enableText: true } },
    });

    return json(200, { ok: true, version: VERSION });
  } catch (err) {
    console.error("submit-application error:", err);
    return json(500, { error: "Server error", version: VERSION });
  }
};

/* ---------- helpers ---------- */
function ok() {
  return { statusCode: 200, headers: cors(), body: "OK" };
}

function json(code, obj) {
  return {
    statusCode: code,
    headers: {
      ...cors(),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(obj),
  };
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

function str(v) {
  return v == null ? "" : String(v);
}

function truthy(v) {
  if (typeof v === "boolean") return v;
  const s = String(v || "").toLowerCase();
  return ["true", "1", "yes", "on"].includes(s);
}

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
