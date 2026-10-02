/**
 * Greedy CTC decode.
 * logits: flattened (batch=1, time, classes) Float32Array of softmax/log-softmax
 *         outputs. Only batch=1 is supported.
 */
export function greedyCtcDecode(
  logits: Float32Array,
  dims: readonly number[],
  alphabet: string,
  blank: number,
): string {
  return greedyCtcDecodeWithConfidence(logits, dims, alphabet, blank).text;
}

/**
 * Probability of `bestVal` within one time step, whatever the output scale:
 * a row that is already a distribution (softmax) is used as-is; raw logits and
 * log-softmax are normalised with a softmax (identity for log-softmax).
 */
function stepProbability(logits: Float32Array, offset: number, classes: number, bestVal: number): number {
  let rawSum = 0;
  let rawMin = Infinity;
  for (let c = 0; c < classes; c++) {
    rawSum += logits[offset + c];
    rawMin = Math.min(rawMin, logits[offset + c]);
  }
  if (rawMin >= 0 && Math.abs(rawSum - 1) < 1e-3) return bestVal;
  let expSum = 0;
  for (let c = 0; c < classes; c++) expSum += Math.exp(logits[offset + c] - bestVal);
  return 1 / expSum;
}

/**
 * Greedy CTC decode plus a confidence in [0, 1]: the probability of the
 * least-certain emitted character (one doubtful digit makes the weight doubtful).
 */
export function greedyCtcDecodeWithConfidence(
  logits: Float32Array,
  dims: readonly number[],
  alphabet: string,
  blank: number,
): { text: string; confidence: number } {
  if (dims.length !== 3 || dims[0] !== 1) {
    throw new Error(`expected logits dims [1, T, C], got [${dims.join(", ")}]`);
  }
  const time = dims[1];
  const classes = dims[2];
  const out: string[] = [];
  let prev = -1;
  let minProb = 1;
  for (let t = 0; t < time; t++) {
    const offset = t * classes;
    let best = 0;
    let bestVal = logits[offset];
    for (let c = 1; c < classes; c++) {
      const v = logits[offset + c];
      if (v > bestVal) {
        bestVal = v;
        best = c;
      }
    }
    if (best === blank) {
      prev = -1;
      continue;
    }
    if (best === prev) continue;
    out.push(alphabet[best]);
    prev = best;
    minProb = Math.min(minProb, stepProbability(logits, offset, classes, bestVal));
  }
  return { text: out.join(""), confidence: out.length ? minProb : 0 };
}
