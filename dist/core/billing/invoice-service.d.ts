import { Invoice, InvoiceLineItem, RatedCharge } from "../../contracts/billing.js";
export declare class InvoiceService {
    private invoices;
    private auditLog;
    createDraftInvoice(organizationId: string, billingAccountId: string, subscriptionId: string, currency: string, periodStart: Date, periodEnd: Date): Invoice;
    addChargeToInvoice(invoiceId: string, charge: RatedCharge, sourceType: InvoiceLineItem["sourceType"]): void;
    addAdjustment(invoiceId: string, amountMinorUnits: number, description: string, isCredit: boolean): void;
    finalizeInvoice(invoiceId: string): Invoice;
    markInvoicePaid(invoiceId: string, amountPaidMinorUnits: number): void;
    private recalculateInvoice;
    private recordAudit;
}
