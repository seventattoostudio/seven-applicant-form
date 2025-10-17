// netlify/functions/submit-booking-2-0.js
// Classic Functions (CJS) + CORS; avoid 204 to dodge undici bug.

const ALLOWLIST = [
  "https://seventattoolv.com",
  "https://www.seventattoolv.com",
  "https://seventattoolv.myshopify.com",
  "https://frolicking-sundae-64ec36.netlify.app",
];

function pickAllowedOrigin(reqOrigin = "") {
  return ALLOWLIST.includes(reqOrigin)
    ? reqOrigin
    : "https://frolicking-sundae-64ec36.netlify.app";
}

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

function ok(headers, body = {}) {
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, ...body }),
  };
}

function err(headers, code, message, more = {}) {
  return {
    statusCode: code,
    headers,
    body: JSON.stringify({ ok: false, error: message, ...more }),
  };
}

function required(v) {
  return v !== undefined && v !== null && String(v).trim() !== "";
}

// OPTIONAL email via SendGrid (enable env vars SENDGRID_API_KEY, BOOKING_TO, BOOKING_FROM)
async function maybeSendEmail(payload) {
  const key = process.env.SENDGRID_API_KEY;
  const to = process.env.BOOKING_TO;
  const from = process.env.BOOKING_FROM;
  if (!key || !to || !from)
    return { sent: false, reason: "Email disabled (missing env vars)" };

  const sgMail = await import("@sendgrid/mail").then((m) => m.default);
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
      html: `<pre style="font:14px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">${lines.join(
        "\n"
      )}</pre>`,
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: String(e?.response?.body || e.message || e) };
  }
}

exports.handler = async (event) => {
  const origin = event.headers?.origin || "";
  const headers = corsHeaders(origin);

  // IMPORTANT: return 200 (not 204) for preflight to avoid undici/Response bug.
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return err(headers, 405, "Method Not Allowed");
  }

  const ct =
    event.headers["content-type"] || event.headers["Content-Type"] || "";
  if (!ct.toLowerCase().includes("application/json")) {
    return err(headers, 415, "Unsupported Media Type – use application/json");
  }

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch {
    return err(headers, 400, "Invalid JSON in request body");
  }

  const missing = ["fullName", "email", "consent"].filter(
    (f) => !required(data[f])
  );
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

  const emailResult = await maybeSendEmail(payload);

  return ok(headers, {
    diagnostics: {
      origin,
      allowedOrigin: headers["Access-Control-Allow-Origin"],
      email: emailResult,
    },
  });
};
