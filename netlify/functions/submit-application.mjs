import sendgrid from "@sendgrid/mail";

sendgrid.setApiKey(process.env.SENDGRID_API_KEY);

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const data = JSON.parse(event.body);

    // Format email content
    const msg = {
      to: "careers@seventattoolv.com", // 👈 change if needed
      from: "no-reply@seventattoolv.com", // verified sender in SendGrid
      subject: `New Application from ${data.name || "Unknown"}`,
      text: `
New application received:

Name: ${data.name}
Email: ${data.email}
Phone: ${data.phone || "N/A"}
Position: ${data.position || "N/A"}
Start Date: ${data.startDate || "N/A"}
Availability: ${data.availability || "N/A"}
Experience: ${data.experience || "N/A"}
Portfolio: ${data.portfolio || "N/A"}
Intro Video: ${data.introVideo || "N/A"}

Message:
${data.message || "(none)"}
      `,
    };

    await sendgrid.send(msg);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: "Application submitted" }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: "Server Error" };
  }
}
