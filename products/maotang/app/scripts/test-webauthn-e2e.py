#!/usr/bin/env python3
"""Mobile WebAuthn and claim-route simulation for the MAOTANG PWA.

This is intentionally a browser test. The failure that motivated it only appears when the real
client capability probe, system credential call, serialization and claim route are wired together.
Chromium's CTAP2 virtual authenticator supplies a platform credential and user verification without
pretending that a JavaScript boolean is an assertion.

The suite covers:

1. A false-negative UVPAA probe must not stop an explicit enrollment attempt.
2. A platform credential must complete registration and a server challenge assertion.
3. A cancelled assertion must not POST to the claim route.
4. The claim route must receive the WebAuthn response and report the unconfigured local faucet honestly.
5. A local credential inherited without its server enrollment cookie must be cleared and re-enrolled.

Run against an already configured local dev server:

    python scripts/test-webauthn-e2e.py --base-url http://localhost:3000

Or let the script launch an isolated Next dev server with synthetic WebAuthn configuration:

    python scripts/test-webauthn-e2e.py

The script requires Playwright's Python package and a Chromium binary. It never prints or writes the
ephemeral WebAuthn secret.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import expect, sync_playwright


APP_ROOT = Path(__file__).resolve().parents[1]
STORAGE_KEY = "maotang.web.owner.credential.v1"
ENROLL_LABEL = "Create a Face ID credential first"
CLAIM_LABEL = "Claim 10 MAOTANG with Face ID"


class SimulationFailure(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SimulationFailure(message)


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_for_http(url: str, process: subprocess.Popen[bytes], timeout: float = 120.0) -> None:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise SimulationFailure(f"Next dev exited before becoming ready (code {process.returncode})")
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 500:
                    return
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
        time.sleep(0.5)
    raise SimulationFailure(f"Next dev did not become ready at {url}: {last_error}")


def start_dev_server() -> tuple[str, subprocess.Popen[bytes]]:
    node = os.environ.get("MAOTANG_NODE") or shutil.which("node")
    if not node:
        raise SimulationFailure("node was not found; set MAOTANG_NODE or add Node.js to PATH")
    next_cli = APP_ROOT / "node_modules" / "next" / "dist" / "bin" / "next"
    if not next_cli.exists():
        raise SimulationFailure(f"Next CLI is missing at {next_cli}; install app dependencies first")

    port = free_port()
    origin = f"http://localhost:{port}"
    env = os.environ.copy()
    env.update(
        {
            "MAOTANG_WEBAUTHN_SECRET": secrets.token_hex(32),
            "MAOTANG_WEBAUTHN_RP_ID": "localhost",
            "MAOTANG_WEBAUTHN_EXPECTED_ORIGIN": origin,
            "MAOTANG_SECURITY_HOLD": "0",
            "MAOTANG_GROWTH_ALLOW_EPHEMERAL": "1",
            "NEXT_PUBLIC_MAOTANG_RPC_URL": "http://127.0.0.1:9",
            "NEXT_TELEMETRY_DISABLED": "1",
        }
    )
    for key in (
        "MAOTANG_FAUCET_RPC_URL",
        "MAOTANG_FAUCET_CHAIN_ID",
        "MAOTANG_FAUCET_PRIVATE_KEY",
        "MAOTANG_FAUCET_TOKEN_ADDRESS",
        "MAOTANG_FAUCET_CONTRACT_ADDRESS",
    ):
        env.pop(key, None)

    command = [node, str(next_cli), "dev", "--hostname", "localhost", "--port", str(port)]
    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    process = subprocess.Popen(
        command,
        cwd=APP_ROOT,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creationflags,
    )
    wait_for_http(f"{origin}/api/agent/status", process)
    return origin, process


def stop_dev_server(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


def add_virtual_authenticator(context: Any) -> tuple[Any, str]:
    page = context.pages[0]
    cdp = context.new_cdp_session(page)
    cdp.send("WebAuthn.enable")
    result = cdp.send(
        "WebAuthn.addVirtualAuthenticator",
        {
            "options": {
                "protocol": "ctap2",
                "transport": "internal",
                "hasResidentKey": True,
                "hasUserVerification": True,
                "isUserVerified": True,
                "automaticPresenceSimulation": True,
            }
        },
    )
    return cdp, str(result["authenticatorId"])


def virtual_credentials(cdp: Any, authenticator_id: str) -> list[dict[str, Any]]:
    result = cdp.send("WebAuthn.getCredentials", {"authenticatorId": authenticator_id})
    credentials = result.get("credentials", [])
    require(isinstance(credentials, list), "virtual authenticator returned malformed credentials")
    return credentials


def response_json(response: Any, label: str) -> dict[str, Any]:
    try:
        payload = response.json()
    except Exception as error:  # Playwright raises different JSON errors across versions.
        raise SimulationFailure(f"{label} did not return JSON: {error}") from error
    require(isinstance(payload, dict), f"{label} returned a non-object JSON body")
    return payload


def run_simulation(base_url: str, headed: bool) -> None:
    page_errors: list[str] = []
    api_responses: list[tuple[str, int]] = []
    claim_posts: list[Any] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=not headed)
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            is_mobile=True,
            has_touch=True,
            locale="en-US",
            user_agent=(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
            ),
        )
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        def on_response(response: Any) -> None:
            if "/api/agent/" in response.url:
                api_responses.append((response.url, response.status))

        def on_request(request: Any) -> None:
            if request.method == "POST" and request.url.endswith("/api/agent/claim"):
                claim_posts.append(request)

        page.on("response", on_response)
        page.on("request", on_request)

        # Reproduce the mobile false negative that hid the biometric controls in production.
        page.add_init_script(
            """
            Object.defineProperty(
              PublicKeyCredential,
              "isUserVerifyingPlatformAuthenticatorAvailable",
              { configurable: true, value: async () => false }
            );
            """
        )

        cdp, authenticator_id = add_virtual_authenticator(context)
        page.goto(f"{base_url}/dechat?ref=alpha", wait_until="domcontentloaded", timeout=60_000)

        enroll = page.get_by_role("button", name=ENROLL_LABEL)
        try:
            enroll.wait_for(state="visible", timeout=45_000)
        except PlaywrightTimeoutError as error:
            raise SimulationFailure(
                "false-negative UVPAA still hid the enrollment control; Face ID can never be invoked"
            ) from error
        expect(enroll).to_be_enabled(timeout=15_000)
        print("PASS false-negative UVPAA preserves the explicit enrollment path")

        with page.expect_response(
            lambda response: response.url.endswith("/api/agent/webauthn/register/verify"),
            timeout=45_000,
        ) as registration_response:
            enroll.click()
        verify_response = registration_response.value
        verify_payload = response_json(verify_response, "registration verify")
        require(verify_response.status == 200, f"registration verify returned HTTP {verify_response.status}")
        require(verify_payload.get("ok") is True, "registration verify refused the attestation")
        require(
            verify_payload.get("enrollment", {}).get("userVerified") is True,
            "virtual platform authenticator did not produce a user-verified enrollment",
        )

        credentials = virtual_credentials(cdp, authenticator_id)
        require(len(credentials) == 1, f"expected one virtual credential after enrollment, found {len(credentials)}")
        credential_id = str(credentials[0].get("credentialId") or credentials[0].get("id") or "")
        require(credential_id != "", "virtual credential id was missing")
        stored_id = page.evaluate("key => localStorage.getItem(key)", STORAGE_KEY)
        require(isinstance(stored_id, str) and stored_id != "", "the browser stored no credential id")
        print("PASS CTAP2 platform enrollment reached the server and stored the verified credential")

        claim = page.get_by_role("button", name=CLAIM_LABEL)
        expect(claim).to_be_enabled(timeout=45_000)

        # A dismissed prompt must fail closed before the claim request is sent.
        posts_before_cancel = len(claim_posts)
        page.evaluate(
            """
            () => {
              const original = navigator.credentials.get.bind(navigator.credentials);
              window.__maotangOriginalGet = original;
              navigator.credentials.get = () =>
                Promise.reject(new DOMException("user cancelled", "NotAllowedError"));
            }
            """
        )
        claim.click()
        page.get_by_text("Claim request failed: USER_CANCELLED").wait_for(timeout=15_000)
        require(
            len(claim_posts) == posts_before_cancel,
            "a cancelled biometric prompt still reached the claim API",
        )
        print("PASS cancelled WebAuthn assertion remains fail-closed")

        page.evaluate(
            """
            () => {
              navigator.credentials.get = window.__maotangOriginalGet;
              delete window.__maotangOriginalGet;
            }
            """
        )
        expect(claim).to_be_enabled(timeout=45_000)
        sign_count_before = int(virtual_credentials(cdp, authenticator_id)[0].get("signCount", 0))

        with page.expect_response(
            lambda response: response.request.method == "POST"
            and response.url.endswith("/api/agent/claim"),
            timeout=45_000,
        ) as claim_response:
            claim.click()
        claim_http = claim_response.value
        claim_payload = response_json(claim_http, "claim route")
        claim_body = claim_http.request.post_data_json
        require(isinstance(claim_body, dict), "claim request did not carry a JSON object")
        assertion = claim_body.get("assertion")
        require(isinstance(assertion, dict), "claim request carried no WebAuthn assertion")
        require(assertion.get("id") == stored_id, "claim assertion was for a different credential")
        require(assertion.get("type") == "public-key", "claim assertion was not a public-key credential")
        response = assertion.get("response")
        require(isinstance(response, dict), "claim assertion carried no response payload")
        for field in ("clientDataJSON", "authenticatorData", "signature"):
            require(
                isinstance(response.get(field), str) and response[field] != "",
                f"claim assertion omitted {field}",
            )
        require(claim_body.get("referral") == "alpha", "referral attribution was not serialized")
        require(claim_http.status == 503, f"unconfigured local faucet returned HTTP {claim_http.status}")
        require(
            claim_payload.get("code") == "FAUCET_UNCONFIGURED",
            f"local faucet refusal was not explicit: {claim_payload.get('code')}",
        )

        credentials_after_claim = virtual_credentials(cdp, authenticator_id)
        sign_count_after = int(credentials_after_claim[0].get("signCount", 0))
        require(
            sign_count_after > sign_count_before,
            "claim did not produce a fresh authenticator signature",
        )
        page.get_by_text("Claim request failed: FAUCET_UNCONFIGURED").wait_for(timeout=15_000)
        print("PASS server challenge assertion reached POST /api/agent/claim with a fresh signature")
        print("PASS unconfigured faucet is reported honestly instead of fabricating a transaction")

        # Simulate browser storage outliving the sealed server enrollment cookie.
        local_id_before = page.evaluate("key => localStorage.getItem(key)", STORAGE_KEY)
        require(local_id_before is not None, "the pre-stale simulation had no local credential")
        context.clear_cookies()
        with page.expect_response(
            lambda response: response.url.endswith("/api/agent/claim/challenge")
            and response.request.method == "GET",
            timeout=45_000,
        ) as stale_response:
            page.reload(wait_until="domcontentloaded", timeout=60_000)
        require(stale_response.value.status == 409, "stale enrollment did not produce ENROLLMENT_REQUIRED")
        stale_payload = response_json(stale_response.value, "claim challenge")
        require(
            stale_payload.get("code") == "ENROLLMENT_REQUIRED",
            "stale enrollment returned the wrong server code",
        )
        enroll_again = page.get_by_role("button", name=ENROLL_LABEL)
        enroll_again.wait_for(state="visible", timeout=45_000)
        page.wait_for_function(
            "key => localStorage.getItem(key) === null",
            arg=STORAGE_KEY,
            timeout=15_000,
        )
        print("PASS ENROLLMENT_REQUIRED clears a stale local credential and reopens enrollment")

        with page.expect_response(
            lambda response: response.url.endswith("/api/agent/webauthn/register/verify"),
            timeout=45_000,
        ) as reenroll_response:
            enroll_again.click()
        require(reenroll_response.value.status == 200, "re-enrollment after stale recovery failed")
        require(
            len(virtual_credentials(cdp, authenticator_id)) == 2,
            "stale recovery did not create a fresh platform credential",
        )
        print("PASS recovery enrollment completed a second server-verified credential")

        require(not page_errors, f"uncaught page errors: {page_errors}")
        require(api_responses, "no agent API responses were observed")
        context.close()
        browser.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url",
        help="Use an already running local server (must use the RP ID and origin configured on that server)",
    )
    parser.add_argument("--headed", action="store_true", help="Show the Chromium window")
    args = parser.parse_args()

    server: subprocess.Popen[bytes] | None = None
    base_url = args.base_url.rstrip("/") if args.base_url else ""
    try:
        if not base_url:
            base_url, server = start_dev_server()
        run_simulation(base_url, args.headed)
        print(f"RESULT PASS mobile WebAuthn simulation at {base_url}")
        return 0
    except (SimulationFailure, PlaywrightTimeoutError) as error:
        print(f"RESULT FAIL {error}", file=sys.stderr)
        return 1
    finally:
        if server is not None:
            stop_dev_server(server)


if __name__ == "__main__":
    raise SystemExit(main())
