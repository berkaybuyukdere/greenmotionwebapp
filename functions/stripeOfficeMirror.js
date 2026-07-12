/**
 * Mirror successful Stripe charges into iOS office collections:
 * - traffic_fine → office_operations (Traffic Fine)
 * - damage → traffic_accident_contracts
 * Idempotent on stripePaymentIntentId / stripeMailOrderId.
 */
const crypto = require("crypto");
const admin = require("firebase-admin");

/**
 * @param {string} resNo reservation code
 * @return {string}
 */
function canonicalResCode(resNo) {
  return String(resNo || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
}

/**
 * @return {number} Cocoa reference date seconds
 */
function iosTimeIntervalNow() {
  return (Date.now() -
    new Date("2001-01-01T00:00:00Z").getTime()) / 1000;
}

/**
 * @param {string} category charge category
 * @return {string|null}
 */
function officeTypeForCategory(category) {
  const cat = String(category || "").toLowerCase();
  // iOS OfficeOperationType only has Traffic Fine — damage/accidents
  // land in traffic_accident_contracts (separate hub card).
  if (cat === "traffic_fine") return "Traffic Fine";
  return null;
}

/**
 * @param {string} category charge category
 * @return {string|null}
 */
function normalizeCategory(category) {
  const cat = String(category || "").toLowerCase().trim();
  if (cat === "traffic_fine" || cat === "damage") return cat;
  // walk_in / extra map to damage (same as web UI apiCategory)
  if (cat === "walk_in" || cat === "extra") return "damage";
  return null;
}

/**
 * @param {object} params
 * @param {string} params.franchiseId
 * @param {string} params.category traffic_fine | damage
 * @param {string} [params.resNo]
 * @param {string} [params.customerName]
 * @param {number} params.amountMajor CHF major units
 * @param {string} [params.mailOrderId]
 * @param {string} [params.paymentIntentId]
 * @param {string} [params.source]
 * @return {Promise<object>}
 */
async function recordOfficeOperationForChargeServer(params = {}) {
  const franchiseId = String(params.franchiseId || "")
      .trim().toUpperCase();
  const category = normalizeCategory(params.category);
  if (!franchiseId || !category) {
    return {ok: false, skipped: true};
  }

  const amount = Number(params.amountMajor) || 0;
  const paymentIntentId =
    String(params.paymentIntentId || "").trim() || null;
  const mailOrderId =
    String(params.mailOrderId || "").trim() || null;
  const db = admin.firestore();
  const opsCol = db.collection("franchises")
      .doc(franchiseId)
      .collection("office_operations");
  const officeType = officeTypeForCategory(category);
  let operationId = null;

  if (officeType) {
    try {
      if (paymentIntentId) {
        const existing = await opsCol
            .where("stripePaymentIntentId", "==", paymentIntentId)
            .limit(1)
            .get();
        if (!existing.empty) {
          return {
            ok: true,
            skipped: true,
            reason: "already_mirrored_pi",
          };
        }
      } else if (mailOrderId) {
        const existing = await opsCol
            .where("stripeMailOrderId", "==", mailOrderId)
            .limit(1)
            .get();
        if (!existing.empty) {
          return {
            ok: true,
            skipped: true,
            reason: "already_mirrored_mo",
          };
        }
      }
    } catch (e) {
      console.warn(
          "[stripeOfficeMirror] dedupe query", e && e.message,
      );
    }

    operationId = crypto.randomUUID();
    try {
      await opsCol.doc(operationId).set({
        id: operationId,
        type: officeType,
        date: iosTimeIntervalNow(),
        amount,
        photos: [],
        vehiclePlate: null,
        posCount: null,
        posAmounts: null,
        notes: "",
        isCompleted: false,
        resCode: params.resNo || null,
        referenceNumber: params.resNo || null,
        plate: null,
        customerName: params.customerName || null,
        status: "done",
        washedBy: null,
        washingDate: null,
        source: params.source || "stripe",
        stripeMailOrderId: mailOrderId,
        stripePaymentIntentId: paymentIntentId,
        franchiseId,
      });
    } catch (err) {
      console.warn(
          "[stripeOfficeMirror] office operation failed",
          err && err.message,
      );
      return {ok: false, error: err && err.message};
    }

    if (category !== "damage") {
      return {ok: true, operationId};
    }
  }

  if (category !== "damage") {
    return {ok: true, operationId, skipped: !officeType};
  }

  operationId = operationId || crypto.randomUUID();

  try {
    const canonicalRes = canonicalResCode(params.resNo);
    if (!canonicalRes) return {ok: true, operationId};

    const key = `${franchiseId}|${canonicalRes}|primary`;
    const digest = crypto.createHash("sha256")
        .update(key).digest("hex");
    const docId = `tac_${digest.slice(0, 32)}`;
    const now = admin.firestore.Timestamp.now();
    const contractsCol = db
        .collection("franchises")
        .doc(franchiseId)
        .collection("traffic_accident_contracts");

    const contractBase = {
      photos: [],
      amount,
      resCode: canonicalRes,
      paidAmount: amount,
      createdAt: now,
      createdTs: now,
      contractIssueDate: now,
      processedDate: now,
      franchiseId,
      createdByName: "Stripe",
      paymentMethod: "officePayment",
      linkedPaymentOfficeOperationDocumentId: operationId,
      source: params.source || "stripe",
      stripePaymentIntentId: paymentIntentId,
    };

    const primaryRef = contractsCol.doc(docId);
    const existing = await primaryRef.get();
    if (!existing.exists) {
      await primaryRef.set({
        ...contractBase,
        id: crypto.randomUUID(),
        documentId: docId,
        idempotencyKey: key,
      });
    } else {
      const supplementDocId = crypto.randomUUID();
      await contractsCol.doc(supplementDocId).set({
        ...contractBase,
        id: supplementDocId,
        documentId: supplementDocId,
        supplementOfDocumentId: docId,
      });
    }
  } catch (err) {
    console.warn(
        "[stripeOfficeMirror] traffic accident contract failed",
        err && err.message,
    );
  }

  return {ok: true, operationId};
}

module.exports = {
  recordOfficeOperationForChargeServer,
  normalizeCategory,
  officeTypeForCategory,
};
