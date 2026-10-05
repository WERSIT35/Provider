/**
 * Small, dependency-free statistics for the RNG validation battery
 * (scripts/rng-stats.ts) and its unit test. Not a replacement for a lab's
 * Dieharder / NIST SP 800-22 / TestU01 run (scripts/rng-dump.ts feeds those); a
 * fast internal check that the stream and the engine's mappings are uniform.
 */

/** ln Γ(x), Lanczos approximation (|error| < 2e-10 for x > 0). */
export function lnGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Regularized upper incomplete gamma Q(a, x) (Numerical Recipes gammq). */
export function gammaQ(a: number, x: number): number {
  if (x < 0 || a <= 0) throw new Error("gammaQ: bad arguments");
  if (x === 0) return 1;
  const gln = lnGamma(a);
  if (x < a + 1) {
    // Series for P, then Q = 1 - P.
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 10_000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  // Continued fraction (Lentz).
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 10_000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h;
}

/** Complementary error function (Numerical Recipes erfcc, |rel error| < 1.2e-7). */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    );
  return x >= 0 ? r : 2 - r;
}

/** Upper-tail p-value of a chi-square statistic. Wilson–Hilferty for very large df. */
export function chiSquareP(stat: number, df: number): number {
  if (df > 1000) {
    const z = (Math.cbrt(stat / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
    return 0.5 * erfc(z / Math.SQRT2);
  }
  return gammaQ(df / 2, stat / 2);
}

/**
 * Pearson chi-square of observed counts against expected probabilities. Bins whose
 * expected count is under 5 are pooled (the test's validity condition).
 */
export function chiSquare(observed: ArrayLike<number>, probs?: ArrayLike<number>): { stat: number; df: number; p: number } {
  const k = observed.length;
  let n = 0;
  for (let i = 0; i < k; i++) n += observed[i];
  const pooled: Array<{ o: number; e: number }> = [];
  let accO = 0;
  let accE = 0;
  for (let i = 0; i < k; i++) {
    accO += observed[i];
    accE += n * (probs ? probs[i] : 1 / k);
    if (accE >= 5) {
      pooled.push({ o: accO, e: accE });
      accO = 0;
      accE = 0;
    }
  }
  if (accE > 0 && pooled.length) {
    pooled[pooled.length - 1].o += accO;
    pooled[pooled.length - 1].e += accE;
  }
  let stat = 0;
  for (const { o, e } of pooled) stat += ((o - e) * (o - e)) / e;
  const df = pooled.length - 1;
  return { stat, df, p: chiSquareP(stat, df) };
}

const popcount8 = new Uint8Array(256).map((_, i) => {
  let c = 0;
  for (let v = i; v; v >>= 1) c += v & 1;
  return c;
});

/** NIST SP 800-22 §2.1 frequency (monobit) test over all bits. */
export function monobit(bytes: Uint8Array): { stat: number; p: number } {
  let ones = 0;
  for (let i = 0; i < bytes.length; i++) ones += popcount8[bytes[i]];
  const n = bytes.length * 8;
  const s = Math.abs(2 * ones - n) / Math.sqrt(n);
  return { stat: s, p: erfc(s / Math.SQRT2) };
}

/** NIST SP 800-22 §2.3 runs test over all bits. */
export function runs(bytes: Uint8Array): { stat: number; p: number } {
  const n = bytes.length * 8;
  let ones = 0;
  for (let i = 0; i < bytes.length; i++) ones += popcount8[bytes[i]];
  const pi = ones / n;
  if (Math.abs(pi - 0.5) >= 2 / Math.sqrt(n)) return { stat: NaN, p: 0 }; // monobit pre-test failed
  let v = 1;
  let prev = bytes[0] >> 7;
  for (let i = 0; i < bytes.length; i++) {
    for (let b = 7; b >= 0; b--) {
      const bit = (bytes[i] >> b) & 1;
      if (i === 0 && b === 7) continue;
      if (bit !== prev) v += 1;
      prev = bit;
    }
  }
  const num = Math.abs(v - 2 * n * pi * (1 - pi));
  const den = 2 * Math.sqrt(2 * n) * pi * (1 - pi);
  return { stat: v, p: erfc(num / den) };
}
