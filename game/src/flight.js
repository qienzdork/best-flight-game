// Skyline Run — the flight model. One clear job: keep the jet's state honest.
// Arcade physics with real trade-offs: throttle sets speed, bank turns the jet,
// pitch trades speed for altitude, and below stall speed the wing gives up.
import { PLANE, RUNWAY } from './config.js';
import { terrainHeight, onRunway } from './terrain.js';

export function createPlane() {
  return {
    x: 0,
    z: 300, // on the runway threshold, ready to roll
    y: RUNWAY.elevation + 2,
    heading: 0, // radians, 0 = north, grows clockwise
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    fuel: PLANE.startFuel,
    damage: 0,
    gearDown: true,
    flapsDown: false,
    afterburner: false,
    verticalSpeed: 0,
    touchdownVs: 0, // vertical speed at the moment of touchdown, for scoring
    onGround: true,
    airborne: false,
    stalled: false,
    crashed: false,
    crashReason: '',
    landed: false,
    groundSpeed: 0,
  };
}

/** Where the sortie starts: parked on the runway, nose pointing north. */
export function placeOnRunway(plane) {
  plane.x = 0;
  plane.z = RUNWAY.z + RUNWAY.length / 2 - 60;
  plane.y = RUNWAY.elevation + 2;
  plane.heading = 0;
  plane.pitch = 0;
  plane.roll = 0;
  plane.speed = 0;
  plane.throttle = 0;
  plane.fuel = PLANE.startFuel;
  plane.damage = 0;
  plane.gearDown = true;
  plane.flapsDown = false;
  plane.afterburner = false;
  plane.onGround = true;
  plane.airborne = false;
  plane.crashed = false;
  plane.landed = false;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Advance the jet one step. `ctl` is { pitch, roll, throttleDelta, afterburner,
 * gearToggle, flapsToggle }. Returns an event string: 'takeoff', 'stall',
 * 'landed', 'crash-terrain', 'crash-hard', 'fuel-out', or ''.
 */
export function stepFlight(plane, ctl, dt) {
  if (plane.crashed) return '';
  let event = '';

  plane.throttle = clamp(plane.throttle + ctl.throttleDelta, 0, 1);
  plane.afterburner = ctl.afterburner && plane.throttle > 0.7 && plane.fuel > 0;
  const effectiveThrottle = plane.afterburner ? 1.25 : plane.throttle;

  // Attitude: roll and pitch ease toward the pilot's demand.
  const targetRoll = ctl.roll * 1.15;
  plane.roll += (targetRoll - plane.roll) * Math.min(1, dt * 4.5);
  const targetPitch = clamp(ctl.pitch * 0.55, -0.5, 0.5);
  plane.pitch += (targetPitch - plane.pitch) * Math.min(1, dt * 3.5);

  // Speed chases the throttle target; drag and climb bleed it off.
  let targetSpeed = PLANE.minSpeed + effectiveThrottle * (PLANE.maxSpeed - PLANE.minSpeed);
  if (plane.flapsDown) targetSpeed *= 0.82;
  const climbBleed = Math.max(0, plane.pitch) * 26;
  const accel = plane.speed < targetSpeed - climbBleed
    ? PLANE.accel
    : -PLANE.drag * 22;
  plane.speed = Math.max(0, plane.speed + accel * dt);

  // The stall: too slow and the nose drops no matter what the pilot asks.
  plane.stalled = plane.speed < PLANE.minSpeed && !plane.onGround;
  if (plane.stalled) {
    plane.pitch += (-0.35 - plane.pitch) * Math.min(1, dt * 2);
    if (plane.speed < 12) event = 'stall';
  }

  // Bank turns the jet; the turn tightens with speed and bank. Banking right
  // (positive roll) turns right: heading grows clockwise from north.
  const turn = plane.roll * PLANE.turnRate * clamp(plane.speed / PLANE.cruiseSpeed, 0.25, 1.3);
  plane.heading = wrapAngle(plane.heading + turn * dt);

  // Vertical speed comes from pitch and speed; the ground kills it.
  const ground = terrainHeight(plane.x, plane.z);
  const wasAirborne = plane.airborne;
  if (plane.onGround) {
    // Rolling on its wheels, the jet follows the ground it is on.
    plane.y = ground + 2;
    plane.verticalSpeed = 0;
    if (plane.speed > 34 && plane.pitch < -0.08) {
      plane.onGround = false;
      plane.airborne = true;
      event = 'takeoff';
    }
  } else {
    const climb = Math.sin(-plane.pitch) * plane.speed * 0.9;
    const sink = plane.stalled ? PLANE.sinkRate * 1.6 : PLANE.sinkRate * 0.25;
    plane.verticalSpeed = climb - sink * (1 - clamp(plane.speed / PLANE.cruiseSpeed, 0, 1) * 0.7);
    plane.y += plane.verticalSpeed * dt;
  }

  // Move forward along the heading.
  const forwardX = Math.sin(plane.heading);
  const forwardZ = -Math.cos(plane.heading);
  plane.x += forwardX * plane.speed * dt;
  plane.z += forwardZ * plane.speed * dt;
  // Keep the jet inside the valley; the ridge pushes back gently.
  const bound = 2050;
  if (Math.abs(plane.x) > bound) plane.x = Math.sign(plane.x) * bound;
  if (Math.abs(plane.z) > bound) plane.z = Math.sign(plane.z) * bound;
  if (plane.y > 900) plane.y = 900;

  // Fuel: throttle burns it, the burner guzzles it, rings top it up.
  if (!plane.onGround || plane.speed > 5) {
    plane.fuel -= (PLANE.fuelDrain + plane.throttle * PLANE.fuelDrainThrottle
      + (plane.afterburner ? PLANE.afterburnerDrain : 0)) * dt;
  }
  if (plane.fuel <= 0) {
    plane.fuel = 0;
    plane.throttle = 0;
    event = 'fuel-out';
  }

  // Ground contact: the moment of truth for every landing. Only a plane that
  // is actually descending can touch down: a jet that has just rotated off
  // the runway is climbing away on a vertical speed of zero, and re-landing
  // it in the same step would trap it on the ground forever.
  const clearance = plane.y - ground;
  if (!plane.onGround && clearance <= 2 && (plane.verticalSpeed < -0.5 || clearance <= 0)) {
    const descending = plane.verticalSpeed;
    // Keep the touchdown rate for scoring: the branches below zero it.
    plane.touchdownVs = descending;
    // Well under the terrain is not a landing, whatever the vertical speed.
    if (clearance < -3) {
      plane.crashed = true;
      plane.crashReason = 'Terrain impact';
      event = 'crash-terrain';
      return event;
    }
    const gentle = descending > -4.5 && Math.abs(plane.roll) < 0.35
      && Math.abs(plane.pitch) < 0.35 && plane.speed < 62;
    const aligned = onRunway(plane.x, plane.z);
    if (aligned && gentle && plane.gearDown) {
      plane.onGround = true;
      plane.airborne = false;
      plane.y = ground + 2;
      plane.verticalSpeed = 0;
      plane.pitch = 0;
      plane.roll = 0;
      plane.landed = true;
      event = 'landed';
    } else if (aligned && gentle && !plane.gearDown) {
      // A belly landing: the jet survives, the airframe remembers it.
      plane.damage += 45;
      plane.onGround = true;
      plane.airborne = false;
      plane.y = ground + 2;
      plane.verticalSpeed = 0;
      plane.speed *= 0.5;
      plane.landed = true;
      event = 'landed';
    } else if (aligned && plane.gearDown && descending <= -4.5 && descending > -9) {
      // A hard runway arrival: the jet survives, the airframe remembers it.
      plane.damage += Math.max(5, Math.min(40, (-descending - 4.5) * 9));
      plane.onGround = true;
      plane.airborne = false;
      plane.y = ground + 2;
      plane.verticalSpeed = 0;
      plane.speed *= 0.55;
      plane.landed = true;
      event = 'landed';
    } else if (aligned && plane.gearDown && descending > -4.5) {
      // A fast or banked touchdown: it stays down, but it cost the airframe.
      plane.damage += 15;
      plane.onGround = true;
      plane.airborne = false;
      plane.y = ground + 2;
      plane.verticalSpeed = 0;
      plane.speed *= 0.6;
      plane.pitch = 0;
      plane.roll = 0;
      plane.landed = true;
      event = 'landed';
    } else if (!aligned && descending > -4.5 && Math.abs(plane.roll) < 0.5 && plane.speed < 70) {
      // A rough-field arrival: the valley is forgiving once, at a price.
      plane.damage += 25;
      plane.onGround = true;
      plane.airborne = false;
      plane.y = ground + 2;
      plane.verticalSpeed = 0;
      plane.speed *= 0.5;
      plane.landed = true;
      event = 'landed';
    } else {
      plane.crashed = true;
      plane.crashReason = aligned ? 'Hard impact on the runway' : 'Terrain impact';
      event = 'crash-terrain';
    }
  }

  // Rolling on the ground: brakes bite, the jet slows to a stop.
  if (plane.onGround && !plane.crashed) {
    if (plane.throttle < 0.12) plane.speed = Math.max(0, plane.speed - 26 * dt);
    if (plane.speed < 0.5 && plane.landed) plane.speed = 0;
  }

  // Damage from a battered airframe eventually ends the sortie.
  if (plane.damage >= 100 && !plane.crashed) {
    plane.crashed = true;
    plane.crashReason = 'Airframe failure';
    event = 'crash-hard';
  }
  return event;
}
