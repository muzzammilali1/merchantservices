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
  createdAt: string;
  updatedAt: string;
}

export interface Gateway {
  id: string;
  name: string;
  active: boolean;
}

export type PaymentStatus = "RECEIVED" | "NOT_RECEIVED" | "PENDING";

export interface Payment {
  id: string;
  merchantId: string;
  gatewayId: string;
  grossAmount: string;
  status: PaymentStatus;
  rateSnapshot: string;
  deductionAmount: string | null;
  netAmount: string | null;
  notes: string | null;
  submittedAt: string;
  gateway: { id: string; name: string };
  createdBy: { id: string; name: string };
}

export interface GatewayBreakdown {
  gatewayId: string;
  gatewayName: string;
  received: string;
  notReceived: string;
  pending: string;
  deduction: string;
  net: string;
}

export interface CurrentRate {
  gatewayId: string;
  gatewayName: string;
  percentage: string;
}

export interface MerchantSummary {
  merchant: Merchant & { createdBy: { id: string; name: string } };
  currentRates: CurrentRate[];
  totals: {
    totalReceived: string;
    totalNotReceived: string;
    totalPending: string;
    totalGross: string;
    totalDeduction: string;
    totalNet: string;
  };
  gatewayBreakdown: GatewayBreakdown[];
}

export interface ReportTotals {
  count: number;
  gross: string;
  received: string;
  notReceived: string;
  pending: string;
  deduction: string;
  net: string;
}

export interface DashboardGatewayBreakdown {
  gatewayId: string;
  gatewayName: string;
  received: string;
  notReceived: string;
  pending: string;
  volume: string;
  deduction: string;
  net: string;
}

export interface DashboardData {
  totalMerchants: number;
  totalGatewayCount: number;
  totals: ReportTotals;
  gatewayBreakdown: DashboardGatewayBreakdown[];
}

export interface MerchantReportRow {
  merchantId: string;
  merchantCode: string;
  name: string;
  active: boolean;
  totals: ReportTotals;
}

export interface GatewayReportRow {
  gatewayId: string;
  name: string;
  active: boolean;
  totals: ReportTotals;
}

export interface ReportFilters {
  merchantId?: string;
  gatewayId?: string;
  status?: PaymentStatus;
  from?: string;
  to?: string;
}

export interface AuditLogEntry {
  id: string;
  entityType: string;
  entityId: string;
  fieldChanged: string;
  oldValue: string | null;
  newValue: string | null;
  note: string | null;
  changedBy: { id: string; name: string };
  changedAt: string;
}
