// sendTestEmail.js
// Usage: node -r dotenv/config scripts/sendTestEmail.js
import { MailerSend, EmailParams, Recipient, Sender } from 'mailersend';

(async () => {
  try {
    const apiKey = process.env.MAILERSEND_API_KEY;
    const fromEmail = process.env.EMAIL_FROM || 'no-reply@example.com';

    if (!apiKey) {
      console.error('MAILERSEND_API_KEY is not set in the environment.');
      process.exit(1);
    }

    const mailer = new MailerSend({ apiKey });

    const recipients = [new Recipient('vineetsahu005@gmail.com', 'Vineet Sahu')];

    const params = new EmailParams()
      .setFrom(new Sender(fromEmail, 'KaamSetu Test'))
      .setTo(recipients)
      .setSubject('KaamSetu — Test email')
      .setHtml('<p>This is a test email from KaamSetu local test script.</p>');

    const res = await mailer.email.send(params);
    console.log('MailerSend response:', res);
    console.log('Test email sent successfully.');
  } catch (err) {
    console.error('Failed to send test email:', err);
    process.exit(1);
  }
})();
