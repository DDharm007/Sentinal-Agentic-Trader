#!/usr/bin/env python3
"""
Automated Test Suite for SENTINEL / ArmorIQ Control Plane (Problem 1)

Verifies:
  1. Customer Refund Agent: Autonomous execution + Monetary scope hold (INR 25,000 > INR 5,000)
  2. Zero side-effects while held (no database writes before human approval)
  3. Dynamic single-use plan amendment, re-signing, and agent resumption
  4. Safe rejection flow (terminates safely with zero refunds)
  5. Cryptographic tampering detection (tampered plan fails closed with INTEGRITY_FAILED)
  6. Hash-linked audit ledger integrity (SHA-256 chain verification)
"""

import time
import unittest
import httpx

BASE_URL = "http://localhost:8787/api"


class TestArmorIQSentinel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = httpx.Client(base_url=BASE_URL, timeout=10.0)
        res = cls.client.get("/health")
        if res.status_code != 200:
            raise RuntimeError(f"Sentinel Gateway not available at {BASE_URL}")

    def setUp(self):
        # Reset sandbox and control plane state before each test
        self.client.post("/demo/reset")
        time.sleep(0.2)

    def test_01_customer_refund_hold_and_approval_flow(self):
        """Test autonomous execution, cryptographic monetary hold, and post-approval resumption."""
        # 1. Start Customer Refund Run
        start_res = self.client.post("/demo/refund/run", json={"stepDelayMs": 100})
        self.assertEqual(start_res.status_code, 200)
        run_id = start_res.json()["runId"]
        self.assertTrue(run_id.startswith("run_"))

        # 2. Wait for the agent to encounter the ₹25,000 refund and get HELD
        held = False
        for _ in range(40):
            time.sleep(0.2)
            run = self.client.get("/run").json().get("run")
            if run and run.get("status") == "waiting-approval":
                held = True
                break

        self.assertTrue(held, "Agent should be held when attempting ₹25,000 refund (> ₹5,000 limit)")

        # 3. Verify zero side-effects in sandbox database while held
        sandbox_pre = self.client.get("/sandbox").json()
        self.assertEqual(len(sandbox_pre.get("refunds", [])), 0, "No refund record must exist while action is held")

        # 4. Inspect the pending approval request
        approvals = self.client.get("/approvals").json()
        pending = [a for a in approvals if a.get("status") == "PENDING"]
        self.assertGreaterEqual(len(pending), 1)
        approval = pending[0]
        self.assertEqual(approval["tool"], "refund.issue")

        # 5. Human Approves the single-use exception
        decide_res = self.client.post(
            f"/approvals/{approval['id']}/decide",
            json={"verdict": "APPROVE", "approver": "finance-lead@acme.example"},
        )
        self.assertEqual(decide_res.status_code, 200)
        self.assertEqual(decide_res.json().get("status"), "APPROVED")

        # 6. Wait for the agent to resume and complete
        completed = False
        for _ in range(40):
            time.sleep(0.2)
            run = self.client.get("/run").json().get("run")
            if run and run.get("status") == "completed":
                completed = True
                break

        self.assertTrue(completed, "Agent should complete workflow after approval")

        # 7. Verify real side-effects in sandbox database
        sandbox_post = self.client.get("/sandbox").json()
        self.assertEqual(len(sandbox_post.get("refunds", [])), 1, "Real refund record must be created")
        refund = sandbox_post["refunds"][0]
        self.assertEqual(refund["amount"], 25000)
        self.assertEqual(refund["currency"], "INR")
        self.assertEqual(refund["status"], "PROCESSED")

    def test_02_customer_refund_rejection_flow(self):
        """Test that rejecting a held refund safely terminates the workflow without executing."""
        self.client.post("/demo/refund/run", json={"stepDelayMs": 100})

        for _ in range(40):
            time.sleep(0.2)
            run = self.client.get("/run").json().get("run")
            if run and run.get("status") == "waiting-approval":
                break

        pending = [a for a in self.client.get("/approvals").json() if a.get("status") == "PENDING"]
        self.assertGreaterEqual(len(pending), 1)

        # Reject the refund
        decide_res = self.client.post(
            f"/approvals/{pending[0]['id']}/decide",
            json={"verdict": "REJECT", "approver": "fraud-analyst@acme.example"},
        )
        self.assertEqual(decide_res.status_code, 200)
        self.assertEqual(decide_res.json().get("status"), "REJECTED")

        time.sleep(0.4)
        run = self.client.get("/run").json().get("run")
        self.assertEqual(run.get("status"), "terminated")

        # Verify zero side-effects
        sandbox = self.client.get("/sandbox").json()
        self.assertEqual(len(sandbox.get("refunds", [])), 0, "No refund must be processed on rejection")

    def test_03_cryptographic_tamper_detection(self):
        """Test that modifying a signed plan fails closed instantly with INTEGRITY_FAILED."""
        # 1. Deliberately tamper with the signed plan
        tamper_res = self.client.post("/plans/PLN-92A7/integrity", json={"action": "tamper"}).json()
        self.assertFalse(tamper_res.get("signatureValid"))
        self.assertEqual(tamper_res.get("status"), "INTEGRITY FAILED")

        # 2. Attempt tool call under tampered plan
        probe_res = self.client.post(
            "/probe",
            json={"tool": "invoice.read", "invoiceId": "INV-2026-0841", "agentId": "agt_7F92A1"},
        ).json()
        auth = probe_res.get("authorization", {})
        self.assertEqual(auth.get("decision"), "BLOCKED")
        self.assertEqual(auth.get("verification"), "INTEGRITY_FAILED")

        # 3. Restore plan integrity
        restore_res = self.client.post("/plans/PLN-92A7/integrity", json={"action": "restore"}).json()
        self.assertTrue(restore_res.get("signatureValid"))
        self.assertEqual(restore_res.get("status"), "VERIFIED")

    def test_04_audit_chain_cryptographic_integrity(self):
        """Test that the audit ledger maintains a valid SHA-256 hash chain linking all decisions."""
        audit_res = self.client.get("/audit").json()
        self.assertTrue(audit_res.get("chain"), "Audit hash chain must be cryptographically intact")
        self.assertGreater(audit_res.get("total", 0), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
