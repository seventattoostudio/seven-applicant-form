// netlify/functions/submit-application.js
// Seven Tattoo — Artist Application (SendGrid / CommonJS)

const sg = require("@sendgrid/mail");

// bump to confirm what's deployed via GET ?ping=1
const VERSION = "st-2025-09-16-artist-v2";

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

    // Bot trap (honeypot)
    if (
      truthy(body.hp_extra_info) ||
      String(body.hp_extra_info || "").length > 0
    ) {
      return json(200, { ok: true, skipped: true, reason: "honeypot" });
    }

    // ---- Normalize incoming fields (with back-compat fallbacks) ----
    const name = str(body.name);
    const email = str(body.email);
    const phone = str(body.phone);
    const position = str(body.position || "Artist");
    const location = str(body.location || body.city); // some forms send "city"
    const qProud = str(body.q_proud || body.about); // fallback to old "about"
    const qCommit = str(body.q_commitment || body.ownership_story);
    const videoUrl = str(body.video_url);
    const consent = truthy(body.consent || body.agree_sanitation)
      ? "Yes"
      : "No";

    // Instagram handle: required for artist — normalize to raw "@handle"
    const igHandleRaw = str(
      body.instagram_handle || body.ig_handle || body.resume_link
    );
    const instagram = normalizeIgHandle(igHandleRaw);

    // ---- Basic required check ----
    const missing = [];
    if (!name) missing.push("name");
    if (!email) missing.push("email");
    if (!phone) missing.push("phone");
    if (!location) missing.push("location");
    if (!instagram) missing.push("instagram_handle");
    if (!qProud) missing.push("q_proud");
    if (!qCommit) missing.push("q_commitment");
    if (!consent) missing.push("consent");
    if (missing.length) {
      return json(422, {
        error: "Missing fields",
        fields: missing,
        version: VERSION,
      });
    }

    // ---- Build email (plain text) ----
    const lines = [];
    lines.push("New Seven Tattoo Application");
    lines.push("-----------------------------");
    lines.push(`Name: ${name}`);
    lines.push(`Email: ${email}`);
    lines.push(`Phone: ${phone}`);
    lines.push(`Position: ${position}`);
    lines.push(`City/Location: ${location}`);
    lines.push(`Instagram Handle: ${instagram}`);
    lines.push("");
    lines.push(
      "What must your work represent in five years for you to feel proud?:"
    );
    lines.push(qProud || "—");
    lines.push("");
    lines.push(
      "Tell us about a long-term commitment you kept and why it mattered.:"
    );
    lines.push(qCommit || "—");
    lines.push("");
    lines.push(`Consent: ${consent}`);
    if (videoUrl) lines.push(`Video URL: ${videoUrl}`);
    lines.push("");
    lines.push(`(version: ${VERSION})`);

    const text = lines.join("\n");

    // Simple HTML wrapper (keeps preformatted layout)
    const html = `<div style="font:14px -apple-system,Segoe UI,Roboto,Arial;color:#111;line-height:1.6">
      <h2 style="margin:0 0 8px;font:800 20px -apple-system,Segoe UI,Roboto,Arial">New Seven Tattoo Application</h2>
      <pre style="white-space:pre-wrap;margin:0">${escapeHtml(text)}</pre>
    </div>`;

    const subject = `Application: ${name || "Applicant"} (${position})`;

    // Dry run if key missing (lets you verify formatting from local / staging)
    if (!process.env.SENDGRID_API_KEY) {
      return json(200, {
        ok: true,
        dryRun: true,
        to: TO_EMAIL,
        subject,
        version: VERSION,
        preview: text.slice(0, 1200),
      });
    }

    await sg.send({
      to: TO_EMAIL,
      from: { email: FROM_EMAIL, name: FROM_NAME },
      replyTo: email || undefined,
      subject,
      text,
      html,
      trackingSettings: { clickTracking: { enable: false, enableText: false } },
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

// Accept "@name", "name", or full URLs like instagram.com/name → returns "@name"
function normalizeIgHandle(input = "") {
  let s = String(input || "").trim();
  if (!s) return "";
  // If they pasted a URL, extract first path segment
  if (/^(https?:)?\/\//i.test(s) || /^instagram\.com/i.test(s)) {
    try {
      if (!/^https?:\/\//i.test(s)) s = "https://" + s;
      const u = new URL(s);
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length) s = parts[0];
    } catch (_) {
      /* ignore */
    }
  }
  s = s.replace(/^@+/, ""); // drop leading @
  s = s.replace(/[^a-z0-9._]/gi, ""); // IG-valid chars only
  return s ? "@" + s : "";
}
