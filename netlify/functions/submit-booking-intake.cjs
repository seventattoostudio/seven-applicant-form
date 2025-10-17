// netlify/functions/submit-booking-intake.cjs

// ---------- CORS ----------
const ALLOWLIST = [
  "https://seventattoolv.com",
  "https://www.seventattoolv.com",
  "https://seventattoolv.myshopify.com",
  "https://frolicking-sundae-64ec36.netlify.app",
];

const pickAllowedOrigin = (origin = "") =>
  ALLOWLIST.includes(origin)
    ? origin
    : "https://frolicking-sundae-64ec36.netlify.app";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": pickAllowedOrigin(origin),
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    "Access-Control-Allow-Credentials": "false",
    Vary: "Origin",
    "Content-Type": "application/json; charset=utf-8",
  };
}

const ok = (headers, obj = {}) => ({
  statusCode: 200,
  headers,
  body: JSON.stringify({ ok: true, ...obj }),
});

const err = (headers, code, message, more = {}) => ({
  statusCode: code,
  headers,
  body: JSON.stringify({ ok: false, error: message, ...more }),
});

const isFilled = (v) =>
  v !== undefined && v !== null && String(v).trim() !== "";

// ---------- Optional Email (SendGrid) ----------
async function maybeSendEmail(payload) {
  const key = process.env.SENDGRID_API_KEY;
  const to = process.env.BOOKING_TO;
  const from = process.env.BOOKING_FROM;

  // If env vars are missing, skip email gracefully
  if (!key || !to || !from) {
    return { sent: false, reason: "Email disabled (missing env vars)" };
  }

  let sgMail;
  try {
    sgMail = require("@sendgrid/mail");
  } catch {
    return { sent: false, reason: "@sendgrid/mail not installed" };
  }

  sgMail.setApiKey(key);

  const subject = `Booking Intake – ${payload.fullName || "New Lead"}`;
  const lines = [
    `Name: ${payload.fullName || "(not provided)"}`,
    `Email: ${payload.email || "(not provided)"}`,
    `Phone: ${payload.phone || "(not provided)"}`,
    `Placement: ${payload.placement || "(not provided)"}`,
    `Scale: ${payload.scale || "(not provided)"}`,
    `Heard via: ${payload.hear || "(not provided)"}`,
    `Artist: ${payload.artist || "(not provided)"}`,
    `Consent: ${payload.consent ? "Yes" : "No"}`,
    `Meaning: ${payload.meaning || "(not provided)"}`,
    `Vision: ${payload.vision || "(not provided)"}`,
    `Source Link: ${payload.source_link || "(not provided)"}`,
  ];

  try {
    await sgMail.send({
      to,
      from,
      subject,
      text: lines.join("\n"),
      html: `<pre style="font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">${lines
        .map((l) => l.replace(/</g, "&lt;"))
        .join("\n")}</pre>`,
    });
    return { sent: true };
  } catch (e) {
    const reason = e?.response?.body || e?.message || String(e);
    return { sent: false, reason };
  }
}

// ---------- Handler ----------
exports.handler = async (event) => {
  const origin = event.headers?.origin || "";
  const headers = corsHeaders(origin);

  // Preflight — always 200 (avoid undici 204 bug)
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // Method check
  if (event.httpMethod !== "POST") {
    return err(headers, 405, "Method Not Allowed");
  }

  // Content-Type check
  const ct = (
    event.headers["content-type"] ||
    event.headers["Content-Type"] ||
    ""
  ).toLowerCase();
  if (!ct.includes("application/json")) {
    return err(headers, 415, "Unsupported Media Type – use application/json");
  }

  // Parse JSON
  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch {
    return err(headers, 400, "Invalid JSON in request body");
  }

  // Honeypot (hidden field "website"): if filled, pretend success
  if (isFilled(data.website)) {
    return ok(headers, { diagnostics: { dropped: true, reason: "honeypot" } });
  }

  // Required fields (minimal)
  const missing = ["fullName", "email", "consent"].filter(
    (f) => !isFilled(data[f])
  );
  if (missing.length) {
    return err(headers, 422, "Missing required fields", { missing });
  }

  // Normalize payload
  const payload = {
    meaning: data.meaning || "",
    vision: data.vision || "",
    fullName: data.fullName || "",
    email: data.email || "",
    phone: data.phone || "",
    placement: data.placement || "",
    scale: data.scale || "",
    hear: data.hear || "",
    consent: !!data.consent,
    artist: data.artist || "",
    source_link: data.source_link || data.source || "",
  };

  // Send email if configured
  const email = await maybeSendEmail(payload);

  // Success
  return ok(headers, {
    diagnostics: {
      allowedOrigin: headers["Access-Control-Allow-Origin"],
      email,
    },
  });
};
