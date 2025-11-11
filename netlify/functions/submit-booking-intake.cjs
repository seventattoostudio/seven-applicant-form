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

// ---------- Email (SendGrid, optional) ----------
async function maybeSendEmail(payload) {
  const key = process.env.SENDGRID_API_KEY;
  const to = process.env.BOOKING_TO || process.env.INTERNAL_EMAIL; // fallback if you already used INTERNAL_EMAIL
  const from =
    process.env.BOOKING_FROM ||
    process.env.SEND_FROM ||
    "Seven Tattoo <no-reply@seventattoolv.com>";

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

  const nice = (s) => (s || "").toString().trim();
  const parts = [];
  if (nice(payload.scale)) parts.push(payload.scale);
  if (nice(payload.placement)) parts.push(payload.placement);

  const subject = `Booking Intake — ${nice(payload.fullName) || "New Lead"}${
    parts.length ? ` (${parts.join(", ")})` : ""
  }`;

  const esc = (s) =>
    nice(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const submitted = new Date().toISOString();

  const html = `
        <div style="font:14px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#111;">
          <h2 style="margin:0 0 10px; font-size:20px;">Seven Tattoo — Booking Intake</h2>
          <p style="margin:0 0 16px; color:#444;"><strong>Submitted:</strong> ${esc(
            submitted
          )}</p>
    
          <p style="margin:6px 0;"><strong>Meaning:</strong> ${
            esc(payload.meaning) || "(not provided)"
          }</p>
          <p style="margin:6px 0;"><strong>Vision:</strong> ${
            esc(payload.vision) || "(not provided)"
          }</p>
    
          <p style="margin:16px 0 6px;"><strong>Full Name:</strong> ${
            esc(payload.fullName) || "(not provided)"
          }</p>
          <p style="margin:6px 0;"><strong>Email:</strong> ${
            payload.email
              ? `<a href="mailto:${esc(payload.email)}">${esc(
                  payload.email
                )}</a>`
              : "(not provided)"
          }</p>
          <p style="margin:6px 0;"><strong>Phone:</strong> ${
            esc(payload.phone) || "(not provided)"
          }</p>
    
          <p style="margin:16px 0 6px;"><strong>Placement:</strong> ${
            esc(payload.placement) || "(not provided)"
          }</p>
          <p style="margin:6px 0;"><strong>Scale:</strong> ${
            esc(payload.scale) || "(not provided)"
          }</p>
          <p style="margin:6px 0;"><strong>Heard About Us:</strong> ${
            esc(payload.hear) || "(not provided)"
          }</p>
          <p style="margin:6px 0;"><strong>Consent:</strong> ${
            payload.consent ? "Yes" : "No"
          }</p>
    
          <p style="margin:16px 0 6px;"><strong>Artist (param):</strong> ${
            esc(payload.artist) || "(not provided)"
          }</p>
          <p style="margin:6px 0;"><strong>Source Link:</strong> ${
            payload.source_link
              ? `<a href="${esc(payload.source_link)}">link</a>`
              : "(not provided)"
          }</p>
        </div>
      `;

  const text = [
    `Seven Tattoo — Booking Intake`,
    ``,
    `Submitted: ${submitted}`,
    ``,
    `Meaning: ${nice(payload.meaning) || "(not provided)"}`,
    `Vision: ${nice(payload.vision) || "(not provided)"}`,
    ``,
    `Full Name: ${nice(payload.fullName) || "(not provided)"}`,
    `Email: ${nice(payload.email) || "(not provided)"}`,
    `Phone: ${nice(payload.phone) || "(not provided)"}`,
    ``,
    `Placement: ${nice(payload.placement) || "(not provided)"}`,
    `Scale: ${nice(payload.scale) || "(not provided)"}`,
    `Heard About Us: ${nice(payload.hear) || "(not provided)"}`,
    `Consent: ${payload.consent ? "Yes" : "No"}`,
    ``,
    `Artist (param): ${nice(payload.artist) || "(not provided)"}`,
    `Source Link: ${nice(payload.source_link) || "(not provided)"}`,
  ].join("\n");

  try {
    // Build the message object
    const msg = { to, from, subject, text, html };

    // 👇 This is the important part: make "Reply" go to the client
    if (nice(payload.email)) {
      msg.replyTo = {
        email: nice(payload.email),
        name: nice(payload.fullName) || nice(payload.email),
      };
    }

    await sgMail.send(msg);
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

  if (event.httpMethod === "OPTIONS")
    return { statusCode: 200, headers, body: "" };

  if (event.httpMethod !== "POST")
    return err(headers, 405, "Method Not Allowed");

  const ct = (
    event.headers["content-type"] ||
    event.headers["Content-Type"] ||
    ""
  ).toLowerCase();

  if (!ct.includes("application/json"))
    return err(headers, 415, "Unsupported Media Type – use application/json");

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch {
    return err(headers, 400, "Invalid JSON in request body");
  }

  // Honeypot
  if (isFilled(data.website))
    return ok(headers, { diagnostics: { dropped: true, reason: "honeypot" } });

  // Require ALL fields (including artist + consent)
  const missing = [
    "meaning",
    "vision",
    "fullName",
    "email",
    "phone",
    "placement",
    "scale",
    "hear",
    "artist",
    "consent",
  ].filter((f) => (f === "consent" ? !data.consent : !isFilled(data[f])));

  if (missing.length)
    return err(headers, 422, "Missing required fields", { missing });

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

  const email = await maybeSendEmail(payload);

  return ok(headers, {
    diagnostics: {
      allowedOrigin: headers["Access-Control-Allow-Origin"],
      email,
    },
  });
};
