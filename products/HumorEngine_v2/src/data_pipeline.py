"""
HumorEngine_v2 — Data Pipeline
===============================

Core pipeline for handling user feedback and compiling SFT datasets.

Classes:
    HumorDataPipeline
        - append_training_sample(video_desc, punchline, is_positive)
            is_positive=True  → appends to data/sft_train.jsonl
            is_positive=False → logs to data/discarded_samples.json

Usage:
    from src.data_pipeline import HumorDataPipeline

    pipeline = HumorDataPipeline()
    pipeline.append_training_sample(
        video_desc="A fashion model walking on a runway...",
        punchline="The structural integrity of the concrete pour meets ISO 9001 standards.",
        is_positive=True,
    )
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("data_pipeline")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent

DATA_DIR = PROJECT_ROOT / "data"
SFT_TRAIN_PATH = DATA_DIR / "sft_train.jsonl"
DISCARDED_PATH = DATA_DIR / "discarded_samples.json"

# ---------------------------------------------------------------------------
# HumorDataPipeline
# ---------------------------------------------------------------------------


class HumorDataPipeline:
    """
    Handles user feedback on generated humor samples.

    - Approved samples (is_positive=True)  → appended to ``sft_train.jsonl``
      in the SFT schema format.
    - Discarded samples (is_positive=False) → logged to
      ``discarded_samples.json`` for future DPO preference analysis.
    """

    def __init__(self, data_dir: Optional[Path] = None) -> None:
        self.data_dir = Path(data_dir) if data_dir else DATA_DIR
        self.data_dir.mkdir(parents=True, exist_ok=True)
        logger.info("HumorDataPipeline initialized — data dir: %s", self.data_dir)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def append_training_sample(
        self,
        video_desc: str,
        punchline: str,
        is_positive: bool,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Record a single user-feedback sample.

        Parameters
        ----------
        video_desc : str
            Description of the visual / video context that inspired the
            humor generation.
        punchline : str
            The generated punchline or humorous output text.
        is_positive : bool
            ``True``  → approved sample → appended to ``sft_train.jsonl``.
            ``False`` → discarded sample → logged to ``discarded_samples.json``.
        metadata : dict or None
            Optional extra fields to attach (e.g. rule_key, user_id,
            generation_params).
        """
        if is_positive:
            self._write_sft_sample(video_desc, punchline, metadata)
        else:
            self._write_discarded_sample(video_desc, punchline, metadata)

    # ------------------------------------------------------------------
    # Internal — SFT approved samples
    # ------------------------------------------------------------------

    def _build_sft_record(
        self,
        video_desc: str,
        punchline: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Construct a single SFT JSON object matching the training schema."""
        record: Dict[str, Any] = {
            "instruction": f"Generate a humor output for the following visual context: {video_desc}",
            "output": punchline,
            "humor_type": metadata.get("humor_type", "cognitive_dissonance") if metadata else "cognitive_dissonance",
            "rating": metadata.get("rating", 5) if metadata else 5,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if metadata:
            # Pass through any additional fields the caller provided
            for k, v in metadata.items():
                if k not in record:
                    record[k] = v
        return record

    def _write_sft_sample(
        self,
        video_desc: str,
        punchline: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Append one approved sample as a JSONL line to ``sft_train.jsonl``."""
        record = self._build_sft_record(video_desc, punchline, metadata)
        sft_path = self.data_dir / "sft_train.jsonl"

        with open(sft_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

        logger.info(
            "SFT sample appended → %s  |  punchline: %.60s...",
            sft_path.name,
            punchline,
        )

    # ------------------------------------------------------------------
    # Internal — Discarded / DPO-preference samples
    # ------------------------------------------------------------------

    def _build_discarded_record(
        self,
        video_desc: str,
        punchline: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Construct a discarded-sample record for DPO analysis."""
        record: Dict[str, Any] = {
            "video_desc": video_desc,
            "punchline": punchline,
            "label": "discarded",
            "reason": (metadata.pop("reason", None) if metadata else None),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if metadata:
            for k, v in metadata.items():
                if k not in record:
                    record[k] = v
        return record

    def _write_discarded_sample(
        self,
        video_desc: str,
        punchline: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Log one discarded sample to ``discarded_samples.json``.

        The file is maintained as a JSON array so that it can be loaded
        and analysed for DPO preference pair mining later.
        """
        record = self._build_discarded_record(video_desc, punchline, metadata)
        discard_path = self.data_dir / "discarded_samples.json"

        # Load existing discarded samples, or start a fresh list
        samples: list = []
        if discard_path.exists():
            try:
                with open(discard_path, "r", encoding="utf-8") as f:
                    samples = json.load(f)
            except (json.JSONDecodeError, Exception):
                samples = []

        samples.append(record)

        with open(discard_path, "w", encoding="utf-8") as f:
            json.dump(samples, f, ensure_ascii=False, indent=2)

        logger.info(
            "Discarded sample logged → %s  |  punchline: %.60s...",
            discard_path.name,
            punchline,
        )

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    def count_sft_samples(self) -> int:
        """Return the number of SFT samples currently stored."""
        sft_path = self.data_dir / "sft_train.jsonl"
        if not sft_path.exists():
            return 0
        count = 0
        with open(sft_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    count += 1
        return count

    def count_discarded_samples(self) -> int:
        """Return the number of discarded samples currently stored."""
        discard_path = self.data_dir / "discarded_samples.json"
        if not discard_path.exists():
            return 0
        with open(discard_path, "r", encoding="utf-8") as f:
            samples = json.load(f)
        return len(samples) if isinstance(samples, list) else 0

    def get_all_sft_samples(self) -> list:
        """Load and return all SFT samples as a list of dicts."""
        sft_path = self.data_dir / "sft_train.jsonl"
        if not sft_path.exists():
            return []
        samples = []
        with open(sft_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    samples.append(json.loads(line))
        return samples

    def get_all_discarded_samples(self) -> list:
        """Load and return all discarded samples as a list of dicts."""
        discard_path = self.data_dir / "discarded_samples.json"
        if not discard_path.exists():
            return []
        with open(discard_path, "r", encoding="utf-8") as f:
            samples = json.load(f)
        return samples if isinstance(samples, list) else []


# ---------------------------------------------------------------------------
# Quick self-test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    pipeline = HumorDataPipeline()

    print("\n=== HumorDataPipeline — Quick Test ===\n")

    # --- Approved sample ---
    pipeline.append_training_sample(
        video_desc="A luxury fashion model struts down a Paris runway in haute couture.",
        punchline="The concrete slump test indicates a workability of 125 mm, consistent with EU standard EN 206. The model's gait remains unaffected by this classification.",
        is_positive=True,
        metadata={"humor_type": "audio_visual_counterpoint", "rating": 5},
    )

    # --- Discarded sample ---
    pipeline.append_training_sample(
        video_desc="Two diplomats shake hands at a peace summit.",
        punchline="That's so funny, LOL!",
        is_positive=False,
        metadata={"reason": "violates layer_3_deadpan_tone — emotional buzzword 'LOL'"},
    )

    print(f"\n  SFT samples:          {pipeline.count_sft_samples()}")
    print(f"  Discarded samples:    {pipeline.count_discarded_samples()}")
    print("\n=== Test complete ===")
