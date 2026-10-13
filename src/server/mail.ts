import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/server/env";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | undefined;

/**
 * Sends mail over SMTP when SMTP_URL is set (Mailpit locally). Otherwise writes the
 * message as JSON to MAIL_OUTBOX_DIR so development and tests need no mail server.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  const { SMTP_URL, MAIL_FROM, MAIL_OUTBOX_DIR, NODE_ENV, EIGHTCORE_ALLOW_FILE_MAIL } = env();
  if (SMTP_URL) {
    transporter ??= nodemailer.createTransport(SMTP_URL);
    await transporter.sendMail({ from: MAIL_FROM, ...message });
    return;
  }
  if (NODE_ENV === "production" && EIGHTCORE_ALLOW_FILE_MAIL !== "1") {
    throw new Error("SMTP_URL must be set in production");
  }
  const dir = path.resolve(MAIL_OUTBOX_DIR);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${randomUUID()}.json`);
  await writeFile(
    file,
    JSON.stringify({ from: MAIL_FROM, sentAt: new Date().toISOString(), ...message }, null, 2),
  );
  console.info(
    `[mail] "${message.subject}" → ${message.to} (written to ${path.relative(process.cwd(), file)})`,
  );
}

/** Plain, brand-consistent email body. Links are the only dynamic content. */
export function actionEmail(opts: { heading: string; body: string; actionLabel: string; url: string }) {
  const text = `${opts.heading}\n\n${opts.body}\n\n${opts.actionLabel}: ${opts.url}\n\n— Eightcore`;
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#FAF8F5;color:#17171A;padding:32px">
<div style="max-width:480px;margin:auto;background:#fff;border:1px solid #E7E2DA;border-radius:12px;padding:32px">
<p style="font-weight:600;letter-spacing:.08em;color:#8A6F3E;margin:0 0 24px">EIGHTCORE</p>
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(opts.heading)}</h1>
<p style="line-height:1.5;margin:0 0 24px">${escapeHtml(opts.body)}</p>
<a href="${escapeHtml(opts.url)}" style="display:inline-block;background:#17171A;color:#FAF8F5;padding:10px 18px;border-radius:8px;text-decoration:none">${escapeHtml(opts.actionLabel)}</a>
</div></body></html>`;
  return { text, html };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
