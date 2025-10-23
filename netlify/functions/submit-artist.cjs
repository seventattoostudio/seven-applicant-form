// netlify/functions/submit-artist.cjs
// Seven Tattoo — Artist Application (video REQUIRED)
// - SendGrid SMTP (nodemailer)
// - Strong CORS + diagnostics
// - Mirrors current form labels/order

const nodemailer = require("nodemailer");

// ---------- CORS ----------
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": CORS_ORIGIN,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

const ok = (b) => ({
  statusCode: 200,
  headers: corsHeaders,
  body: JSON.stringify(b),
});
const bad = (m, extra = {}) => ({
  statusCode: 400,
  headers: corsHeaders,
  body: JSON.stringify({ ok: false, error: m, ...extra }),
});
const oops = (m, extra = {}) => ({
  statusCode: 500,
  headers: corsHeaders,
  body: JSON.stringify({ ok: false, error: m, ...extra }),
});

// ---------- Helpers ----------
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

function mapFields(input) {
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

  // Optional
  const portfolioLink =
    v(input.portfolio_link) ||
    v(input.portfolio) ||
    v(input.website) ||
    v(input.url) ||
    v(input.link);

  // Optional notify override from form JS (data-notify-email)
  const notifyEmail = v(input.notify_email) || v(input.notifyEmail);

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
    notifyEmail,
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
  if (!m.videoUrl) missing.push("video_url"); // required
  return missing;
}

function buildEmailBodies(mapped) {
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

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">
    <h2 style="margin:0 0 8px;">Seven Tattoo — Artist Application</h2>
    <div style="color:#666;margin-bottom:12px;">Submitted: ${new Date().toLocaleString()}</div>
    <table cellpadding="0" cellspacing="0" style="width:100%;max-width:760px;border-collapse:collapse">
      <tbody>
        <tr><td style="padding:6px 0;"><strong>Full Name:</strong> ${escapeHtml(
          mapped.fullName
        )}</td></tr>
        <tr><td style="padding:6px 0;"><strong>Email:</strong> ${escapeHtml(
          mapped.email
        )}</td></tr>
        <tr><td style="padding:6px 0;"><strong>Phone:</strong> ${escapeHtml(
          mapped.phone || "(not provided)"
        )}</td></tr>
        <tr><td style="padding:6px 0;"><strong>City/Location:</strong> ${escapeHtml(
          mapped.city
        )}</td></tr>
        <tr><td style="padding:6px 0;"><strong>Instagram Handle:</strong> ${escapeHtml(
          mapped.igHandle
        )}</td></tr>
        ${
          mapped.portfolioLink
            ? `<tr><td style="padding:6px 0;"><strong>Portfolio Link:</strong> <a href="${escapeAttr(
                mapped.portfolioLink
              )}">${escapeHtml(mapped.portfolioLink)}</a></td></tr>`
            : ""
        }
        <tr><td style="padding:10px 0;border-top:1px solid #eee;"></td></tr>
        <tr><td style="padding:6px 0;"><strong>Upload Healed Work (Required):</strong> <a href="${escapeAttr(
          mapped.healedWorkUrl
        )}">${escapeHtml(mapped.healedWorkUrl)}</a></td></tr>
        <tr><td style="padding:10px 0;border-top:1px solid #eee;"></td></tr>
        <tr><td style="padding:6px 0;"><strong>Q1 — Five-year representation (proud):</strong><br>${nl2br(
          escapeHtml(mapped.proud)
        )}</td></tr>
        <tr><td style="padding:6px 0;"><strong>Q2 — Long-term commitment:</strong><br>${nl2br(
          escapeHtml(mapped.commitment)
        )}</td></tr>
        <tr><td style="padding:6px 0;"><strong>Q3 — Client should feel:</strong><br>${nl2br(
          escapeHtml(mapped.clientFeel)
        )}</td></tr>
        <tr><td style="padding:10px 0;border-top:1px solid #eee;"></td></tr>
        <tr><td style="padding:6px 0;"><strong>Agrees to sanitation/compliance:</strong> ${
          mapped.agreeSanitation ? "YES" : "NO"
        }</td></tr>
        <tr><td style="padding:6px 0;"><strong>60s Video — “Why Seven?”:</strong> <a href="${escapeAttr(
          mapped.videoUrl
        )}">${escapeHtml(mapped.videoUrl)}</a></td></tr>
      </tbody>
    </table>
  </div>`.trim();

  return { text, html };
}

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(s = "") {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
function nl2br(s = "") {
  return s.replace(/\n/g, "<br>");
}

// ---------- Handler ----------
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "ok" };
  }
  if (event.httpMethod !== "POST") return bad("Use POST");

  const body = readJson(event);
  if (body === null) return bad("Invalid JSON");

  // Honeypot: quietly succeed
  if (typeof body.hp_extra_info === "string" && body.hp_extra_info.trim()) {
    return ok({ ok: true, skipped: true });
  }

  const mapped = mapFields(body);
  const missing = validate(mapped);
  if (missing.length) {
    console.error("Artist submit missing:", missing, {
      gotKeys: Object.keys(body || {}),
    });
    return bad(`Missing required field(s): ${missing.join(", ")}`, { missing });
  }

  // Resolve emails
  const defaultTo = "careers@seventattoolv.com";
  // Allow form-provided notify_email if present; else env; else default
  const toCareers =
    mapped.notifyEmail ||
    process.env.ARTIST_RECEIVER ||
    process.env.TO_EMAIL ||
    defaultTo;

  const fromEmail =
    process.env.SEND_FROM || process.env.FROM_EMAIL || defaultTo;

  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (!sendgridKey) {
    return oops("SENDGRID_API_KEY not configured", { haveKey: false });
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.sendgrid.net",
    port: 465,
    secure: true,
    auth: { user: "apikey", pass: sendgridKey },
  });

  const { text, html } = buildEmailBodies(mapped);
  const subject = `New ARTIST application — ${mapped.fullName}`;

  try {
    // Send to Seven (careers)
    await transporter.sendMail({
      from: fromEmail,
      to: toCareers,
      subject,
      text,
      html,
      replyTo: mapped.email || undefined,
    });

    // Auto-ack to applicant
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
        html: `
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">
            <p>Hi ${escapeHtml(mapped.fullName || "")},</p>
            <p>Thanks for applying to <strong>Seven Tattoo</strong>. We've received your submission and will review it shortly.</p>
            <p>If you shared a Google Drive link, please ensure:</p>
            <ul>
              <li>General access: <strong>Anyone with the link</strong></li>
              <li>Role: <strong>Viewer</strong></li>
            </ul>
            <p>— Seven Tattoo</p>
          </div>`.trim(),
      });
    }

    const diagnostics = {
      ok: true,
      deliveredTo: toCareers,
      usedFrom: fromEmail,
      haveKey: !!sendgridKey,
      timestamp: new Date().toISOString(),
      origin: event.headers?.origin || null,
    };
    return ok(diagnostics);
  } catch (err) {
    console.error("Artist submit mail error:", err?.response?.body || err);
    return oops("Email send failed", {
      code: err?.code || null,
      response: err?.response?.body || null,
    });
  }
};
