#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import torch

EXPECTED_SOURCE_SHA256 = "51900ffb4cfd724592235b8e20dfca0858f5b386543ff975650c1cc5d598bd05"
SCREEN_WIDTH = 4096.0
SCREEN_HEIGHT = 2304.0
SCREEN_DIAGONAL = math.hypot(SCREEN_WIDTH, SCREEN_HEIGHT)
MAX_STEPS = 96.0
MAX_VELOCITY = 6500.0
TARGET_RADIUS = 8.0
OPSET_VERSION = 17
CORPUS_SEED = 20260816
CORPUS_CASES = 1200


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_source_hash(source_zip: Path) -> str:
    actual = sha256(source_zip)
    if actual != EXPECTED_SOURCE_SHA256:
        raise RuntimeError(
            f"source ZIP SHA256 mismatch: expected {EXPECTED_SOURCE_SHA256}, got {actual}"
        )
    return actual


def make_observation(
    position: np.ndarray,
    destination: np.ndarray,
    previous_velocity: np.ndarray,
    step: int,
) -> np.ndarray:
    delta = destination - position
    distance = float(np.linalg.norm(delta))
    return np.concatenate(
        [
            position / np.array([SCREEN_WIDTH, SCREEN_HEIGHT]),
            destination / np.array([SCREEN_WIDTH, SCREEN_HEIGHT]),
            delta / np.array([SCREEN_WIDTH, SCREEN_HEIGHT]),
            np.array([distance / SCREEN_DIAGONAL]),
            previous_velocity / MAX_VELOCITY,
            np.array([step / MAX_STEPS]),
        ]
    ).astype(np.float32)


class ActorParameters(torch.nn.Module):
    def __init__(self, actor: torch.nn.Module) -> None:
        super().__init__()
        self.actor = actor

    def forward(self, observation: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        mean, log_std, _ = self.actor.get_action_dist_params(observation)
        return mean, log_std


def load_actor(source_zip: Path) -> tuple[Any, dict[str, str]]:
    # The hash check must happen before SB3 deserializes the untrusted ZIP.
    source_sha256 = verify_source_hash(source_zip)
    from stable_baselines3 import SAC

    model = SAC.load(source_zip, device="cpu")
    model.policy.eval()
    model.policy.actor.eval()
    versions = {
        "stable_baselines3": _package_version("stable-baselines3"),
        "torch": torch.__version__,
        "numpy": np.__version__,
        "python": platform.python_version(),
        "source_sha256": source_sha256,
    }
    return model.policy.actor, versions


def _package_version(package: str) -> str:
    from importlib.metadata import version

    return version(package)


def torch_outputs(actor: torch.nn.Module, observations: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    with torch.inference_mode():
        mean, log_std = ActorParameters(actor)(torch.from_numpy(observations))
    return mean.numpy(), log_std.numpy()


def build_observations() -> np.ndarray:
    rng = np.random.default_rng(CORPUS_SEED)
    cases: list[np.ndarray] = []
    boundary_positions = [
        np.array([0.0, 0.0]),
        np.array([SCREEN_WIDTH - 1.0, SCREEN_HEIGHT - 1.0]),
        np.array([SCREEN_WIDTH / 2.0, SCREEN_HEIGHT / 2.0]),
        np.array([1.0, SCREEN_HEIGHT - 2.0]),
    ]
    boundary_destinations = [
        np.array([0.0, 0.0]),
        np.array([SCREEN_WIDTH - 1.0, SCREEN_HEIGHT - 1.0]),
        np.array([SCREEN_WIDTH / 2.0, SCREEN_HEIGHT / 2.0]),
        np.array([SCREEN_WIDTH - 2.0, 2.0]),
    ]
    boundary_velocities = [
        np.array([0.0, 0.0]),
        np.array([-MAX_VELOCITY, -MAX_VELOCITY]),
        np.array([MAX_VELOCITY, MAX_VELOCITY]),
        np.array([MAX_VELOCITY, -MAX_VELOCITY]),
    ]
    for position in boundary_positions:
        for destination in boundary_destinations:
            for velocity in boundary_velocities:
                for step in (0, 1, 95, 96):
                    cases.append(make_observation(position, destination, velocity, step))

    while len(cases) < CORPUS_CASES:
        position = rng.uniform(
            [0.0, 0.0], [SCREEN_WIDTH - 1.0, SCREEN_HEIGHT - 1.0]
        )
        destination = rng.uniform(
            [0.0, 0.0], [SCREEN_WIDTH - 1.0, SCREEN_HEIGHT - 1.0]
        )
        velocity = rng.uniform(-MAX_VELOCITY, MAX_VELOCITY, size=2)
        step = int(rng.integers(0, 97))
        cases.append(make_observation(position, destination, velocity, step))
    return np.asarray(cases[:CORPUS_CASES], dtype=np.float32)


def export_model(actor: torch.nn.Module, model_path: Path) -> None:
    wrapper = ActorParameters(actor).eval()
    sample = torch.zeros((1, 10), dtype=torch.float32)
    model_path.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        wrapper,
        (sample,),
        str(model_path),
        input_names=["observation"],
        output_names=["mean", "log_std"],
        dynamic_axes={
            "observation": {0: "batch"},
            "mean": {0: "batch"},
            "log_std": {0: "batch"},
        },
        opset_version=OPSET_VERSION,
        do_constant_folding=True,
        training=torch.onnx.TrainingMode.EVAL,
        external_data=False,
    )


def onnx_outputs(model_path: Path, observations: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    import onnxruntime as ort

    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    output_mean, output_log_std = session.run(
        ["mean", "log_std"], {"observation": observations}
    )
    return np.asarray(output_mean), np.asarray(output_log_std)


def compare(
    expected_mean: np.ndarray,
    expected_log_std: np.ndarray,
    actual_mean: np.ndarray,
    actual_log_std: np.ndarray,
) -> dict[str, float]:
    expected = np.concatenate([expected_mean, expected_log_std], axis=1)
    actual = np.concatenate([actual_mean, actual_log_std], axis=1)
    if not np.isfinite(expected).all() or not np.isfinite(actual).all():
        raise AssertionError("non-finite Python or ONNX output")
    absolute_error = np.abs(expected - actual)
    maximum = float(np.max(absolute_error))
    average = float(np.mean(absolute_error))
    if maximum > 1e-5 or average > 1e-6:
        raise AssertionError(f"equivalence thresholds exceeded: max={maximum}, mean={average}")
    return {"max_absolute_error": maximum, "mean_absolute_error": average}


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def verify_artifact_metadata(model_path: Path, corpus_path: Path, manifest_path: Path) -> None:
    recorded = json.loads(manifest_path.read_text(encoding="utf-8"))
    if recorded["artifact"]["sha256"] != sha256(model_path):
        raise AssertionError("ONNX artifact hash does not match manifest")
    if recorded["corpus"]["sha256"] != sha256(corpus_path):
        raise AssertionError("corpus hash does not match manifest")
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    if len(corpus["cases"]) != recorded["corpus"]["cases"]:
        raise AssertionError("corpus case count does not match manifest")


def manifest(
    model_path: Path,
    corpus_path: Path,
    source_sha256: str,
    versions: dict[str, str],
    metrics: dict[str, float],
) -> dict[str, object]:
    return {
        "schema_version": 1,
        "name": "sac_mouse_v2",
        "artifact": {
            "path": "resources/models/sac_mouse_v2.onnx",
            "sha256": sha256(model_path),
            "size_bytes": model_path.stat().st_size,
            "opset": OPSET_VERSION,
            "inputs": [{"name": "observation", "shape": ["batch", 10], "dtype": "float32"}],
            "outputs": [
                {"name": "mean", "shape": ["batch", 2], "dtype": "float32"},
                {"name": "log_std", "shape": ["batch", 2], "dtype": "float32"},
            ],
        },
        "source": {
            "path": "external Bumblebee sac_mouse_v2.zip",
            "sha256": source_sha256,
            "algorithm": "SAC",
            "policy": "MlpPolicy",
        },
        "corpus": {
            "path": "tests/fixtures/onnx-corpus.json",
            "sha256": sha256(corpus_path),
            "cases": CORPUS_CASES,
            "seed": CORPUS_SEED,
        },
        "observations": {
            "size": 10,
            "ordering": [
                "position_x / screen_width",
                "position_y / screen_height",
                "destination_x / screen_width",
                "destination_y / screen_height",
                "(destination_x - position_x) / screen_width",
                "(destination_y - position_y) / screen_height",
                "euclidean_distance / screen_diagonal",
                "previous_velocity_x / max_velocity_px_s",
                "previous_velocity_y / max_velocity_px_s",
                "step / max_steps",
            ],
            "screen": {"width_px": 4096, "height_px": 2304, "diagonal_px": SCREEN_DIAGONAL},
            "max_velocity_px_s": MAX_VELOCITY,
            "max_steps": int(MAX_STEPS),
        },
        "actions": {"size": 2, "bounds": [-1.0, 1.0], "transform": "SB3 SAC squashed action is not exported"},
        "log_std_clip": {"min": -20.0, "max": 2.0, "source": "stable_baselines3.sac.policies.Actor.get_action_dist_params"},
        "environment": {"dt_seconds": 1 / 120, "target_radius_px": TARGET_RADIUS},
        "conversion": {
            "date_utc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "versions": versions,
            "metrics": metrics,
            "deterministic": True,
            "random_sampling_in_onnx": False,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-zip", type=Path)
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--model", type=Path, default=Path("resources/models/sac_mouse_v2.onnx"))
    parser.add_argument("--manifest", type=Path, default=Path("resources/models/sac_mouse_v2.manifest.json"))
    parser.add_argument("--corpus", type=Path, default=Path("tests/fixtures/onnx-corpus.json"))
    parser.add_argument("--evidence", type=Path, default=Path("docs/evidence/task-3-conversion.json"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source_zip = args.source_zip or Path(__file__).resolve().parents[2] / "cloakbrowser-pro/temp/bumblebee/src/bumblebee/models/sac_mouse_v2.zip"
    source_sha256 = verify_source_hash(source_zip)
    actor, versions = load_actor(source_zip)
    versions["onnx"] = _package_version("onnx")
    versions["onnxruntime"] = _package_version("onnxruntime")
    observations = build_observations()

    if not args.verify_only:
        export_model(actor, args.model)

    if not args.model.exists():
        raise FileNotFoundError(args.model)
    python_mean, python_log_std = torch_outputs(actor, observations)
    onnx_mean, onnx_log_std = onnx_outputs(args.model, observations)
    metrics = compare(python_mean, python_log_std, onnx_mean, onnx_log_std)

    if not args.verify_only:
        cases = [
            {
                "observation": observation.tolist(),
                "mean": mean.tolist(),
                "log_std": log_std.tolist(),
            }
            for observation, mean, log_std in zip(observations, python_mean, python_log_std)
        ]
        write_json(
            args.corpus,
            {"schema_version": 1, "seed": CORPUS_SEED, "cases": cases},
        )
        write_json(args.manifest, manifest(args.model, args.corpus, source_sha256, versions, metrics))
    else:
        verify_artifact_metadata(args.model, args.corpus, args.manifest)

    evidence = {
        "task": 3,
        "source_sha256_verified_before_deserialization": True,
        "source_sha256": source_sha256,
        "model_sha256": sha256(args.model),
        "model_size_bytes": args.model.stat().st_size,
        "corpus_sha256": sha256(args.corpus) if args.corpus.exists() else None,
        "corpus_cases": int(len(observations)),
        "opset": OPSET_VERSION,
        "versions": versions,
        "onnxruntime": _package_version("onnxruntime"),
        "onnx": _package_version("onnx"),
        "metrics": metrics,
        "verify_only": args.verify_only,
    }
    write_json(args.evidence, evidence)
    print(json.dumps(evidence, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
