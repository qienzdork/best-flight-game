// Skyline Run — sorties and scoring. One clear job: turn a flight into a game.
// A sortie is a ring course followed by a landing back at Skyline Field. Rings
// pay points and fuel; the landing pays for how gently it was done and how fast
// the sortie was flown. Finish one and the next sortie is tighter and lower.
import { RINGS, SCORE, RUNWAY } from './config.js';
import { ringCourse } from './terrain.js';

export function createMission() {
  return {
    sortie: 1,
    rings: ringCourse(1),
    ringIndex: 0,
    ringsCleared: 0,
    score: 0,
    sortieScore: 0,
    sortieTime: 0,
    clock: SCORE.sortieClock,
    phase: 'rings', // 'rings' | 'return' | 'done'
    message: '',
    messageUntil: 0,
    bestLanding: null,
    sortiesCompleted: 0,
    totalRings: 0,
  };
}

function ringCenter(mission, index) {
  return mission.rings[index];
}

/** Distance from the jet to the centre of the next ring, in metres. */
export function distanceToNextRing(mission, plane) {
  const ring = ringCenter(mission, mission.ringIndex);
  if (!ring) return Infinity;
  const dx = plane.x - ring.x;
  const dy = plane.y - ring.y;
  const dz = plane.z - ring.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** The next ring, or null once the course is flown. */
export function nextRing(mission) {
  return mission.ringIndex < mission.rings.length
    ? mission.rings[mission.ringIndex]
    : null;
}

/**
 * Called every frame while flying. Returns an event string: 'ring', 'course-done',
 * 'landed-scored', or ''. `now` is the mission clock in seconds.
 */
export function stepMission(mission, plane, dt, now) {
  mission.sortieTime += dt;
  if (mission.phase === 'rings') {
    const ring = nextRing(mission);
    if (ring) {
      const d = distanceToNextRing(mission, plane);
      if (d < RINGS.radius * RINGS.passTolerance) {
        mission.ringIndex += 1;
        mission.ringsCleared += 1;
        mission.totalRings += 1;
        mission.score += RINGS.passScore;
        mission.sortieScore += RINGS.passScore;
        plane.fuel = Math.min(100, plane.fuel + 7);
        mission.message = `RING ${mission.ringsCleared} / ${mission.rings.length}  +100`;
        mission.messageUntil = now + 1.6;
        if (mission.ringIndex >= mission.rings.length) {
          mission.phase = 'return';
          mission.message = 'COURSE CLEAR — RETURN TO SKYLINE FIELD AND LAND';
          mission.messageUntil = now + 4;
          return 'course-done';
        }
        return 'ring';
      }
    }
  }
  return '';
}

/** Score the landing once the jet is down on the runway. Returns points earned. */
export function scoreLanding(mission, plane, now) {
  const touchdownVs = plane.touchdownVs ?? plane.verticalSpeed ?? 0;
  const softness = Math.max(0, 1 - Math.abs(touchdownVs) / 4.5);
  const landingPoints = SCORE.landingBase + Math.round(SCORE.landingSmoothBonus * softness);
  const timeLeft = Math.max(0, mission.clock - mission.sortieTime);
  const timePoints = Math.round(SCORE.sortieTimeBonus * (timeLeft / mission.clock));
  const total = landingPoints + timePoints;
  mission.score += total;
  mission.sortieScore += total;
  mission.sortiesCompleted += 1;
  mission.bestLanding = {
    softness: Math.round(softness * 100),
    points: total,
  };
  mission.message = `LANDED  +${total}  (touchdown ${Math.round(softness * 100)}% smooth)`;
  mission.messageUntil = now + 5;
  return total;
}

/** Start the next sortie: a fresh, harder course and a full tank. */
export function startNextSortie(mission, plane) {
  mission.sortie += 1;
  mission.rings = ringCourse(mission.sortie);
  mission.ringIndex = 0;
  mission.ringsCleared = 0;
  mission.sortieScore = 0;
  mission.sortieTime = 0;
  mission.phase = 'rings';
  mission.message = `SORTIE ${mission.sortie} — ${mission.rings.length} RINGS, LOWER AND TIGHTER`;
  mission.messageUntil = 0; // set by the caller with the real clock
  plane.fuel = 100;
  plane.damage = 0;
  plane.landed = false;
}

/** Bearing (degrees, 0 = north) from the jet to a world point. */
export function bearingTo(plane, x, z) {
  const dx = x - plane.x;
  const dz = z - plane.z;
  let deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return Math.round(deg);
}

/** Where the pilot should be heading right now: the next ring, or the runway. */
export function currentTarget(mission, plane) {
  if (mission.phase === 'rings') {
    const ring = nextRing(mission);
    if (ring) return { x: ring.x, z: ring.z, y: ring.y, label: `RING ${mission.ringIndex + 1}` };
  }
  return { x: RUNWAY.x, z: RUNWAY.z, y: RUNWAY.elevation + 2, label: 'SKYLINE FIELD' };
}
