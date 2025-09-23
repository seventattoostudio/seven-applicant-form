cat > (netlify / functions / submit - artist.js) << "EOF";
// submit-artist.js
const nodemailer = require("nodemailer");

const required = (b, fields) =>
  fields.filter((f) => !b[f] || String(b[f]).trim() === "");

const makeTransport = () =>
  nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_PORT) === "465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

const internalEmailHtml = (data) => `
  <h2>New Artist Application</h2>
  <p><strong>Full Name:</strong> ${data.fullName}</p>
  <p><strong>Phone:</strong> ${data.phone}</p>
  <p><strong>Email:</strong> ${data.email}</p>
  <p><strong>City/Location:</strong> ${data.city}</p>
  <p><strong>Portfolio Link:</strong> ${data.portfolio}</p>
  <hr/>
  <p><strong>What must your work represent in five years for you to feel proud?</strong><br>${
    data.fiveYear
  }</p>
  <p><strong>Tell us about a long-term commitment you kept and why it mattered.</strong><br>${
    data.longCommit
  }</p>
  <p><strong>I agree to follow sanitation & compliance standards:</strong> ${
    data.compliance ? "Yes" : "No"
  }</p>
  ${
    data.videoLink
      ? `<p><strong>60s Video (“Why Seven?”):</strong> ${data.videoLink}</p>`
      : ""
  }
  <hr/>
  <p style="font-size:12px;color:#888">Route: Artist • Source: ${
    data.source || "Landing Page"
  }</p>
`;

const applicantEmailHtml = (data) => `
  <h2>Thanks, ${data.fullName} — Artist application received</h2>
  <p>Hi ${data.fullName},</p>
  <p>Thanks for applying to join <strong>Seven Tattoo</strong> as an <strong>Artist</strong>. We review applications within 48 hours and will reach out if we’re moving forward.</p>
  <p><strong>We noted your portfolio:</strong> ${data.portfolio}</p>
  <p>— Seven Tattoo</p>
`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS")
    return { statusCode: 204, headers: corsHeaders };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const body = JSON.parse(event.body || "{}");

    // Honeypot
    if (body.hp && String(body.hp).trim().length > 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: "Blocked" }),
      };
    }

    const missing = required(body, [
      "fullName",
      "phone",
      "email",
      "city",
      "portfolio",
      "fiveYear",
      "longCommit",
      "compliance",
    ]);
    if (missing.length) {
      return {
        statusCode: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ ok: false, error: "Missing fields", missing }),
      };
    }

    const data = {
      fullName: body.fullName,
      phone: body.phone,
      email: body.email,
      city: body.city,
      portfolio: body.portfolio,
      fiveYear: body.fiveYear,
      longCommit: body.longCommit,
      compliance: ["true", "on", "yes", true, 1, "1"].includes(body.compliance),
      videoLink: body.videoLink || "",
      source: body.source || "",
    };

    const transporter = makeTransport();

    // 1) Internal
    await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: process.env.INTERNAL_EMAIL,
      subject: `Artist Application — ${data.fullName}`,
      html: internalEmailHtml(data),
      text:
        `New Artist Application\n` +
        `Name: ${data.fullName}\nPhone: ${data.phone}\nEmail: ${data.email}\nCity: ${data.city}\n` +
        `Portfolio: ${data.portfolio}\n5-Year: ${data.fiveYear}\nCommitment: ${data.longCommit}\n` +
        `Compliance: ${data.compliance ? "Yes" : "No"}\nVideo: ${
          data.videoLink || "—"
        }`,
      replyTo: data.email,
    });

    // 2) Confirmation to applicant
    await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: data.email,
      subject: "We received your Artist application — Seven Tattoo",
      html: applicantEmailHtml(data),
      text: `Thanks ${data.fullName}! We received your Artist application. We review within 48 hours.`,
    });

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: "Server error" }),
    };
  }
};
EOF;
