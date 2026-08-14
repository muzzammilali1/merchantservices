import { prisma } from "./prisma";

export interface AuditFieldChange {
  entityType: string;
  entityId: string;
  fieldChanged: string;
  oldValue: string | null;
  newValue: string | null;
  changedById: string;
  note?: string;
}

export function recordAuditChange(change: AuditFieldChange) {
  return prisma.auditLog.create({ data: change });
}
