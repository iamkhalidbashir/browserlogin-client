# Spike 006: SAC ONNX-WASM under Bun compile and Electrobun

## Decision

Selected `onnxruntime-web@1.27.0` with the WASM execution provider. The
committed Task 3 model is used directly:

- Model: `resources/models/sac_mouse_v2.onnx`
- Input: `observation`, `float32[1,10]`
- Outputs: `mean`, `float32[1,2]`; `log_std`, `float32[1,2]`
- Manifest SHA-256: `55c7dcccfbf436bf49d2f7f8e1a5b06bdeba5e23d2ec55090a8f0b099fd2930b`

Adjacent-file delivery was selected. The spike supplies the model as bytes
and sets `ort.env.wasm.wasmBinary` to the matching local
`ort-wasm-simd-threaded.wasm`. It does not use `onnxruntime-node`, native
bindings, network model downloads, or runtime WASM fetches. The fetch wrapper
is installed around session creation and inference and is restored afterward.

## Evidence

All commands ran with Bun `1.2.23` from the repository root.

Source:

```sh
bun scripts/spike-onnx-wasm.ts
```

```text
{"loaded":true,"ms":191.268,"source":"onnxruntime-web-wasm","model":"/Users/bashir/Projects/OpensourceProjects/browserlogin-client/resources/models/sac_mouse_v2.onnx","wasm":"/Users/bashir/Projects/OpensourceProjects/browserlogin-client/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm","fetches":0,"modelSha256":"55c7dcccfbf436bf49d2f7f8e1a5b06bdeba5e23d2ec55090a8f0b099fd2930b","mean":[9.837336540222168,24.51468276977539],"log_std":[2,2]}
```

Compiled adjacent-file binary:

```sh
cp resources/models/sac_mouse_v2.onnx /tmp/task6-model.onnx
cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm /tmp/task6-wasm.wasm
bun build --compile scripts/spike-onnx-wasm.ts --outfile /tmp/task6-onnx-wasm
/tmp/task6-onnx-wasm --model /tmp/task6-model.onnx --wasm /tmp/task6-wasm.wasm
```

The source and compiled output arrays are recorded byte-for-byte as JSON
float32 values in `.omo/evidence/task-6-compiled.txt`. Both report
`fetches:0` and the manifest hash.

The compiled run reported:

```text
{"loaded":true,"ms":177.165,"source":"onnxruntime-web-wasm","model":"/tmp/task6-model.onnx","wasm":"/tmp/task6-wasm.wasm","fetches":0,"modelSha256":"55c7dcccfbf436bf49d2f7f8e1a5b06bdeba5e23d2ec55090a8f0b099fd2930b","mean":[9.837336540222168,24.51468276977539],"log_std":[2,2]}
```

Missing and corrupt model checks:

```sh
bun scripts/spike-onnx-wasm.ts --model /tmp/task6-does-not-exist.onnx
bun scripts/spike-onnx-wasm.ts --corrupt-model
```

Both exit nonzero. The missing run emits `MODEL_ASSET_MISSING` with the
searched path. The corrupt run emits `MODEL_HASH_MISMATCH` with expected and
actual hashes. Full outputs are in `.omo/evidence/task-6-model-missing.txt`.

## Electrobun

An isolated project was created under `/tmp/task6-electrobun`, pinned to the
repository's `Electrobun 2.0.1-beta.14` and Hutch offline mechanism. Its Bun
main entrypoint used the same script, model bytes, WASM bytes, and fetch
counter. `hutch electrobun config --env=dev` and
`DASH_RELEASE_OFFLINE=1 hutch electrobun build --env=dev` both succeeded; the
main process produced the same output arrays and `fetches:0`. The temporary
project, package, app bundle, and copied assets were deleted after capture.

The isolated Bun main-process output was:

```text
{"loaded":true,"ms":178.783,"source":"onnxruntime-web-wasm","model":"/tmp/task6-electrobun/resources/models/sac_mouse_v2.onnx","wasm":"/tmp/task6-electrobun/ort-wasm-simd-threaded.wasm","fetches":0,"modelSha256":"55c7dcccfbf436bf49d2f7f8e1a5b06bdeba5e23d2ec55090a8f0b099fd2930b","mean":[9.837336540222168,24.51468276977539],"log_std":[2,2]}
electrobun build complete: /private/tmp/task6-electrobun/build/dev-macos-arm64
```

## Latency and constraints

`ms` measures session creation plus one inference on the local machine. It is
feasibility evidence, not a production benchmark. The `.wasm` file and
`onnxruntime-web` JavaScript package are both from version `1.27.0`, avoiding
the documented runtime artifact mismatch failure. The compiled binary uses
adjacent files because Bun 1.2.23's CLI does not expose the newer `--asset`
flag; this is explicit and testable packaging behavior.

Context7 was unavailable because its monthly quota was exhausted. Installed
declarations, the package's local distribution, and official ONNX Runtime,
Bun, and Electrobun documentation were inspected instead.
