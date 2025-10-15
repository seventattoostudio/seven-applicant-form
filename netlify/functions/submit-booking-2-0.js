// netlify/functions/submit-booking-2-0.js
// Booking Intake — CORS + validation + SendGrid email

const sgMail = require("@sendgrid/mail");

const ALLOWED_ORIGINS = [
  "https://seventattoolv.com",
  "https://www.seventattoolv.com",
  // add preview if testing in theme editor:
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

// basic HTML escaping
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

  try {
    const body = JSON.parse(event.body || "{}");

    // Honeypot
    if (body.website) {
      return {
        statusCode: 200,
        headers: corsHeaders(event.headers.origin),
        body: JSON.stringify({ ok: true }),
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

    // Compose summary
    const submittedAt = new Date().toISOString();
    const summaryLines = [
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
    ];
    const summaryText = summaryLines.join("\n");

    console.log(summaryText); // backup log

    // Send email via SendGrid (uses Netlify env vars)
    const KEY = process.env.SENDGRID_API_KEY;
    const TO = process.env.INTAKE_TO;
    const FROM = process.env.INTAKE_FROM;
    const BCC = process.env.INTAKE_BCC;

    if (!KEY || !TO || !FROM) {
      console.warn(
        "Missing SENDGRID_API_KEY / INTAKE_TO / INTAKE_FROM env vars. Skipping email send."
      );
    } else {
      sgMail.setApiKey(KEY);

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

      const msg = {
        to: TO,
        from: FROM,
        subject: `Booking Intake — ${body.fullName} (${body.placement}, ${body.scale})`,
        text: summaryText,
        html,
        ...(BCC ? { bcc: BCC } : {}),
      };

      try {
        await sgMail.send(msg);
      } catch (mailErr) {
        console.error("SendGrid error:", mailErr?.response?.body || mailErr);
        // keep returning 200 so user sees success; logs will show the issue
      }
    }

    return {
      statusCode: 200,
      headers: corsHeaders(event.headers.origin),
      body: JSON.stringify({ ok: true }),
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
