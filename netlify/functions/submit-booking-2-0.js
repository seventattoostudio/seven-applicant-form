// Seven Tattoo — Hidden Booking Intake (CORS safe + SendGrid)
// netlify/functions/submit-booking-2-0.js

import sgMail from "@sendgrid/mail";
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Add every storefront origin you’ll submit from
const ALLOWED_ORIGINS = new Set([
  "https://seventattoolv.com",
  "https://www.seventattoolv.com",
  "https://seventattoolv.myshopify.com", // allow Shopify preview/editor
]);

// --- CORS helpers (echo requested headers so preflight always passes) ---
function corsHeaders(origin, req) {
  const reqHeaders = req?.headers?.get("access-control-request-headers");
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": reqHeaders || "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin, Access-Control-Request-Headers",
  };
}

export default async (req, context) => {
  const method = (req.method || "GET").toUpperCase();
  const origin = req.headers.get("origin") || "";
  console.log("Incoming Origin:", origin); // 👈 Debug line for CORS tracing
  const isAllowed = ALLOWED_ORIGINS.has(origin);
  const allowOrigin = isAllowed ? origin : origin || "*"; // echo back the origin

  // OPTIONS preflight — always reply with readable CORS headers
  if (method === "OPTIONS") {
    return new Response("", {
      status: 204,
      headers: corsHeaders(allowOrigin, req),
    });
  }

  // Only POST is allowed
  if (method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      {
        status: 405,
        headers: corsHeaders(allowOrigin, req),
      }
    );
  }

  // Unknown origins: readable JSON instead of CORS block
  if (!isAllowed) {
    return new Response(
      JSON.stringify({ ok: false, error: `Origin not allowed: ${origin}` }),
      {
        status: 403,
        headers: corsHeaders(allowOrigin, req),
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
      headers: corsHeaders(allowOrigin, req),
    });
  }

  // Honeypot: if bots filled `website`, fake success
  if (body.website && String(body.website).trim() !== "") {
    return new Response(JSON.stringify({ ok: true, bot: true }), {
      status: 200,
      headers: corsHeaders(allowOrigin, req),
    });
  }

  // Extract fields (mirror frontend)
  const {
    meaning = "",
    vision = "", // REQUIRED, 4k max
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

  // Validation
  const missing = [];
  if (!meaning.trim()) missing.push("Meaning");
  if (!vision.trim()) missing.push("Vision");
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
      { status: 400, headers: corsHeaders(allowOrigin, req) }
    );
  }

  if (vision && vision.length > 4000) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Vision must be 4,000 characters or fewer.",
      }),
      { status: 400, headers: corsHeaders(allowOrigin, req) }
    );
  }

  // Compose email
  const submittedIso = new Date().toISOString();
  const toEmail = "bookings@seventattoolv.com";
  const subject = `Booking Intake — ${fullName} (${scale}, ${placement})`;

  const text = [
    `Seven Tattoo — Booking Intake`,
    ``,
    `Submitted: ${submittedIso}`,
    `Meaning: ${meaning}`,
    `Vision: ${vision}`,
    `Full Name: ${fullName}`,
    `Email: ${email}`,
    `Phone: ${phone}`,
    `Placement: ${placement}`,
    `Scale: ${scale}`,
    `Heard About Us: ${hear}`,
    `Consent: ${consent ? "Yes" : "No"}`,
    `Artist (param): ${artist || "(not specified)"}`,
    `Source Link: ${source_link || "(none)"}`,
  ].join("\n");

  const html = `
    <h2>Seven Tattoo — Booking Intake</h2>
    <p><strong>Submitted:</strong> ${submittedIso}</p>
    <p><strong>Meaning:</strong> ${escapeHtml(meaning)}</p>
    <p><strong>Vision:</strong> ${escapeHtml(vision)}</p>
    <p><strong>Full Name:</strong> ${escapeHtml(fullName)}</p>
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
    <p><strong>Placement:</strong> ${escapeHtml(placement)}</p>
    <p><strong>Scale:</strong> ${escapeHtml(scale)}</p>
    <p><strong>Heard About Us:</strong> ${escapeHtml(hear)}</p>
    <p><strong>Consent:</strong> ${consent ? "Yes" : "No"}</p>
    <p><strong>Artist (param):</strong> ${escapeHtml(
      artist || "(not specified)"
    )}</p>
    <p><strong>Source Link:</strong> <a href="${escapeAttr(
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
      headers: corsHeaders(allowOrigin, req),
    });
  } catch (err) {
    const msg =
      err?.response?.body?.errors?.[0]?.message ||
      err?.message ||
      "Email send failed";
    console.error(
      "SendGrid error:",
      err?.response?.body || err?.message || err
    );
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: corsHeaders(allowOrigin, req),
    });
  }
};

// --- helpers ---
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
