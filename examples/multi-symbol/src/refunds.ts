// Refund domain — fixture for repo-edit-bench.
// Three call sites share amount validation; high-value refunds require approval.

export interface Customer {
  id: string;
  tier: "free" | "pro" | "enterprise";
}

export interface RefundRequest {
  customer: Customer;
  amount: number;
  currency: "USD" | "EUR" | "JPY";
  approvedBy?: string;
}

export interface RefundRecord {
  id: string;
  customerId: string;
  amount: number;
  currency: string;
  partial: boolean;
  replayed: boolean;
}

const HIGH_VALUE_USD = 1000;

function requireApprovalIfHighValue(req: RefundRequest): void {
  if (req.amount >= HIGH_VALUE_USD && !req.approvedBy) {
    throw new Error("High-value refund requires approval");
  }
}

let nextId = 1;
function mkId(prefix: string): string {
  return `${prefix}_${nextId++}`;
}

export function createRefund(req: RefundRequest): RefundRecord {
  requireApprovalIfHighValue(req);
  return {
    id: mkId("rf"),
    customerId: req.customer.id,
    amount: req.amount,
    currency: req.currency,
    partial: false,
    replayed: false,
  };
}

export function createPartialRefund(req: RefundRequest, portion: number): RefundRecord {
  const adjusted = { ...req, amount: Math.round(req.amount * portion) };
  requireApprovalIfHighValue(adjusted);
  return {
    id: mkId("rfp"),
    customerId: adjusted.customer.id,
    amount: adjusted.amount,
    currency: adjusted.currency,
    partial: true,
    replayed: false,
  };
}

export function replayRefund(original: RefundRecord, approvedBy?: string): RefundRecord {
  if (original.amount >= HIGH_VALUE_USD && !approvedBy) {
    throw new Error("High-value refund requires approval");
  }
  return { ...original, id: mkId("rfr"), replayed: true };
}
