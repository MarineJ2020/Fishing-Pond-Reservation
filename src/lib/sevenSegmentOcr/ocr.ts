import * as ort from "onnxruntime-web/wasm";

import { greedyCtcDecodeWithConfidence } from "./ctc";
import { preprocess, type ImageSource, type InputSpec } from "./preprocess";

interface ModelMetadata {
  alphabet: string;
  blank: number;
  inputShape: [number, number, number, number]; // [N, C, H, W]
  inputName: string;
}

export class OcrSession {
  private session!: ort.InferenceSession;
  private meta!: ModelMetadata;
  private spec!: InputSpec;

  async load(
    modelUrl = "model/recognizer.onnx",
    metaUrl = "model/alphabet.json",
  ): Promise<void> {
    const metaResp = await fetch(metaUrl);
    if (!metaResp.ok) throw new Error(`failed to load metadata: ${metaResp.status}`);
    this.meta = (await metaResp.json()) as ModelMetadata;
    const [, c, h, w] = this.meta.inputShape;
    this.spec = { channels: c, height: h, width: w, name: this.meta.inputName };

    this.session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ["wasm"], // WASM is universally supported; WebGPU can be added later
      graphOptimizationLevel: "all",
    });
  }

  async recognize(image: ImageSource): Promise<string> {
    return (await this.recognizeWithConfidence(image)).text;
  }

  /** Text plus the model's confidence (0-1) in its least-certain character. */
  async recognizeWithConfidence(image: ImageSource): Promise<{ text: string; confidence: number }> {
    if (!this.session) throw new Error("call load() first");
    const tensor = preprocess(image, this.spec);
    const out = await this.session.run({ [this.spec.name]: tensor });
    const logits = out[this.session.outputNames[0]];
    return greedyCtcDecodeWithConfidence(
      logits.data as Float32Array,
      logits.dims,
      this.meta.alphabet,
      this.meta.blank,
    );
  }
}
