/**
 * RazorShield AI — outbound mail transport.
 *
 * HONEST CAPABILITY STATEMENT: this sandbox has no SMTP provider and no
 * real email sending is performed. The default "log" transport writes the
 * message (including action links) to the server log and — in
 * non-production only — hands the link back to the API caller so the
 * flow stays usable in development. That development-only disclosure is
 * explicit and never enabled in production builds.
 *
 * Real deployments set MAIL_FROM + an SMTP-capable transport (Phase 2
 * integration — see docs/saas/implementation-roadmap.md). Until a real
 * provider is configured and tested, email delivery is documented as
 * UNVERIFIED — the token system itself is fully implemented and tested.
 */

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
  /** Dev-only: the action URL surfaced to the caller when no SMTP exists. */
  actionUrl?: string;
}

export interface MailSendResult {
  transport: "log";
  /** Non-production only: lets the dev UI complete verify/reset flows. */
  devActionUrl: string | null;
}

export async function sendMail(email: OutboundEmail): Promise<MailSendResult> {
  const isProd = process.env.NODE_ENV === "production";
  const lines = [
    "[mailer:log-transport] (no SMTP configured — message logged, not delivered)",
    `to: ${email.to}`,
    `subject: ${email.subject}`,
    email.body,
  ];
  console.log(lines.join("\n"));
  return { transport: "log", devActionUrl: isProd ? null : (email.actionUrl ?? null) };
}
