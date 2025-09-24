// netlify/functions/submit-artist.cjs
// Handles Artist applications: internal email + confirmation to applicant (SendGrid).

const nodemailer = require("nodemailer");

// -------------------- helpers --------------------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const isTruthy = (v) =>
  ["true", "on", "yes", "1", 1, true].includes(
    typeof v === "string" ? v.toLowerCase() : v
  );

const requiredMissing = (body, fields) =>
  fields.filter((f) => body[f] == null || String(body[f]).trim() === "");

const parseBody = (raw, headers = {}) => {
  const ct = (headers["content-type"] || headers["Content-Type"] || "").toLowerCase();
  if (ct.includes("application/json")) { try { return JSON.parse(raw || "{}"); } catch { return {}; } }
  if (ct.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(raw || "");
    return Object.fromEntries(params.entries());
  }
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
};

// Use SendGrid via Nodemailer
const makeTransport = () =>
  nodemailer.createTransport({
    service: "SendGrid",
    auth: { user: "apikey", pass: process.env.SENDGRID_API_KEY },
  });

// small utilities for safety/formatting
const escapeHtml = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const nl2br = (s = "") => escapeHtml(s).replace(/\n/g, "<br>");
const oneLine = (s = "") => String(s).replace(/\s+/g, " ").trim();

// -------------------- email templates --------------------
const internalEmailHtml = (d) => `
  <h2>New Artist Application</h2>
  <p><strong>Full Name:</strong> ${escapeHtml(d.fullName)}</p>
  <p><strong>Phone:</strong> ${escapeHtml(d.phone)}</p>
  <p><strong>Email:</strong> ${escapeHtml(d.email)}</p>
  <p><strong>City/Location:</strong> ${escapeHtml(d.city)}</p>
  <p><strong>Portfolio Link:</strong> <a href="${escapeHtml(d.portfolio)}">${escapeHtml(d.portfolio)}</a></p>
  <hr/>
  <p><strong>What must your work represent in five years for you to feel proud?</strong><br>${nl2br(d.fiveYear)}</p>
  <p><strong>Tell us about a long-term commitment you kept and why it mattered.</strong><br>${nl2br(d.longCommit)}</p>
  <p><strong>I agree to follow sanitation & compliance standards:</strong> ${d.compliance ? "Yes" : "No"}</p>
  ${d.videoLink ? `<p><strong>60s Video (“Why Seven?”):</strong> <a href="${escapeHtml(d.videoLink)}">${escapeHtml(d.videoLink)}</a></p>` : ""}
  <hr/>
  <p style="font-size:12px;color:#888">Route: Artist • Source: ${escapeHtml(d.source || "Landing Page")}</p>
`;

const internalEmailText = (d) =>
  [
    "New Artist Application",
    `Name: ${d.fullName}`,
    `Phone: ${d.phone}`,
    `Email: ${d.email}`,
    `City: ${d.city}`,
    `Portfolio: ${d.portfolio}`,
    `5-Year: ${oneLine(d.fiveYear)}`,
    `Commitment: ${oneLine(d.longCommit)}`,
    `Compliance: ${d.compliance ? "Yes" : "No"}`,
    `Video: ${d.videoLink || "—"}`,
    `Source: ${d.source || "Landing Page"}`,
  ].join("\n");

const applicantEmailHtml = (d) => `
  <h2>Thanks, ${escapeHtml(d.fullName)} — Artist application received</h2>
  <p>Hi ${escapeHtml(d.fullName)},</p>
  <p>Thanks for applying to join <strong>Seven Tattoo</strong> as an <strong>Artist</strong>. We review applications within 48 hours and will reach out if we’re moving forward.</p>
  <p><strong>We noted your portfolio:</strong> <a href="${escapeHtml(d.portfolio)}">${escapeHtml(d.portfolio)}</a></p>
  <p>— Seven Tattoo</p>
`;

const applicantEmailText = (d) =>
  `Thanks ${d.fullName}! We received your Artist application. We review within 48 hours.\n\n— Seven Tattoo`;

// -------------------- handler --------------------
module.exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = parseBody(event.body, event.headers);

    // Honeypot
    if (body.hp && String(body.hp).trim().length > 0) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ ok:false, error:"Blocked" }) };
    }

    const missing = requiredMissing(body, [
      "fullName","phone","email","city",
      "portfolio","fiveYear","longCommit","compliance"
    ]);
    if (missing.length) {
      return {
        statusCode: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ ok:false, error:"Missing fields", missing }),
      };
    }

    const data = {
      fullName: String(body.fullName).trim(),
      phone: String(body.phone).trim(),
      email: String(body.email).trim(),
      city: String(body.city).trim(),
      portfolio: String(body.portfolio).trim(),
      fiveYear: String(body.fiveYear || "").trim(),
      longCommit: String(body.longCommit || "").trim(),
      compliance: isTruthy(body.compliance),
      videoLink: String(body.videoLink || "").trim(),
      source: String(body.source || "").trim(),
    };

    const transporter = makeTransport();

    // 1) Internal inbox
    await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: process.env.INTERNAL_EMAIL,
      subject: `Artist Application — ${data.fullName}`,
      html: internalEmailHtml(data),
      text: internalEmailText(data),
      replyTo: data.email,
    });

    // 2) Confirmation to applicant
    await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: data.email,
      subject: "We received your Artist application — Seven Tattoo",
      html: applicantEmailHtml(data),
      text: applicantEmailText(data),
    });

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ ok:true }),
    };
  } catch (err) {
    console.error("submit-artist error:", err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ ok:false, error:"Server error" }) };
  }
};

