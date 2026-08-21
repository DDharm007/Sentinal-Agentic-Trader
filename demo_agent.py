#!/usr/bin/env python3
"""
SENTINEL - Autonomous Operations Agent CLI (ArmorIQ Problem 1)

Demonstrates autonomous AI agents governed by ArmorIQ:
  - Routine safe actions run autonomously without babysitting.
  - An out-of-scope action is attempted (e.g. monetary threshold exceeded or document injection).
  - ArmorIQ cryptographic verification holds the action BEFORE it touches any tool surface.
  - An operator reviews and approves the held action from the CLI or Web Dashboard.
  - The plan is dynamically amended with a single-use grant, re-signed, and the agent resumes.
"""

import sys
import time
import httpx

GATEWAY_URL = "http://localhost:8787/api"

# ANSI Colors
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
MAGENTA = "\033[95m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def print_banner():
    print(f"""
{CYAN}{BOLD}================================================================================{RESET}
{CYAN}{BOLD}  SENTINEL  -  Autonomous Operations Control Plane (ArmorIQ Problem 1){RESET}
{DIM}  Autonomous, until it shouldn't be: Cryptographic Intent Plan Enforcement{RESET}
{CYAN}{BOLD}================================================================================{RESET}
""")


def wait_for_gateway(client: httpx.Client) -> bool:
    print(f"{DIM}Connecting to SENTINEL Authorization Gateway at {GATEWAY_URL}...{RESET}")
    try:
        res = client.get("/health", timeout=3.0)
        if res.status_code == 200:
            print(f"{GREEN}+ Connected to Gateway (Uptime: {res.json().get('uptimeSeconds', 0)}s){RESET}\n")
            return True
    except Exception:
        pass
    print(f"{RED}x Gateway not reachable at {GATEWAY_URL}. Make sure 'npm run dev' is running.{RESET}\n")
    return False


def run_scenario(client: httpx.Client, scenario: str = "refund"):
    is_refund = scenario == "refund"
    agent_name = "Customer Refund Operations Agent" if is_refund else "Invoice Operations Agent"
    plan_id = "PLN-REFUND-01" if is_refund else "PLN-92A7"

    print(f"{BOLD}--------------------------------------------------------------------------------{RESET}")
    print(f"{CYAN}{BOLD}Running Scenario: {agent_name}{RESET}")
    print(f"{BOLD}--------------------------------------------------------------------------------{RESET}\n")

    # 1. Reset state
    print(f"{BOLD}[1/5] Initializing Sandbox & Resetting Ledger...{RESET}")
    client.post("/demo/reset")
    time.sleep(0.3)
    print(f"{GREEN}+ Clean state established. Cryptographic keys and seed plans ready.{RESET}\n")

    # 2. Inspect Intent Plan
    print(f"{BOLD}[2/5] Inspecting Declared Intent Plan (ArmorIQ capture_plan)...{RESET}")
    plans = client.get("/plans").json()
    plan_doc = next((p for p in plans if p.get("planId") == plan_id), None)
    if plan_doc:
        print(f"  * Plan ID:       {CYAN}{plan_doc['planId']} (v{plan_doc['version']}){RESET}")
        print(f"  * Agent ID:      {plan_doc['agentId']}")
        print(f"  * Intent:        {DIM}{plan_doc['intent'][:90]}...{RESET}")
        print(f"  * Algorithm:     {plan_doc['algorithm']} (Signed over canonical JSON)")
        print(f"  * Signature:     {DIM}{plan_doc['signatureShort']}{RESET}")
        print(f"  * Status:        {GREEN}{plan_doc['status']}{RESET}")
        print(f"  * Grants ({len(plan_doc['grants'])}):")
        for g in plan_doc['grants']:
            constraints_str = f" [constraints: {g.get('constraints')}]" if g.get('constraints') else ""
            print(f"      - {g['effect']} : {g['resource']}{DIM}{constraints_str}{RESET}")
    print()

    # 3. Launch the Agent
    print(f"{BOLD}[3/5] Starting Autonomous Agent Execution Loop...{RESET}")
    start_url = "/demo/refund/run" if is_refund else "/demo/invoice/run"
    start_res = client.post(start_url, json={"stepDelayMs": 800})
    if start_res.status_code != 200:
        print(f"{RED}Failed to start run: {start_res.text}{RESET}")
        return

    print(f"  {CYAN}Agent run ID: {start_res.json().get('runId')}{RESET}")
    print(f"  {DIM}Streaming tool calls through ArmorIQ invoke()...{RESET}\n")

    last_step = -1
    held_approval_id = None

    while True:
        time.sleep(0.3)
        run_data = client.get("/run").json().get("run")
        if not run_data:
            continue

        step = run_data.get("currentStep", 0)
        tot = run_data.get("totalSteps", 6)
        status = run_data.get("status")
        note = run_data.get("note", "")

        if step != last_step or status == "waiting-approval":
            last_step = step
            if status == "running":
                print(f"  [{step}/{tot}] {CYAN}ACTION:{RESET} {note} ... {GREEN}[ALLOWED]{RESET}")
            elif status == "waiting-approval":
                print(f"\n{YELLOW}{BOLD}>>> [GATEWAY HOLD TRIGGERED] <<<{RESET}")
                print(f"  [{step}/{tot}] {MAGENTA}OUT-OF-SCOPE ACTION DETECTED:{RESET} {note}")
                break

    # 4. Handle Held Action
    print(f"\n{BOLD}[4/5] Evaluating Cryptographic Policy Boundary...{RESET}")
    approvals = client.get("/approvals").json()
    pending = [a for a in approvals if a.get("status") == "PENDING"]

    if pending:
        app = pending[0]
        held_approval_id = app["id"]
        auth = app.get("authorization", {})
        print(f"  * Approval Request ID: {CYAN}{held_approval_id}{RESET}")
        print(f"  * Tool:                {app['tool']}")
        print(f"  * Target:              {YELLOW}{app['target']}{RESET}")
        print(f"  * Reason:              {auth.get('reason')}")
        print(f"  * Uncovered Tuples:")
        for uc in auth.get("uncovered", []):
            print(f"      {RED}x {uc.get('requirement', {}).get('effect')} : {uc.get('requirement', {}).get('resource')}{RESET}")
        print(f"\n  {DIM}Note: A keyword filter would NOT catch this, as the tool name is legitimate.{RESET}")
        print(f"  {DIM}ArmorIQ cryptographic verification halted execution BEFORE any byte left the process.{RESET}\n")

        print(f"{BOLD}Human Decision Options:{RESET}")
        print(f"  1) {GREEN}APPROVE{RESET} (Mint single-use grant, re-sign plan, and resume agent)")
        print(f"  2) {RED}REJECT{RESET}  (Deny request and safely terminate workflow)")

        try:
            choice = input(f"\nEnter choice [1/2] (default 1): ").strip() or "1"
        except (KeyboardInterrupt, EOFError):
            choice = "1"

        verdict = "APPROVE" if choice == "1" else "REJECT"
        print(f"\nSubmitting verdict: {BOLD}{verdict}{RESET}...")

        decide_res = client.post(
            f"/approvals/{held_approval_id}/decide",
            json={"verdict": verdict, "approver": "lead-approver@acme.example"},
        )
        print(f"Response: {decide_res.json().get('status')}\n")

    # 5. Monitor Resumption / Completion
    print(f"{BOLD}[5/5] Resuming Workflow & Verifying Sandbox Side Effects...{RESET}")
    while True:
        time.sleep(0.3)
        run_data = client.get("/run").json().get("run")
        if not run_data:
            break
        status = run_data.get("status")
        step = run_data.get("currentStep", 0)
        tot = run_data.get("totalSteps", 6)
        note = run_data.get("note", "")

        if status in ("completed", "terminated", "failed"):
            print(f"  [{step}/{tot}] Final Status: {GREEN if status == 'completed' else RED}{status.upper()}{RESET} - {note}\n")
            break

    # Inspect Sandbox
    sandbox = client.get("/sandbox").json()
    print(f"{CYAN}{BOLD}--- Real Sandbox Side Effects ---{RESET}")
    if is_refund:
        print(f"  * Refunds Processed:  {len(sandbox.get('refunds', []))}")
        for rfd in sandbox.get('refunds', []):
            print(f"      - Refund ID: {rfd['id']} | Order: {rfd['orderId']} | Amount: {rfd['currency']} {rfd['amount']} | Status: {rfd['status']}")
    else:
        print(f"  * Ledger Rows Posted: {len(sandbox.get('ledger', []))}")
        for row in sandbox.get('ledger', []):
            print(f"      - Invoice: {row['invoiceId']} | Vendor: {row['vendor']} | Amount: {row['currency']} {row['amount']}")

    print(f"  * Outbox Messages:    {len(sandbox.get('outbox', []))}")
    for mail in sandbox.get('outbox', []):
        print(f"      - To: {mail['to']} | Subject: {mail['subject']}")

    # Audit chain check
    audit = client.get("/audit").json()
    chain_ok = audit.get("chain", False)
    print(f"\n{CYAN}{BOLD}--- Cryptographic Audit Chain ---{RESET}")
    print(f"  * Total Decision Log Entries: {audit.get('total', 0)}")
    print(f"  * SHA-256 Hash Chain Status:  {GREEN + 'VALID (Intact)' if chain_ok else RED + 'COMPROMISED'}{RESET}\n")


def main():
    print_banner()
    with httpx.Client(base_url=GATEWAY_URL, timeout=10.0) as client:
        if not wait_for_gateway(client):
            sys.exit(1)

        print(f"{BOLD}Select Demo Scenario to Execute:{RESET}")
        print(f"  1) {CYAN}Customer Refund Operations Agent{RESET} (Monetary Limit Gating: INR 5,000 threshold)")
        print(f"  2) {CYAN}Invoice Processing Pipeline{RESET} (Document-Borne Indirect Exfiltration Defense)")
        print(f"  3) {CYAN}Run Both Scenarios Sequentially{RESET}")

        try:
            choice = input(f"\nEnter choice [1/2/3] (default 1): ").strip() or "1"
        except (KeyboardInterrupt, EOFError):
            choice = "1"

        if choice == "2":
            run_scenario(client, "invoice")
        elif choice == "3":
            run_scenario(client, "refund")
            time.sleep(1.0)
            run_scenario(client, "invoice")
        else:
            run_scenario(client, "refund")

        print(f"{GREEN}{BOLD}Demo Finished! View full dashboard at http://localhost:5173{RESET}\n")


if __name__ == "__main__":
    main()
