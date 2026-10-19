// Analizador de escala tonal en un Web Worker: FFT (Cooley-Tukey), autocorrelación y perfiles Krumhansl-Kessler
const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const u = i + k, v = u + h, xr = re[v] * cr - im[v] * ci, xi = re[v] * ci + im[v] * cr;
        re[v] = re[u] - xr; im[v] = im[u] - xi; re[u] += xr; im[u] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// Frecuencia fundamental por autocorrelación: r[l] = Σ x[i]·x[i+l]
function f0(x, sr) {
  const n = x.length; let r0 = 0;
  for (let i = 0; i < n; i++) r0 += x[i] * x[i];
  if (r0 / n < 1e-5) return 0;
  const lo = Math.floor(sr / 1000), hi = Math.floor(sr / 70), r = new Float64Array(hi + 2); let mx = 0;
  for (let l = lo - 1; l <= hi + 1; l++) { let s = 0; for (let i = 0; i + l < n; i++) s += x[i] * x[i + l]; r[l] = s; if (l >= lo && l <= hi && s > mx) mx = s; }
  if (mx / r0 < 0.5) return 0;
  for (let l = lo; l <= hi; l++)
    if (r[l] > r[l - 1] && r[l] >= r[l + 1] && r[l] >= 0.9 * mx) {
      const d = r[l - 1] - 2 * r[l] + r[l + 1];
      return sr / (l + (d ? (0.5 * (r[l - 1] - r[l + 1])) / d : 0));
    }
  return 0;
}
const pc = (f) => ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12;
const norm = (v) => { const s = v.reduce((a, b) => a + b, 0) || 1; return v.map((x) => x / s); };
function corr(a, b) {
  const ma = a.reduce((s, x) => s + x, 0) / 12, mb = b.reduce((s, x) => s + x, 0) / 12; let n = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db || 1);
}
function analyze(x, sr) {
  const t0 = Date.now(), N = 4096, H = 2048, A = 2048;
  const chroma = new Array(12).fill(0), hist = new Array(12).fill(0);
  const w = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))); // ventana de Hann
  let frames = 0, voiced = 0;
  for (let s = 0; s + N <= x.length; s += H) {
    frames++;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * w[i];
    fft(re, im);
    const mag = new Float64Array(N / 2).map((_, k) => Math.hypot(re[k], im[k]));
    for (let k = 2; k < N / 2 - 1; k++) {
      const f = (k * sr) / N;
      if (f > 65 && f < 2100 && mag[k] > mag[k - 1] && mag[k] > mag[k + 1]) chroma[pc(f)] += mag[k];
    }
    const p = f0(x.subarray(s, s + A), sr);
    if (p) { hist[pc(p)]++; voiced++; }
  }
  const nc = norm(chroma), nh = norm(hist);
  const prof = nc.map((v, i) => (voiced ? 0.5 * v + 0.5 * nh[i] : v));
  const rank = [];
  for (let t = 0; t < 12; t++) for (const [mode, P] of [["mayor", MAJ], ["menor", MIN]])
    rank.push({ tonic: t, mode, r: corr(prof, P.map((_, i) => P[(i - t + 12) % 12])) });
  rank.sort((a, b) => b.r - a.r);
  return { key: rank[0], ranking: rank.slice(0, 4), chroma: nc, frames, voiced, ms: Date.now() - t0 };
}
if (typeof self !== "undefined" && typeof window === "undefined") self.onmessage = (e) => self.postMessage(analyze(e.data.samples, e.data.sr));
