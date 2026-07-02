/**
 * Mail-order payment emails — category-specific SMTP (traffic fine / damage).
 */
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

const CATEGORY_SMTP_DOC = {
  traffic_fine: 'CH_MAIL_TRAFFIC',
  damage: 'CH_MAIL_DAMAGE',
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPaymentButtonHtml(url, label, amountLabel) {
  const safeUrl = escapeHtml(url);
  const text = amountLabel
    ? `${escapeHtml(label)} &mdash; ${escapeHtml(amountLabel)}`
    : escapeHtml(label);
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0;"><tr><td align="center" style="border-radius:2px;background:#0969da;border:1px solid #0550ae;"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;">${text}</a></td></tr></table>`;
}

function resolveFranchiseSmtpPassword(smtp, franchiseId, category) {
  const fromDoc = String(smtp?.password || smtp?.smtpPassword || '').trim();
  if (fromDoc) return fromDoc;
  const cat = String(category || '').toLowerCase();
  const catEnv =
    cat === 'traffic_fine'
      ? process.env.SMTP_CH_TRAFFIC_PASSWORD
      : cat === 'damage'
        ? process.env.SMTP_CH_DAMAGE_PASSWORD
        : '';
  if (catEnv) return String(catEnv).trim();
  const envKey = `SMTP_${String(franchiseId || 'CH').toUpperCase()}_PASSWORD`;
  return String(process.env[envKey] || process.env.SMTP_PASSWORD || '').trim();
}

async function readMailOrderSmtpConfig(franchiseId, category) {
  const cat = String(category || 'damage').toLowerCase();
  const docId = CATEGORY_SMTP_DOC[cat] || CATEGORY_SMTP_DOC.damage;
  const candidates = [docId, String(franchiseId || 'CH').trim().toUpperCase(), 'CH'];
  for (const candidate of [...new Set(candidates)]) {
    const snap = await admin.firestore().collection('smtpConfigurations').doc(candidate).get();
    if (snap.exists) return snap.data() || null;
  }
  return null;
}

async function downloadStorageAttachment(storagePath) {
  const path = String(storagePath || '').trim();
  if (!path) return null;
  const bucket = admin.storage().bucket();
  const file = bucket.file(path);
  const [buf] = await file.download();
  const name = path.split('/').pop() || 'attachment';
  const [meta] = await file.getMetadata().catch(() => [{ contentType: 'application/octet-stream' }]);
  return {
    filename: name,
    content: buf,
    contentType: meta?.contentType || 'application/octet-stream',
  };
}

function applyTemplate(template, vars) {
  let out = String(template || '');
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(String(value ?? ''));
  }
  return out;
}

/**
 * @param {object} opts
 * @return {Promise<{sent: boolean, message?: string}>}
 */
async function sendMailOrderPaymentEmail(opts) {
  const {
    franchiseId,
    category,
    toEmail,
    customerName,
    resNo,
    mailContent,
    paymentUrl,
    amountCents,
    currency = 'chf',
    subject,
    htmlBody,
    documents = [],
  } = opts;

  const customerEmail = String(toEmail || '').trim();
  if (!customerEmail) {
    return { sent: false, message: 'No customer email' };
  }

  const smtp = await readMailOrderSmtpConfig(franchiseId, category);
  const smtpPassword = smtp ? resolveFranchiseSmtpPassword(smtp, franchiseId, category) : '';
  const fromAddr = String(smtp?.senderEmail || process.env.SMTP_FROM || '').trim();

  if (!smtp || !smtpPassword || !fromAddr) {
    return {
      sent: false,
      message: `SMTP not configured for ${category === 'traffic_fine' ? 'traffic fines' : 'damage'}`,
    };
  }

  const major = ((Number(amountCents) || 0) / 100).toFixed(2);
  const cur = String(currency || 'chf').toUpperCase();
  const amountLabel = `${major} ${cur}`;
  const vars = {
    CUSTOMER_NAME: String(customerName || '').trim() || 'Customer',
    RES_CODE: String(resNo || '').trim() || '—',
    MAIL_CONTENT: String(mailContent || '').trim(),
    AMOUNT: amountLabel,
    PAYMENT_URL: String(paymentUrl || '').trim(),
  };

  const categoryLabel = category === 'traffic_fine' ? 'Traffic fine' : 'Damage';
  const buttonLabel = `Pay — ${vars.RES_CODE}`;
  const buttonHtml = paymentUrl ? buildPaymentButtonHtml(paymentUrl, buttonLabel, amountLabel) : '';

  const finalSubject = applyTemplate(
    subject || `${categoryLabel} payment request — ${vars.RES_CODE}`,
    vars,
  );

  const bodyHtml =
    htmlBody ||
    applyTemplate(
      `<p>Dear {{CUSTOMER_NAME}},</p>
<p>{{MAIL_CONTENT}}</p>
<p>Please use the button below to complete your payment securely.</p>`,
      vars,
    );

  const finalHtml = `${bodyHtml}${buttonHtml}`;
  const finalText = `
Dear ${vars.CUSTOMER_NAME},

${vars.MAIL_CONTENT}

Amount: ${amountLabel}
Pay online: ${vars.PAYMENT_URL}
  `.trim();

  const transporter = nodemailer.createTransport({
    host: String(smtp.host || 'smtp.gmail.com').trim(),
    port: Number(smtp?.port || process.env.SMTP_PORT || 587),
    secure: smtp?.secure === true,
    auth: {
      user: String(smtp?.username || smtp?.user || fromAddr).trim(),
      pass: smtpPassword,
    },
  });

  const mailAttachments = [];
  for (const doc of (Array.isArray(documents) ? documents : []).slice(0, 20)) {
    if (!doc?.storagePath) continue;
    try {
      const att = await downloadStorageAttachment(doc.storagePath);
      if (att) mailAttachments.push(att);
    } catch (e) {
      console.warn('[stripeMailOrderMail] attachment skip', doc.storagePath, e?.message);
    }
  }

  await transporter.sendMail({
    from: fromAddr,
    to: customerEmail,
    subject: finalSubject,
    text: finalText,
    html: finalHtml,
    attachments: mailAttachments,
  });

  return { sent: true, message: 'Email sent' };
}

/**
 * Receipt e-mail after staff charged card directly (no payment link).
 */
async function sendMailOrderReceiptEmail(opts) {
  const {
    franchiseId,
    category,
    toEmail,
    customerName,
    resNo,
    mailContent,
    amountCents,
    currency = 'chf',
    subject,
    htmlBody,
    documents = [],
  } = opts;

  const customerEmail = String(toEmail || '').trim();
  if (!customerEmail) {
    return { sent: false, message: 'No customer email' };
  }

  const smtp = await readMailOrderSmtpConfig(franchiseId, category);
  const smtpPassword = smtp ? resolveFranchiseSmtpPassword(smtp, franchiseId, category) : '';
  const fromAddr = String(smtp?.senderEmail || process.env.SMTP_FROM || '').trim();

  if (!smtp || !smtpPassword || !fromAddr) {
    return {
      sent: false,
      message: `SMTP not configured for ${category === 'traffic_fine' ? 'traffic fines' : 'damage'}`,
    };
  }

  const major = ((Number(amountCents) || 0) / 100).toFixed(2);
  const cur = String(currency || 'chf').toUpperCase();
  const amountLabel = `${major} ${cur}`;
  const vars = {
    CUSTOMER_NAME: String(customerName || '').trim() || 'Customer',
    RES_CODE: String(resNo || '').trim() || '—',
    MAIL_CONTENT: String(mailContent || '').trim(),
    AMOUNT: amountLabel,
  };

  const categoryLabel = category === 'traffic_fine' ? 'Traffic fine' : 'Damage';
  const finalSubject = applyTemplate(
    subject || `${categoryLabel} payment received — ${vars.RES_CODE}`,
    vars,
  );

  const bodyHtml =
    htmlBody ||
    applyTemplate(
      `<p>Dear {{CUSTOMER_NAME}},</p>
<p>{{MAIL_CONTENT}}</p>
<p>We have received your payment of <strong>{{AMOUNT}}</strong>. Thank you.</p>`,
      vars,
    );

  const finalText = `
Dear ${vars.CUSTOMER_NAME},

${vars.MAIL_CONTENT}

Payment received: ${amountLabel}
  `.trim();

  const transporter = nodemailer.createTransport({
    host: String(smtp.host || 'smtp.gmail.com').trim(),
    port: Number(smtp?.port || process.env.SMTP_PORT || 587),
    secure: smtp?.secure === true,
    auth: {
      user: String(smtp?.username || smtp?.user || fromAddr).trim(),
      pass: smtpPassword,
    },
  });

  const mailAttachments = [];
  for (const doc of (Array.isArray(documents) ? documents : []).slice(0, 20)) {
    if (!doc?.storagePath) continue;
    try {
      const att = await downloadStorageAttachment(doc.storagePath);
      if (att) mailAttachments.push(att);
    } catch (e) {
      console.warn('[stripeMailOrderMail] receipt attachment skip', doc.storagePath, e?.message);
    }
  }

  await transporter.sendMail({
    from: fromAddr,
    to: customerEmail,
    subject: finalSubject,
    text: finalText,
    html: bodyHtml,
    attachments: mailAttachments,
  });

  return { sent: true, message: 'Receipt email sent' };
}

module.exports = {
  sendMailOrderPaymentEmail,
  sendMailOrderReceiptEmail,
  buildPaymentButtonHtml,
  CATEGORY_SMTP_DOC,
};
