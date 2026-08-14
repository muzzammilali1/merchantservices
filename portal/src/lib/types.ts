export type UserRole = "ADMIN" | "STAFF";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  mustChangePassword: boolean;
}

export interface Merchant {
  id: string;
  merchantCode: string;
  name: string;
  active: boolean;
}

export interface Gateway {
  id: string;
  name: string;
  active: boolean;
}

export type PaymentStatus = "RECEIVED" | "NOT_RECEIVED" | "PENDING";

export interface CreatedPayment {
  id: string;
  status: PaymentStatus;
  grossAmount: string;
  rateSnapshot: string;
  deductionAmount: string | null;
  netAmount: string | null;
  submittedAt: string;
  merchant: { id: string; name: string; merchantCode: string };
  gateway: { id: string; name: string };
}
