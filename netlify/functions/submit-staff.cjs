// netlify/functions/submit-staff.cjs
const nodemailer = require("nodemailer");

// --- CORS ---
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const cors = {
  "Access-Control-Allow-Origin": CORS_ORIGIN,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// --- Small helpers ---
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

function readJson(event) {
  try {
    if (!event.body) return {};
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --- Field aliasing (Shopify -> internal) ---
function mapFields(input) {
  const v = (x) => (typeof x === "string" ? x.trim() : x);

  // basics
  const fullName =
    v(input.fullName) ||
    v(input.name) ||
    v(input.full_name) ||
    v(input.applicant_name);
  const email = v(input.email) || v(input.staff_email);
  const phone = v(input.phone) || v(input.phone_number) || v(input.tel);
  const city = v(input.city) || v(input.location) || v(input.city_location);

  // extras
  const position =
    v(input.position) || v(input.role) || v(input.job) || v(input.applying_for);
  const availability =
    v(input.availability) ||
    v(input.start_date) ||
    v(input.start) ||
    v(input.when_available);

  // your UI has TWO textareas
  const about =
    v(input.about) || v(input.q_about) || v(input.experience) || v(input.notes);
  const ownershipStory =
    v(input.ownership_story) || v(input.q_ownership) || v(input.ownership);

  // links
  const portfolio =
    v(input.portfolio) ||
    v(input.portfolio_link) ||
    v(input.website) ||
    v(input.url) ||
    v(input.link);
  const resumeLink =
    v(input.resume_link) ||
    v(input.video_url) ||
    v(input.cv_link) ||
    v(input.drive);

  // checkbox: you use "consent" on the frontend; accept common variants
  const agreeRaw =
    input.agree_policies ??
    input.consent ??
    input.agree ??
    input.agree_sanitation;
  const agreePolicies = ["true", "on", "yes", "1", "y"].includes(
    String(agreeRaw).toLowerCase()
  );

  // optional override
  const notifyEmail = v(input.recipient) || v(input.notify_email);

  return {
    fullName,
    email,
    phone,
    city,
    position,
    availability,
    about,
    ownershipStory,
    portfolio,
    resumeLink,
    agreePolicies,
    notifyEmail,
    raw: input,
  };
}

function validate(m) {
  const missing = [];
  // keep server lenient (frontend already enforces more)
  if (!m.fullName) missing.push("name");
  if (!m.email) missing.push("email");
  return missing;
}

module.exports.handler = async (event) => {
  // preflight
  if (event.httpMethod === "OPTIONS")
    return { statusCode: 200, headers: cors, body: "ok" };
  if (event.httpMethod !== "POST") return bad("Use POST");

  const body = readJson(event);
  if (body === null) return bad("Invalid JSON");

  const m = mapFields(body);
  const missing = validate(m);
  if (missing.length) {
    console.error("Staff submit missing:", missing, {
      gotKeys: Object.keys(body || {}),
    });
    return bad(`Missing required field(s): ${missing.join(", ")}`);
  }

  // --- Email transport (SendGrid via SMTP) ---
  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (!sendgridKey) return oops("SENDGRID_API_KEY not configured");

  const toCareers =
    m.notifyEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.notifyEmail)
      ? m.notifyEmail
      : process.env.STAFF_RECEIVER || "careers@seventattoolv.com";

  const fromEmail = process.env.SEND_FROM || "careers@seventattoolv.com";

  const transport = nodemailer.createTransport({
    host: "smtp.sendgrid.net",
    port: 465,
    secure: true,
    auth: { user: "apikey", pass: sendgridKey },
  });

  const subject = `New STAFF application — ${m.fullName}${
    m.position ? ` (${m.position})` : ""
  }`;

  const lines = [
    `Name: ${m.fullName}`,
    `Email: ${m.email}`,
    `Phone: ${m.phone || "(not provided)"}`,
    `City/Location: ${m.city || "(not provided)"}`,
    `Position/Role: ${m.position || "(not provided)"}`,
    `Availability: ${m.availability || "(not provided)"}`,
    `Portfolio: ${m.portfolio || "(not provided)"}`,
    `Resume/Video: ${m.resumeLink || "(not provided)"}`,
    "",
    `About (What do you need from a workplace to feel secure and grow?):`,
    m.about || "(not provided)",
    "",
    `Ownership story (when something went wrong):`,
    m.ownershipStory || "(not provided)",
    "",
    `Agrees to policies: ${m.agreePolicies ? "YES" : "NO"}`,
  ];

  try {
    // internal
    await transport.sendMail({
      from: fromEmail,
      to: toCareers,
      subject,
      text: lines.join("\n"),
    });
    // confirmation
    await transport.sendMail({
      from: fromEmail,
      to: m.email,
      subject: "Seven Tattoo — We received your Staff application",
      text: `Hi ${
        m.fullName || ""
      },\n\nThanks for applying to Seven Tattoo. We’ve received your submission and will review it shortly.\n— Seven Tattoo`,
    });

    return ok({ ok: true });
  } catch (err) {
    console.error("Staff submit mail error:", err?.response?.body || err);
    return oops("Email send failed");
  }
};
