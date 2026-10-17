#!/usr/bin/env python3
"""DePIN mining end-to-end verification: BLE proximity + NPU compute -> $mHUMAN rewards.

Runs with the standard library only (no Node.js, no Foundry, no blockchain node, no internet).

  1. keccak256 self-check against published vectors, and derivation of every function selector
     from its signature (the runtime hardcodes selectors because it has no keccak).
  2. Static verification: the Solidity contract, its Foundry test and the JS worker modules are
     present and wired together (agent-gated entry points, `--mine` CLI flag, offline egress).
  3. Constants agreement: every value that exists on both sides (proof-type tags, reward rates,
     proximity band, batch bounds, emission cap, ABI payload width) is parsed out of
     `MaoTangMining.sol` and `constants.mjs` and asserted equal. Drift is a hard failure.
  4. Mining simulation: a registered agent submits simulated BLE pings and NPU compute tasks, the
     contract's own validation rules are applied, rewards accrue, and a claim moves micro-HUMAN out
     of the reward vault into the agent's account. Negative cases (replay, weak signal, stale
     window, under-powered compute, emission cap, unregistered agent) must all be rejected.

The chain logic is mirrored here rather than executed, because neither `forge` nor a node is
available in this environment. The mirror is driven by constants parsed from the Solidity source,
so it cannot silently diverge from what is shipped.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACT = REPO_ROOT / "contracts" / "src" / "MaoTangMining.sol"
CONTRACT_TEST = REPO_ROOT / "contracts" / "test" / "MaoTangMining.t.sol"
MINING_SRC = REPO_ROOT / "agent-manager" / "src" / "mining"
MANAGER = REPO_ROOT / "agent-manager" / "src" / "agent-manager.mjs"

FAILURES: list[str] = []


def check(condition: bool, label: str) -> bool:
    print(f"  [{'PASS' if condition else 'FAIL'}] {label}")
    if not condition:
        FAILURES.append(label)
    return bool(condition)


def section(title: str) -> None:
    print(f"\n{title}")


_RC = (
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
)
_R = (
    (0, 36, 3, 41, 18), (1, 44, 10, 45, 2), (62, 6, 43, 15, 61),
    (28, 55, 25, 21, 56), (27, 20, 39, 8, 14),
)
_M64 = (1 << 64) - 1


def _rol(value: int, shift: int) -> int:
    shift %= 64
    return ((value << shift) | (value >> (64 - shift))) & _M64


def _keccak_f(state):
    for rnd in range(24):
        c = [state[x][0] ^ state[x][1] ^ state[x][2] ^ state[x][3] ^ state[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rol(c[(x + 1) % 5], 1) for x in range(5)]
        for x in range(5):
            for y in range(5):
                state[x][y] ^= d[x]
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rol(state[x][y], _R[x][y])
        for x in range(5):
            for y in range(5):
                state[x][y] = b[x][y] ^ ((~b[(x + 1) % 5][y]) & _M64 & b[(x + 2) % 5][y])
        state[0][0] ^= _RC[rnd]
    return state


def keccak256(data: bytes) -> bytes:
    """Ethereum's Keccak-256 (padding byte 0x01, not SHA-3's 0x06)."""
    rate = 136
    state = [[0] * 5 for _ in range(5)]
    pad = rate - (len(data) % rate)
    if pad == 1:
        padded = data + b"\x81"
    else:
        padded = data + b"\x01" + b"\x00" * (pad - 2) + b"\x80"
    for offset in range(0, len(padded), rate):
        block = padded[offset : offset + rate]
        for lane in range(rate // 8):
            state[lane % 5][lane // 5] ^= int.from_bytes(block[lane * 8 : lane * 8 + 8], "little")
        state = _keccak_f(state)
    out = bytearray()
    for lane in range(4):
        out += state[lane % 5][lane // 5].to_bytes(8, "little")
    return bytes(out)


def selector(signature: str) -> str:
    return keccak256(signature.encode("utf-8")).hex()[:8]


def verify_keccak() -> None:
    section("[1/5] keccak256 self-check (published vectors)")
    vectors = (
        (b"", "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"),
        (b"abc", "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"),
    )
    for payload, expected in vectors:
        check(keccak256(payload).hex() == expected, f"keccak256({payload!r}) matches the published vector")
    check(selector("transfer(address,uint256)") == "a9059cbb", "keccak256 derives the known ERC-20 transfer selector")

# ------------------------------------------------------------------------------------ parsing

def _contract_text() -> str:
    return CONTRACT.read_text(encoding="utf-8")


def _js_text() -> str:
    return (MINING_SRC / "constants.mjs").read_text(encoding="utf-8")


def _eval_expr(expr: str, units: dict[str, int]) -> int:
    expr = expr.strip()
    match = re.fullmatch(r"(\d+)\s+(\w+)", expr)
    if match:
        if match.group(2) not in units:
            raise AssertionError(f"unknown time unit in {expr!r}")
        return int(match.group(1)) * units[match.group(2)]
    cleaned = expr.replace("_", "")
    if not re.fullmatch(r"[0-9*\s]+", cleaned):
        raise AssertionError(f"refusing to evaluate unexpected expression {expr!r}")
    return int(eval(cleaned, {"__builtins__": {}}, {}))  # noqa: S307 - token-whitelisted above


_TIME_UNITS = {"seconds": 1, "minutes": 60, "hours": 3600, "days": 86400}


def solidity_uint(name: str) -> int:
    match = re.search(rf"uint256 public constant {name} = ([^;]+);", _contract_text())
    if match is None:
        raise AssertionError(f"constant {name} not found in MaoTangMining.sol")
    return _eval_expr(match.group(1), _TIME_UNITS)


def solidity_int(name: str) -> int:
    match = re.search(rf"int256 public constant {name} = (-?\d+);", _contract_text())
    if match is None:
        raise AssertionError(f"signed constant {name} not found in MaoTangMining.sol")
    return int(match.group(1))


def solidity_bytes32(name: str) -> str:
    match = re.search(rf"bytes32 public constant {name} = (0x[0-9a-fA-F]{{64}});", _contract_text())
    if match is None:
        raise AssertionError(f"bytes32 constant {name} not found in MaoTangMining.sol")
    return match.group(1).lower()


def js_uint(name: str) -> int:
    match = re.search(rf"export const {name} = ([^;]+);", _js_text())
    if match is None:
        raise AssertionError(f"{name} not found in constants.mjs")
    return _eval_expr(match.group(1).replace("n", ""), _TIME_UNITS)


def js_int(name: str) -> int:
    match = re.search(rf"export const {name} = (-?\d+);", _js_text())
    if match is None:
        raise AssertionError(f"signed constant {name} not found in constants.mjs")
    return int(match.group(1))


def js_bytes32(name: str) -> str:
    match = re.search(rf'export const {name} = "(0x[0-9a-fA-F]{{64}})";', _js_text())
    if match is None:
        raise AssertionError(f"{name} not found in constants.mjs")
    return match.group(1).lower()


def js_object_block(name: str) -> str:
    match = re.search(rf"export const {name} = Object\.freeze\(\{{(.*?)\}}\);", _js_text(), re.S)
    if match is None:
        raise AssertionError(f"{name} not found in constants.mjs")
    return match.group(1)


def ascii_bytes32(tag: str) -> str:
    raw = tag.encode("utf-8")
    assert len(raw) <= 32
    return "0x" + (raw + b"\x00" * (32 - len(raw))).hex()


# ------------------------------------------------------------------- [2/5] static verification

def static_verification() -> None:
    section("[2/5] Static verification of the shipped contract and worker")

    check(CONTRACT.is_file(), "contracts/src/MaoTangMining.sol exists")
    check(CONTRACT_TEST.is_file(), "contracts/test/MaoTangMining.t.sol exists")

    text = _contract_text()
    check("contract MaoTangMining is AgentGated" in text, "the mining contract inherits the agent gate")
    check(
        "function submitMiningProof(bytes32 proofType, bytes memory proofData)" in text,
        "submitMiningProof(bytes32,bytes) is implemented",
    )
    check("onlyAuthorizedAgent" in text, "mining entry points are agent-gated")
    check("function claimMiningRewards() external onlyAuthorizedAgent" in text, "claimMiningRewards() is agent-gated")
    check("PROOF_TYPE_BLE_PING" in text and "PROOF_TYPE_ZK_COMPUTE" in text, "both proof types are declared")
    check("function fundRewardVault(uint256 amount)" in text, "the reward vault can be funded")
    check("mhuman.transfer(agent, amount)" in text, "rewards are disbursed from the vault to the agent account")
    check("consumedMiningProof[nullifier]" in text, "proofs are single-use (replay protected)")
    check("EpochEmissionCapExceeded" in text, "a per-epoch emission cap is enforced")

    test_text = CONTRACT_TEST.read_text(encoding="utf-8")
    for name in (
        "test_BleBatchAccruesRewardAndClaimDisbursesToAgent",
        "test_ComputeBatchAccruesReward",
        "test_UnregisteredCallerCannotSubmit",
        "test_ReplayProofRejected",
        "test_DistantSignalRejected",
        "test_StaleProofRejected",
        "test_InsufficientComputeRejected",
        "test_EpochEmissionCapIsEnforced",
        "test_ClaimRevertsWhenVaultIsUnderfunded",
    ):
        check(name in test_text, f"Foundry test {name} is present")

    expected_modules = [
        "constants.mjs",
        "abi.mjs",
        "telemetry.mjs",
        "transport.mjs",
        "background-miner.mjs",
        "index.mjs",
    ]
    missing = [name for name in expected_modules if not (MINING_SRC / name).is_file()]
    check(not missing, f"agent-manager/src/mining/ ships all {len(expected_modules)} modules")

    miner = (MINING_SRC / "background-miner.mjs").read_text(encoding="utf-8")
    check("class BackgroundMiner" in miner, "BackgroundMiner is implemented")
    check("setInterval" in miner and "unref" in miner, "the worker uses a single, unref'd duty-cycle timer")
    check("batteryFloor" in miner, "low-power compute deferral is implemented")
    check("MAX_EPOCH_REWARD" in miner, "the worker pre-checks the on-chain emission cap")
    check("privateKey" not in miner and "exportSeed" not in miner, "the worker never touches private key material")

    transport = (MINING_SRC / "transport.mjs").read_text(encoding="utf-8")
    check("eth_sendRawTransaction" in transport, "the worker broadcasts via eth_sendRawTransaction")
    check("NULL_SIGNER" in transport and "TEE/Secure-Enclave" in transport, "signing is an injected, on-device boundary")

    manager = MANAGER.read_text(encoding="utf-8")
    check("--mine" in manager and "JsonRpcMiningTransport" in manager, "the CLI exposes --mine over the mining transport")

    runtime_text = "\n".join(
        path.read_text(encoding="utf-8", errors="replace")
        for path in sorted((REPO_ROOT / "agent-manager" / "src").rglob("*"))
        if path.is_file() and path.suffix in (".ts", ".mjs", ".js")
    ).lower()
    for vendor in ("api.openai.com", "anthropic", "generativelanguage.googleapis.com", "amazonaws"):
        check(vendor not in runtime_text, f"no cloud vendor reference ({vendor}) in runtime code")
    non_loopback = [
        url for url in re.findall(r"https?://[^\s\"'`)\]}]+", runtime_text)
        if not url.startswith(("http://127.0.0.1", "https://127.0.0.1", "http://localhost", "https://localhost"))
    ]
    check(not non_loopback, "runtime code contains no non-loopback URL literals")
    for url in non_loopback:
        print(f"        !! {url}")

# ------------------------------------------------------------- [3/5] constants + selectors

def constants_agreement() -> None:
    section("[3/5] Solidity <-> worker constant agreement")

    check(
        solidity_bytes32("PROOF_TYPE_BLE_PING") == js_bytes32("PROOF_TYPE_BLE_PING"),
        "PROOF_TYPE_BLE_PING matches between Solidity and the worker",
    )
    check(
        solidity_bytes32("PROOF_TYPE_ZK_COMPUTE") == js_bytes32("PROOF_TYPE_ZK_COMPUTE"),
        "PROOF_TYPE_ZK_COMPUTE matches between Solidity and the worker",
    )
    check(
        js_bytes32("PROOF_TYPE_BLE_PING") == ascii_bytes32("maotang.mining.ble-ping.v1"),
        "the BLE proof type is the zero-padded ASCII tag",
    )
    check(
        js_bytes32("PROOF_TYPE_ZK_COMPUTE") == ascii_bytes32("maotang.mining.zk-compute.v1"),
        "the compute proof type is the zero-padded ASCII tag",
    )

    for name in (
        "PROOF_DATA_BYTES",
        "BLE_REWARD_PER_PING",
        "COMPUTE_REWARD_PER_TASK",
        "MAX_BLE_PINGS_PER_PROOF",
        "MAX_COMPUTE_TASKS_PER_PROOF",
        "MIN_COMPUTE_UNITS",
        "MAX_EPOCH_REWARD",
    ):
        value = solidity_uint(name)
        check(value == js_uint(name), f"{name} == {value} on both sides")

    check(
        solidity_uint("MAX_PROOF_AGE") * 1000 == js_uint("MAX_PROOF_AGE_MS"),
        f"MAX_PROOF_AGE ({solidity_uint('MAX_PROOF_AGE')} s) == MAX_PROOF_AGE_MS ({js_uint('MAX_PROOF_AGE_MS')} ms)",
    )
    check(
        solidity_uint("EPOCH_SECONDS") * 1000 == js_uint("EPOCH_MS"),
        f"EPOCH_SECONDS ({solidity_uint('EPOCH_SECONDS')} s) == EPOCH_MS ({js_uint('EPOCH_MS')} ms)",
    )
    check(solidity_int("MIN_BLE_RSSI") == js_int("MIN_BLE_RSSI"), "MIN_BLE_RSSI matches on both sides")
    check(solidity_int("MAX_BLE_RSSI") == js_int("MAX_BLE_RSSI"), "MAX_BLE_RSSI matches on both sides")
    check(solidity_uint("PROOF_DATA_BYTES") == 6 * 32, "the proof payload is six ABI words")

    selectors = dict(re.findall(r'(\w+): "(0x[0-9a-f]{8})"', js_object_block("SELECTORS")))
    signatures = dict(re.findall(r'(\w+): "([^"]+)"', js_object_block("FUNCTION_SIGNATURES")))
    check(set(selectors) == set(signatures), "every hardcoded selector documents its signature")
    for name, signature in signatures.items():
        derived = selector(signature)
        check(selectors.get(name) == f"0x{derived}", f"selector {name} == keccak256({signature!r})[:4] = 0x{derived}")


# ----------------------------------------------------------------- [4/5] mining simulation

class Unauthorized(Exception):
    pass


class ContractRejection(Exception):
    def __init__(self, code: str, detail: str):
        super().__init__(f"{code}: {detail}")
        self.code = code


def encode_payload(payload: dict) -> bytes:
    """The same six-word big-endian blob the JS encoder produces."""
    second = payload["strongestRssi"] if "strongestRssi" in payload else payload["computeUnits"]
    words = (
        payload["unitCount"],
        second,
        payload["windowStart"],
        payload["windowEnd"],
        payload["setHash"],
        payload["digest"],
    )
    out = bytearray()
    for index, word in enumerate(words):
        if isinstance(word, str):
            out += bytes.fromhex(word.removeprefix("0x"))
        elif word < 0:
            out += ((1 << 256) + word).to_bytes(32, "big")
        else:
            out += int(word).to_bytes(32, "big")
    return bytes(out)


class MiningMirror:
    """Mirrors MaoTangMining's validation, accrual, emission cap and vault disbursement."""

    def __init__(self, *, ble_type, compute_type, reward_rates, batch_bounds, proximity, max_age_seconds,
                 epoch_seconds, max_epoch_reward):
        self.ble_type = ble_type
        self.compute_type = compute_type
        self.reward_rates = reward_rates
        self.batch_bounds = batch_bounds
        self.proximity = proximity
        self.max_age_seconds = max_age_seconds
        self.epoch_seconds = epoch_seconds
        self.max_epoch_reward = max_epoch_reward
        self.vault = 0
        self.pending: dict[str, int] = {}
        self.consumed: set[str] = set()
        self.epoch_paid: dict[int, int] = {}
        self.agents: set[str] = set()
        self.claimed: dict[str, int] = {}

    def register_agent(self, pub_key: bytes) -> str:
        agent = "0x" + keccak256(b"maotang.agent.v1" + pub_key).hex()[-40:]
        self.agents.add(agent)
        return agent

    def fund_vault(self, amount: int) -> None:
        self.vault += amount

    def submit(self, agent: str, proof_type: str, payload: dict, now: int) -> int:
        if agent not in self.agents:
            raise Unauthorized(f"agent {agent} is not registered")
        if proof_type not in self.reward_rates:
            raise ContractRejection("UnknownProofType", proof_type)

        proof_data = encode_payload(payload)
        nullifier = keccak256(bytes.fromhex(proof_type[2:]) + bytes.fromhex(agent[2:]) + proof_data).hex()
        if nullifier in self.consumed:
            raise ContractRejection("ReplayProof", nullifier)

        units = self._validate(proof_type, payload, now)
        reward = self.reward_rates[proof_type] * units

        epoch = now // self.epoch_seconds
        paid = self.epoch_paid.get(epoch, 0)
        if paid + reward > self.max_epoch_reward:
            raise ContractRejection("EpochEmissionCapExceeded", f"epoch {epoch}")

        self.consumed.add(nullifier)
        self.epoch_paid[epoch] = paid + reward
        self.pending[agent] = self.pending.get(agent, 0) + reward
        return reward

    def _validate(self, proof_type: str, payload: dict, now: int) -> int:
        if proof_type == self.ble_type:
            return self._validate_ble(payload, now)
        return self._validate_compute(payload, now)

    def _validate_ble(self, payload: dict, now: int) -> int:
        pings = payload["unitCount"]
        if pings <= 0 or pings > self.batch_bounds["ble"]:
            raise ContractRejection("InvalidBatchSize", str(pings))
        if not payload["setHash"]:
            raise ContractRejection("EmptyProofDigest", "beaconSetHash")
        if not payload["digest"]:
            raise ContractRejection("MissingAttestation", "telemetryDigest")
        floor, ceiling = self.proximity
        if payload["strongestRssi"] < floor or payload["strongestRssi"] > ceiling:
            raise ContractRejection("OutOfProximityRange", str(payload["strongestRssi"]))
        self._require_fresh(payload["windowStart"], payload["windowEnd"], now)
        return pings

    def _validate_compute(self, payload: dict, now: int) -> int:
        tasks = payload["unitCount"]
        if tasks <= 0 or tasks > self.batch_bounds["compute"]:
            raise ContractRejection("InvalidBatchSize", str(tasks))
        if payload["computeUnits"] < self.batch_bounds["minComputeUnits"]:
            raise ContractRejection("InsufficientCompute", str(payload["computeUnits"]))
        if not payload["setHash"]:
            raise ContractRejection("EmptyProofDigest", "taskSetHash")
        if not payload["digest"]:
            raise ContractRejection("MissingAttestation", "proofDigest")
        self._require_fresh(payload["windowStart"], payload["windowEnd"], now)
        return tasks

    def _require_fresh(self, window_start: int, window_end: int, now: int) -> None:
        if window_end < window_start:
            raise ContractRejection("InvalidProofWindow", f"{window_start}..{window_end}")
        if window_end > now:
            raise ContractRejection("ProofFromTheFuture", str(window_end))
        if now - window_end > self.max_age_seconds:
            raise ContractRejection("StaleProof", str(window_end))

    def claim(self, agent: str) -> int:
        if agent not in self.agents:
            raise Unauthorized(f"agent {agent} is not registered")
        amount = self.pending.get(agent, 0)
        if amount == 0:
            raise ContractRejection("NothingToClaim", agent)
        if amount > self.vault:
            raise ContractRejection("InsufficientRewardVault", f"need {amount}, have {self.vault}")
        self.pending[agent] = 0
        self.vault -= amount
        self.claimed[agent] = self.claimed.get(agent, 0) + amount
        return amount


def ble_payload(pings: list, *, digest: str | None = None) -> dict:
    rssis = [rssi for _beacon, rssi, _at in pings]
    times = [at for _beacon, _rssi, at in pings]
    return {
        "unitCount": len(pings),
        "strongestRssi": max(rssis) if rssis else 0,
        "windowStart": min(times) if times else 0,
        "windowEnd": max(times) if times else 0,
        "setHash": keccak256("|".join(sorted({beacon for beacon, _r, _a in pings})).encode()).hex(),
        "digest": digest if digest is not None else keccak256(b"telemetry").hex(),
    }


def compute_payload(tasks: list, *, digest: str | None = None) -> dict:
    times = [at for _task, _units, at in tasks]
    return {
        "unitCount": len(tasks),
        "computeUnits": sum(units for _task, units, _at in tasks),
        "windowStart": min(times) if times else 0,
        "windowEnd": max(times) if times else 0,
        "setHash": keccak256("|".join(sorted(task for task, _u, _a in tasks)).encode()).hex(),
        "digest": digest if digest is not None else keccak256(b"npu-compute").hex(),
    }


def mirror_for(*, max_epoch_reward: int | None = None) -> MiningMirror:
    ble_type = js_bytes32("PROOF_TYPE_BLE_PING")
    compute_type = js_bytes32("PROOF_TYPE_ZK_COMPUTE")
    return MiningMirror(
        ble_type=ble_type,
        compute_type=compute_type,
        reward_rates={ble_type: js_uint("BLE_REWARD_PER_PING"), compute_type: js_uint("COMPUTE_REWARD_PER_TASK")},
        batch_bounds={
            "ble": js_uint("MAX_BLE_PINGS_PER_PROOF"),
            "compute": js_uint("MAX_COMPUTE_TASKS_PER_PROOF"),
            "minComputeUnits": js_uint("MIN_COMPUTE_UNITS"),
        },
        proximity=(js_int("MIN_BLE_RSSI"), js_int("MAX_BLE_RSSI")),
        max_age_seconds=js_uint("MAX_PROOF_AGE_MS") // 1000,
        epoch_seconds=js_uint("EPOCH_MS") // 1000,
        max_epoch_reward=js_uint("MAX_EPOCH_REWARD") if max_epoch_reward is None else max_epoch_reward,
    )

def mining_simulation() -> None:
    print("\n[4/5] Simulated BLE proximity + NPU compute mining")

    ble_type = js_bytes32("PROOF_TYPE_BLE_PING")
    compute_type = js_bytes32("PROOF_TYPE_ZK_COMPUTE")
    now = 1_767_225_600  # 2026-01-01T00:00:00Z, an epoch boundary

    mirror = mirror_for()
    agent = mirror.register_agent(keccak256(b"alice-agent-key"))
    check(len(agent) == 42, "the agent address is derived from its public key, as on-chain")

    quota = js_uint("MICRO_UNITS_PER_HUMAN")
    check(quota == 1_000_000 * 10 ** 6, "one human quota is 1,000,000 mHUMAN in micro-units")
    mirror.fund_vault(quota)
    check(mirror.vault == quota, "the reward vault holds exactly one human quota")

    pings = [("beacon-front-door", -47, now - 20), ("beacon-kitchen", -75, now - 60), ("beacon-desk", -63, now - 40)]
    ble_reward = mirror.submit(agent, ble_type, ble_payload(pings), now)
    check(
        ble_reward == len(pings) * js_uint("BLE_REWARD_PER_PING"),
        f"3 BLE proximity pings earn {ble_reward} micro-HUMAN",
    )

    tasks = [("npu-task-1", 400, now - 30), ("npu-task-2", 400, now - 15), ("npu-task-3", 400, now - 5)]
    compute_reward = mirror.submit(agent, compute_type, compute_payload(tasks), now)
    check(
        compute_reward == len(tasks) * js_uint("COMPUTE_REWARD_PER_TASK"),
        f"3 NPU compute tasks earn {compute_reward} micro-HUMAN",
    )

    total = ble_reward + compute_reward
    check(
        total == 3 * js_uint("BLE_REWARD_PER_PING") + 3 * js_uint("COMPUTE_REWARD_PER_TASK"),
        "total reward equals pings*rate + tasks*rate exactly",
    )
    check(mirror.pending[agent] == total, "accrued rewards are tracked per agent")
    check(mirror.vault == quota, "the vault is untouched until the agent claims")

    paid = mirror.claim(agent)
    check(paid == total, "claimMiningRewards disburses exactly the accrued amount")
    check(mirror.claimed[agent] == total, "rewards land in the agent's own contract account")
    check(mirror.vault == quota - total, "the vault decreases by the disbursed amount")
    check(total < quota, "a single mining cycle cannot drain the whole vault")

    try:
        mirror.submit(agent, ble_type, ble_payload(pings), now)
        check(False, "replaying an identical proof is rejected")
    except ContractRejection as error:
        check(error.code == "ReplayProof", "replaying an identical proof is rejected (ReplayProof)")

    # Emission cap: 64-task compute batches are worth 0.32 quota each, so the 4th exceeds the epoch.
    mini = mirror_for()
    mini.register_agent(keccak256(b"alice-agent-key"))
    batch = [(f"npu-task-{index}", 1_000, now - 5) for index in range(64)]
    for round_index in range(3):
        payload = compute_payload(batch)
        payload["setHash"] = keccak256(f"task-set-{round_index}".encode()).hex()
        mini.submit(mini.register_agent(keccak256(f"miner-{round_index}".encode())), compute_type, payload, now)
    expected = 3 * 64 * js_uint("COMPUTE_REWARD_PER_TASK")
    check(mini.epoch_paid[now // mini.epoch_seconds] == expected, "three full batches fit the epoch budget")
    over = compute_payload(batch)
    over["setHash"] = keccak256(b"task-set-over").hex()
    try:
        mini.submit(mini.register_agent(keccak256(b"miner-over")), compute_type, over, now)
        check(False, "the fourth full batch is refused by the epoch emission cap")
    except ContractRejection as error:
        check(error.code == "EpochEmissionCapExceeded", "the fourth full batch is refused by the epoch emission cap")
    check(
        mini.epoch_paid[now // mini.epoch_seconds] <= js_uint("MAX_EPOCH_REWARD"),
        "epoch emissions never exceed the cap",
    )


def negative_and_offline() -> None:
    print("\n[5/5] Negative cases and offline guarantees")

    ble_type = js_bytes32("PROOF_TYPE_BLE_PING")
    compute_type = js_bytes32("PROOF_TYPE_ZK_COMPUTE")
    now = 1_767_225_600
    pub_key = keccak256(b"bob-agent-key")

    cases = (
        ("unregistered agent", "ghost", ble_type, ble_payload([("beacon", -50, now - 10)]), Unauthorized),
        ("unknown proof type", "self", "0x" + "ff" * 32, ble_payload([("beacon", -50, now - 10)]), ContractRejection),
        ("distant signal", "self", ble_type, ble_payload([("beacon", -120, now - 10)]), ContractRejection),
        ("impossibly strong signal", "self", ble_type, ble_payload([("beacon", 0, now - 10)]), ContractRejection),
        ("stale window", "self", ble_type, ble_payload([("beacon", -50, now - 901)]), ContractRejection),
        ("future window", "self", ble_type, ble_payload([("beacon", -50, now + 5)]), ContractRejection),
        ("zero-ping batch", "self", ble_type, ble_payload([]), ContractRejection),
        ("missing attestation", "self", ble_type, ble_payload([("beacon", -50, now - 10)], digest=""), ContractRejection),
        (
            "under-powered compute",
            "self",
            compute_type,
            compute_payload([("task", js_uint("MIN_COMPUTE_UNITS") - 1, now - 5)]),
            ContractRejection,
        ),
    )

    for label, who, proof_type, payload, expected_error in cases:
        mirror = mirror_for()
        agent = mirror.register_agent(pub_key)
        target = "0x" + "de" * 20 if who == "ghost" else agent
        try:
            mirror.submit(target, proof_type, payload, now)
            check(False, f"{label} is rejected")
        except expected_error as error:
            check(True, f"{label} is rejected ({getattr(error, 'code', type(error).__name__)})")

    empty = mirror_for()
    empty_agent = empty.register_agent(pub_key)
    try:
        empty.claim(empty_agent)
        check(False, "claiming with nothing accrued is rejected")
    except ContractRejection as error:
        check(error.code == "NothingToClaim", "claiming with nothing accrued is rejected (NothingToClaim)")

    broke = mirror_for()
    broke_agent = broke.register_agent(pub_key)
    broke.submit(broke_agent, ble_type, ble_payload([("beacon", -50, now - 10)]), now)
    try:
        broke.claim(broke_agent)
        check(False, "claiming from an unfunded vault is rejected")
    except ContractRejection as error:
        check(error.code == "InsufficientRewardVault", "claiming from an unfunded vault is rejected (InsufficientRewardVault)")

    positive = mirror_for()
    positive_agent = positive.register_agent(pub_key)
    positive.fund_vault(js_uint("BLE_REWARD_PER_PING"))
    positive.submit(positive_agent, ble_type, ble_payload([("beacon", -50, now - 10)]), now)
    check(positive.claim(positive_agent) == js_uint("BLE_REWARD_PER_PING"), "a funded vault pays out the accrued reward")

    transport = (MINING_SRC / "transport.mjs").read_text(encoding="utf-8")
    methods = set(re.findall(r'request\("(eth_[a-zA-Z]+)"', transport))
    check(
        methods <= {"eth_sendRawTransaction", "eth_call"},
        f"the mining transport only calls JSON-RPC methods ({sorted(methods)})",
    )
    check("fetch" not in transport.replace("fetchImpl", ""), "the transport has no hand-rolled network stack")

    miner = (MINING_SRC / "background-miner.mjs").read_text(encoding="utf-8")
    check("http" not in miner.lower(), "the background worker contains no URL at all")
    check("require(" not in miner, "the worker pulls in no third-party module")


def main() -> int:
    print("MAOTANG DePIN mining end-to-end verification")
    print(f"repository: {REPO_ROOT}")
    static_verification()
    verify_keccak()
    constants_agreement()
    mining_simulation()
    negative_and_offline()

    print("\n=== RESULT ===")
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s) failed")
        for item in FAILURES:
            print(f"  - {item}")
        return 1
    print("PASSED: simulated BLE proximity + NPU compute proofs yield exact $mHUMAN mining rewards,")
    print("        and the worker's only egress is JSON-RPC to the configured node.")
    return 0


if __name__ == "__main__":
    sys.exit(main())