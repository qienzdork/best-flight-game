// Skyline Run — the screenshot scenes behind ?shot=cover|rings|landing|title.
// Each scene flies the real flight model forward from a staged state with a
// simple autopilot (bank toward the target, hold altitude, cruise throttle),
// so every frame is what a short real flight looks like — and the same seed
// always gives the same frame.
import { stepFlight } from './flight.js';
import { distanceToNextRing, nextRing } from './missions.js';

const STEP = 1 / 60;

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Steer toward a point in the sky: bank into the heading error, pitch to hold
 * the target altitude, and ease the throttle toward cruise.
 */
function autopilotTo(plane, tx, ty, tz, dt) {
  const desiredHeading = Math.atan2(tx - plane.x, -(tz - plane.z));
  const error = wrapAngle(desiredHeading - plane.heading);
  const roll = clamp(error * 1.4, -1, 1);
  // Gentle altitude hold: a steep dive ruins the shot and the airframe.
  const pitch = clamp((plane.y - ty) * 0.02, -0.6, 0.6);
  const throttleDelta = (0.72 - plane.throttle) * dt * 2.5;
  return { pitch, roll, throttleDelta, afterburner: false };
}

/** Glide down the final approach: line up on the runway and ride the slope. */
function autopilotLand(plane, dt) {
  const error = wrapAngle(0 - plane.heading);
  const roll = clamp(error * 1.6, -1, 1);
  const slopeY = Math.max(14, 10 + (plane.z - 1250) * 0.08);
  const pitch = clamp((plane.y - slopeY) * 0.03, -0.5, 0.5);
  const throttleDelta = (0.32 - plane.throttle) * dt * 2.5;
  return { pitch, roll, throttleDelta, afterburner: false };
}

function flyForward(world, seconds, pilot) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    const ctl = pilot(world.plane, STEP);
    stepFlight(world.plane, ctl, STEP);
    world.time += STEP;
    if (world.plane.crashed) break;
  }
}

/**
 * If the autopilot pranged the jet, put it back in level flight near the
 * intended viewpoint so the shot still shows a flying aircraft.
 */
function ensureFlying(world, x, y, z, heading) {
  const plane = world.plane;
  if (!plane.crashed) return;
  plane.crashed = false;
  plane.crashReason = '';
  plane.x = x;
  plane.y = y;
  plane.z = z;
  plane.heading = heading;
  plane.pitch = 0;
  plane.roll = 0;
  plane.speed = 68;
  plane.verticalSpeed = 0;
  plane.onGround = false;
  plane.airborne = true;
}

/**
 * Stage the world for a screenshot and return the screen to draw.
 * `world` carries { plane, mission, time, clouds }.
 */
export function stageShot(name, world) {
  const { plane, mission } = world;
  if (name === 'rings') {
    // Low over the lake, threading the early rings with the valley ahead.
    mission.ringIndex = 1;
    mission.phase = 'rings';
    plane.x = 550;
    plane.z = -450;
    plane.y = 105;
    plane.heading = Math.atan2(450 - 550, -(-250 + 450));
    plane.pitch = 0;
    plane.roll = 0;
    plane.speed = 72;
    plane.throttle = 0.72;
    plane.fuel = 82;
    plane.onGround = false;
    plane.airborne = true;
    flyForward(world, 2, (p, dt) => {
      const ring = nextRing(mission);
      return ring ? autopilotTo(p, ring.x, ring.y, ring.z, dt) : autopilotTo(p, 0, 80, 900, dt);
    });
    ensureFlying(world, 480, 95, -320, Math.atan2(450 - 480, -(-250 + 320)));
    return 'play';
  }
  if (name === 'landing') {
    // On final: gear down, flaps down, the strip filling the windscreen.
    mission.ringIndex = mission.rings.length;
    mission.phase = 'return';
    plane.x = 0;
    plane.z = 1550;
    plane.y = 58;
    plane.heading = 0;
    plane.pitch = 0.05;
    plane.roll = 0;
    plane.speed = 46;
    plane.throttle = 0.34;
    plane.fuel = 38;
    plane.gearDown = true;
    plane.flapsDown = true;
    plane.onGround = false;
    plane.airborne = true;
    flyForward(world, 2.5, (p, dt) => autopilotLand(p, dt));
    ensureFlying(world, 0, 34, 1435, 0);
    return 'play';
  }
  if (name === 'title') {
    // Parked on the runway at dawn light, the valley spread out ahead.
    plane.x = 0;
    plane.z = 1180;
    plane.y = 10;
    plane.heading = 0;
    plane.pitch = 0;
    plane.roll = 0;
    plane.speed = 0;
    plane.throttle = 0;
    plane.fuel = 100;
    plane.onGround = true;
    plane.airborne = false;
    return 'title';
  }
  // Default: the cover. The last ring hangs ahead with Skyline Field beyond it.
  mission.ringIndex = mission.rings.length - 1;
  mission.phase = 'rings';
  plane.x = 140;
  plane.z = 1680;
  plane.y = 120;
  plane.heading = 0;
  plane.pitch = 0;
  plane.roll = 0;
  plane.speed = 70;
  plane.throttle = 0.72;
  plane.fuel = 64;
  plane.onGround = false;
  plane.airborne = true;
  flyForward(world, 4, (p, dt) => {
    const ring = nextRing(mission);
    return ring ? autopilotTo(p, ring.x, ring.y, ring.z, dt) : autopilotTo(p, 0, 80, 900, dt);
  });
  ensureFlying(world, 60, 70, 1380, 0);
  return 'play';
}

/** How far the staged scene flew, for the shot report. */
export function shotInfo(world) {
  return {
    ringDistance: Math.round(distanceToNextRing(world.mission, world.plane)),
    altitude: Math.round(world.plane.y),
    speed: Math.round(world.plane.speed * 1.944),
  };
}
