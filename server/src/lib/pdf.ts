import PDFDocument from "pdfkit";
import type { Response } from "express";

const PAGE_MARGIN = 40;
const ROW_HEIGHT = 18;

function drawTable(
  doc: PDFKit.PDFDocument,
  columns: { label: string; width: number }[],
  rows: string[][]
) {
  const startX = doc.page.margins.left;
  const usableBottom = doc.page.height - doc.page.margins.bottom;

  function drawHeader() {
    let x = startX;
    const headerY = doc.y;
    doc.font("Helvetica-Bold").fontSize(9);
    for (const col of columns) {
      doc.text(col.label, x, headerY, { width: col.width, ellipsis: true });
      x += col.width;
    }
    doc.y = headerY + ROW_HEIGHT;
    doc
      .moveTo(startX, doc.y)
      .lineTo(startX + columns.reduce((sum, c) => sum + c.width, 0), doc.y)
      .strokeColor("#cccccc")
      .stroke();
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(9);
  }

  drawHeader();

  for (const row of rows) {
    if (doc.y + ROW_HEIGHT > usableBottom) {
      doc.addPage();
      drawHeader();
    }
    let x = startX;
    const rowY = doc.y;
    for (let i = 0; i < columns.length; i++) {
      doc.text(row[i] ?? "", x, rowY, { width: columns[i].width, ellipsis: true });
      x += columns[i].width;
    }
    doc.y = rowY + ROW_HEIGHT;
  }

  // Explicit-position text() calls leave doc.x wherever the last cell was
  // written; reset it to the left margin so subsequent doc.text() calls
  // without an explicit x don't inherit that offset.
  doc.x = startX;
}

export interface MerchantStatementData {
  merchant: { name: string; merchantCode: string; active: boolean; createdAt: string };
  totals: {
    totalReceived: string;
    totalNotReceived: string;
    totalPending: string;
    totalGross: string;
    totalDeduction: string;
    totalNet: string;
  };
  gatewayBreakdown: {
    gatewayName: string;
    received: string;
    notReceived: string;
    pending: string;
    deduction: string;
    net: string;
  }[];
  payments: {
    submittedAt: string;
    gatewayName: string;
    grossAmount: string;
    status: string;
    rateSnapshot: string;
    deductionAmount: string | null;
    netAmount: string | null;
  }[];
}

export function streamMerchantStatementPdf(res: Response, data: MerchantStatementData) {
  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${data.merchant.merchantCode}-statement.pdf"`);
  doc.pipe(res);

  doc.font("Helvetica-Bold").fontSize(18).text("Merchant Statement");
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10).fillColor("#555555");
  doc.text(`Generated ${new Date().toLocaleString()}`);
  doc.moveDown(1);

  doc.fillColor("#000000").font("Helvetica-Bold").fontSize(13).text(data.merchant.name);
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#555555")
    .text(
      `${data.merchant.merchantCode} · ${data.merchant.active ? "Active" : "Inactive"} · Created ${new Date(
        data.merchant.createdAt
      ).toLocaleDateString()}`
    );
  doc.moveDown(1);

  doc.fillColor("#000000").font("Helvetica-Bold").fontSize(11).text("Summary");
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10);
  const summaryLines: [string, string][] = [
    ["Total Received", data.totals.totalReceived],
    ["Total Unreceived", data.totals.totalNotReceived],
    ["Total Pending", data.totals.totalPending],
    ["Total Gross", data.totals.totalGross],
    ["Total Deduction", data.totals.totalDeduction],
    ["Net Amount", data.totals.totalNet],
  ];
  for (const [label, value] of summaryLines) {
    doc.text(`${label}: ${value}`);
  }
  doc.moveDown(1);

  if (data.gatewayBreakdown.length > 0) {
    doc.font("Helvetica-Bold").fontSize(11).text("By Gateway");
    doc.moveDown(0.3);
    drawTable(
      doc,
      [
        { label: "Gateway", width: 110 },
        { label: "Received", width: 80 },
        { label: "Not Received", width: 90 },
        { label: "Pending", width: 80 },
        { label: "Deduction", width: 80 },
        { label: "Net", width: 75 },
      ],
      data.gatewayBreakdown.map((g) => [g.gatewayName, g.received, g.notReceived, g.pending, g.deduction, g.net])
    );
    doc.moveDown(1);
  }

  if (data.payments.length > 0) {
    doc.font("Helvetica-Bold").fontSize(11).text("Payments");
    doc.moveDown(0.3);
    drawTable(
      doc,
      [
        { label: "Date", width: 65 },
        { label: "Gateway", width: 80 },
        { label: "Gross", width: 65 },
        { label: "Status", width: 75 },
        { label: "Rate", width: 45 },
        { label: "Deduction", width: 70 },
        { label: "Net", width: 65 },
      ],
      data.payments.map((p) => [
        new Date(p.submittedAt).toLocaleDateString(),
        p.gatewayName,
        p.grossAmount,
        p.status,
        `${p.rateSnapshot}%`,
        p.deductionAmount ?? "—",
        p.netAmount ?? "—",
      ])
    );
  }

  doc.end();
}

export function streamTableReportPdf(
  res: Response,
  filename: string,
  title: string,
  columns: { label: string; width: number }[],
  rows: string[][]
) {
  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "A4", layout: "landscape" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  doc.font("Helvetica-Bold").fontSize(18).text(title);
  doc.font("Helvetica").fontSize(10).fillColor("#555555").text(`Generated ${new Date().toLocaleString()}`);
  doc.moveDown(1);
  doc.fillColor("#000000");

  drawTable(doc, columns, rows);

  doc.end();
}
