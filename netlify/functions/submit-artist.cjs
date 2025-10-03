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

// Aliases helper
const v = (x) => (typeof x === "string" ? x.trim() : x);
const isURL = (u) => {
  try {
    new URL(u);
    return true;
  } catch {
    return false;
  }
};
const igIsHandle = (h) => /^@?[A-Za-z0-9._]{2,30}$/.test(h || "");

// Map both old + new fields to a normalized model
function mapFields(input) {
  const fullName =
    v(input.fullName) ||
    v(input.name) ||
    v(input.full_name) ||
    v(input.applicant_name);
  const phone = v(input.phone) || v(input.phone_number) || v(input.tel);
  const email = v(input.email) || v(input.applicant_email);
  const city = v(input.city) || v(input.location) || v(input.city_location);

  // IG: enforce handle (not URL)
  let igHandle =
    v(input.ig_handle) || v(input.instagram) || v(input.instagram_handle);
  if (igHandle && /^https?:\/\//i.test(igHandle)) igHandle = ""; // reject links
  if (igHandle && !igHandle.startsWith("@")) igHandle = "@" + igHandle;

  // NEW questions (with fallbacks to older names where sensible)
  const healedGalleryUrl =
    v(input.healed_gallery_url) ||
    v(input.healedResultsUrl) ||
    v(input.gallery) ||
    v(input.portfolio_url);
  const sanitationPractices =
    v(input.sanitation_practices) ||
    v(input.sanitation) ||
    v(input.sanitationCompliance) ||
    v(input.q_sanitation);
  const masteryDefinition =
    v(input.mastery_definition) || v(input.mastery) || v(input.q_mastery);
  const longTermResidency =
    v(input.long_term_residency) ||
    v(input.longTermResidency) ||
    v(input.residency);

  const accountabilityAck =
    input.accountability_ack ??
    input.accountability ??
    input.healed_results_accountability ??
    input.agree;

  const workflowConsistency =
    v(input.workflow_consistency) || v(input.process) || v(input.q_process);
  const idealClient =
    v(input.ideal_client) || v(input.idealCollector) || v(input.q_ideal);

  const supportingLink =
    v(input.supporting_link) ||
    v(input.portfolio) ||
    v(input.portfolio_link) ||
    v(input.website) ||
    v(input.url) ||
    v(input.link);

  // Required video
  const videoUrl =
    v(input.video_url) ||
    v(input.video) ||
    v(input.resume_link) ||
    v(input.video_intro);

  return {
    // contact
    fullName,
    phone,
    email,
    city,
    igHandle,

    // new questions
    healedGalleryUrl,
    sanitationPractices,
    masteryDefinition,
    longTermResidency,
    accountabilityAck:
      String(accountabilityAck).toLowerCase() === "true" ||
      ["on", "yes", "1", "true"].includes(
        String(accountabilityAck).toLowerCase()
      ),
    workflowConsistency,
    idealClient,

    // links
    supportingLink,
    videoUrl,

    raw: input,
  };
}

function validate(m) {
  const missing = [];

  if (!m.fullName) missing.push("Full Name");
  if (!m.email) missing.push("Email");
  if (!m.city) missing.push("City/Location");

  if (!m.igHandle || !igIsHandle(m.igHandle))
    missing.push("Instagram Handle (plain @handle)");

  if (!m.healedGalleryUrl) missing.push("Healed Results Gallery (URL)");
  if (!m.sanitationPractices) missing.push("Sanitation & compliance practices");
  if (!m.masteryDefinition) missing.push("Mastery/excellence definition");
  if (!m.longTermResidency) missing.push("Long-term residency (Yes/No)");
  if (!m.accountabilityAck) missing.push("Accountability for healed results");
  if (!m.workflowConsistency)
    missing.push("Process (consult → stencil → tattoo → aftercare)");
  if (!m.idealClient) missing.push("Ideal collector/client");

  if (!m.videoUrl) missing.push("60-second video link");

  // URL sanity
  if (m.healedGalleryUrl && !isURL(m.healedGalleryUrl))
    missing.push("Healed Results Gallery must be a valid URL");
  if (m.videoUrl && !isURL(m.videoUrl))
    missing.push("60-second video must be a valid URL");
  if (m.supportingLink && !isURL(m.supportingLink))
    missing.push("Supporting link must be a valid URL");

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

  // Build email that mirrors labels exactly
  const lines = [
    `Artist Application — ${new Date().toLocaleString()}`,
    "",
    `Full Name: ${mapped.fullName}`,
    `Phone: ${mapped.phone || "(not provided)"}`,
    `Email: ${mapped.email}`,
    `City/Location: ${mapped.city}`,
    `Instagram: ${mapped.igHandle}`,
    "",
    `Healed Results Gallery (URL): ${mapped.healedGalleryUrl}`,
    "",
    "Describe your sanitation & compliance practices:",
    mapped.sanitationPractices,
    "",
    "What does mastery/excellence look like in your work?",
    mapped.masteryDefinition,
    "",
    `Long-term residency: ${mapped.longTermResidency}`,
    `Accountability for healed results acknowledged: ${
      mapped.accountabilityAck ? "Yes" : "No"
    }`,
    "",
    "Outline your typical process (consult → stencil → tattoo → aftercare):",
    mapped.workflowConsistency,
    "",
    "Describe your ideal collector/client:",
    mapped.idealClient,
  ];

  if (mapped.supportingLink)
    lines.push("", `Supporting link: ${mapped.supportingLink}`);
  lines.push("", `60-sec video: ${mapped.videoUrl}`);

  const subject = `New ARTIST application — ${mapped.fullName}`;
  const text = lines.join("\n");

  try {
    // Send to careers
    await transporter.sendMail({
      from: fromEmail,
      to: toCareers,
      subject,
      text,
    });

    // Auto-reply to applicant
    await transporter.sendMail({
      from: fromEmail,
      to: mapped.email,
      subject: "Seven Tattoo — We received your Artist application",
      text: `Hi ${
        mapped.fullName || ""
      },\n\nThanks for applying to Seven Tattoo. We’ve received your submission and will review it shortly.\n\n— Seven Tattoo`,
    });

    return ok({ ok: true });
  } catch (err) {
    console.error("Artist submit mail error:", err?.response?.body || err);
    return oops("Email send failed");
  }
};
