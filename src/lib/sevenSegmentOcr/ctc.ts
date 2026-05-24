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
  if (dims.length !== 3 || dims[0] !== 1) {
    throw new Error(`expected logits dims [1, T, C], got [${dims.join(", ")}]`);
  }
  const time = dims[1];
  const classes = dims[2];
  const out: string[] = [];
  let prev = -1;
  for (let t = 0; t < time; t++) {
    let best = 0;
    let bestVal = logits[t * classes];
    for (let c = 1; c < classes; c++) {
      const v = logits[t * classes + c];
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
  }
  return out.join("");
}
