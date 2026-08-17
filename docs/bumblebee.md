# Bumblebee human-input model

BrowserLogin Client uses a verified ONNX export of the Bumblebee `sac_mouse_v2` stochastic Soft Actor-Critic policy for mouse trajectories. It is an input-policy component, not a browser fingerprint or credential source.

## Provenance

| Item           | Value                                                              |
| -------------- | ------------------------------------------------------------------ |
| Source archive | External `sac_mouse_v2.zip` (not committed)                        |
| Source SHA-256 | `51900ffb4cfd724592235b8e20dfca0858f5b386543ff975650c1cc5d598bd05` |
| Algorithm      | SAC, `MlpPolicy`                                                   |
| ONNX artifact  | `resources/models/sac_mouse_v2.onnx`                               |
| ONNX SHA-256   | `55c7dcccfbf436bf49d2f7f8e1a5b06bdeba5e23d2ec55090a8f0b099fd2930b` |
| Opset          | 17                                                                 |
| Corpus         | 1200 cases, seed `20260816`                                        |
| Corpus SHA-256 | `f7b3a3e18420184ba420181c52a8612bd1af634c0b24ba32c728d6447a5c0efa` |

The source hash is checked before Stable-Baselines3 deserializes it. Only ONNX, its manifest, and the finite-output corpus are committed.

## Contract

Input `observation` is float32 `[batch,10]`: normalized current position, destination, delta, distance, previous velocity, and step. Outputs are float32 `mean[batch,2]` and `log_std[batch,2]`; `log_std` is clipped to `[-20,2]`. Sampling and `tanh(mean + exp(log_std) * noise)` happen outside ONNX.

The policy uses a 4096×2304 training space, a 6500 px/s velocity scale, 96 maximum steps, and a `1/120 s` timestep. Runtime coordinates are mapped with finite/bounds checks.

## Conversion and verification

The script can bootstrap pinned dependencies through `uv` and verifies the source actor against ONNX Runtime:

```sh
python3 scripts/convert-sac-to-onnx.py --help
python3 scripts/convert-sac-to-onnx.py --verify-only
bun run test:onnx-fidelity
```

Recorded environment: Python 3.14.3, Stable-Baselines3 2.9.0, Torch 2.13.0, NumPy 2.5.2, ONNX 1.22.0, ONNX Runtime 1.28.0.

- max absolute error: `2.86102294921875e-06`
- mean absolute error: `1.4770546385989292e-07`
- non-finite outputs: `0`

## Fallback

Missing assets, hash mismatch, initialization failure, non-finite output, invalid trajectory, or cancellation triggers a bounded classical path and generic diagnostic. Movement/click/key/wheel pacing uses the selected human preset, caps work, and checks cancellation around awaited dispatches/sleeps.
