// netlify/functions/submit-staff.js
// Handles Staff applications: internal email + confirmation to applicant.

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
  const ct = (
    headers["content-type"] ||
    headers["Content-Type"] ||
    ""
  ).toLowerCase();
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(raw || "{}");
    } catch {
      return {};
    }
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(raw || "");
    return Object.fromEntries(params.entries());
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
};

// Use SendGrid via Nodemailer
const makeTransport = () =>
  nodemailer.createTransport({
    service: "SendGrid",
    auth: { user: "apikey", pass: process.env.SENDGRID_API_KEY }, // 'apikey' is literal
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
  <h2>New Staff Application</h2>
  <p><strong>Full Name:</strong> ${escapeHtml(d.fullName)}</p>
  <p><strong>Phone:</strong> ${escapeHtml(d.phone)}</p>
  <p><strong>Email:</strong> ${escapeHtml(d.email)}</p>
  <p><strong>City/Location:</strong> ${escapeHtml(d.city)}</p>
  <hr/>
  <p><strong>What do you need from a workplace to feel secure and grow?</strong><br>${nl2br(
    d.needFromWorkplace
  )}</p>
  <p><strong>Tell us about a time you took ownership when something went wrong.</strong><br>${nl2br(
    d.ownershipStory
  )}</p>
  <p><strong>I can follow written procedures and document every client interaction:</strong> ${
    d.proceduresConsent ? "Yes" : "No"
  }</p>
  ${
    d.resumeLink
      ? `<p><strong>Resume/Video:</strong> <a href="${escapeHtml(
          d.resumeLink
        )}">${escapeHtml(d.resumeLink)}</a></p>`
      : ""
  }
  <hr/>
  <p style="font-size:12px;color:#888">Route: Staff • Source: ${escapeHtml(
    d.source || "Landing Page"
  )}</p>
`;

const internalEmailText = (d) =>
  [
    "New Staff Application",
    `Name: ${d.fullName}`,
    `Phone: ${d.phone}`,
    `Email: ${d.email}`,
    `City: ${d.city}`,
    `Need: ${oneLine(d.needFromWorkplace)}`,
    `Ownership: ${oneLine(d.ownershipStory)}`,
    `Procedures: ${d.proceduresConsent ? "Yes" : "No"}`,
    `Resume/Video: ${d.resumeLink || "—"}`,
    `Source: ${d.source || "Landing Page"}`,
  ].join("\n");

const applicantEmailHtml = (d) => `
  <h2>Thanks, ${escapeHtml(d.fullName)} — We got your application</h2>
  <p>Hi ${escapeHtml(d.fullName)},</p>
  <p>Thanks for applying for the <strong>Staff</strong> position at Seven Tattoo. Our team reviews applications within 48 hours. If you’re a match, we’ll email you next steps.</p>
  <p><strong>What we received:</strong></p>
  <ul>
    <li>Email: ${escapeHtml(d.email)}</li>
    <li>City: ${escapeHtml(d.city)}</li>
  </ul>
  <p>— Seven Tattoo</p>
`;

const applicantEmailText = (d) =>
  `Thanks ${d.fullName}! We received your Staff application. We review within 48 hours.\n\n— Seven Tattoo`;

// -------------------- handler --------------------
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = parseBody(event.body, event.headers);

    // Honeypot to block bots
    if (body.hp && String(body.hp).trim().length > 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "Blocked" }),
      };
    }

    // Validate required fields
    const missing = requiredMissing(body, [
      "fullName",
      "phone",
      "email",
      "city",
      "needFromWorkplace",
      "ownershipStory",
      "proceduresConsent",
    ]);
    if (missing.length) {
      return {
        statusCode: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ ok: false, error: "Missing fields", missing }),
      };
    }

    // Normalize data
    const data = {
      fullName: String(body.fullName).trim(),
      phone: String(body.phone).trim(),
      email: String(body.email).trim(),
      city: String(body.city).trim(),
      needFromWorkplace: String(body.needFromWorkplace || "").trim(),
      ownershipStory: String(body.ownershipStory || "").trim(),
      proceduresConsent: isTruthy(body.proceduresConsent),
      resumeLink: String(body.resumeLink || "").trim(),
      source: String(body.source || "").trim(),
    };

    const transporter = makeTransport();

    // 1) Internal inbox
    await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: process.env.INTERNAL_EMAIL, // e.g. careers@seventattoolv.com
      subject: `Staff Application — ${data.fullName}`,
      html: internalEmailHtml(data),
      text: internalEmailText(data),
      replyTo: data.email, // replies go to the applicant
    });

    // 2) Confirmation to applicant
    await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: data.email,
      subject: "We received your Staff application — Seven Tattoo",
      html: applicantEmailHtml(data),
      text: applicantEmailText(data),
    });

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error("submit-staff error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: "Server error" }),
    };
  }
};
