// Skyline Run — the valley. One clear job: answer "what is the ground here?"
// and "what should it look like?" for any (x, z) in the world. The terrain is a
// seeded fractal heightfield with a flattened airfield, a lake in the east basin,
// a road that follows the valley floor and a small town beside the runway.
import { WORLD, RUNWAY } from './config.js';
import { makeFractalNoise, makeRng } from './random.js';

const noise = makeFractalNoise(WORLD.seed, 420);
const half = WORLD.size / 2;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Distance from a point to the runway centreline, in metres. */
export function runwayDistance(x, z) {
  const along = Math.abs(z - RUNWAY.z);
  const across = Math.abs(x - RUNWAY.x);
  return { along, across };
}

/** True when (x, z) is on the paved strip. */
export function onRunway(x, z) {
  const d = runwayDistance(x, z);
  return d.across <= RUNWAY.width / 2 && d.along <= RUNWAY.length / 2;
}

/** True when (x, z) is on the flat graded apron around the strip. */
export function onApron(x, z) {
  const d = runwayDistance(x, z);
  return d.across <= RUNWAY.width / 2 + 60 && d.along <= RUNWAY.length / 2 + 60;
}

/** Ground height in metres at (x, z). The airfield is graded flat. */
export function terrainHeight(x, z) {
  const cx = clamp(x, -half, half);
  const cz = clamp(z, -half, half);
  // Valley floor: low in the middle, rising to ridges at the edges.
  const edge = Math.max(Math.abs(cx), Math.abs(cz)) / half;
  const bowl = Math.pow(edge, 2.2) * WORLD.maxHill;
  let h = noise(cx, cz) * 62 + bowl - 8;
  // The lake basin in the east: a smooth dip below the waterline.
  const lakeDx = (cx - 1250) / 620;
  const lakeDz = (cz + 500) / 520;
  const lakeD = lakeDx * lakeDx + lakeDz * lakeDz;
  if (lakeD < 1) h = lerp(h, WORLD.waterLevel - 9, (1 - lakeD) * 0.9);
  // The valley corridor: the ring course, the runway and the final approach are
  // carved down to a flat floor, so a jet can fly the course at 40–90 m and
  // come home on a clear glidepath instead of meeting a hillside.
  const d = distanceToSpine(cx, cz);
  if (d < 380) {
    const carve = clamp(1 - (d - 130) / 250, 0, 1) * 0.92;
    h = lerp(h, 12, carve);
  }
  // The airfield is graded flat so landings read as landings.
  if (onApron(cx, cz)) {
    const d2 = runwayDistance(cx, cz);
    const flat = Math.max(0, 1 - Math.max(0, d2.across - RUNWAY.width / 2) / 60);
    h = lerp(h, RUNWAY.elevation, flat);
  }
  return h;
}

// The valley spine: the ring course, the runway and the final approach south
// of the strip. Terrain near it is carved flat (see terrainHeight).
const SPINE = [
  [900, -650], [450, -250], [-100, 100], [-650, 450], [-350, 850],
  [150, 1150], [500, 1500], [0, 1250], [0, 900], [0, 2100],
];

function distanceToSpine(x, z) {
  let best = Infinity;
  for (let i = 0; i < SPINE.length - 1; i += 1) {
    const [ax, az] = SPINE[i];
    const [bx, bz] = SPINE[i + 1];
    const abx = bx - ax;
    const abz = bz - az;
    const len2 = abx * abx + abz * abz;
    const t = len2 === 0 ? 0 : clamp(((x - ax) * abx + (z - az) * abz) / len2, 0, 1);
    const px = ax + abx * t;
    const pz = az + abz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) best = d;
  }
  return best;
}

/** The road runs north-south along the valley floor, west of the runway. */
export function roadDistance(x, z) {
  const roadX = -420 + Math.sin(z * 0.0011) * 130;
  return Math.abs(x - roadX);
}

/** The town sits west of the airfield: a grid of streets around (-620, 780). */
export function townDistance(x, z) {
  const dx = (x + 620) / 300;
  const dz = (z - 780) / 260;
  return Math.max(Math.abs(dx), Math.abs(dz));
}

function shade(base, light) {
  return `rgb(${base[0] + light},${base[1] + light},${base[2] + light})`;
}

/**
 * The ground colour for a cell centre, with a little per-cell variation so the
 * valley reads as fields and scrub rather than one flat tint. Returns a CSS
 * colour string. `light` is a small brightness shift from the slope.
 */
export function terrainColor(x, z, light) {
  const h = terrainHeight(x, z);
  const rng = makeRng(Math.floor(x * 0.37 + z * 0.91) >>> 0);
  const jitter = Math.floor((rng() - 0.5) * 14);
  if (h < WORLD.waterLevel) return shade([38, 106, 158], light + jitter);
  if (onRunway(x, z)) return shade([52, 54, 60], light);
  if (onApron(x, z)) return shade([96, 104, 78], light + jitter);
  if (roadDistance(x, z) < 9) return shade([58, 56, 52], light);
  if (townDistance(x, z) < 1) {
    // Streets and rooftops: a checker of warm grey and terracotta.
    const block = (Math.floor((x + 620) / 42) + Math.floor((z - 780) / 42)) % 2 === 0;
    return block ? shade([122, 104, 88], light) : shade([150, 96, 74], light);
  }
  if (h > 96) return shade([148, 138, 122], light + jitter); // bare rock up high
  if (h > 55) return shade([94, 116, 66], light + jitter); // scrub on the slopes
  return shade([74, 128, 62], light + jitter); // valley grass
}

/** True when the cell is water (drawn with a sparkle instead of grass). */
export function isWater(x, z) {
  return terrainHeight(x, z) < WORLD.waterLevel && !onRunway(x, z);
}

/** The ring course: a valley tour that starts over the lake and ends on final. */
export function ringCourse(sortie) {
  const rings = [];
  if (sortie === 1) {
    const path = [
      [900, -650, 95], [450, -250, 80], [-100, 100, 70], [-650, 450, 85],
      [-350, 850, 60], [150, 1150, 55], [500, 1500, 70], [0, 1250, 45],
    ];
    for (const [x, z, y] of path) rings.push({ x, z, y });
  } else {
    // Sortie 2: tighter, lower, and it threads the ridge gap.
    const path = [
      [1100, -900, 70], [600, -500, 55], [100, -150, 48], [-500, 150, 60],
      [-950, 500, 55], [-600, 950, 42], [-100, 1350, 38], [0, 1250, 40],
    ];
    for (const [x, z, y] of path) rings.push({ x, z, y });
  }
  return rings;
}

/** Clouds: fixed puffs that drift slowly, placed by seed so shots repeat. */
export function makeClouds() {
  const rng = makeRng(WORLD.seed * 31 + 5);
  const clouds = [];
  for (let i = 0; i < 46; i += 1) {
    clouds.push({
      x: (rng() - 0.5) * WORLD.size * 1.4,
      z: (rng() - 0.5) * WORLD.size * 1.4,
      y: 260 + rng() * 160,
      size: 90 + rng() * 160,
      speed: 2 + rng() * 3,
    });
  }
  return clouds;
}
