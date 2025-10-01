// netlify/functions/submit-backoffice.cjs
const nodemailer = require("nodemailer");

/* ---------- CORS ---------- */
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

/* ---------- Body parsing ---------- */
function parseBody(event) {
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : event.body || "";
    const ct = String(
      event.headers?.["content-type"] || event.headers?.["Content-Type"] || ""
    ).toLowerCase();

    if (ct.includes("application/json")) return JSON.parse(raw || "{}");
    if (ct.includes("application/x-www-form-urlencoded")) {
      const p = new URLSearchParams(raw);
      const o = {};
      for (const [k, v] of p.entries()) o[k] = v;
      return o;
    }
    // try json by default
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

/* ---------- tolerant getters ---------- */
function getFirstCI(obj, keys) {
  const map = new Map(Object.keys(obj || {}).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = map.get(String(k).toLowerCase());
    if (real && obj[real] != null && String(obj[real]).trim() !== "")
      return v(obj[real]);
  }
  return "";
}
function getByRegex(obj, regexes) {
  for (const [k, val] of Object.entries(obj || {})) {
    if (val == null) continue;
    for (const rx of regexes) {
      if (rx.test(k) && String(val).trim() !== "") return v(val);
    }
  }
  return "";
}

/* ---------- base mapping ---------- */
function mapBase(input) {
  const o = input || {};
  const fullName = getFirstCI(o, [
    "fullName",
    "name",
    "applicant_name",
    "full_name",
  ]);
  const email = getFirstCI(o, ["email", "applicant_email"]);
  const phone = getFirstCI(o, ["phone", "tel", "phone_number"]);
  const city = getFirstCI(o, ["city", "location", "city_location"]);

  const q1 =
    getFirstCI(o, [
      "about",
      "answer1",
      "q1",
      "why_fit",
      "what_you_need",
      "what_do_you_need",
    ]) ||
    getByRegex(o, [/about/i, /(organized|secure|grow|need).*work(place)?/i]);

  const resumeLink = getFirstCI(o, [
    "resumeUrl",
    "resume_link",
    "video_url",
    "cv_link",
    "portfolio",
    "portfolio_url",
    "link",
    "url",
  ]);

  const consentRaw =
    o.consentProcedures ?? o.consent ?? o.agree ?? o.agree_sanitation;
  const consent = ["true", "on", "yes", "1", "y"].includes(
    String(consentRaw).toLowerCase()
  );

  const role = getFirstCI(o, ["role"]) || "Back Office (Staff)";
  const source = getFirstCI(o, ["source"]);
  const notifyEmail = getFirstCI(o, ["recipient", "notify_email"]);
  const userAgent = getFirstCI(o, ["userAgent", "user_agent"]);
  const page = getFirstCI(o, ["page"]);

  return {
    fullName,
    email,
    phone,
    city,
    q1,
    resumeLink,
    consent,
    role,
    source,
    notifyEmail,
    userAgent,
    page,
    raw: o,
  };
}

/* ---------- ownership story extractor (bulletproof) ---------- */
function getOwnership(raw) {
  const o = raw || {};
  const candidates = [
    "ownershipStory",
    "ownership_story",
    "ownershipstory",
    "ownership-story",
    "ownership",
    "answer2",
    "q2",
    "story",
    "when_something_went_wrong",
    "something_went_wrong",
    "what_went_wrong",
    "went_wrong",
    "documented",
    "maintained_order",
    "made_work_easier",
  ];

  // 1) exact names first
  for (const k of candidates) {
    if (o[k] != null && String(o[k]).trim() !== "")
      return { value: v(o[k]), keyUsed: k };
  }
  // 2) regex on keys
  for (const [k, val] of Object.entries(o)) {
    if (!val) continue;
    if (
      /owner(ship)?[_ -]?story/i.test(k) ||
      /(document|maintain(ed)?|order|went[_ -]?wrong|made[_ -]?work[_ -]?easier)/i.test(
        k
      )
    ) {
      const t = String(val).trim();
      if (t) return { value: t, keyUsed: k };
    }
  }
  // 3) fallback: longest textarea-like answer (excluding obvious fields)
  const ignore = new Set(
    [
      "fullName",
      "fullname",
      "name",
      "applicant_name",
      "full_name",
      "email",
      "applicant_email",
      "phone",
      "tel",
      "phone_number",
      "city",
      "location",
      "city_location",
      "about",
      "answer1",
      "q1",
      "what_you_need",
      "what_do_you_need",
      "why_fit",
      "resumeUrl",
      "resume_link",
      "video_url",
      "cv_link",
      "portfolio",
      "portfolio_url",
      "link",
      "url",
      "consent",
      "consentProcedures",
      "agree",
      "agree_sanitation",
      "role",
      "source",
      "recipient",
      "notify_email",
      "userAgent",
      "user_agent",
      "page",
      "hp_extra_info",
    ].map((s) => s.toLowerCase())
  );
  let best = { k: "", v: "" };
  for (const [k, val] of Object.entries(o)) {
    if (typeof val !== "string") continue;
    if (ignore.has(k.toLowerCase())) continue;
    const t = val.trim();
    if (!t) continue;
    if (t.includes(" ") || t.length > 40) {
      if (t.length > best.v.length) best = { k, v: t };
    }
  }
  if (best.v) return { value: best.v, keyUsed: best.k };
  return { value: "", keyUsed: "" };
}

/* ---------- validation ---------- */
function validate(m, ownershipVal) {
  const miss = [];
  if (!m.fullName) miss.push("Full Name");
  if (!m.email) miss.push("Email");
  if (!m.phone) miss.push("Phone");
  if (!m.city) miss.push("City/Location");
  if (!m.q1) miss.push("Q1 (organization)");
  if (!ownershipVal) miss.push("Q2 (ownership story)");
  if (!m.resumeLink) miss.push("Resume/Video link");
  return miss;
}

/* ---------- email helpers ---------- */
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

/* ---------- handler ---------- */
module.exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS")
    return { statusCode: 200, headers: cors, body: "ok" };
  if (event.httpMethod !== "POST") return bad("Use POST");

  const body = parseBody(event);
  if (body === null) return bad("Invalid body");

  // honeypot
  if (v(body.hp_extra_info)) return ok({ ok: true, skipped: true });

  const m = mapBase(body);
  const { value: ownershipVal, keyUsed: ownershipKey } = getOwnership(m.raw);

  const missing = validate(m, ownershipVal);
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

  // include all raw pairs for debugging
  const IGNORE_KEYS = new Set(["hp_extra_info"]);
  const allPairs = Object.keys(m.raw || {})
    .filter((k) => !IGNORE_KEYS.has(k))
    .map((k) => `${k}: ${String(m.raw[k])}`);

  const text = [
    `ROLE: ${m.role}`,
    `Source: ${m.source || "-"}`,
    m.page ? `Page: ${m.page}` : null,
    ``,
    `Full Name: ${m.fullName}`,
    `Email: ${m.email}`,
    `Phone: ${m.phone}`,
    `City / Location: ${m.city}`,
    ``,
    `About (What do you need from a workplace to feel secure and grow?):`,
    `${m.q1}`,
    ``,
    `Ownership story (when something went wrong):`,
    `${ownershipVal}`,
    ownershipKey ? `[ownership key used: ${ownershipKey}]` : null,
    ``,
    `Resume / Portfolio / Video URL: ${m.resumeLink}`,
    `Agrees to policies: ${m.consent ? "YES" : "NO"}`,
    m.userAgent ? `User Agent: ${m.userAgent}` : null,
    ``,
    `— — — — —`,
    `All submitted fields (raw)`,
    `— — — — —`,
    ...allPairs,
  ]
    .filter(Boolean)
    .join("\n");

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
        "About (What do you need from a workplace to feel secure and grow?)",
        m.q1
      )}
      ${row("Ownership story (when something went wrong)", ownershipVal)}
      ${ownershipKey ? row("[ownership key used]", ownershipKey) : ""}
      ${row("Resume / Portfolio / Video URL", m.resumeLink)}
      ${row("Agrees to policies", m.consent ? "YES" : "NO")}
      ${row("User Agent", m.userAgent || "")}
    </table>

    <h3 style="margin:22px 0 8px;">All submitted fields (raw)</h3>
    <pre style="white-space:pre-wrap;background:#f7f7f7;border:1px solid #eee;border-radius:8px;padding:10px;margin:0;">${esc(
      allPairs.join("\n")
    )}</pre>
  </div>
  `;

  try {
    await transport.sendMail({
      from: fromEmail,
      to: toCareers,
      subject,
      text,
      html,
    });
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
