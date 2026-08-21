# SENTINEL — Technical Architecture & Cryptographic Security Model

## 1. System Overview

**SENTINEL** is structured around the principle of **Separation of Reasoning and Authority**:
- The **LLM / Agent** is a reasoning engine that proposes actions.
- The **ArmorIQ Gateway** is a deterministic, non-bypassable cryptographic gateway that enforces authorization.
- The **Tool Surfaces** execute side-effects *only* when authorized by a cryptographically verified signed plan.

---

## 2. Core Cryptographic Concepts

### 2.1 The Signed Intent Plan (`PlanDocument`)
An intent plan is a canonical JSON document that binds an agent identity to a declared intent, validity window, and set of capability grants:

$$\text{digest} = \text{SHA-256}(\text{canonical}(\text{PlanDocument}))$$
$$\text{signature} = \text{Sign}_{\text{KMS}}(\text{algorithm}, \text{digest})$$

```typescript
export interface PlanDocument {
  planId: string;
  agentId: string;
  intent: string;
  grants: Grant[];
  declaredSteps: { tool: string; summary: string }[];
  issuedAt: string;
  expiresAt: string;
  version: number;
  previousDigest: string | null;
  amendment?: {
    reason: string;
    approvalId: string;
    grants: Grant[];
    singleUse: boolean;
    approver: string;
  };
}
```

### 2.2 Capability Tuples & Set-Coverage Governance
Every tool invocation dynamically derives the **Required Capability Tuples** from its runtime arguments:

$$\text{Requirement} = (\text{Effect}, \text{Resource}, \text{Attributes})$$

For example, when `refund.issue(orderId="ORD-9942", amount=25000)` is called, the required tuple is:
```json
{
  "effect": "write",
  "resource": "finance.refund",
  "attributes": {
    "amount": ["25000"],
    "currency": ["INR"]
  }
}
```

The authorization engine evaluates whether every required tuple is **covered** by at least one grant in the signed plan.
- If a numeric constraint like `maxAmount: ["5000"]` is present in the grant, and the presented attribute is `25000`, the set coverage algorithm marks the requirement as **UNSATISFIED (CONSTRAINT FAILURE)**.

---

## 3. The Hold, Approval, and Resumption Lifecycle

```
[Agent emits Tool Call]
          │
          ▼
   [invoke() Gateway]
          │
          ├──► 1. Verify Plan Signature & Expiry (Fails closed on tamper)
          ├──► 2. Derive Runtime Requirements
          ├──► 3. Check Grant Set Coverage
          │
          ├── [ALL TUPLES COVERED] ────────► Forward to Tool Surface ──► Log ALLOWED
          │
          └── [TUPLES UNCOVERED]
                    │
                    ▼
          [Enter HELD State] ──► (0 bytes written to Sandbox Surface)
                    │
                    ▼
          [Create Approval Request in Dashboard]
                    │
           ┌────────┴────────┐
           ▼                 ▼
      [ REJECT ]        [ APPROVE ]
           │                 │
           ▼                 ▼
   [Terminate Run]     [Dynamic Plan Amendment]
   [₹0 refunded]       • Mint single-use grant
                       • Plan Version v1 -> v2
                       • Re-sign with Ed25519/HMAC
                       • Re-authorize & Execute Tool
                       • Consume Single-Use Grant (v3)
                       • Resume Autonomous Agent Loop
```

---

## 4. Tamper-Evident Hash-Linked Audit Chain

Every decision emitted by SENTINEL commits to the digest of the preceding audit record:

$$\text{entryDigest}_{n} = \text{SHA-256}(\text{entryDigest}_{n-1} + \text{canonical}(\text{AuditEvent}_{n}))$$

This provides a tamper-evident audit ledger that can be verified independently by external auditors or regulators.
