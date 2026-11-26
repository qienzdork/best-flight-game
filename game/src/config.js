// Skyline Run — tuning constants. One clear job: every number the flight model,
// the world and the missions share lives here, so a balance change is one edit.
export const VIEW = {
  width: 1280,
  height: 800,
  focalScale: 1.05,
  viewDistance: 1700,
  cellSize: 100,
};

export const WORLD = {
  size: 4200, // terrain spans -2100..2100 m on both axes
  waterLevel: 6, // metres above the datum; the lake sits here
  maxHill: 150,
  seed: 7,
};

export const PLANE = {
  minSpeed: 26, // m/s — below this the wing stops flying
  cruiseSpeed: 68,
  maxSpeed: 118,
  accel: 14, // m/s^2 toward the throttle target
  drag: 0.35,
  climbRate: 16, // m/s at full pitch up and cruise speed
  sinkRate: 9,
  rollRate: 1.9, // rad/s
  pitchRate: 0.85,
  turnRate: 0.55, // rad/s at full bank
  fuelDrain: 0.16, // per second at idle throttle
  fuelDrainThrottle: 0.5, // extra per second at full throttle
  afterburnerDrain: 1.4,
  ringFuelBonus: 7,
  startFuel: 100,
  cameraDistance: 42,
  cameraHeight: 11,
};

export const RUNWAY = {
  x: 0,
  z: 900, // centre of the strip, south end of the valley
  heading: 0, // runway runs north-south (heading 360/180)
  length: 700,
  width: 46,
  elevation: 8,
};

export const RINGS = {
  count: 8,
  radius: 15,
  passScore: 100,
  passTolerance: 1.35, // how far outside the ring centre still counts, in radii
};

export const SCORE = {
  landingBase: 250,
  landingSmoothBonus: 250, // scaled by how gentle the touchdown was
  sortieTimeBonus: 300, // scaled by time left on the sortie clock
  sortieClock: 240, // seconds per sortie before the time bonus is gone
};

export const KEYS = {
  pitchUp: ['ArrowUp', 'KeyI'],
  pitchDown: ['ArrowDown', 'KeyK'],
  rollLeft: ['ArrowLeft', 'KeyA', 'KeyJ'],
  rollRight: ['ArrowRight', 'KeyD', 'KeyL'],
  throttleUp: ['ShiftLeft', 'ShiftRight', 'KeyW'],
  throttleDown: ['ControlLeft', 'ControlRight', 'KeyS'],
  gear: ['KeyG'],
  afterburner: ['Space'],
  flaps: ['KeyF'],
  pause: ['KeyP', 'Escape'],
  restart: ['KeyR'],
  mute: ['KeyM'],
  start: ['Enter'],
};
