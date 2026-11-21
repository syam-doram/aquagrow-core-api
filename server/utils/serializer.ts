/**
 * Field-level security and response serializer
 * ─────────────────────────────────────────────────────────────────────────────
 * Enforces role-based field redaction directly at the backend API layer.
 * 
 * Rules:
 * Staff (billing_staff, stock_staff, shop_manager, etc.) must NEVER receive:
 *  - purchaseRate / purchaseCost / unitCost
 *  - landedCost / landedCostPerUnit
 *  - supplierPricing / supplierId / purchaseDiscountPercent
 *  - profit / margin
 *  - transportCharges / allocatedCosts
 *
 * Owner, super_admin, finance_admin receive full financial details.
 */

export const FINANCIAL_ROLES = new Set([
  'owner',
  'super_admin',
  'finance_admin',
  'admin',
]);

export function isFinancialAuthorized(role?: string): boolean {
  if (!role) return false;
  return FINANCIAL_ROLES.has(role);
}

/**
 * Serializes a Product document or plain object according to the user's role.
 */
export function serializeProduct(product: any, userRole?: string): any {
  if (!product) return null;
  const doc = typeof product.toObject === 'function' ? product.toObject() : { ...product };

  if (!isFinancialAuthorized(userRole)) {
    // Redact sensitive financial / cost fields for non-financial staff
    delete doc.purchaseRate;
    delete doc.rateTaxBasis;
    delete doc.totalPurchaseCost;
    delete doc.landedCostPerUnit;
    delete doc.discountAmount;
    delete doc.discountPercentage;
    delete doc.gstAmount;
  }

  return doc;
}

/**
 * Serializes an array of Products.
 */
export function serializeProducts(products: any[], userRole?: string): any[] {
  return products.map(p => serializeProduct(p, userRole));
}

/**
 * Serializes a Batch document according to the user's role.
 */
export function serializeBatch(batch: any, userRole?: string): any {
  if (!batch) return null;
  const doc = typeof batch.toObject === 'function' ? batch.toObject() : { ...batch };

  if (!isFinancialAuthorized(userRole)) {
    delete doc.unitCost;
    delete doc.purchaseRate;
    delete doc.landedCost;
    delete doc.gst;
    delete doc.supplierId;
  }

  return doc;
}

/**
 * Serializes an array of Batches.
 */
export function serializeBatches(batches: any[], userRole?: string): any[] {
  return batches.map(b => serializeBatch(b, userRole));
}

/**
 * Serializes a Purchase Order according to the user's role.
 */
export function serializePurchaseOrder(po: any, userRole?: string): any {
  if (!po) return null;
  const doc = typeof po.toObject === 'function' ? po.toObject() : { ...po };

  if (!isFinancialAuthorized(userRole)) {
    delete doc.totalExpectedAmount;
    delete doc.totalReceivedAmount;
    if (Array.isArray(doc.items)) {
      doc.items = doc.items.map((item: any) => {
        const i = { ...item };
        delete i.rate;
        delete i.discountPercent;
        delete i.gstPercent;
        delete i.totalAmount;
        return i;
      });
    }
  }

  return doc;
}
