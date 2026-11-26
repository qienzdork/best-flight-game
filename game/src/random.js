// Skyline Run — deterministic randomness. A tiny mulberry32 stream plus smooth
// value noise, so the same seed always builds the same valley, lake and clouds.
// Nothing here reads the clock or the network: screenshots stay reproducible.
export function makeRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** A 2D value-noise field: a grid of random heights, smoothly interpolated. */
export function makeNoise(seed, cell) {
  const rng = makeRng(seed);
  const size = 64;
  const grid = new Float32Array((size + 1) * (size + 1));
  for (let i = 0; i < grid.length; i += 1) grid[i] = rng();
  function at(gx, gz) {
    const x = ((gx % size) + size) % size;
    const z = ((gz % size) + size) % size;
    return grid[z * (size + 1) + x];
  }
  return function noise(x, z) {
    const gx = x / cell;
    const gz = z / cell;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const fx = smooth(gx - x0);
    const fz = smooth(gz - z0);
    const a = at(x0, z0);
    const b = at(x0 + 1, z0);
    const c = at(x0, z0 + 1);
    const d = at(x0 + 1, z0 + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
}

/** Fractal noise: three octaves of value noise, the ridged look of real hills. */
export function makeFractalNoise(seed, cell) {
  const n1 = makeNoise(seed, cell);
  const n2 = makeNoise(seed + 101, cell / 2.3);
  const n3 = makeNoise(seed + 202, cell / 5.1);
  return function fractal(x, z) {
    return n1(x, z) * 0.55 + n2(x, z) * 0.3 + n3(x, z) * 0.15;
  };
}
