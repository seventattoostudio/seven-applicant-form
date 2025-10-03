// netlify/functions/submit-artist.cjs
// Mirrors the current Artist Application fields (video REQUIRED)

const nodemailer = require("nodemailer");

// --- CORS ---
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

// --- Helpers ---
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

// Map multiple possible field keys -> single internal model
function mapFields(input) {
  const v = (x) => (typeof x === "string" ? x.trim() : x);

  const fullName =
    v(input.name) ||
    v(input.full_name) ||
    v(input.fullName) ||
    v(input.applicant_name);

  const phone = v(input.phone) || v(input.phone_number) || v(input.tel);
  const email = v(input.email) || v(input.applicant_email);
  const city = v(input.location) || v(input.city) || v(input.city_location);

  const igHandle =
    v(input.ig_handle) || v(input.instagram) || v(input.instagram_handle);

  const healedWorkUrl =
    v(input.healed_work_url) ||
    v(input.healed_work) ||
    v(input.healed_gallery_url);

  const proud = v(input.q_proud) || v(input.proud) || v(input.q_vision);
  const commitment =
    v(input.q_commitment) || v(input.commitment) || v(input.long_term);
  const clientFeel =
    v(input.q_feel) || v(input.client_feel) || v(input.q_client_feel);

  const agreeSanitationRaw =
    input.agree_sanitation ??
    input.agreeSanitation ??
    input.sanitation ??
    input.agree;
  const agreeSanitation = ["true", "on", "yes", "1"].includes(
    String(agreeSanitationRaw).toLowerCase()
  );

  // REQUIRED video now
  const videoUrl =
    v(input.video_url) ||
    v(input.video) ||
    v(input.video_intro) ||
    v(input.resume_link);

  const portfolioLink =
    v(input.portfolio_link) ||
    v(input.portfolio) ||
    v(input.website) ||
    v(input.url) ||
    v(input.link);

  return {
    fullName,
    phone,
    email,
    city,
    igHandle,
    healedWorkUrl,
    proud,
    commitment,
    clientFeel,
    agreeSanitation,
    videoUrl,
    portfolioLink,
    raw: input,
  };
}

function validate(m) {
  const missing = [];
  if (!m.fullName) missing.push("name");
  if (!m.email) missing.push("email");
  if (!m.city) missing.push("city/location");
  if (!m.igHandle) missing.push("ig_handle");
  if (!m.healedWorkUrl) missing.push("healed_work_url");
  if (!m.proud) missing.push("q_proud");
  if (!m.commitment) missing.push("q_commitment");
  if (!m.clientFeel) missing.push("q_feel");
  if (!m.agreeSanitation) missing.push("agree_sanitation");
  if (!m.videoUrl) missing.push("video_url"); // now required
  return missing;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS")
    return { statusCode: 200, headers: corsHeaders, body: "ok" };
  if (event.httpMethod !== "POST") return bad("Use POST");

  const body = readJson(event);
  if (body === null) return bad("Invalid JSON");

  // Honeypot
  if (typeof body.hp_extra_info === "string" && body.hp_extra_info.trim()) {
    return ok({ ok: true });
  }

  const mapped = mapFields(body);
  const missing = validate(mapped);
  if (missing.length) {
    console.error("Artist submit missing:", missing, {
      gotKeys: Object.keys(body || {}),
    });
    return bad(`Missing required field(s): ${missing.join(", ")}`);
  }

  const toCareers =
    process.env.ARTIST_RECEIVER ||
    process.env.TO_EMAIL ||
    "careers@seventattoolv.com";
  const fromEmail =
    process.env.SEND_FROM ||
    process.env.FROM_EMAIL ||
    "careers@seventattoolv.com";
  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (!sendgridKey) return oops("SENDGRID_API_KEY not configured");

  const transporter = nodemailer.createTransport({
    host: "smtp.sendgrid.net",
    port: 465,
    secure: true,
    auth: { user: "apikey", pass: sendgridKey },
  });

  // Email body mirrors labels & order
  const lines = [
    `Seven Tattoo — Artist Application`,
    `Submitted: ${new Date().toLocaleString()}`,
    ``,
    `Full Name: ${mapped.fullName}`,
    `Email: ${mapped.email}`,
    `Phone: ${mapped.phone || "(not provided)"}`,
    `City/Location: ${mapped.city}`,
    `Instagram Handle: ${mapped.igHandle}`,
    mapped.portfolioLink ? `Portfolio Link: ${mapped.portfolioLink}` : null,
    ``,
    `Upload Healed Work (Required): ${mapped.healedWorkUrl}`,
    ``,
    `Short Answer — What must your work represent in five years for you to feel proud?`,
    mapped.proud,
    ``,
    `Short Answer — Tell us about a long-term commitment you kept and why it mattered.`,
    mapped.commitment,
    ``,
    `Short Answer — In one sentence, what should a client feel when wearing your work?`,
    mapped.clientFeel,
    ``,
    `Agrees to sanitation/compliance: ${mapped.agreeSanitation ? "YES" : "NO"}`,
    `Upload (Required): 60-second video — “Why Seven?”: ${mapped.videoUrl}`,
  ].filter(Boolean);

  const text = lines.join("\n");
  const subject = `New ARTIST application — ${mapped.fullName}`;

  try {
    await transporter.sendMail({
      from: fromEmail,
      to: toCareers,
      subject,
      text,
    });

    if (mapped.email) {
      await transporter.sendMail({
        from: fromEmail,
        to: mapped.email,
        subject: "Seven Tattoo — We received your Artist application",
        text: `Hi ${mapped.fullName || ""},

Thanks for applying to Seven Tattoo. We've received your submission and will review it shortly.

If you shared a Google Drive link, please make sure the sharing setting is:
  • General access: "Anyone with the link"
  • Role: Viewer

— Seven Tattoo`,
      });
    }

    return ok({ ok: true });
  } catch (err) {
    console.error("Artist submit mail error:", err?.response?.body || err);
    return oops("Email send failed");
  }
};
