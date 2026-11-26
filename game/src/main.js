// Skyline Run — the game loop. One clear job: own the screens, the clock and
// the wiring between input, flight model, missions, audio and the renderer.
// Screens: 'title' | 'play' | 'paused' | 'crashed' | 'landed'.
import { VIEW, KEYS, RUNWAY } from './config.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createPlane, placeOnRunway, stepFlight } from './flight.js';
import { createMission, stepMission, scoreLanding, startNextSortie, nextRing } from './missions.js';
import { terrainHeight, makeClouds, onRunway } from './terrain.js';
import { stageShot } from './shots.js';
import {
  makeCamera, project, drawSky, drawClouds, drawTerrain, drawRunwayMarkings,
  drawRing, drawAircraft, drawFlightTapes, drawAttitude, drawFuelDamage,
  drawRadar, drawMissionHud, drawTitle, drawEndScreen,
} from './render.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seedParam = Number(params.get('seed'));
const SEED = Number.isFinite(seedParam) ? seedParam : 7;

const input = createInput(canvas);
input.attach();
const audio = createAudio();
const clouds = makeClouds();

const world = {
  plane: createPlane(),
  mission: createMission(),
  time: 0,
  clouds,
  screen: 'title',
  best: 0,
  crashTimer: 0,
  landTimer: 0,
  lastBeep: 0,
  shotMode: Boolean(shotName),
};

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function warningsFor(plane, mission) {
  const warnings = [];
  const ground = terrainHeight(plane.x, plane.z);
  if (plane.fuel < 20 && plane.fuel > 0) warnings.push('LOW FUEL');
  if (plane.fuel <= 0) warnings.push('FUEL EMPTY — GLIDE');
  if (plane.stalled) warnings.push('STALL');
  // On final with the gear down, descending is the plan, not a warning.
  const onFinal = plane.gearDown && mission.phase === 'return' && Math.abs(plane.x) < 150;
  if (!plane.onGround && plane.y - ground < 25 && plane.verticalSpeed < -3 && !onFinal) warnings.push('PULL UP');
  if (mission.phase === 'return' && !plane.gearDown && plane.y < 120) warnings.push('GEAR UP — LANDING');
  if (plane.damage > 60) warnings.push('HULL CRITICAL');
  return warnings;
}

function render(now) {
  const { plane, mission } = world;
  const cam = makeCamera(plane, canvas.width, canvas.height);
  drawSky(ctx, cam, now);
  drawClouds(ctx, cam, clouds, now);
  drawTerrain(ctx, cam);
  drawRunwayMarkings(ctx, cam);
  // Rings: the next one burns amber, cleared ones green, the rest pale.
  mission.rings.forEach((ring, i) => {
    const state = i < mission.ringIndex ? 'done' : i === mission.ringIndex ? 'next' : 'later';
    drawRing(ctx, cam, ring, state, now);
  });
  if (!plane.crashed) drawAircraft(ctx, cam, plane, now);
  // Speed streaks at the screen edges when the jet is really moving.
  if (plane.speed > 92 && world.screen === 'play') {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 10; i += 1) {
      const y = ((i * 137 + now * 900) % cam.height);
      const len = 30 + plane.speed * 0.4;
      ctx.beginPath();
      ctx.moveTo(6, y);
      ctx.lineTo(6 + len, y);
      ctx.moveTo(cam.width - 6, y);
      ctx.lineTo(cam.width - 6 - len, y);
      ctx.stroke();
    }
  }
  if (world.screen === 'title') {
    drawTitle(ctx, cam, mission);
  } else if (world.screen === 'play' || world.screen === 'paused') {
    drawFlightTapes(ctx, cam, plane);
    drawAttitude(ctx, cam, plane);
    drawFuelDamage(ctx, cam, plane);
    drawRadar(ctx, cam, plane, mission);
    drawMissionHud(ctx, cam, plane, mission, now, warningsFor(plane, mission));
    if (world.screen === 'paused') {
      drawEndScreen(ctx, cam, 'paused', ['Take a breath. The valley will wait.']);
    }
  } else if (world.screen === 'crashed') {
    drawFlightTapes(ctx, cam, plane);
    drawEndScreen(ctx, cam, 'crashed', [
      world.plane.crashReason || 'The valley wins this one.',
      `Score ${mission.score}  •  Rings ${mission.totalRings}  •  Sorties ${mission.sortiesCompleted}`,
      `Best score ${world.best}`,
    ]);
  } else if (world.screen === 'landed') {
    drawFlightTapes(ctx, cam, plane);
    drawEndScreen(ctx, cam, 'landed', [
      `Sortie ${mission.sortie} complete — ${mission.bestLanding ? mission.bestLanding.points : 0} points for the landing.`,
      `Score ${mission.score}  •  Rings ${mission.totalRings}  •  Fuel ${Math.round(plane.fuel)}%`,
      mission.sortie === 1
        ? 'Sortie 2 is lower, tighter, and the ridge gap is in the way.'
        : 'The next sortie runs the same valley, harder still.',
    ]);
  }
}

function startFlight() {
  audio.ensure();
  placeOnRunway(world.plane);
  world.mission = createMission();
  world.time = 0;
  world.screen = 'play';
  world.crashTimer = 0;
  world.landTimer = 0;
  setStatus('Flying. Ring course ahead, then land at Skyline Field.');
}

function restartSortie() {
  audio.ensure();
  placeOnRunway(world.plane);
  const keptScore = world.mission.score;
  const keptRings = world.mission.totalRings;
  const keptSorties = world.mission.sortiesCompleted;
  const keptBest = world.best;
  world.mission = createMission();
  world.mission.score = keptScore;
  world.mission.totalRings = keptRings;
  world.mission.sortiesCompleted = keptSorties;
  world.best = keptBest;
  world.time = 0;
  world.screen = 'play';
}

function step(dt) {
  const { plane, mission } = world;
  const axes = input.axes();
  const ctl = {
    pitch: axes.pitch,
    roll: axes.roll,
    throttleDelta: input.throttleDelta(dt),
    afterburner: input.held(KEYS.afterburner),
  };
  if (input.consumePress(KEYS.gear)) plane.gearDown = !plane.gearDown;
  if (input.consumePress(KEYS.flaps)) plane.flapsDown = !plane.flapsDown;
  if (input.consumePress(KEYS.mute)) audio.toggleMute();
  const event = stepFlight(plane, ctl, dt);
  const missionEvent = stepMission(mission, plane, dt, world.time);
  if (missionEvent === 'ring') audio.ringChime();
  if (event === 'takeoff') setStatus('Airborne. Fly the rings, then come home.');
  if (event === 'fuel-out') setStatus('Fuel empty. Glide her down, gently.');
  if (event === 'stall') setStatus('Stall! Nose down, throttle up.');
  if (event === 'landed') {
    const points = scoreLanding(mission, plane, world.time);
    audio.touchdown();
    world.best = Math.max(world.best, mission.score);
    world.screen = 'landed';
    world.landTimer = 0;
    setStatus(`Landed. ${points} points. Press Enter for the next sortie.`);
  }
  if (event === 'crash-terrain' || event === 'crash-hard') {
    audio.crashBoom();
    world.best = Math.max(world.best, mission.score);
    world.screen = 'crashed';
    world.crashTimer = 0;
    setStatus(`Crashed: ${plane.crashReason}. Press R to fly again.`);
  }
  // Low-fuel warning beep, at most once every two seconds.
  const warnings = warningsFor(plane, mission);
  if ((warnings.includes('LOW FUEL') || warnings.includes('PULL UP')) && world.time - world.lastBeep > 2) {
    audio.warningBeep();
    world.lastBeep = world.time;
  }
  audio.update(plane.throttle, plane.speed, plane.afterburner, world.screen === 'play');
}

// ---- Loop, input routing and screenshot staging (appended to main.js) ----

let last = performance.now();
let shotRendered = false;

function frame(nowMs) {
  const now = nowMs / 1000;
  let dt = Math.min(0.05, (nowMs - last) / 1000);
  last = nowMs;
  world.time += dt;

  if (world.shotMode) {
    // Screenshot mode: the scene is already staged; render it once and stop.
    if (!shotRendered) {
      render(world.time);
      shotRendered = true;
      window.__shotReady = true;
    }
    return;
  }

  if (world.screen === 'title') {
    if (input.consumePress(KEYS.start) || input.mouseActive) startFlight();
  } else if (world.screen === 'play') {
    if (input.consumePress(KEYS.pause)) {
      world.screen = 'paused';
      setStatus('Paused.');
    } else {
      step(dt);
    }
  } else if (world.screen === 'paused') {
    if (input.consumePress(KEYS.pause) || input.consumePress(KEYS.start)) {
      world.screen = 'play';
    } else if (input.consumePress(KEYS.restart)) {
      restartSortie();
    }
  } else if (world.screen === 'crashed') {
    world.crashTimer += dt;
    if (input.consumePress(KEYS.restart) && world.crashTimer > 0.8) restartSortie();
  } else if (world.screen === 'landed') {
    world.landTimer += dt;
    if (input.consumePress(KEYS.start) && world.landTimer > 0.8) {
      startNextSortie(world.mission, world.plane);
      placeOnRunway(world.plane);
      world.mission.messageUntil = world.time + 4;
      world.screen = 'play';
      setStatus(`Sortie ${world.mission.sortie}. Fly the rings, then come home.`);
    } else if (input.consumePress(KEYS.restart) && world.landTimer > 0.8) {
      restartSortie();
    }
  }

  // Clicking the canvas also starts the flight from the title screen.
  if (world.screen === 'title' && input.mouseActive) startFlight();

  render(world.time);
  input.endFrame();
  requestAnimationFrame(frame);
}

if (world.shotMode) {
  // Stage the deterministic scene, then render one frame for the screenshot.
  placeOnRunway(world.plane);
  world.mission = createMission();
  world.screen = stageShot(shotName, world);
  world.time = 12; // a settled time of day for the light
  requestAnimationFrame(frame);
  // Safety net: if the first frame never fires, the flag still lands.
  setTimeout(() => { window.__shotReady = true; }, 4000);
} else {
  placeOnRunway(world.plane);
  setStatus('Skyline Run. Press Enter or click to fly.');
  requestAnimationFrame(frame);
}

// Expose a little state for debugging and for the screenshot harness.
window.__skyline = {
  world,
  seed: SEED,
};
