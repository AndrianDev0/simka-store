type TransactionalEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey?: string;
};

export type EmailDelivery = {
  delivered: boolean;
  reason?: "not_configured" | "provider_error";
  id?: string;
};

export type EmailConfigurationStatus = {
  configured: boolean;
  missing: Array<"RESEND_API_KEY" | "EMAIL_FROM">;
  from?: string;
};

export function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function getEmailConfigurationStatus(): EmailConfigurationStatus {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  const missing: EmailConfigurationStatus["missing"] = [];
  if (!apiKey) missing.push("RESEND_API_KEY");
  if (!from) missing.push("EMAIL_FROM");
  return { configured: missing.length === 0, missing, ...(from ? { from } : {}) };
}

export async function sendTransactionalEmail(message: TransactionalEmail): Promise<EmailDelivery> {
  const configuration = getEmailConfigurationStatus();
  if (!configuration.configured || !configuration.from) return { delivered: false, reason: "not_configured" };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
        "Content-Type": "application/json",
        ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({
        from: configuration.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(process.env.EMAIL_REPLY_TO?.trim() ? { reply_to: process.env.EMAIL_REPLY_TO.trim() } : {}),
      }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error("transactional_email_failed", { status: response.status });
      return { delivered: false, reason: "provider_error" };
    }
    const payload = await response.json().catch(() => null) as { id?: unknown } | null;
    return { delivered: true, ...(typeof payload?.id === "string" ? { id: payload.id } : {}) };
  } catch (error) {
    console.error("transactional_email_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return { delivered: false, reason: "provider_error" };
  }
}
