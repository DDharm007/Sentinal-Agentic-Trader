#!/usr/bin/env python3
"""
ArmorIQ SDK self-test.

Proves the real `armoriq-sdk` package is installed and functioning, and reports
which half of it is usable in this environment:

  * LOCAL   - plan capture shaping, deterministic plan hashing, canonical JSON
              and Ed25519 intent-token verification. No network, no credentials.
  * CLOUD   - capture_plan()/invoke() against the ArmorIQ customer proxy. Needs
              an API key, so it reports NOT CONFIGURED rather than failing when
              credentials are absent.

Emits a single JSON object on stdout so the SENTINEL gateway can render it in
the console. Run directly for a human-readable summary:

    .venv/Scripts/python.exe sdk_selftest.py --pretty
"""

from __future__ import annotations

import json
import os
import platform
import sys
import time
import traceback
from typing import Any, Dict, List

CHECKS: List[Dict[str, Any]] = []


def record(
    name: str,
    scope: str,
    status: str,
    detail: str,
    started: float,
    evidence: Any = None,
    provider: str = None,
) -> None:
    CHECKS.append(
        {
            "name": name,
            "scope": scope,
            "provider": provider,
            "status": status,
            "detail": detail,
            "durationMs": round((time.perf_counter() - started) * 1000, 3),
            "evidence": evidence,
        }
    )


def check(name: str, scope: str = "local", provider: str = None):
    """Run a check, turning any exception into a FAIL row instead of a crash."""

    def wrap(fn):
        started = time.perf_counter()
        try:
            detail, evidence = fn()
            record(name, scope, "PASS", detail, started, evidence, provider)
        except LookupError as exc:
            # A missing optional credential is "not configured", not a failure.
            record(name, scope, "NOT_CONFIGURED", str(exc), started, None, provider)
        except Exception as exc:  # noqa: BLE001 - a failed check is data, not a crash
            record(
                name,
                scope,
                "FAIL",
                f"{type(exc).__name__}: {exc}",
                started,
                {"traceback": traceback.format_exc(limit=3)},
                provider,
            )
        return fn

    return wrap


# --------------------------------------------------------------------------
# The tool calls a SENTINEL agent would declare at plan time.
# --------------------------------------------------------------------------
REFUND_TOOL_CALLS = [
    {"name": "customer.get", "args": {"customerId": "CUST-8821"}},
    {"name": "order.get", "args": {"orderId": "ORD-9942"}},
    {"name": "payment.verify", "args": {"orderId": "ORD-9942"}},
    {"name": "refund.issue", "args": {"orderId": "ORD-9942", "amount": 5000, "currency": "INR"}},
]

sdk_version = None
plan_payload: Dict[str, Any] = {}
plan_hash_value = ""


@check("SDK import", "local")
def _import():
    global sdk_version
    import armoriq_sdk

    sdk_version = armoriq_sdk.__version__
    return (
        f"armoriq_sdk {armoriq_sdk.__version__} imported from {os.path.dirname(armoriq_sdk.__file__)}",
        {"version": armoriq_sdk.__version__, "exports": len(armoriq_sdk.__all__)},
    )


@check("Plan capture shaping", "local")
def _plan_builder():
    global plan_payload
    from armoriq_sdk import build_plan_from_tool_calls

    # SENTINEL tools are dotted (refund.issue), not <MCP>__<action>, so the
    # surface they belong to is supplied explicitly.
    plan_payload = build_plan_from_tool_calls(
        REFUND_TOOL_CALLS,
        goal="Process a customer refund within the authorized monetary limit",
        default_mcp_name="sentinel",
    )
    steps = plan_payload.get("steps") or plan_payload.get("plan") or []
    if not steps:
        raise AssertionError(f"no steps produced; got keys {list(plan_payload)}")
    return (
        f"build_plan_from_tool_calls() shaped {len(steps)} declared steps",
        {"keys": list(plan_payload), "stepCount": len(steps), "sample": steps[:2]},
    )


@check("Deterministic plan hash", "local")
def _plan_hash():
    global plan_hash_value
    from armoriq_sdk import hash_tool_calls

    first = hash_tool_calls(REFUND_TOOL_CALLS)
    again = hash_tool_calls(REFUND_TOOL_CALLS)
    if first != again:
        raise AssertionError("hash_tool_calls is not deterministic")

    tampered = [dict(c) for c in REFUND_TOOL_CALLS]
    tampered[3] = {
        "name": "refund.issue",
        "args": {"orderId": "ORD-9942", "amount": 25000, "currency": "INR"},
    }
    tampered_hash = hash_tool_calls(tampered)
    if tampered_hash == first:
        raise AssertionError("raising the refund amount did not change the plan hash")

    plan_hash_value = first
    return (
        "Stable across runs, and changes when the refund amount is raised 5,000 -> 25,000",
        {"planHash": first, "tamperedHash": tampered_hash},
    )


@check("Canonical JSON", "local")
def _canonical():
    from armoriq_sdk.crypto_verify import canonical_json

    a = canonical_json({"b": 2, "a": 1, "nested": {"y": 2, "x": 1}})
    b = canonical_json({"a": 1, "nested": {"x": 1, "y": 2}, "b": 2})
    if a != b:
        raise AssertionError("key order changed the canonical encoding")
    return (
        "Key order does not affect the signed byte string",
        {"encoded": a.decode("utf-8")},
    )


@check("Ed25519 signature verification", "local")
def _ed25519():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives import serialization
    from armoriq_sdk.crypto_verify import canonical_json, verify_ed25519

    key = Ed25519PrivateKey.generate()
    public_hex = key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    ).hex()

    message = canonical_json({"plan_hash": plan_hash_value or "demo", "amount": 5000})
    signature = key.sign(message).hex()

    if not verify_ed25519(public_hex, message, signature):
        raise AssertionError("a valid signature failed verification")

    forged = canonical_json({"plan_hash": plan_hash_value or "demo", "amount": 25000})
    if verify_ed25519(public_hex, forged, signature):
        raise AssertionError("a tampered payload passed verification")

    return (
        "Valid signature accepted; same signature rejected once the amount is edited",
        {"publicKey": public_hex[:32] + "...", "signature": signature[:32] + "..."},
    )


@check("Intent token verification", "local")
def _intent_token():
    from armoriq_sdk.crypto_verify import verify_intent_token_signature

    # An unsigned/garbage token must be rejected rather than raising.
    result = verify_intent_token_signature({"token_id": "tok_demo", "signature": "00" * 32})
    if result is True:
        raise AssertionError("an unsigned token was accepted")
    return (
        "verify_intent_token_signature() rejects a token with no valid signature",
        {"rejected": True},
    )


@check("ArmorIQ key accepted", "cloud", "armoriq")
def _armoriq_key():
    api_key = os.getenv("ARMORIQ_API_KEY")
    if not api_key:
        # Not a failure: the local enforcement path is what SENTINEL demonstrates.
        raise LookupError(
            "ARMORIQ_API_KEY is not set - cloud capture_plan()/invoke() is unavailable. "
            "Local plan hashing and signature verification are unaffected."
        )
    from armoriq_sdk import ArmorIQClient

    # The SDK validates key format on construction, so a typo is caught here
    # rather than as an opaque failure on the first network call.
    client = ArmorIQClient(
        api_key=api_key,
        user_id=os.getenv("ARMORIQ_USER_ID", "sentinel-console"),
        agent_id=os.getenv("ARMORIQ_AGENT_ID", "agt_refund_01"),
    )
    try:
        return (
            f"Key format accepted by the SDK; client bound to {client.proxy_endpoint}",
            {"proxyEndpoint": str(client.proxy_endpoint), "keyPrefix": api_key[:8] + "..."},
        )
    finally:
        try:
            client.close()
        except Exception:
            pass


@check("ArmorIQ proxy reachable", "cloud", "armoriq")
def _armoriq_proxy():
    api_key = os.getenv("ARMORIQ_API_KEY")
    if not api_key:
        raise LookupError("ARMORIQ_API_KEY is not set - the proxy handshake was not attempted.")
    from armoriq_sdk import ArmorIQClient

    client = ArmorIQClient(
        api_key=api_key,
        user_id=os.getenv("ARMORIQ_USER_ID", "sentinel-console"),
        agent_id=os.getenv("ARMORIQ_AGENT_ID", "agt_refund_01"),
        timeout=12.0,
        max_retries=1,
    )
    try:
        # bootstrap() is the cheapest authenticated round-trip the SDK offers.
        info = client.bootstrap()
        keys = sorted(info.keys()) if isinstance(info, dict) else []
        return (
            f"bootstrap() authenticated against {client.proxy_endpoint}",
            {"responseKeys": keys[:12]},
        )
    finally:
        try:
            client.close()
        except Exception:
            pass


@check("Google Gemini reachable", "cloud", "google")
def _google():
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise LookupError(
            "GOOGLE_API_KEY is not set - live Gemini reasoning is unavailable. "
            "The demo agents run their scripted plans regardless."
        )
    from google import genai

    client = genai.Client(api_key=api_key)
    # Listing models is a real authenticated call, and costs no tokens.
    names = []
    for model in client.models.list():
        name = getattr(model, "name", None)
        if name:
            names.append(name)
        if len(names) >= 60:
            break
    if not names:
        raise AssertionError("the key authenticated but no models were returned")
    return (
        f"Authenticated; {len(names)} models visible to this key",
        {"sample": names[:6]},
    )


def provider_state(provider: str) -> str:
    """Worst-case roll-up across a provider's checks."""
    rows = [c for c in CHECKS if c.get("provider") == provider]
    if not rows:
        return "NOT_CONFIGURED"
    if any(r["status"] == "FAIL" for r in rows):
        return "FAIL"
    if all(r["status"] == "NOT_CONFIGURED" for r in rows):
        return "NOT_CONFIGURED"
    return "PASS"


def main() -> int:
    local = [c for c in CHECKS if c["scope"] == "local"]
    passed = sum(1 for c in local if c["status"] == "PASS")
    payload = {
        "ok": passed == len(local),
        "sdkVersion": sdk_version,
        "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "interpreter": {
            "executable": sys.executable,
            "python": platform.python_version(),
            "platform": platform.platform(),
        },
        "summary": {
            "localPassed": passed,
            "localTotal": len(local),
            "cloudConfigured": any(
                c["scope"] == "cloud" and c["status"] == "PASS" for c in CHECKS
            ),
            "providers": {
                "armoriq": provider_state("armoriq"),
                "google": provider_state("google"),
            },
        },
        "checks": CHECKS,
    }

    if "--pretty" in sys.argv:
        mark = {"PASS": "PASS", "FAIL": "FAIL", "NOT_CONFIGURED": "SKIP"}
        print(f"\nArmorIQ SDK {sdk_version}  ({platform.python_version()})\n")
        for c in CHECKS:
            print(f"  [{mark.get(c['status'], '?'):4}] {c['name']:<32} {c['detail']}")
        print(f"\n  {passed}/{len(local)} local checks passed\n")
    else:
        print(json.dumps(payload, indent=2))

    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
