import { Resend } from "resend";

const NOTIFY_TO = "andrej.hano@gmail.com";

function getResendFrom(): string {
  const from = process.env.RESEND_FROM?.trim();
  if (from) return from;
  return "Alpaca site <notifications@signature.spenatlabs.com>";
}

export async function sendSiteAccessNotification(
  request: Request,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.error("[site-access-email] RESEND_API_KEY is not set");
    return;
  }

  const resend = new Resend(apiKey);
  const at = new Date().toISOString();
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const { error } = await resend.emails.send({
    from: getResendFrom(),
    to: [NOTIFY_TO],
    subject: "Site access: password accepted",
    text: [
      "Someone successfully passed the site password screen.",
      "",
      `Time (UTC): ${at}`,
      `IP: ${ip}`,
      `User-Agent: ${userAgent}`,
    ].join("\n"),
  });

  if (error) {
    console.error("[site-access-email] Resend error:", error);
  }
}
