// netlify/functions/submit-application.js
import sgMail from "@sendgrid/mail";

// Set this to your domain if you want to restrict, otherwise "*" is fine for Shopify:
const ALLOW_ORIGIN = "*";

export default async (req, context) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Parse JSON
  let data;
  try {
    data = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Honeypot (matches your Shopify input name/class)
  if (data.hp_extra_info && String(data.hp_extra_info).trim().length > 0) {
    return json({ error: "Spam detected" }, 400);
  }

  // Required fields (matches your form)
  const required = ["name", "email", "about", "video_url"];
  for (const k of required) {
    if (!data[k] || String(data[k]).trim() === "") {
      return json({ error: `Missing field: ${k}` }, 400);
    }
  }
  // Checkbox: included only when checked
  if (!("consent" in data)) {
    return json({ error: "Consent required" }, 400);
  }

  // Build message summary
  const line = (k, label = k) => (data[k] ? `${label}: ${data[k]}` : "");
  const text = [
    "New Seven Tattoo Application",
    "---------------------------",
    line("name", "Name"),
    line("email", "Email"),
    line("phone", "Phone"),
    line("position", "Position"),
    line("start_date", "Earliest start"),
    line("preferred_hours", "Hours/week"),
    line("days_available", "Days"),
    line("weekends_holidays", "Weekends & holidays"),
    line("years_customer_service", "Customer service years"),
    line("pos_or_frontdesk_tools", "POS / front desk tools"),
    line("software", "Software"),
    "",
    "About:",
    data.about || "",
    "",
    "Resume link:",
    data.resume_link || "",
    "",
    "Video URL:",
    data.video_url || "",
    "",
    "References:",
    line("ref1", "Ref 1"),
    line("ref2", "Ref 2"),
    "",
    "__meta:",
    JSON.stringify(data.__meta || {}, null, 2),
  ]
    .filter(Boolean)
    .join("\n");

  // ===== (Optional) SendGrid email =====
  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  const TO_EMAIL = process.env.TO_EMAIL || "careers@seventattoolv.com";
  const FROM_EMAIL = process.env.FROM_EMAIL || "no-reply@seventattoolv.com";

  if (SENDGRID_API_KEY) {
    try {
      sgMail.setApiKey(SENDGRID_API_KEY);
      await sgMail.send({
        to: TO_EMAIL,
        from: FROM_EMAIL,
        subject: `Application: ${data.name} (${data.position || "Front Desk"})`,
        text,
      });
    } catch (err) {
      console.error("SendGrid error:", err?.response?.body || err);
      // We still return 200 so the user sees success.
    }
  } else {
    // No email configured — log to function logs so you can see it in Netlify UI.
    console.log("[Application]", text);
  }

  return json({ ok: true, message: "Received" }, 200);
};

// ---------- helpers ----------
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}
