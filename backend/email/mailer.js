const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { compile } = require('handlebars');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function getKey() {
  const secret = process.env.APP_SECRET || process.env.SECRET || 'dev_secret_please_change';
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(IV_LEN);
  const key = getKey();
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(payload) {
  if (!payload) return '';
  const data = Buffer.from(payload, 'base64');
  const iv = data.slice(0, IV_LEN);
  const tag = data.slice(IV_LEN, IV_LEN + 16);
  const enc = data.slice(IV_LEN + 16);
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(enc), decipher.final()]);
  return decrypted.toString('utf8');
}

function resolvePassword(storedValue) {
  if (!storedValue || storedValue === '*****') return '';
  try {
    return decrypt(storedValue);
  } catch (err) {
    return storedValue;
  }
}

async function createTransportFromSettings(settings) {
  // settings: { provider, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure }
  const provider = (settings.provider || process.env.MAIL_PROVIDER || process.env.OTP_EMAIL_PROVIDER || 'smtp').toLowerCase();
  const pass = resolvePassword(settings.smtp_pass) || process.env.OTP_SMTP_PASS || process.env.SMTP_PASS || '';
  const resolvedUser = settings.smtp_user || process.env.OTP_SMTP_USER || process.env.SMTP_USER || settings.sender_email || '';
  const resolvedHost = settings.smtp_host || process.env.OTP_SMTP_HOST || process.env.SMTP_HOST || undefined;
  const resolvedPort = Number(settings.smtp_port || process.env.OTP_SMTP_PORT || process.env.SMTP_PORT || 587) || undefined;
  const secure = typeof settings.smtp_secure === 'boolean'
    ? settings.smtp_secure
    : provider === 'gmail'
      ? true
      : resolvedPort === 465;

  const baseOpts = {
    host: resolvedHost || undefined,
    port: resolvedPort,
    secure,
    auth: resolvedUser ? { user: resolvedUser, pass } : undefined,
    tls: { rejectUnauthorized: false }
  };

  let opts = { ...baseOpts };

  if (provider === 'gmail') {
    opts = {
      service: 'gmail',
      auth: { user: resolvedUser || settings.sender_email, pass }
    };
  } else if (provider === 'sendgrid') {
    opts = {
      host: resolvedHost || 'smtp.sendgrid.net',
      port: resolvedPort || 587,
      secure: false,
      auth: {
        user: resolvedUser || 'apikey',
        pass: pass || process.env.SENDGRID_API_KEY || ''
      },
      tls: { rejectUnauthorized: false }
    };
  } else if (provider === 'resend') {
    opts = {
      host: resolvedHost || 'smtp.resend.com',
      port: resolvedPort || 587,
      secure: false,
      auth: {
        user: resolvedUser || 'resend',
        pass: pass || process.env.RESEND_API_KEY || ''
      },
      tls: { rejectUnauthorized: false }
    };
  } else if (provider === 'mailgun') {
    opts = {
      host: resolvedHost || 'smtp.mailgun.org',
      port: resolvedPort || 587,
      secure: false,
      auth: {
        user: resolvedUser || settings.sender_email || 'postmaster@mg.yourdomain.com',
        pass: pass || process.env.MAILGUN_SMTP_PASSWORD || ''
      },
      tls: { rejectUnauthorized: false }
    };
  } else if (provider === 'ses' || provider === 'amazon ses' || provider === 'aws ses') {
    opts = {
      host: resolvedHost || 'email-smtp.us-east-1.amazonaws.com',
      port: resolvedPort || 587,
      secure: false,
      auth: {
        user: resolvedUser || '',
        pass: pass || ''
      },
      tls: { rejectUnauthorized: false }
    };
  }

  const transporter = nodemailer.createTransport(opts);
  try {
    await transporter.verify();
  } catch (err) {
    // don't throw here; caller may want to report status
  }
  return transporter;
}

async function sendMail(settings, opts) {
  const transporter = await createTransportFromSettings(settings);
  const merged = {
    from: `${settings.sender_name || ''} <${settings.sender_email || settings.smtp_user || 'no-reply@localhost'}>`,
    ...opts
  };
  return transporter.sendMail(merged);
}

function renderTemplate(body, data) {
  try {
    const tmpl = compile(body || '');
    return tmpl(data || {});
  } catch (err) {
    return body || '';
  }
}

module.exports = { encrypt, decrypt, createTransportFromSettings, sendMail, renderTemplate };
