import { 
  Invoice, 
  InvoiceLineItem, 
  RatedCharge, 
  InvoiceStatus,
  CommercialAuditRecord
} from "../../contracts/billing.js";
import { sumUsd } from "../../contracts/cost-center.js";

export class InvoiceService {
  private invoices = new Map<string, Invoice>();
  private auditLog: CommercialAuditRecord[] = [];

  createDraftInvoice(
    organizationId: string,
    billingAccountId: string,
    subscriptionId: string,
    currency: string,
    periodStart: Date,
    periodEnd: Date
  ): Invoice {
    const invoiceId = `inv_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const invoice: Invoice = {
      invoiceId,
      organizationId,
      billingAccountId,
      subscriptionId,
      status: "DRAFT",
      currency,
      periodStart,
      periodEnd,
      subtotalMinorUnits: 0,
      discountTotalMinorUnits: 0,
      taxTotalMinorUnits: 0,
      creditTotalMinorUnits: 0,
      totalMinorUnits: 0,
      amountDueMinorUnits: 0,
      amountPaidMinorUnits: 0,
      lineItems: []
    };
    this.invoices.set(invoiceId, invoice);
    this.recordAudit(organizationId, "SYSTEM", "INVOICE_CREATED", "Invoice", invoiceId, { status: "DRAFT" });
    return invoice;
  }

  addChargeToInvoice(invoiceId: string, charge: RatedCharge, sourceType: InvoiceLineItem["sourceType"]) {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status !== "DRAFT") throw new Error("Cannot modify non-draft invoice");

    const lineItem: InvoiceLineItem = {
      id: `li_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      description: charge.description,
      quantity: charge.quantity,
      unit: charge.unit,
      unitPriceMinorUnits: charge.unitPriceMinorUnits,
      amountMinorUnits: charge.amountMinorUnits,
      sourceType,
      meterId: charge.meterId,
      periodStart: charge.periodStart,
      periodEnd: charge.periodEnd
    };

    invoice.lineItems.push(lineItem);
    this.recalculateInvoice(invoice);
  }

  addAdjustment(invoiceId: string, amountMinorUnits: number, description: string, isCredit: boolean) {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status !== "DRAFT") throw new Error("Cannot modify non-draft invoice");

    const lineItem: InvoiceLineItem = {
      id: `li_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      description,
      quantity: 1,
      unit: "adjustment",
      unitPriceMinorUnits: amountMinorUnits,
      amountMinorUnits,
      sourceType: isCredit ? "CREDIT" : "ADJUSTMENT",
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd
    };

    invoice.lineItems.push(lineItem);
    this.recalculateInvoice(invoice);
  }

  finalizeInvoice(invoiceId: string): Invoice {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status !== "DRAFT") throw new Error("Invoice already finalized");

    this.recalculateInvoice(invoice);
    invoice.status = "OPEN";
    invoice.issuedAt = new Date();
    // Default due date = 30 days
    invoice.dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    
    this.recordAudit(invoice.organizationId, "SYSTEM", "INVOICE_FINALIZED", "Invoice", invoiceId, { total: invoice.totalMinorUnits });
    return invoice;
  }

  markInvoicePaid(invoiceId: string, amountPaidMinorUnits: number) {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new Error("Invoice not found");
    
    invoice.amountPaidMinorUnits = amountPaidMinorUnits;
    if (invoice.amountPaidMinorUnits >= invoice.amountDueMinorUnits) {
      invoice.status = "PAID";
      invoice.paidAt = new Date();
    }
    this.recordAudit(invoice.organizationId, "SYSTEM", "INVOICE_PAYMENT_APPLIED", "Invoice", invoiceId, { amount: amountPaidMinorUnits, status: invoice.status });
  }

  private recalculateInvoice(invoice: Invoice) {
    // Collect components for exact Kahan summation if necessary, though integer minor units can use plain sum.
    // However, following prompt #38 & existing cost-center, minor units are used. We can just sum safely.
    
    let subtotal = 0;
    let credits = 0;

    for (const li of invoice.lineItems) {
      if (li.sourceType === "CREDIT") {
        credits += Math.abs(li.amountMinorUnits);
      } else {
        subtotal += li.amountMinorUnits;
      }
    }

    invoice.subtotalMinorUnits = subtotal;
    invoice.creditTotalMinorUnits = credits;
    // For now, tax and discounts are 0. (Tax boundary stubbed out per prompt)
    invoice.totalMinorUnits = Math.max(0, subtotal - credits);
    invoice.amountDueMinorUnits = Math.max(0, invoice.totalMinorUnits - invoice.amountPaidMinorUnits);
  }

  private recordAudit(orgId: string, actor: string, action: string, type: string, resId: string, details: any) {
    this.auditLog.push({
      id: `audit_${Date.now()}`,
      organizationId: orgId,
      actor,
      action,
      resourceType: type,
      resourceId: resId,
      timestamp: new Date(),
      details
    });
  }
}

