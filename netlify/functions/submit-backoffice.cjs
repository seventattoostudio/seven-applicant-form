// netlify/functions/submit-backoffice.cjs
const nodemailer = require("nodemailer");

/* ===================== CORS ===================== */
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const cors = {
  "Access-Control-Allow-Origin": CORS_ORIGIN,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const ok = (b) => ({ statusCode: 200, headers: cors, body: JSON.stringify(b) });
const bad = (m) => ({
  statusCode: 400,
  headers: cors,
  body: JSON.stringify({ ok: false, message: m }),
});
const oops = (m) => ({
  statusCode: 500,
  headers: cors,
  body: JSON.stringify({ ok: false, message: m }),
});

/* ===================== Body Parsing ===================== */
function parseBody(event) {
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : event.body || "";

    const hdrs = event.headers || {};
    const ct = String(
      hdrs["content-type"] || hdrs["Content-Type"] || ""
    ).toLowerCase();

    if (ct.includes("application/json")) return JSON.parse(raw || "{}");
    if (ct.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(raw);
      const obj = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      return obj;
    }
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

/* ===================== Field Mapping ===================== */
/** Accept legacy names + new AJAX keys so the email mirrors everything */
function mapFields(input) {
  const fullName =
    v(input.fullName) || v(input.name) || v(input.applicant_name);
  const email = v(input.email);
  const phone = v(input.phone) || v(input.tel);
  const city = v(input.city) || v(input.location);

  // Q/A: support both old and new keys
  const q1 = v(input.about) || v(input.answer1);
  const q2 = v(input.ownershipStory) || v(input.answer2);

  // Link field: support both old and new keys
  const resumeLink =
    v(input.resume_link) ||
    v(input.resumeUrl) ||
    v(input.video_url) ||
    v(input.cv_link);

  // Consent: normalize many variants to boolean
  const consentRaw =
    input.consentProcedures ??
    input.consent ??
    input.agree ??
    input.agree_sanitation;
  const consent = ["true", "on", "yes", "1", "y"].includes(
    String(consentRaw).toLowerCase()
  );

  const role = v(input.role) || "Back Office (Staff)";
  const source = v(input.source);
  const notifyEmail = v(input.recipient) || v(input.notify_email);

  // extra meta if provided by frontend
  const userAgent = v(input.userAgent);
  const page = v(input.page);

  return {
    fullName,
    email,
    phone,
    city,
    q1,
    q2,
    resumeLink,
    consent,
    role,
    source,
    notifyEmail,
    userAgent,
    page,
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

/* ===================== Email Helpers ===================== */
function esc(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function row(label, val) {
  if (val === undefined || val === null || String(val) === "") return "";
  return `<tr><td style="padding:6px 10px;border-top:1px solid #eee;"><strong>${esc(
    label
  )}:</strong></td><td style="padding:6px 10px;border-top:1px solid #eee;">${esc(
    val
  )}</td></tr>`;
}

/* ===================== Handler ===================== */
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

  // SendGrid SMTP (your original: secure: true, 465)
  const transport = nodemailer.createTransport({
    host: "smtp.sendgrid.net",
    port: 465,
    secure: true,
    auth: { user: "apikey", pass: sendgridKey },
  });

  const subject = `New BACK OFFICE application — ${m.fullName}`;

  // Primary labeled section (human-friendly)
  const textLines = [
    `ROLE: ${m.role}`,
    `Source: ${m.source || "-"}`,
    m.page ? `Page: ${m.page}` : null,
    ``,
    `Full Name: ${m.fullName}`,
    `Email: ${m.email}`,
    `Phone: ${m.phone}`,
    `City / Location: ${m.city}`,
    ``,
    `How do you stay organized when managing multiple responsibilities?`,
    `${m.q1}`,
    ``,
    `Tell us about a time you documented or maintained order that made work easier for others.`,
    `${m.q2}`,
    ``,
    `Resume / Portfolio / Video URL: ${m.resumeLink}`,
    `Consent to procedures & daily records: ${m.consent ? "YES" : "NO"}`,
    m.userAgent ? `User Agent: ${m.userAgent}` : null,
  ].filter(Boolean);

  // “All submitted fields” dump: mirror everything provided
  const IGNORE_KEYS = new Set(["hp_extra_info"]);
  const allPairs = Object.keys(m.raw || {})
    .filter((k) => !IGNORE_KEYS.has(k))
    .map((k) => `${k}: ${String(m.raw[k])}`);

  const textAll = [
    ``,
    `— — — — —`,
    `All submitted fields (raw)`,
    `— — — — —`,
    ...allPairs,
  ];

  const text = [...textLines, ...textAll].join("\n");

  const html = `
    <div style="font-family:system-ui,-apple-system,'SF Pro Text','Helvetica Neue',Arial,sans-serif; color:#111;">
      <h2 style="margin:0 0 10px;">Back Office Application</h2>
      <p style="margin:0 0 14px;opacity:.85;">
        ${
          m.page
            ? `Submitted via <strong>${esc(m.page)}</strong>`
            : `Submission received`
        } ${m.source ? ` • Source: <strong>${esc(m.source)}</strong>` : ``}
      </p>

      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:760px;">
        ${row("ROLE", m.role)}
        ${row("Full Name", m.fullName)}
        ${row("Email", m.email)}
        ${row("Phone", m.phone)}
        ${row("City / Location", m.city)}
        ${row(
          "How do you stay organized when managing multiple responsibilities?",
          m.q1
        )}
        ${row(
          "Tell us about a time you documented or maintained order that made work easier for others.",
          m.q2
        )}
        ${row("Resume / Portfolio / Video URL", m.resumeLink)}
        ${row(
          "Consent to procedures & daily records",
          m.consent ? "Yes" : "No"
        )}
        ${row("User Agent", m.userAgent || "")}
      </table>

      <h3 style="margin:22px 0 8px;">All submitted fields (raw)</h3>
      <pre style="white-space:pre-wrap;background:#f7f7f7;border:1px solid #eee;border-radius:8px;padding:10px;margin:0;">
${esc(allPairs.join("\n"))}
      </pre>
    </div>
  `;

  try {
    // Internal notification
    await transport.sendMail({
      from: fromEmail,
      to: toCareers,
      subject,
      text,
      html,
    });

    // Applicant confirmation (short + echo key answers)
    await transport.sendMail({
      from: fromEmail,
      to: m.email,
      subject: "Seven Tattoo — We received your Back Office application",
      text: `Hi ${m.fullName || ""},

Thanks for applying to Seven Tattoo. We’ve received your Back Office application and will review it shortly.

Summary:
- Name: ${m.fullName}
- Phone: ${m.phone}
- City: ${m.city}
- Link: ${m.resumeLink}

If we move forward, we'll reach out via this email.

— Seven Tattoo`,
    });

    return ok({ ok: true });
  } catch (err) {
    console.error("BackOffice mail error:", err?.response?.body || err);
    return oops("Email send failed");
  }
};
