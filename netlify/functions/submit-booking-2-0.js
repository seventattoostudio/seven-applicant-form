// netlify/functions/submit-booking-2-0.js
// Booking Intake — CORS + validation + SendGrid email (+ diagnostics)

const sgMail = require("@sendgrid/mail");

// Allow your live domains (add your myshopify preview if testing the editor)
const ALLOWED_ORIGINS = [
  "https://seventattoolv.com",
  "https://www.seventattoolv.com",
  // "https://YOUR-STORE.myshopify.com"
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
  // CORS preflight
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

  // Diagnostics you’ll see in the response (safe; no secrets)
  const diagnostics = {
    haveKey: !!process.env.SENDGRID_API_KEY,
    to:
      process.env.INTAKE_TO ||
      process.env.INTERNAL_EMAIL ||
      process.env.BACKOFFICE_RECEIVER ||
      null,
    from:
      process.env.INTAKE_FROM ||
      process.env.FROM_EMAIL ||
      process.env.SEND_FROM ||
      null,
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

    // Validate required fields
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

    // Compose summary
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

    console.log(summaryText); // backup logging

    // ---- Email vars: use your existing keys first, then INTAKE_* if you add them later
    const KEY = process.env.SENDGRID_API_KEY;
    const TO =
      process.env.INTERNAL_EMAIL ||
      process.env.BACKOFFICE_RECEIVER ||
      process.env.INTAKE_TO ||
      null;
    const FROM =
      process.env.FROM_EMAIL ||
      process.env.SEND_FROM ||
      process.env.INTAKE_FROM ||
      null;
    const BCC = process.env.INTAKE_BCC;

    console.log(
      "[email] haveKey:",
      !!KEY,
      "to:",
      TO,
      "from:",
      FROM,
      "bcc:",
      !!BCC
    );

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
        diagnostics.sendgridStatus = resp?.[0]?.statusCode || null; // expect 202
        console.log(
          "[email] sent ok:",
          Array.isArray(resp),
          "statusCode:",
          diagnostics.sendgridStatus
        );
      } catch (mailErr) {
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
// redeploy to apply function scopes
