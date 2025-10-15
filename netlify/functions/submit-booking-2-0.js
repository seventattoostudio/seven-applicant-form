// netlify/functions/submit-booking-2-0.js
// Booking Intake — CORS + validation + SendGrid email + DIAGNOSTICS (safe to return)
// NOTE: Diagnostics will return only booleans/status codes — never your API key.

const sgMail = require("@sendgrid/mail");

const ALLOWED_ORIGINS = [
  "https://seventattoolv.com",
  "https://www.seventattoolv.com",
  // "https://YOUR-STORE.myshopify.com" // add if testing from preview
];

function corsHeaders(origin = "") {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

exports.handler = async (event) => {
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

  const diagnostics = {
    haveKey: !!process.env.SENDGRID_API_KEY,
    to: process.env.INTAKE_TO || null,
    from: process.env.INTAKE_FROM || null,
    bcc: !!process.env.INTAKE_BCC,
    attemptedSend: false,
    sendgridStatus: null,
    sendgridError: null,
  };

  try {
    const body = JSON.parse(event.body || "{}");

    // Honeypot
    if (body.website) {
      return {
        statusCode: 200,
        headers: corsHeaders(event.headers.origin),
        body: JSON.stringify({ ok: true, diagnostics }),
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
        body: JSON.stringify({ ok: false, errors, diagnostics }),
      };
    }

    // Compose message
    const submittedAt = new Date().toISOString();
    const summaryText = [
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
      `Artist (param): ${body.artist || "(none)"}`,
      `Source Link: ${body.source_link || "(none)"}`,
    ].join("\n");

    const html = `
      <div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">
        <h2 style="margin:0 0 12px">New Booking Intake — Vision Call Review</h2>
        <p><b>Submitted:</b> ${submittedAt}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:12px 0" />
        <p><b>Meaning</b><br>${escapeHtml(body.meaning)}</p>
        <p><b>Full Name</b>: ${escapeHtml(body.fullName)}<br>
           <b>Email</b>: ${escapeHtml(body.email)}<br>
           <b>Phone</b>: ${escapeHtml(body.phone)}</p>
        <p><b>Placement</b>: ${escapeHtml(body.placement)}<br>
           <b>Scale</b>: ${escapeHtml(body.scale)}<br>
           <b>How heard</b>: ${escapeHtml(body.hear)}</p>
        <p><b>Artist (param)</b>: ${escapeHtml(body.artist || "(none)")}<br>
           <b>Source Link</b>: ${escapeHtml(body.source_link || "(none)")}</p>
      </div>
    `;

    // Log as backup
    console.log(summaryText);

    // Attempt email if env vars present
    const KEY = process.env.SENDGRID_API_KEY;
    const TO = process.env.INTAKE_TO;
    const FROM = process.env.INTAKE_FROM;
    const BCC = process.env.INTAKE_BCC;

    if (KEY && TO && FROM) {
      try {
        sgMail.setApiKey(KEY);
        const msg = {
          to: TO,
          from: FROM, // must be a verified sender or authenticated domain in SendGrid
          subject: `Booking Intake — ${body.fullName} (${body.placement}, ${body.scale})`,
          text: summaryText,
          html,
          ...(BCC ? { bcc: BCC } : {}),
        };
        diagnostics.attemptedSend = true;
        const resp = await sgMail.send(msg);
        diagnostics.sendgridStatus = resp?.[0]?.statusCode || null; // expect 202 on success
      } catch (mailErr) {
        // capture concise error (never include secrets)
        const sg = mailErr?.response?.body;
        diagnostics.sendgridError =
          sg?.errors?.[0]?.message ||
          mailErr.message ||
          "unknown sendgrid error";
        console.error("[email] sendgrid error:", sg || mailErr);
      }
    } else {
      console.warn("[email] missing env vars; skipping send");
    }

    return {
      statusCode: 200,
      headers: corsHeaders(event.headers.origin),
      body: JSON.stringify({ ok: true, diagnostics }),
    };
  } catch (err) {
    console.error("Error in submit-booking-2-0:", err);
    return {
      statusCode: 500,
      headers: corsHeaders(event.headers.origin),
      body: JSON.stringify({ ok: false, message: "Server error" }),
    };
  }
};
