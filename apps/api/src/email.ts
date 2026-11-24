import nodemailer from 'nodemailer';

export function createAccountMailer(production: boolean) {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.MAIL_FROM?.trim();
  if (!host && !from && !production) return null;
  if (!host || !from) throw new Error('Set SMTP_HOST and MAIL_FROM to enable account email.');

  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set SMTP_PORT to a valid port.');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (Boolean(user) !== Boolean(pass)) throw new Error('Set both SMTP_USER and SMTP_PASSWORD for authenticated SMTP.');
  const secure = port === 465;
  const transport = nodemailer.createTransport({
    host, port, secure, requireTLS: production && !secure, auth: user && pass ? { user, pass } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000
  });

  return async function sendAccountLink(to: string, subject: string, instruction: string, url: string) {
    try {
      await transport.sendMail({
        from, to, subject,
        text: `${instruction}\n\n${url}\n\nThis link expires in one hour. If you did not request this, you can ignore this email.\n\nLinkedup Pro`
      });
    } catch {
      // SMTP errors can contain message contents or credentials in their responses.
      console.error('Linkedup Pro could not deliver an account email. Check SMTP delivery and credentials.');
    }
  };
}
