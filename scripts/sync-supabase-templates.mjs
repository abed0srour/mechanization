import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const token = process.env.SUPABASE_ACCESS_TOKEN || process.argv[2];
const projectRef = process.env.SUPABASE_PROJECT_REF || process.argv[3] || 'tiremwasgeyivbqqsnrk';

if (!token) {
  console.error('Error: SUPABASE_ACCESS_TOKEN environment variable or CLI argument is required.');
  process.exit(1);
}

const changeEmailPath = path.join(rootDir, 'supabase', 'templates', 'change-email-address.html');
const resetPasswordPath = path.join(rootDir, 'supabase', 'templates', 'reset-password.html');

const changeEmailContent = fs.readFileSync(changeEmailPath, 'utf8');
const resetPasswordContent = fs.readFileSync(resetPasswordPath, 'utf8');

async function syncTemplates() {
  console.log(`Syncing email templates for project ${projectRef}...`);
  const body = {
    mailer_subjects_email_change: 'Confirm your new email address | تأكيد تغيير البريد الإلكتروني',
    mailer_templates_email_change_content: changeEmailContent,
    mailer_subjects_recovery: 'Reset your password | إعادة تعيين كلمة المرور',
    mailer_templates_recovery_content: resetPasswordContent,
  };

  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`Failed to update templates (${response.status}):`, err);
    process.exit(1);
  }

  const result = await response.json();
  console.log('Successfully updated Supabase Auth email templates!');
  console.log('  - Email Change Template:', result.mailer_subjects_email_change);
  console.log('  - Password Reset Template:', result.mailer_subjects_recovery);
}

syncTemplates().catch((err) => {
  console.error('Fatal sync error:', err);
  process.exit(1);
});
