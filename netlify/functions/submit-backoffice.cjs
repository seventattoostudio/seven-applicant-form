// netlify/functions/submit-backoffice.cjs
const nodemailer = require("nodemailer");

/* ============ CORS ============ */
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

/* ============ Body Parsing ============ */
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

/* ============ Helpers for tolerant mapping ============ */
function getFirst(obj, keys) {
  for (const k of keys)
    if (obj[k] != null && String(obj[k]).trim() !== "") return v(obj[k]);
  return "";
}
function getFirstCI(obj, keys) {
  // case-insensitive key match
  const map = new Map(Object.keys(obj || {}).map((k) => [k.toLowerCase(), k]));
  for (const cand of keys) {
    const real = map.get(cand.toLowerCase());
    if (real && obj[real] != null && String(obj[real]).trim() !== "")
      return v(obj[real]);
  }
  return "";
}
function getByRegex(obj, regexArr) {
  const entries = Object.entries(obj || {});
  for (const [k, val] of entries) {
    for (const rx of regexArr) {
      if (rx.test(k) && val != null && String(val).trim() !== "") return v(val);
    }
  }
  return "";
}

/* ============ Field Mapping (accepts legacy + new + fuzzy) ============ */
function mapFields(input) {
  const obj = input || {};

  const fullName = getFirstCI(obj, [
    "fullName",
    "name",
    "applicant_name",
    "full_name",
  ]);
  const email = getFirstCI(obj, ["email", "applicant_email"]);
  const phone = getFirstCI(obj, ["phone", "tel", "phone_number"]);
  const city = getFirstCI(obj, ["city", "location", "city_location"]);

  // Q1
  const q1 =
    getFirstCI(obj, [
      "about",
      "answer1",
      "q1",
      "why_fit",
      "what_you_need",
      "what_do_you_need",
    ]) ||
    getByRegex(obj, [/about/i, /(organized|secure|grow|need).*workplace/i]);

  // Q2
  const q2 =
    getFirstCI(obj, [
      "ownershipStory",
      "ownership_story",
      "answer2",
      "q2",
      "story",
      "when_something_went_wrong",
    ]) ||
    getByRegex(obj, [
      /owner(ship)?[_ ]?story/i,
      /(document(ed)?|order|went[_ ]?wrong|made work easier)/i,
    ]);

  // Resume / Video URL
  const resumeLink = getFirstCI(obj, [
    "resumeUrl",
    "resume_link",
    "video_url",
    "cv_link",
    "portfolio",
    "portfolio_url",
    "link",
    "url",
  ]);

  // Consent → boolean
  const consentRaw =
    obj.consentProcedures ?? obj.consent ?? obj.agree ?? obj.agree_sanitation;
  const consent = ["true", "on", "yes", "1", "y"].includes(
    String(consentRaw).toLowerCase()
  );

  const role = getFirstCI(obj, ["role"]) || "Back Office (Staff)";
  const source = getFirstCI(obj, ["source"]);
  const notifyEmail = getFirstCI(obj, ["recipient", "notify_email"]);
  const userAgent = getFirstCI(obj, ["userAgent", "user_agent"]);
  const page = getFirstCI(obj, ["page"]);

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
    raw: obj,
  };
}

function validate(m) {
  const miss = [];
  if (!m.fullName) miss.push("Full Name");
  if (!m.email) miss.push("Email");
  if (!m.phone) miss.push("Phone");
  if (!m.city) miss.push("City/Location");
  if (!m.q1) miss.push("Q1 (organization)");
  if (!m.q2) miss.push("Q2 (documented order)");
  if (!m.resumeLink) miss.push("Resume/Video link");
  return miss;
}

function esc(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function row(label, val) {
  return `<tr><td style="padding:6px 10px;border-top:1px solid #eee;"><strong>${esc(
    label
  )}:</strong></td><td style="padding:6px 10px;border-top:1px solid #eee;">${
    val ? esc(val) : "<em>(not provided)</em>"
  }</td></tr>`;
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

  const subject = `New BACK OFFICE application — ${m.fullName}`;

  // Text (human-friendly + raw dump)
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

  const IGNORE_KEYS = new Set(["hp_extra_info"]);
  const allPairs = Object.keys(m.raw || {})
    .filter((k) => !IGNORE_KEYS.has(k))
    .map((k) => `${k}: ${String(m.raw[k])}`);

  const text = [
    ...textLines,
    "",
    "— — — — —",
    "All submitted fields (raw)",
    "— — — — —",
    ...allPairs,
  ].join("\n");

  const html = `
    <div style="font-family:system-ui,-apple-system,'SF Pro Text','Helvetica Neue',Arial,sans-serif;color:#111;">
      <h2 style="margin:0 0 10px;">Back Office Application</h2>
      <p style="margin:0 0 14px;opacity:.85;">
        ${
          m.page
            ? `Submitted via <strong>${esc(m.page)}</strong>`
            : `Submission received`
        }
        ${m.source ? ` • Source: <strong>${esc(m.source)}</strong>` : ``}
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
      <pre style="white-space:pre-wrap;background:#f7f7f7;border:1px solid #eee;border-radius:8px;padding:10px;margin:0;">${esc(
        allPairs.join("\n")
      )}</pre>
    </div>
  `;

  try {
    // Internal
    await transport.sendMail({
      from: fromEmail,
      to: toCareers,
      subject,
      text,
      html,
    });

    // Applicant confirmation
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
