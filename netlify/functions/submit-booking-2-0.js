// netlify/functions/submit-booking-2-0.js
// Booking Intake handler — CORS + OPTIONS + validation + SendGrid email

const sgMail = require("@sendgrid/mail");

// 1) Allow your domain so Shopify can send to this function
const ALLOWED_ORIGINS = [
  "https://seventattoolv.com",
  "https://www.seventattoolv.com",
];

// 2) Build standard CORS headers
function corsHeaders(origin = "") {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

exports.handler = async (event) => {
  // Handle preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders(event.headers.origin),
      body: "",
    };
  }

  // Only POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders(event.headers.origin),
      body: JSON.stringify({ ok: false, message: "Method not allowed" }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    // Honeypot (anti-bot)
    if (body.website) {
      return {
        statusCode: 200,
        headers: corsHeaders(event.headers.origin),
        body: JSON.stringify({ ok: true }),
      };
    }

    // Validate required fields
    const errors = [];
    const req = (field, label = field) => {
      if (!body[field] || String(body[field]).trim() === "")
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

    // Summary for logs/email
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

    console.log(summaryText);

    // 3) Send email via SendGrid
    try {
      const TO = process.env.INTAKE_TO;
      const FROM = process.env.INTAKE_FROM;
      const KEY = process.env.SENDGRID_API_KEY;

      if (!TO || !FROM || !KEY) {
        console.warn(
          "Missing env vars: INTAKE_TO / INTAKE_FROM / SENDGRID_API_KEY"
        );
      } else {
        sgMail.setApiKey(KEY);
        await sgMail.send({
          to: TO,
          from: FROM,
          subject: "New Booking Intake — Vision Call Review",
          text: summaryText,
        });
      }
    } catch (mailErr) {
      console.error("SendGrid error:", mailErr);
      // We still return 200 so the user sees success; logs will show the error.
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
