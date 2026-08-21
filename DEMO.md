# SENTINEL — Hackathon Live Presentation & Demo Guide

> **Automate India Hackathon — ArmorIQ Track (Problem 1)**  
> *Follow this exact 3-5 minute presentation script to deliver a flawless, high-scoring live demo for judges.*

---

## ⏱️ 3–5 Minute Presentation Timeline

### [0:00–0:30] Problem: The Autonomous Agent Dilemma
- **Say**: *"Judges, the greatest blocker to deploying autonomous AI agents in production today is the trust gap. Either we force agents to ask permission for every mundane step — making them useless chatbots — or we give them unrestricted API access, where an indirect prompt injection or logic flaw eventually causes massive financial or data loss."*
- **Action**: Show the SENTINEL Command Center at [http://localhost:5173](http://localhost:5173).

---

### [0:30–1:00] Solution: Cryptographic Intent Plans
- **Say**: *"We built SENTINEL, powered by the ArmorIQ SDK. When our Customer Support Agent starts, it doesn't get naked credentials. It receives an Ed25519-signed Intent Plan (`PLN-REFUND-01`) authorizing routine support operations and refunds up to ₹5,000. Every tool call leaves through ArmorIQ's `invoke()` gateway."*
- **Action**: Navigate to **Intent Plans** tab and show the signed plan `PLN-REFUND-01` with its canonical SHA-256 digest and grant set.

---

### [1:00–1:45] Autonomous Execution (Safe Steps)
- **Say**: *"Let's trigger our Customer Refund Agent. Watch it move fast and autonomously on safe routine tasks."*
- **Action**: Click **"Run Demo"** on Scenario 1.
- **Show**:
  - Step 1: `customer.get` (Priya Sharma, VIP Tier) $\rightarrow$ **ALLOWED (0.8ms)**
  - Step 2: `order.get` (Sony WH-1000XM5 Headphones, damaged in transit) $\rightarrow$ **ALLOWED**
  - Step 3: `payment.verify` (Razorpay/HDFC payment settlement verified) $\rightarrow$ **ALLOWED**

---

### [1:45–2:30] The Contextual Out-of-Scope Action & ArmorIQ Hold
- **Say**: *"Here is where things get critical. The customer's headphones were destroyed in transit, so the agent reasonably determines that a full refund of ₹25,000 is justified. It attempts `refund.issue(amount=25000)`."*
- **Emphasize**: *"Notice: a keyword filter looking for 'refund' or 'delete' would be useless here — `refund.issue` is a legitimate tool! But ArmorIQ evaluates the capability tuple `[write : finance.refund, amount: 25000]` against the signed grant `[maxAmount: 5000]`. It immediately catches the violation and holds the action BEFORE execution."*
- **Proof**: Show that the Sandbox Database (`server/.sandbox/`) contains **0 refund rows**.

---

### [2:30–3:15] Human Approval & Dynamic Single-Use Resumption
- **Say**: *"On our dashboard, an interactive approval card appears with the exact unsatisfied cryptographic tuple. Our Finance Manager reviews the ₹25,000 claim and clicks **APPROVE**."*
- **Action**: Click **"Approve"** on the approval card.
- **Explain**: *"ArmorIQ doesn't bypass security — it mints a single-use exception grant, amends the plan to v2, re-signs it, executes the refund on the sandbox payment gateway, and immediately consumes the exception (v3)."*
- **Show**:
  - Step 5: `ticket.update` $\rightarrow$ **RESOLVED**
  - Step 6: `notification.send` $\rightarrow$ Customer confirmation email delivered to sandbox outbox.

---

### [3:15–3:45] Cryptographic Audit Chain & Tampering Demonstration
- **Say**: *"Finally, every decision is cryptographically anchored in our hash-linked audit chain."*
- **Action**: Open the **Audit Trail** tab, showing the intact SHA-256 chain.
- **Bonus Tamper Demo**: Go to **Intent Plans**, click **"Simulate Malicious Plan Tampering"**, and run a probe — show that the gateway instantly fails closed with `BLOCKED: INTEGRITY_FAILED`.

---

### [3:45–4:00] Conclusion
- **Say**: *"With SENTINEL and ArmorIQ, enterprise AI agents can finally be autonomous without being dangerous. Thank you!"*
