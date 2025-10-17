// Seven Tattoo — Hidden Booking Intake (CORS safe + SendGrid)
// netlify/functions/submit-booking-2-0.js

import sgMail from "@sendgrid/mail";
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Add every storefront origin you’ll submit from
const ALLOWED_ORIGINS = new Set([
  "https://seventattoolv.com",
  "https://www.seventattoolv.com",
  // "https://seventattoolv.myshopify.com", // add if you test on myshopify preview
  // "https://preview-your-theme-domain.example"
]);

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*", // set to specific origin at runtime
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export default async (req, context) => {
  const method = req.method.toUpperCase();
  const origin = req.headers.get("origin") || "";
  console.log("Incoming Origin:", origin);

  // OPTIONS preflight
  if (method === "OPTIONS") {
    const allow = ALLOWED_ORIGINS.has(origin) ? origin : "";
    return new Response("", { status: 204, headers: corsHeaders(allow) });
  }

  if (method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      {
        status: 405,
        headers: corsHeaders(ALLOWED_ORIGINS.has(origin) ? origin : ""),
      }
    );
  }

  // Check origin
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "";
  if (!allowOrigin) {
    return new Response(
      JSON.stringify({ ok: false, error: `Origin not allowed: ${origin}` }),
      {
        status: 403,
        headers: corsHeaders(allowOrigin),
      }
    );
  }

  // Parse JSON payload
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
      status: 400,
      headers: corsHeaders(allowOrigin),
    });
  }

  // Honeypot: if bots filled `website`, fake success (no email)
  if (body.website && String(body.website).trim() !== "") {
    return new Response(JSON.stringify({ ok: true, bot: true }), {
      status: 200,
      headers: corsHeaders(allowOrigin),
    });
  }

  // Extract fields
  const {
    meaning = "",
    fullName = "",
    email = "",
    phone = "",
    placement = "",
    scale = "",
    hear = "",
    consent = false,
    artist = "",
    source_link = "",
  } = body || {};

  // Basic validation
  const missing = [];
  if (!meaning.trim()) missing.push("Meaning");
  if (!fullName.trim()) missing.push("Full name");
  if (!email.trim()) missing.push("Email");
  if (!phone.trim()) missing.push("Phone");
  if (!placement.trim()) missing.push("Placement");
  if (!scale.trim()) missing.push("Scale");
  if (!hear.trim()) missing.push("How did you hear about us");
  if (!consent) missing.push("Review consent");

  if (missing.length) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing: " + missing.join(", ") }),
      {
        status: 400,
        headers: corsHeaders(allowOrigin),
      }
    );
  }

  // Compose email
  const toEmail = "bookings@seventattoolv.com";
  const subject = `Booking Intake — ${fullName} (${scale}, ${placement})`;
  const text = [
    `Meaning: ${meaning}`,
    `Full name: ${fullName}`,
    `Email: ${email}`,
    `Phone: ${phone}`,
    `Placement: ${placement}`,
    `Scale: ${scale}`,
    `Heard via: ${hear}`,
    `Consent: ${consent ? "Yes" : "No"}`,
    `Artist: ${artist || "(not specified)"}`,
    `Source: ${source_link || "(none)"}`,
  ].join("\n");

  const html = `
    <h2>Hidden Booking Intake</h2>
    <p><strong>Meaning:</strong> ${escapeHtml(meaning)}</p>
    <p><strong>Full name:</strong> ${escapeHtml(fullName)}</p>
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
    <p><strong>Placement:</strong> ${escapeHtml(placement)}</p>
    <p><strong>Scale:</strong> ${escapeHtml(scale)}</p>
    <p><strong>Heard via:</strong> ${escapeHtml(hear)}</p>
    <p><strong>Consent:</strong> ${consent ? "Yes" : "No"}</p>
    <p><strong>Artist:</strong> ${escapeHtml(artist || "(not specified)")}</p>
    <p><strong>Source:</strong> <a href="${escapeAttr(
      source_link
    )}">${escapeHtml(source_link || "")}</a></p>
  `;

  try {
    await sgMail.send({
      to: toEmail,
      from: {
        email: "no-reply@seventattoolv.com",
        name: "Seven Tattoo Studio",
      }, // verified sender/domain
      replyTo: { email, name: fullName },
      subject,
      text,
      html,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: corsHeaders(allowOrigin),
    });
  } catch (err) {
    console.error(
      "SendGrid error:",
      err?.response?.body || err?.message || err
    );
    const msg =
      err?.response?.body?.errors?.[0]?.message ||
      err?.message ||
      "Email send failed";
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: corsHeaders(allowOrigin),
    });
  }
};

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function escapeAttr(str = "") {
  return escapeHtml(str).replace(/"/g, "&quot;");
}
