// netlify/functions/submit-artist.cjs
const nodemailer = require("nodemailer");

const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": CORS_ORIGIN,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const ok = (b) => ({
  statusCode: 200,
  headers: corsHeaders,
  body: JSON.stringify(b),
});
const bad = (m) => ({
  statusCode: 400,
  headers: corsHeaders,
  body: JSON.stringify({ ok: false, error: m }),
});
const oops = (m) => ({
  statusCode: 500,
  headers: corsHeaders,
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

const v = (x) => (typeof x === "string" ? x.trim() : x);
const igIsHandle = (h) => /^@?[A-Za-z0-9._]{2,30}$/.test(h || "");

// Shopify → internal aliases (original fields)
function mapFields(input) {
  const fullName =
    v(input.fullName) ||
    v(input.name) ||
    v(input.full_name) ||
    v(input.applicant_name);
  const phone = v(input.phone) || v(input.phone_number) || v(input.tel);
  const email = v(input.email) || v(input.applicant_email);
  const city = v(input.city) || v(input.location) || v(input.city_location);

  let igHandle =
    v(input.ig_handle) || v(input.instagram) || v(input.instagram_handle);
  if (igHandle && /^https?:\/\//i.test(igHandle)) igHandle = ""; // require handle, not URL
  if (igHandle && !igHandle.startsWith("@")) igHandle = "@" + igHandle;

  const proud =
    v(input.q_proud) ||
    v(input.proud) ||
    v(input.q_vision) ||
    v(input.question_proud);
  const commitment =
    v(input.q_commitment) || v(input.commitment) || v(input.long_term);

  const agreeRaw =
    input.agree_sanitation ??
    input.agreeSanitation ??
    input.sanitation ??
    input.agree;
  const agreeSanitation = ["true", "on", "yes", "1"].includes(
    String(agreeRaw).toLowerCase()
  );

  const videoUrl =
    v(input.video_url) ||
    v(input.video) ||
    v(input.resume_link) ||
    v(input.video_intro);

  return {
    fullName,
    phone,
    email,
    city,
    igHandle,
    proud,
    commitment,
    agreeSanitation,
    videoUrl,
    raw: input,
  };
}

function validate(m) {
  const missing = [];
  if (!m.fullName) missing.push("name");
  if (!m.email) missing.push("email");
  if (!m.city) missing.push("city/location");
  if (!m.igHandle || !igIsHandle(m.igHandle)) missing.push("ig_handle");
  if (!m.proud) missing.push("q_proud");
  if (!m.commitment) missing.push("q_commitment");
  if (!m.agreeSanitation) missing.push("agree_sanitation");
  if (!m.videoUrl) missing.push("video_url");
  return missing;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS")
    return { statusCode: 200, headers: corsHeaders, body: "ok" };
  if (event.httpMethod !== "POST") return bad("Use POST");

  const body = readJson(event);
  if (body === null) return bad("Invalid JSON");

  const mapped = mapFields(body);
  const missing = validate(mapped);
  if (missing.length) {
    console.error("Artist submit missing:", missing, {
      gotKeys: Object.keys(body || {}),
    });
    return bad(`Missing required field(s): ${missing.join(", ")}`);
  }

  const toCareers = process.env.ARTIST_RECEIVER || "careers@seventattoolv.com";
  const fromEmail = process.env.SEND_FROM || "careers@seventattoolv.com";
  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (!sendgridKey) return oops("SENDGRID_API_KEY not configured");

  const transporter = nodemailer.createTransport({
    host: "smtp.sendgrid.net",
    port: 465,
    secure: true,
    auth: { user: "apikey", pass: sendgridKey },
  });

  const lines = [
    `Artist Application — ${new Date().toLocaleString()}`,
    "",
    `Name: ${mapped.fullName}`,
    `Email: ${mapped.email}`,
    `Phone: ${mapped.phone || "(not provided)"}`,
    `City/Location: ${mapped.city}`,
    `Instagram: ${mapped.igHandle}`,
    `Video: ${mapped.videoUrl}`,
    "",
    "Q — Proud (5-year):",
    mapped.proud,
    "",
    "Q — Long-term commitment:",
    mapped.commitment,
    "",
    `Agrees to sanitation/compliance: ${mapped.agreeSanitation ? "YES" : "NO"}`,
  ];
  const subject = `New ARTIST application — ${mapped.fullName}`;
  const text = lines.join("\n");

  try {
    await transporter.sendMail({
      from: fromEmail,
      to: toCareers,
      subject,
      text,
    });
    await transporter.sendMail({
      from: fromEmail,
      to: mapped.email,
      subject: "Seven Tattoo — We received your Artist application",
      text: `Hi ${
        mapped.fullName || ""
      },\n\nThanks for applying to Seven Tattoo. We’ve received your submission and will review it shortly.\n— Seven Tattoo`,
    });
    return ok({ ok: true });
  } catch (err) {
    console.error("Artist submit mail error:", err?.response?.body || err);
    return oops("Email send failed");
  }
};
