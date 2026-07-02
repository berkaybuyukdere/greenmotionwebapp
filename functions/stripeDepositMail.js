/**
 * Franchise SMTP mail helper for deposit confirmation emails.
 */
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

function resolveFranchiseSmtpPassword(smtp, franchiseId) {
  const fromDoc = String(smtp?.password || smtp?.smtpPassword || '').trim();
  if (fromDoc) return fromDoc;
  const envKey = `SMTP_${String(franchiseId || 'CH').toUpperCase()}_PASSWORD`;
  return String(process.env[envKey] || process.env.SMTP_PASSWORD || '').trim();
}

async function readFranchiseSmtpConfigDoc(docId) {
  const id = String(docId || 'CH').trim().toUpperCase();
  const candidates = [id, id.startsWith('CH') ? 'CH' : id];
  for (const candidate of [...new Set(candidates)]) {
    const snap = await admin.firestore().collection('smtpConfigurations').doc(candidate).get();
    if (snap.exists) return snap.data() || null;
  }
  return null;
}

function applyDepositTemplate(template, vars) {
  let out = String(template || '');
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(String(value ?? ''));
  }
  return out;
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

/**
 * Send deposit-related email after authorization or on staff request.
 * @param {object} opts
 * @return {Promise<{sent: boolean, message?: string}>}
 */
async function sendDepositConfirmationEmail(opts) {
  const {
    franchiseId,
    toEmail,
    subject,
    html,
    text,
    depositRow = {},
    uid,
  } = opts;

  const customerEmail = String(toEmail || depositRow.customerEmail || '').trim();
  if (!customerEmail) {
    return { sent: false, message: 'No customer email' };
  }

  const smtp = await readFranchiseSmtpConfigDoc(franchiseId);
  const smtpPassword = smtp ? resolveFranchiseSmtpPassword(smtp, franchiseId) : '';
  const fromAddr = String(smtp?.senderEmail || process.env.SMTP_FROM || '').trim();

  if (!smtp || !smtpPassword || !fromAddr) {
    return { sent: false, message: 'SMTP not configured' };
  }

  const amountChf = ((Number(depositRow.currentHoldAmount || depositRow.initialAmount || 0) / 100).toFixed(2));
  const resCode = String(depositRow.resCode || depositRow.reference || '').trim();
  const customerName = String(depositRow.customerName || '').trim();

  const vars = {
    CUSTOMER_NAME: customerName || 'Customer',
    RES_CODE: resCode || '—',
    DEPOSIT_AMOUNT: `${amountChf} CHF`,
    PLATE: String(depositRow.plate || '').trim() || '—',
    FRANCHISE_ID: String(franchiseId || depositRow.franchiseId || 'CH').trim(),
  };

  const finalSubject = applyDepositTemplate(
    subject || `Deposit authorization · ${resCode || 'Rental'}`,
    vars,
  );
  const finalHtml = html || `
    <p>Dear ${vars.CUSTOMER_NAME},</p>
    <p>Your rental deposit of <strong>${vars.DEPOSIT_AMOUNT}</strong> has been authorized on your card.</p>
    <p>RES: ${vars.RES_CODE}<br/>Plate: ${vars.PLATE}</p>
  `;
  const finalText = text || `
Deposit authorized: ${vars.DEPOSIT_AMOUNT}
RES: ${vars.RES_CODE}
Customer: ${vars.CUSTOMER_NAME}
Plate: ${vars.PLATE}
  `.trim();

  let transporter;
  try {
    transporter = nodemailer.createTransport({
      host: String(smtp.host || 'smtp.gmail.com').trim(),
      port: Number(smtp?.port || process.env.SMTP_PORT || 587),
      secure: smtp?.secure === true,
      auth: { user: String(smtp?.username || smtp?.user || fromAddr).trim(), pass: smtpPassword },
    });
  } catch (e) {
    return { sent: false, message: e?.message || 'SMTP transport failed' };
  }

  const mailAttachments = [];
  const docList = Array.isArray(depositRow.documents) ? depositRow.documents : [];
  for (const doc of docList.slice(0, 20)) {
    if (!doc?.storagePath) continue;
    try {
      const att = await downloadStorageAttachment(doc.storagePath);
      if (att) mailAttachments.push(att);
    } catch (e) {
      console.warn('[deposit-mail] attachment', doc.storagePath, e?.message || e);
    }
  }

  try {
    await transporter.sendMail({
      from: `"${String(smtp.senderName || 'Green Motion').replace(/"/g, '')}" <${fromAddr}>`,
      to: customerEmail,
      subject: finalSubject,
      text: finalText,
      html: finalHtml,
      attachments: mailAttachments,
    });
    return { sent: true, message: `Sent to ${customerEmail}` };
  } catch (e) {
    console.error('[deposit-mail]', e?.message || e);
    return { sent: false, message: e?.message || 'Send failed' };
  }
}

module.exports = {
  applyDepositTemplate,
  sendDepositConfirmationEmail,
  readFranchiseSmtpConfigDoc,
};
