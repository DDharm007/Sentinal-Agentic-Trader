/**
 * MCP tool registry.
 *
 * A tool declares WHAT IT CONSUMES, never whether it is allowed. The capability
 * tuples below are computed from the runtime arguments and from the provenance
 * labels of the artefacts those arguments reference, so the same tool produces
 * different requirements for different calls - which is why the outcome of
 * `external.send` differs between an internal status notification and an
 * external transfer of extracted invoice data.
 */
import type { Requirement, RiskTier } from '../armoriq/capabilities.js';
import {
  archiveInvoice,
  deleteLedgerEntries,
  deliverMessage,
  getCustomer,
  getInvoice,
  getOrder,
  getTicket,
  getVendorByTaxId,
  postLedgerEntry,
  processRefund,
  updateTicket,
} from './sandbox.js';

export interface Artifact {
  id: string;
  dataClass: string;
  producedBy: string;
  summary: string;
  payload: Record<string, unknown>;
}

export interface ToolContext {
  runId: string;
  agentId: string;
  agentName: string;
  planId: string;
  planVersion: number;
  approvalId?: string;
  artifacts: Map<string, Artifact>;
}

export type ToolArgs = Record<string, any>;

export interface ToolResult {
  output: Record<string, unknown>;
  artifact?: Artifact;
  /**
   * Instructions the tool surfaced from untrusted content. The agent planner
   * consumes these - SENTINEL does not, and never treats them as authority.
   */
  plannerDirectives?: { source: string; text: string }[];
}

export interface ToolDescriptor {
  id: string;
  title: string;
  surface:
    | 'mcp.documents'
    | 'mcp.extraction'
    | 'mcp.registry'
    | 'mcp.database'
    | 'mcp.archive'
    | 'mcp.mail'
    | 'mcp.support'
    | 'mcp.payments';
  riskTier: RiskTier;
  testMode: boolean;
  description: string;
  resource(args: ToolArgs, ctx: ToolContext): string;
  requirements(args: ToolArgs, ctx: ToolContext): Requirement[];
  execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult>;
}

let artifactSeq = 0;
function artifactId(prefix: string): string {
  artifactSeq += 1;
  return `art_${prefix}_${artifactSeq.toString().padStart(3, '0')}`;
}

function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at === -1 ? address : address.slice(at + 1).toLowerCase();
}

function referencedArtifacts(args: ToolArgs, ctx: ToolContext): Artifact[] {
  const ids: string[] = Array.isArray(args.attachments) ? args.attachments : [];
  return ids.map((id) => ctx.artifacts.get(id)).filter((a): a is Artifact => Boolean(a));
}

const TOOLS: ToolDescriptor[] = [
  {
    id: 'invoice.read',
    title: 'Read invoice document',
    surface: 'mcp.documents',
    riskTier: 'routine',
    testMode: false,
    description: 'Fetches a source invoice document from the document store.',
    resource: (args) => `document:${args.invoiceId}`,
    requirements: (args) => [
      {
        effect: 'read',
        resource: 'finance.invoice.raw',
        derivedFrom: `document ${args.invoiceId} is classified finance.invoice.raw in the document store`,
      },
    ],
    async execute(args, ctx) {
      const invoice = getInvoice(args.invoiceId);
      if (!invoice) throw new Error(`Document ${args.invoiceId} not found`);
      const artifact: Artifact = {
        id: artifactId('doc'),
        dataClass: 'finance.invoice.raw',
        producedBy: 'invoice.read',
        summary: `Source document ${invoice.id} (${invoice.vendorName})`,
        payload: invoice as unknown as Record<string, unknown>,
      };
      ctx.artifacts.set(artifact.id, artifact);
      return {
        output: {
          invoiceId: invoice.id,
          vendor: invoice.vendorName,
          amount: invoice.amount,
          currency: invoice.currency,
          pages: 1,
          artifactId: artifact.id,
        },
        artifact,
      };
    },
  },
  {
    id: 'invoice.extract',
    title: 'Extract invoice fields',
    surface: 'mcp.extraction',
    riskTier: 'routine',
    testMode: false,
    description: 'Derives structured accounting fields from a source document.',
    resource: (args) => `artifact:${args.sourceArtifactId}`,
    requirements: (args, ctx) => {
      const source = ctx.artifacts.get(args.sourceArtifactId);
      const sourceClass = source?.dataClass ?? 'finance.invoice.raw';
      return [
        {
          effect: 'read',
          resource: sourceClass,
          derivedFrom: `source artefact ${args.sourceArtifactId} carries provenance label ${sourceClass}`,
        },
        {
          effect: 'derive',
          resource: 'finance.invoice.extracted',
          derivedFrom: 'extraction produces a new artefact classified finance.invoice.extracted',
        },
      ];
    },
    async execute(args, ctx) {
      const source = ctx.artifacts.get(args.sourceArtifactId);
      if (!source) throw new Error(`Artefact ${args.sourceArtifactId} not available`);
      const invoice = source.payload as Record<string, any>;
      const fields = {
        invoiceId: invoice.id,
        vendorName: invoice.vendorName,
        vendorTaxId: invoice.vendorTaxId,
        poNumber: invoice.poNumber,
        amount: invoice.amount,
        currency: invoice.currency,
        dueAt: invoice.dueAt,
        bankAccount: invoice.bankAccount,
        lineItemCount: (invoice.lineItems ?? []).length,
      };
      const artifact: Artifact = {
        id: artifactId('ext'),
        dataClass: 'finance.invoice.extracted',
        producedBy: 'invoice.extract',
        summary: `Extracted fields for ${invoice.id} incl. vendor bank reference`,
        payload: fields,
      };
      ctx.artifacts.set(artifact.id, artifact);

      const notes: string = invoice.notes ?? '';
      const directives = notes.trim()
        ? [{ source: `document ${invoice.id} / notes block`, text: notes.trim() }]
        : [];

      return {
        output: { ...fields, artifactId: artifact.id, embeddedInstructions: directives.length },
        artifact,
        plannerDirectives: directives,
      };
    },
  },
  {
    id: 'vendor.verify',
    title: 'Validate vendor record',
    surface: 'mcp.registry',
    riskTier: 'routine',
    testMode: false,
    description: 'Checks the extracted vendor against the approved vendor registry.',
    resource: (args) => `vendor:${args.taxId}`,
    requirements: () => [
      {
        effect: 'read',
        resource: 'finance.vendor.registry',
        derivedFrom: 'lookup targets the approved-vendor master record set',
      },
    ],
    async execute(args) {
      const vendor = getVendorByTaxId(args.taxId);
      return {
        output: vendor
          ? {
              vendor: vendor.name,
              status: vendor.status,
              riskRating: vendor.riskRating,
              bankAccountMatches: vendor.bankAccountOnFile === args.bankAccount,
            }
          : { status: 'NOT_FOUND' },
      };
    },
  },
  {
    id: 'database.update',
    title: 'Post accounting record',
    surface: 'mcp.database',
    riskTier: 'elevated',
    testMode: false,
    description: 'Writes the payable entry to the accounting system of record.',
    resource: () => 'table:ap_ledger',
    requirements: () => [
      {
        effect: 'write',
        resource: 'finance.ledger',
        derivedFrom: 'statement mutates table ap_ledger in the accounting system of record',
      },
    ],
    async execute(args, ctx) {
      const entry = postLedgerEntry({
        id: `LED-${args.invoiceId}`,
        invoiceId: args.invoiceId,
        vendor: args.vendor,
        amount: args.amount,
        currency: args.currency,
        status: 'PAYABLE_SCHEDULED',
        postedAt: new Date().toISOString(),
        postedBy: `${ctx.agentId} / ${ctx.planId} v${ctx.planVersion}`,
      });
      const artifact: Artifact = {
        id: artifactId('rcpt'),
        dataClass: 'finance.invoice.status',
        producedBy: 'database.update',
        summary: `Posting receipt for ${entry.invoiceId} - status only, no payment instrument data`,
        payload: { ledgerId: entry.id, invoiceId: entry.invoiceId, status: entry.status },
      };
      ctx.artifacts.set(artifact.id, artifact);
      return {
        output: { ledgerId: entry.id, status: entry.status, rowsAffected: 1, artifactId: artifact.id },
        artifact,
      };
    },
  },
  {
    id: 'invoice.archive',
    title: 'Archive processed invoice',
    surface: 'mcp.archive',
    riskTier: 'routine',
    testMode: false,
    description: 'Moves the completed document into the retention store.',
    resource: (args) => `archive:${args.invoiceId}`,
    requirements: () => [
      {
        effect: 'append',
        resource: 'finance.archive',
        derivedFrom: 'operation appends to the immutable retention store',
      },
    ],
    async execute(args, ctx) {
      const entry = archiveInvoice({
        invoiceId: args.invoiceId,
        archivedAt: new Date().toISOString(),
        archivedBy: ctx.agentId,
        retention: '7y',
      });
      return { output: { invoiceId: entry.invoiceId, retention: entry.retention } };
    },
  },
  {
    id: 'external.send',
    title: 'Send message',
    surface: 'mcp.mail',
    riskTier: 'critical',
    testMode: true,
    description:
      'Delivers a message through the mail surface. Requirements depend on the recipient and on the provenance of every attached artefact.',
    resource: (args) => `mailbox:${args.to}`,
    requirements: (args, ctx) => {
      const recipients: string[] = [args.to].filter(Boolean);
      const domains = recipients.map(domainOf);
      const attributes = { recipient: recipients, recipientDomain: domains };
      const attached = referencedArtifacts(args, ctx);

      const dataTuples: Requirement[] = attached.map((artifact) => ({
        effect: 'transfer.external',
        resource: artifact.dataClass,
        attributes,
        derivedFrom: `attachment ${artifact.id} carries provenance label ${artifact.dataClass}, produced by ${artifact.producedBy}`,
      }));

      return [
        ...dataTuples,
        {
          effect: 'transfer.external',
          resource: 'channel.external',
          attributes,
          derivedFrom: `message leaves the trust boundary via recipient domain ${domains.join(', ') || 'unknown'}`,
        },
      ];
    },
    async execute(args, ctx) {
      const attached = referencedArtifacts(args, ctx);
      const message = deliverMessage({
        id: `msg_${Date.now().toString(36)}`,
        to: args.to,
        subject: args.subject ?? '(no subject)',
        body: args.body ?? '',
        attachments: attached.map((a) => ({
          artifactId: a.id,
          dataClass: a.dataClass,
          summary: a.summary,
        })),
        sentAt: new Date().toISOString(),
        transport: 'sandbox-smtp (test mode)',
        authorizedBy: {
          planId: ctx.planId,
          planVersion: ctx.planVersion,
          approvalId: ctx.approvalId,
        },
      });
      return {
        output: {
          messageId: message.id,
          to: message.to,
          transport: message.transport,
          attachments: message.attachments.length,
        },
      };
    },
  },
  {
    id: 'customer.get',
    title: 'Retrieve customer record',
    surface: 'mcp.support',
    riskTier: 'routine',
    testMode: false,
    description: 'Fetches verified customer identity, tier, and purchase history from the CRM.',
    resource: (args) => `customer:${args.customerId}`,
    requirements: () => [
      {
        effect: 'read',
        resource: 'support.customer',
        derivedFrom: 'query reads customer master identity and lifetime tier',
      },
    ],
    async execute(args, ctx) {
      const customer = getCustomer(args.customerId);
      if (!customer) throw new Error(`Customer ${args.customerId} not found`);
      const artifact: Artifact = {
        id: artifactId('cust'),
        dataClass: 'support.customer',
        producedBy: 'customer.get',
        summary: `Customer ${customer.id} (${customer.name}, ${customer.tier} Tier)`,
        payload: customer as unknown as Record<string, unknown>,
      };
      ctx.artifacts.set(artifact.id, artifact);
      return { output: { ...customer, artifactId: artifact.id }, artifact };
    },
  },
  {
    id: 'order.get',
    title: 'Fetch order and item details',
    surface: 'mcp.support',
    riskTier: 'routine',
    testMode: false,
    description: 'Retrieves purchase details, line items, and delivery condition reports.',
    resource: (args) => `order:${args.orderId}`,
    requirements: () => [
      {
        effect: 'read',
        resource: 'support.order',
        derivedFrom: 'query reads order transaction and line item condition records',
      },
    ],
    async execute(args, ctx) {
      const order = getOrder(args.orderId);
      if (!order) throw new Error(`Order ${args.orderId} not found`);
      const artifact: Artifact = {
        id: artifactId('ord'),
        dataClass: 'support.order',
        producedBy: 'order.get',
        summary: `Order ${order.id} (Total: ${order.currency} ${order.totalAmount}, Status: ${order.status})`,
        payload: order as unknown as Record<string, unknown>,
      };
      ctx.artifacts.set(artifact.id, artifact);
      return { output: { ...order, artifactId: artifact.id }, artifact };
    },
  },
  {
    id: 'payment.verify',
    title: 'Verify gateway payment status',
    surface: 'mcp.payments',
    riskTier: 'routine',
    testMode: false,
    description: 'Validates settlement status and original charge authorization on the payment gateway.',
    resource: (args) => `payment:${args.paymentTxnId}`,
    requirements: () => [
      {
        effect: 'read',
        resource: 'finance.payment.verify',
        derivedFrom: 'operation checks settlement status on the payment gateway',
      },
    ],
    async execute(args) {
      const order = getOrder(args.orderId);
      const isSettled = order?.paymentTxnId === args.paymentTxnId;
      return {
        output: {
          paymentTxnId: args.paymentTxnId,
          gateway: order?.paymentGateway ?? 'Razorpay / HDFC',
          status: isSettled ? 'SETTLED' : 'NOT_FOUND',
          originalAmount: order?.totalAmount ?? 0,
          currency: order?.currency ?? 'INR',
          refundable: isSettled,
        },
      };
    },
  },
  {
    id: 'refund.issue',
    title: 'Execute payment refund',
    surface: 'mcp.payments',
    riskTier: 'critical',
    testMode: true,
    description:
      'Initiates an irreversible payment refund and ledger reversal through the payment gateway. Subject to parameter-level monetary limits in the signed plan.',
    resource: (args) => `refund:${args.orderId}`,
    requirements: (args) => [
      {
        effect: 'write',
        resource: 'finance.refund',
        attributes: {
          amount: [String(args.amount)],
          currency: [String(args.currency ?? 'INR')],
        },
        derivedFrom: `action attempts to reverse ${args.currency ?? 'INR'} ${args.amount} on payment gateway for order ${args.orderId}`,
      },
    ],
    async execute(args, ctx) {
      const refund = processRefund({
        id: `RFD-${args.orderId}-${Date.now().toString(36).slice(-4).toUpperCase()}`,
        orderId: args.orderId,
        ticketId: args.ticketId,
        customerId: args.customerId ?? 'CUST-8821',
        amount: Number(args.amount),
        currency: args.currency ?? 'INR',
        reason: args.reason ?? 'Customer claimed damaged item on arrival',
        gatewayTxnId: `REV-${Date.now().toString(36)}`,
        status: 'PROCESSED',
        processedAt: new Date().toISOString(),
        processedBy: `${ctx.agentId} / ${ctx.planId} v${ctx.planVersion}`,
        authorizedBy: {
          planId: ctx.planId,
          planVersion: ctx.planVersion,
          approvalId: ctx.approvalId,
        },
      });

      const artifact: Artifact = {
        id: artifactId('rfd'),
        dataClass: 'finance.refund',
        producedBy: 'refund.issue',
        summary: `Refund receipt ${refund.id} for ${refund.currency} ${refund.amount} on ${refund.orderId}`,
        payload: refund as unknown as Record<string, unknown>,
      };
      ctx.artifacts.set(artifact.id, artifact);

      return {
        output: {
          refundId: refund.id,
          orderId: refund.orderId,
          amount: refund.amount,
          currency: refund.currency,
          gatewayTxnId: refund.gatewayTxnId,
          status: refund.status,
          artifactId: artifact.id,
        },
        artifact,
      };
    },
  },
  {
    id: 'ticket.update',
    title: 'Update support ticket',
    surface: 'mcp.support',
    riskTier: 'elevated',
    testMode: false,
    description: 'Records resolution details, refund references, and closes or escalates the ticket.',
    resource: (args) => `ticket:${args.ticketId}`,
    requirements: () => [
      {
        effect: 'write',
        resource: 'support.ticket',
        derivedFrom: 'statement mutates support ticket status and resolution notes',
      },
    ],
    async execute(args) {
      const ticket = updateTicket(args.ticketId, {
        status: args.status ?? 'RESOLVED',
        resolutionNotes: args.resolutionNotes,
      });
      return { output: { ticketId: args.ticketId, status: ticket?.status ?? args.status } };
    },
  },
  {
    id: 'notification.send',
    title: 'Send customer notification',
    surface: 'mcp.mail',
    riskTier: 'routine',
    testMode: true,
    description: 'Dispatches refund confirmation and support ticket closure notice to the customer.',
    resource: (args) => `customer_comm:${args.to}`,
    requirements: (args) => [
      {
        effect: 'transfer.external',
        resource: 'comm.customer',
        attributes: { recipient: [args.to] },
        derivedFrom: `notification message dispatched to customer ${args.to}`,
      },
    ],
    async execute(args, ctx) {
      const message = deliverMessage({
        id: `msg_cust_${Date.now().toString(36)}`,
        to: args.to,
        subject: args.subject ?? 'Update regarding your support request',
        body: args.body ?? '',
        attachments: [],
        sentAt: new Date().toISOString(),
        transport: 'sandbox-smtp (test mode)',
        authorizedBy: {
          planId: ctx.planId,
          planVersion: ctx.planVersion,
          approvalId: ctx.approvalId,
        },
      });
      return { output: { messageId: message.id, to: message.to, status: 'DELIVERED' } };
    },
  },
  {
    id: 'database.delete',
    title: 'Delete accounting records',
    surface: 'mcp.database',
    riskTier: 'critical',
    testMode: true,
    description: 'Removes rows from the accounting system of record.',
    resource: (args) => `table:ap_ledger/${args.invoiceId ?? '*'}`,
    requirements: () => [
      {
        effect: 'delete',
        resource: 'finance.ledger',
        derivedFrom: 'statement destroys rows in the accounting system of record',
      },
    ],
    async execute(args) {
      const removed = deleteLedgerEntries(args.invoiceId);
      return { output: { rowsDeleted: removed } };
    },
  },
  {
    id: 'permission.modify',
    title: 'Modify authority assignment',
    surface: 'mcp.database',
    riskTier: 'critical',
    testMode: true,
    description: 'Alters role or scope assignments in the authority model.',
    resource: (args) => `principal:${args.principal ?? 'unknown'}`,
    requirements: () => [
      {
        effect: 'privilege.modify',
        resource: 'system.permissions',
        derivedFrom: 'operation rewrites the authority model that governs the caller',
      },
    ],
    async execute() {
      return { output: { applied: false } };
    },
  },
];

const byId = new Map(TOOLS.map((t) => [t.id, t]));

export function getTool(id: string): ToolDescriptor | undefined {
  return byId.get(id);
}

export function requireTool(id: string): ToolDescriptor {
  const tool = byId.get(id);
  if (!tool) throw new Error(`Unknown tool ${id}`);
  return tool;
}

export function listTools(): ToolDescriptor[] {
  return TOOLS;
}

export function toolCatalogue(): {
  id: string;
  title: string;
  surface: string;
  riskTier: RiskTier;
  testMode: boolean;
  description: string;
}[] {
  return TOOLS.map(({ id, title, surface, riskTier, testMode, description }) => ({
    id,
    title,
    surface,
    riskTier,
    testMode,
    description,
  }));
}
