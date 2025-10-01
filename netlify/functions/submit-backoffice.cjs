// netlify/functions/submit-backoffice.cjs
const nodemailer = require("nodemailer");

// --- CORS ---
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const cors = {
  "Access-Control-Allow-Origin": CORS_ORIGIN,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Helpers
const ok = (b) => ({ statusCode: 200, headers: cors, body: JSON.stringify(b) });
const bad = (m) => ({
  statusCode: 400,
  headers: cors,
  body: JSON.stringify({ ok: false, error: m }),
});
const oops = (m) => ({
  statusCode: 500,
  headers: cors,
  body: JSON.stringify({ ok: false, error: m }),
});

function parseBody(event) {
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : event.body || "";

    const hdrs = event.headers || {};
    const ct = String(
      hdrs["content-type"] || hdrs["Content-Type"] || ""
    ).toLowerCase();

    if (ct.includes("application/json")) {
      return JSON.parse(raw || "{}");
    }
    // tolerant: accept x-www-form-urlencoded
    if (ct.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(raw);
      const obj = {};
      for (const [k, v] of params.entries()) {
        obj[k] = v;
      }
      return obj;
    }
    // try JSON fallback
    try {
      return JSON.parse(raw || "{}");
    } catch {
      return {};
    }
  } catch {
    return null;
  }
}

const v = (x) => (typeof x === "string" ? x.trim() : x);

function mapFields(input) {
  const fullName =
    v(input.fullName) || v(input.name) || v(input.applicant_name);
  const email = v(input.email);
  const phone = v(input.phone) || v(input.tel);
  const city = v(input.city) || v(input.location);

  // Specific Q/A (mirror the form labels)
  const q1 = v(input.about); // "How do you stay organized when managing multiple responsibilities?"
  const q2 = v(input.ownershipStory); // "Tell us about a time you documented or maintained order that made work easier for others."

  const resumeLink =
    v(input.resume_link) || v(input.video_url) || v(input.cv_link);

  const consentRaw =
    input.consentProcedures ??
    input.consent ??
    input.agree ??
    input.agree_sanitation;
  const consentProcedures = ["true", "on", "yes", "1", "y"].includes(
    String(consentRaw).toLowerCase()
  );

  const role = v(input.role) || "Back Office (Staff)";
  const source = v(input.source);
  const notifyEmail = v(input.recipient) || v(input.notify_email);

  return {
    fullName,
    email,
    phone,
    city,
    q1,
    q2,
    resumeLink,
    consentProcedures,
    role,
    source,
    notifyEmail,
    raw: input,
  };
}

function validate(m) {
  const missing = [];
  if (!m.fullName) missing.push("Full Name");
  if (!m.email) missing.push("Email");
  if (!m.phone) missing.push("Phone");
  if (!m.city) missing.push("City/Location");
  if (!m.q1) missing.push("Q1 (organization)");
  if (!m.q2) missing.push("Q2 (documented order)");
  if (!m.resumeLink) missing.push("Resume/Video link");
  return missing;
}

module.exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS")
    return { statusCode: 200, headers: cors, body: "ok" };
  if (event.httpMethod !== "POST") return bad("Use POST");

  const body = parseBody(event);
  if (body === null) return bad("Invalid body");

  // honeypot
  if (v(body.hp_extra_info)) return ok({ ok: true, skipped: true });

  const m = mapFields(body);
  const missing = validate(m);
  if (missing.length) {
    console.error("BackOffice submit missing:", missing, {
      gotKeys: Object.keys(body || {}),
    });
    return bad(`Missing required field(s): ${missing.join(", ")}`);
  }

  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (!sendgridKey) return oops("SENDGRID_API_KEY not configured");

  const toCareers =
    m.notifyEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.notifyEmail)
      ? m.notifyEmail
      : process.env.BACKOFFICE_RECEIVER ||
        process.env.INTERNAL_EMAIL ||
        "careers@seventattoolv.com";

  const fromEmail =
    process.env.SEND_FROM ||
    process.env.FROM_EMAIL ||
    "careers@seventattoolv.com";

  const transport = nodemailer.createTransport({
    host: "smtp.sendgrid.net",
    port: 465,
    secure: true,
    auth: { user: "apikey", pass: sendgridKey },
  });

  const subject = `New Back Office application — ${m.fullName}`;

  const lines = [
    `ROLE: ${m.role}`,
    `Source: ${m.source || "-"}`,
    "",
    `Full Name: ${m.fullName}`,
    `Email: ${m.email}`,
    `Phone: ${m.phone}`,
    `City / Location: ${m.city}`,
    "",
    `How do you stay organized when managing multiple responsibilities?`,
    `${m.q1}`,
    "",
    `Tell us about a time you documented or maintained order that made work easier for others.`,
    `${m.q2}`,
    "",
    `Resume / 60-sec video link: ${m.resumeLink}`,
    `Consents to procedures & daily records: ${
      m.consentProcedures ? "YES" : "NO"
    }`,
  ];

  try {
    // Internal notification
    await transport.sendMail({
      from: fromEmail,
      to: toCareers,
      subject,
      text: lines.join("\n"),
    });

    // Applicant confirmation
    await transport.sendMail({
      from: fromEmail,
      to: m.email,
      subject: "Seven Tattoo — We received your Back Office application",
      text: `Hi ${m.fullName || ""},

Thanks for applying to Seven Tattoo. We’ve received your Back Office application and will review it shortly.

— Seven Tattoo`,
    });

    return ok({ ok: true });
  } catch (err) {
    console.error("BackOffice mail error:", err?.response?.body || err);
    return oops("Email send failed");
  }
};
