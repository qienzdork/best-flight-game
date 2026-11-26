// Skyline Run — the renderer, part 1: camera, sky and terrain.
// The camera rides behind the jet (chase view) and never fights the pilot: it
// follows the jet's heading and half its pitch, so the horizon stays readable
// while the aircraft banks around the centre of the frame.
import { VIEW, WORLD, RUNWAY } from './config.js';
import { terrainHeight, terrainColor, onRunway, isWater } from './terrain.js';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A chase camera: position, yaw and pitch, derived from the jet each frame. */
export function makeCamera(plane, width, height) {
  const yaw = plane.heading;
  const pitch = plane.pitch * 0.45;
  const backX = Math.sin(yaw);
  const backZ = -Math.cos(yaw);
  const cam = {
    x: plane.x - backX * 42,
    z: plane.z - backZ * 42,
    y: plane.y + 11 - plane.pitch * 18,
    yaw,
    pitch,
    width,
    height,
    focal: height * VIEW.focalScale,
    cx: width / 2,
    cy: height / 2,
  };
  // The horizon is the optical centre: the projection below already accounts
  // for the camera's pitch, so a level camera puts the horizon dead centre
  // and a diving camera moves it up the frame, as with a real camera.
  cam.horizonY = cam.cy;
  return cam;
}

/**
 * Project a world point into screen space. Returns { x, y, depth } or null when
 * the point is behind the camera or too close to it to draw.
 */
export function project(cam, wx, wy, wz) {
  const dx = wx - cam.x;
  const dy = wy - cam.y;
  const dz = wz - cam.z;
  const sinY = Math.sin(cam.yaw);
  const cosY = Math.cos(cam.yaw);
  // Rotate into camera space. Facing yaw, forward is (sin yaw, -cos yaw) and
  // right is (cos yaw, sin yaw) in (x, z); heading 0 is north (-z).
  const rx = dx * cosY + dz * sinY;
  const forward = dx * sinY - dz * cosY;
  if (forward < 4) return null;
  const sinP = Math.sin(cam.pitch);
  const cosP = Math.cos(cam.pitch);
  // Pitch the camera down by cam.pitch: a point ahead at eye level sits above
  // the camera's forward axis, so it projects above the centre.
  const up = dy * cosP + forward * sinP;
  const fwd = -dy * sinP + forward * cosP;
  if (fwd < 4) return null;
  const scale = cam.focal / fwd;
  return { x: cam.cx + rx * scale, y: cam.horizonY - up * scale, depth: fwd };
}

function skyGradient(ctx, cam) {
  const g = ctx.createLinearGradient(0, 0, 0, cam.height);
  const top = '#2f6fd0';
  const mid = '#7fb2e8';
  const low = '#cfe4f5';
  g.addColorStop(0, top);
  g.addColorStop(0.45, mid);
  g.addColorStop(0.62, low);
  g.addColorStop(1, '#8fae7d');
  return g;
}

/** The sky, the sun and the haze band where the sky meets the ground. */
export function drawSky(ctx, cam, time) {
  ctx.fillStyle = skyGradient(ctx, cam);
  ctx.fillRect(0, 0, cam.width, cam.height);
  // Sun: fixed in the north-west sky, placed by projecting a far point.
  const sunDir = { x: -0.55, y: 0.42, z: -0.72 };
  const sun = project(cam, cam.x + sunDir.x * 3000, cam.y + sunDir.y * 3000, cam.z + sunDir.z * 3000);
  if (sun) {
    const glow = ctx.createRadialGradient(sun.x, sun.y, 4, sun.x, sun.y, 120);
    glow.addColorStop(0, 'rgba(255,244,200,0.95)');
    glow.addColorStop(0.25, 'rgba(255,226,140,0.55)');
    glow.addColorStop(1, 'rgba(255,226,140,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sun.x - 130, sun.y - 130, 260, 260);
    ctx.fillStyle = '#fff7d6';
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, 26, 0, Math.PI * 2);
    ctx.fill();
  }
  // Haze where the valley meets the sky, so the far ground fades out.
  const haze = ctx.createLinearGradient(0, cam.horizonY - 60, 0, cam.horizonY + 40);
  haze.addColorStop(0, 'rgba(207,228,245,0)');
  haze.addColorStop(0.6, 'rgba(207,228,245,0.55)');
  haze.addColorStop(1, 'rgba(207,228,245,0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, cam.horizonY - 60, cam.width, 100);
}

/** Clouds as soft white puffs, drawn far to near so near ones overlap far ones. */
export function drawClouds(ctx, cam, clouds, time) {
  const drawn = [];
  for (const cloud of clouds) {
    const cx = cloud.x + time * cloud.speed;
    const p = project(cam, cx, cloud.y, cloud.z);
    if (!p || p.depth > VIEW.viewDistance * 1.4) continue;
    const scale = cam.focal / p.depth;
    drawn.push({ p, size: cloud.size * scale });
  }
  drawn.sort((a, b) => b.p.depth - a.p.depth);
  for (const { p, size } of drawn) {
    if (size < 6) continue;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    // Each puff is its own fill: one path with overlapping ellipses cuts holes.
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, size, size * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(p.x - size * 0.55, p.y + size * 0.08, size * 0.6, size * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(p.x + size * 0.55, p.y + size * 0.06, size * 0.65, size * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * The terrain: a painter's grid of quads, far to near, each coloured by height,
 * slope and what sits on it (water, road, town, runway). Cells the camera has
 * passed are skipped; the grid is only as wide as the view needs.
 */
export function drawTerrain(ctx, cam) {
  const cell = VIEW.cellSize;
  const range = Math.ceil(VIEW.viewDistance / cell);
  const camCellX = Math.floor(cam.x / cell);
  const camCellZ = Math.floor(cam.z / cell);
  const forwardX = -Math.sin(cam.yaw);
  const forwardZ = Math.cos(cam.yaw);
  const quads = [];
  for (let gz = camCellZ - range; gz <= camCellZ + range; gz += 1) {
    for (let gx = camCellX - range; gx <= camCellX + range; gx += 1) {
      const x0 = gx * cell;
      const z0 = gz * cell;
      const cx = x0 + cell / 2;
      const cz = z0 + cell / 2;
      const relX = cx - cam.x;
      const relZ = cz - cam.z;
      const ahead = relX * forwardX + relZ * forwardZ;
      if (ahead < -60 || ahead > VIEW.viewDistance) continue;
      const dist = Math.sqrt(relX * relX + relZ * relZ);
      if (dist > VIEW.viewDistance) continue;
      const h00 = terrainHeight(x0, z0);
      const h10 = terrainHeight(x0 + cell, z0);
      const h11 = terrainHeight(x0 + cell, z0 + cell);
      const h01 = terrainHeight(x0, z0 + cell);
      const slopeLight = clamp(Math.round((h00 - h11) * 0.12), -14, 14);
      quads.push({ x0, z0, h00, h10, h11, h01, cx, cz, dist, slopeLight });
    }
  }
  quads.sort((a, b) => b.dist - a.dist);
  for (const q of quads) {
    const p00 = project(cam, q.x0, q.h00, q.z0);
    const p10 = project(cam, q.x0 + cell, q.h10, q.z0);
    const p11 = project(cam, q.x0 + cell, q.h11, q.z0 + cell);
    const p01 = project(cam, q.x0, q.h01, q.z0 + cell);
    if (!p00 || !p10 || !p11 || !p01) continue;
    ctx.fillStyle = terrainColor(q.cx, q.cz, q.slopeLight);
    ctx.beginPath();
    ctx.moveTo(p00.x, p00.y);
    ctx.lineTo(p10.x, p10.y);
    ctx.lineTo(p11.x, p11.y);
    ctx.lineTo(p01.x, p01.y);
    ctx.closePath();
    ctx.fill();
    // Water glints: a brighter streak on lake cells.
    if (isWater(q.cx, q.cz)) {
      ctx.fillStyle = 'rgba(190,225,245,0.35)';
      ctx.beginPath();
      ctx.moveTo(p00.x, p00.y);
      ctx.lineTo(p10.x, p10.y);
      ctx.lineTo(p11.x, p11.y);
      ctx.lineTo(p01.x, p01.y);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/** Runway markings: threshold bars, centreline dashes and edge lights. */
export function drawRunwayMarkings(ctx, cam) {
  const y = RUNWAY.elevation + 0.6;
  const halfW = RUNWAY.width / 2;
  const z0 = RUNWAY.z - RUNWAY.length / 2;
  const z1 = RUNWAY.z + RUNWAY.length / 2;
  // Edge lines.
  for (const side of [-1, 1]) {
    const a = project(cam, RUNWAY.x + side * (halfW - 3), y, z0);
    const b = project(cam, RUNWAY.x + side * (halfW - 3), y, z1);
    if (!a || !b) continue;
    ctx.strokeStyle = 'rgba(240,240,235,0.9)';
    ctx.lineWidth = Math.max(1, 900 / a.depth);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  // Centreline dashes, every 60 m.
  for (let z = z0 + 30; z < z1 - 20; z += 60) {
    const a = project(cam, RUNWAY.x, y, z);
    const b = project(cam, RUNWAY.x, y, z + 28);
    if (!a || !b) continue;
    ctx.strokeStyle = 'rgba(245,245,240,0.95)';
    ctx.lineWidth = Math.max(1.5, 1200 / a.depth);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  // Threshold bars at both ends.
  for (const zend of [z0 + 12, z1 - 12]) {
    for (let i = -3; i <= 3; i += 1) {
      const a = project(cam, RUNWAY.x + i * 6 - 2, y, zend);
      const b = project(cam, RUNWAY.x + i * 6 + 2, y, zend);
      const c = project(cam, RUNWAY.x + i * 6 + 2, y, zend + (zend === z0 + 12 ? 14 : -14));
      const d = project(cam, RUNWAY.x + i * 6 - 2, y, zend + (zend === z0 + 12 ? 14 : -14));
      if (!a || !b || !c || !d) continue;
      ctx.fillStyle = 'rgba(245,245,240,0.9)';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fill();
    }
  }
  // Edge lights: small amber dots down both sides.
  ctx.fillStyle = 'rgba(255,190,80,0.95)';
  for (let z = z0 + 20; z <= z1; z += 80) {
    for (const side of [-1, 1]) {
      const p = project(cam, RUNWAY.x + side * (halfW + 2), y + 1, z);
      if (!p) continue;
      const r = Math.max(1, 700 / p.depth);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * A ring: a glowing hoop the jet flies through. The next ring burns amber and
 * pulses; cleared rings are green; later rings are pale white.
 */
export function drawRing(ctx, cam, ring, state, time) {
  const centre = project(cam, ring.x, ring.y, ring.z);
  if (!centre) return;
  const radius = (15 * cam.focal) / centre.depth;
  if (radius < 3 || radius > 1200) return;
  // The hoop faces the jet: draw it as a circle squashed by the viewing angle.
  const dx = ring.x - cam.x;
  const dz = ring.z - cam.z;
  const facing = Math.abs(Math.sin(Math.atan2(dx, dz) - cam.yaw));
  const squash = 0.25 + 0.75 * facing;
  const color = state === 'next'
    ? `rgba(255,176,32,${0.85 + 0.15 * Math.sin(time * 5)})`
    : state === 'done' ? 'rgba(80,220,120,0.8)' : 'rgba(235,240,245,0.55)';
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, radius * 0.09);
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, radius, radius * squash, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Inner glow so the hoop reads at a glance even when small.
  ctx.strokeStyle = state === 'next' ? 'rgba(255,176,32,0.25)' : 'rgba(255,255,255,0.12)';
  ctx.lineWidth = Math.max(4, radius * 0.2);
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, radius, radius * squash, 0, 0, Math.PI * 2);
  ctx.stroke();
  // A chevron above the next ring so the pilot can find it from far away.
  if (state === 'next') {
    ctx.fillStyle = 'rgba(255,176,32,0.95)';
    const s = Math.max(6, radius * 0.28);
    ctx.beginPath();
    ctx.moveTo(centre.x, centre.y - radius - s * 1.6);
    ctx.lineTo(centre.x - s * 0.7, centre.y - radius - s * 0.6);
    ctx.lineTo(centre.x + s * 0.7, centre.y - radius - s * 0.6);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * The jet, drawn in screen space at the chase-view anchor: a swept-wing single
 * seater with a glass canopy, panel lines, navigation lights and a burner glow.
 * It banks with the roll, so the pilot always sees what the jet is doing.
 */
export function drawAircraft(ctx, cam, plane, time) {
  const ax = cam.cx;
  const ay = cam.height * 0.62;
  const scale = 1.0;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(plane.roll * 0.85);
  ctx.scale(scale, scale);
  // Afterburner glow.
  if (plane.afterburner && !plane.crashed) {
    const flicker = 0.7 + Math.sin(time * 40) * 0.3;
    const glow = ctx.createRadialGradient(0, 128, 2, 0, 128, 60 * flicker);
    glow.addColorStop(0, 'rgba(140,200,255,0.9)');
    glow.addColorStop(0.4, 'rgba(80,140,255,0.45)');
    glow.addColorStop(1, 'rgba(80,140,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(0, 132, 26 * flicker, 52 * flicker, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Shadow of the jet on the ground below, when low: a soft dark ellipse.
  // (Drawn in screen space under the jet; it reads as the ground shadow.)
  // Main wings: swept, with a darker underside edge.
  ctx.fillStyle = '#5d6b7d';
  ctx.beginPath();
  ctx.moveTo(-14, 18);
  ctx.lineTo(-168, 92);
  ctx.lineTo(-168, 104);
  ctx.lineTo(-20, 62);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(14, 18);
  ctx.lineTo(168, 92);
  ctx.lineTo(168, 104);
  ctx.lineTo(20, 62);
  ctx.closePath();
  ctx.fill();
  // Wing top panels, lighter, with panel lines.
  ctx.fillStyle = '#7d8ea3';
  ctx.beginPath();
  ctx.moveTo(-12, 16);
  ctx.lineTo(-160, 88);
  ctx.lineTo(-160, 96);
  ctx.lineTo(-18, 56);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(12, 16);
  ctx.lineTo(160, 88);
  ctx.lineTo(160, 96);
  ctx.lineTo(18, 56);
  ctx.closePath();
  ctx.fill();
  // Tail fins.
  ctx.fillStyle = '#6b7c90';
  ctx.beginPath();
  ctx.moveTo(-10, 96);
  ctx.lineTo(-52, 138);
  ctx.lineTo(-34, 142);
  ctx.lineTo(-4, 112);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(10, 96);
  ctx.lineTo(52, 138);
  ctx.lineTo(34, 142);
  ctx.lineTo(4, 112);
  ctx.closePath();
  ctx.fill();
  // Vertical stabiliser.
  ctx.fillStyle = '#5d6b7d';
  ctx.beginPath();
  ctx.moveTo(-7, 88);
  ctx.lineTo(-4, 34);
  ctx.lineTo(8, 34);
  ctx.lineTo(10, 92);
  ctx.closePath();
  ctx.fill();
  // Fuselage: a long tapered body, light on top, darker beneath.
  const body = ctx.createLinearGradient(-16, 0, 16, 0);
  body.addColorStop(0, '#8b9bb0');
  body.addColorStop(0.5, '#c3cfdd');
  body.addColorStop(1, '#7d8ea3');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, -118);
  ctx.quadraticCurveTo(13, -70, 15, -10);
  ctx.quadraticCurveTo(16, 60, 12, 122);
  ctx.quadraticCurveTo(0, 132, -12, 122);
  ctx.quadraticCurveTo(-16, 60, -15, -10);
  ctx.quadraticCurveTo(-13, -70, 0, -118);
  ctx.fill();
  // Nose tip and intake shadow.
  ctx.fillStyle = '#3d4a5c';
  ctx.beginPath();
  ctx.moveTo(0, -118);
  ctx.quadraticCurveTo(7, -96, 8, -78);
  ctx.quadraticCurveTo(0, -84, -8, -78);
  ctx.quadraticCurveTo(-7, -96, 0, -118);
  ctx.fill();
  // Canopy: glass over the cockpit, catching the sky.
  const glass = ctx.createLinearGradient(0, -72, 0, -18);
  glass.addColorStop(0, '#bfe6ff');
  glass.addColorStop(0.5, '#5ea8dd');
  glass.addColorStop(1, '#2c6ea8');
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.moveTo(0, -74);
  ctx.quadraticCurveTo(9, -58, 9, -38);
  ctx.quadraticCurveTo(9, -22, 0, -18);
  ctx.quadraticCurveTo(-9, -22, -9, -38);
  ctx.quadraticCurveTo(-9, -58, 0, -74);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-5, -66);
  ctx.lineTo(2, -30);
  ctx.stroke();
  // Panel lines down the fuselage.
  ctx.strokeStyle = 'rgba(40,55,70,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-12, -8);
  ctx.lineTo(-13, 60);
  ctx.moveTo(12, -8);
  ctx.lineTo(13, 60);
  ctx.stroke();
  // Engine nozzles.
  ctx.fillStyle = '#2c3644';
  ctx.beginPath();
  ctx.ellipse(-7, 126, 6, 5, 0, 0, Math.PI * 2);
  ctx.ellipse(7, 126, 6, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Navigation lights: red left, green right, blinking white tail.
  ctx.fillStyle = '#ff4d4d';
  ctx.beginPath();
  ctx.arc(-166, 98, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4dff88';
  ctx.beginPath();
  ctx.arc(166, 98, 4, 0, Math.PI * 2);
  ctx.fill();
  if (Math.sin(time * 6) > 0) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 138, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}


// ---- HUD and screens (appended to the renderer) ----

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(10,18,28,0.62)';
  ctx.strokeStyle = 'rgba(140,200,255,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();
}

function hudText(ctx, text, x, y, size, color, align = 'left', font = '700') {
  ctx.font = `${font} ${size}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/** The three big flight tapes: altitude, heading compass, speed. */
export function drawFlightTapes(ctx, cam, plane) {
  const w = cam.width;
  const h = cam.height;
  // Altitude (left): label on top, big value below, climb rate at the right.
  panel(ctx, 16, 14, 172, 64);
  hudText(ctx, 'ALT', 30, 32, 12, '#8fc8ff');
  hudText(ctx, `${Math.max(0, Math.round(plane.y))} m`, 30, 58, 22, '#eaf6ff');
  hudText(ctx, plane.verticalSpeed > 0.5 ? `▲ ${plane.verticalSpeed.toFixed(1)}` : plane.verticalSpeed < -0.5 ? `▼ ${Math.abs(plane.verticalSpeed).toFixed(1)}` : '— level', 174, 58, 13, '#bfe0ff', 'right');
  // Speed (right): throttle on the label line, big value below.
  panel(ctx, w - 188, 14, 172, 64);
  hudText(ctx, 'SPD', w - 174, 32, 12, '#8fc8ff');
  const thr = Math.round(plane.throttle * 100);
  hudText(ctx, `THR ${thr}%${plane.afterburner ? ' +BURN' : ''}`, w - 30, 32, 12, plane.afterburner ? '#ffb020' : '#bfe0ff', 'right');
  hudText(ctx, `${Math.round(plane.speed * 1.944)} kt`, w - 174, 58, 22, '#eaf6ff');
  // Heading compass strip (centre).
  panel(ctx, w / 2 - 190, 14, 380, 64);
  const headingDeg = Math.round(((plane.heading * 180) / Math.PI + 360) % 360);
  hudText(ctx, 'HDG', w / 2 - 176, 32, 12, '#8fc8ff');
  hudText(ctx, `${String(headingDeg).padStart(3, '0')}°`, w / 2 - 176, 58, 24, '#eaf6ff');
  ctx.save();
  ctx.beginPath();
  ctx.rect(w / 2 - 110, 22, 220, 48);
  ctx.clip();
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  for (let d = -60; d <= 60; d += 5) {
    const deg = (headingDeg + d + 360) % 360;
    const x = w / 2 + (d / 60) * 110;
    const major = deg % 30 === 0;
    ctx.strokeStyle = major ? '#eaf6ff' : 'rgba(180,220,255,0.5)';
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, 62);
    ctx.lineTo(x, major ? 48 : 54);
    ctx.stroke();
    if (major) {
      const label = deg % 90 === 0 ? labels[deg / 45] : String(deg).padStart(3, '0');
      hudText(ctx, label, x, 34, 11, '#cfe8ff', 'center');
    }
  }
  ctx.restore();
  // Centre caret.
  ctx.fillStyle = '#ffb020';
  ctx.beginPath();
  ctx.moveTo(w / 2, 18);
  ctx.lineTo(w / 2 - 6, 10);
  ctx.lineTo(w / 2 + 6, 10);
  ctx.closePath();
  ctx.fill();
}

/** Artificial horizon + throttle bar, bottom left. */
export function drawAttitude(ctx, cam, plane) {
  const cx = 92;
  const cy = cam.height - 92;
  const r = 62;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-plane.roll);
  const pitchPx = clamp(plane.pitch * 130, -r, r);
  ctx.fillStyle = '#3f8fd2';
  ctx.fillRect(-r, -r + pitchPx, r * 2, r - pitchPx + 2);
  ctx.fillStyle = '#7a5a34';
  ctx.fillRect(-r, pitchPx, r * 2, r * 2);
  ctx.strokeStyle = '#eaf6ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-r, pitchPx);
  ctx.lineTo(r, pitchPx);
  ctx.stroke();
  ctx.restore();
  // Fixed wings and frame.
  ctx.strokeStyle = '#ffb020';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 34, cy);
  ctx.lineTo(cx - 10, cy);
  ctx.moveTo(cx + 10, cy);
  ctx.lineTo(cx + 34, cy);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(140,200,255,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  hudText(ctx, 'ATT', cx, cy + r + 14, 11, '#8fc8ff', 'center');
  // Throttle bar beside it.
  const bx = 172;
  const by = cam.height - 154;
  panel(ctx, bx, by, 26, 124);
  const fillH = 112 * plane.throttle;
  ctx.fillStyle = plane.afterburner ? '#ffb020' : '#58b368';
  ctx.fillRect(bx + 6, by + 118 - fillH, 14, fillH);
  hudText(ctx, 'THR', bx + 13, by - 10, 11, '#8fc8ff', 'center');
  hudText(ctx, `${Math.round(plane.throttle * 100)}%`, bx + 13, by + 138, 11, '#cfe8ff', 'center');
}

/** Fuel and damage gauges, bottom centre-left. */
export function drawFuelDamage(ctx, cam, plane) {
  const x = 216;
  const y = cam.height - 154;
  panel(ctx, x, y, 170, 60);
  hudText(ctx, 'FUEL', x + 12, y + 16, 11, '#8fc8ff');
  const fuelW = 146 * (plane.fuel / 100);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(x + 12, y + 26, 146, 10);
  ctx.fillStyle = plane.fuel < 20 ? '#ff5a4d' : '#58b368';
  ctx.fillRect(x + 12, y + 26, fuelW, 10);
  hudText(ctx, `${Math.round(plane.fuel)}%`, x + 158, y + 31, 12, '#eaf6ff', 'right');
  hudText(ctx, 'HULL', x + 12, y + 48, 11, '#8fc8ff');
  const dmgW = 146 * (1 - plane.damage / 100);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(x + 12, y + 56, 146, 10);
  ctx.fillStyle = plane.damage > 60 ? '#ff5a4d' : plane.damage > 25 ? '#ffb020' : '#58b368';
  ctx.fillRect(x + 12, y + 56, dmgW, 10);
  // Gear and flaps state.
  hudText(ctx, `GEAR ${plane.gearDown ? 'DOWN' : 'UP'}   FLAPS ${plane.flapsDown ? 'DOWN' : 'UP'}`, x + 12, y + 78, 11, '#bfe0ff');
}

/** Top-down radar: runway, rings, town and the jet, north up. */
export function drawRadar(ctx, cam, plane, mission) {
  const size = 150;
  const x = cam.width - size - 16;
  const y = cam.height - size - 16;
  panel(ctx, x, y, size, size);
  const scale = size / (WORLD.size * 1.05);
  const toRadar = (wx, wz) => [x + size / 2 + wx * scale, y + size / 2 + wz * scale];
  // Town blob.
  const [tx, ty] = toRadar(-620, 780);
  ctx.fillStyle = 'rgba(200,170,120,0.7)';
  ctx.beginPath();
  ctx.arc(tx, ty, 7, 0, Math.PI * 2);
  ctx.fill();
  // Lake.
  const [lx, ly] = toRadar(1250, -500);
  ctx.fillStyle = 'rgba(70,140,200,0.8)';
  ctx.beginPath();
  ctx.ellipse(lx, ly, 16, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  // Runway strip.
  const [rx0, ry0] = toRadar(RUNWAY.x - RUNWAY.width / 2, RUNWAY.z - RUNWAY.length / 2);
  const [rx1, ry1] = toRadar(RUNWAY.x + RUNWAY.width / 2, RUNWAY.z + RUNWAY.length / 2);
  ctx.fillStyle = 'rgba(230,230,225,0.9)';
  ctx.fillRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
  // Rings: next one amber, the rest faint.
  mission.rings.forEach((ring, i) => {
    const [px, py] = toRadar(ring.x, ring.z);
    ctx.fillStyle = i === mission.ringIndex ? '#ffb020' : i < mission.ringIndex ? '#58b368' : 'rgba(230,240,245,0.6)';
    ctx.beginPath();
    ctx.arc(px, py, i === mission.ringIndex ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
  // The jet, as a triangle pointing along its heading.
  const [jx, jy] = toRadar(plane.x, plane.z);
  ctx.save();
  ctx.translate(jx, jy);
  ctx.rotate(plane.heading);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(5, 6);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  hudText(ctx, 'RADAR', x + size / 2, y + size + 12, 11, '#8fc8ff', 'center');
}

/** Mission line, score, warnings and the centre message. */
export function drawMissionHud(ctx, cam, plane, mission, now, warnings) {
  const w = cam.width;
  panel(ctx, w / 2 - 210, 90, 420, 34);
  const target = mission.phase === 'rings'
    ? `RING ${mission.ringIndex + 1} / ${mission.rings.length}`
    : 'LAND AT SKYLINE FIELD';
  hudText(ctx, `SORTIE ${mission.sortie}  •  ${target}`, w / 2, 107, 15, '#eaf6ff', 'center');
  hudText(ctx, `SCORE ${mission.score}`, w / 2 + 230, 107, 15, '#ffd76a', 'left');
  // Distance and bearing to the current target, on its own dark pill so it
  // reads over bright cloud as well as over dark ground.
  const tgt = mission.phase === 'rings' ? mission.rings[mission.ringIndex] : { x: 0, z: 900 };
  if (tgt) {
    const dx = tgt.x - plane.x;
    const dz = tgt.z - plane.z;
    const dist = Math.round(Math.sqrt(dx * dx + dz * dz));
    let bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
    if (bearing < 0) bearing += 360;
    const rel = Math.round(((bearing - (plane.heading * 180) / Math.PI + 540) % 360) - 180);
    const arrow = rel > 25 ? '▶▶' : rel < -25 ? '◀◀' : '▲';
    const label = `${dist} m  ${arrow} ${Math.abs(rel)}°`;
    ctx.font = '700 13px "Segoe UI", system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(10,18,28,0.55)';
    ctx.beginPath();
    ctx.roundRect(w / 2 - tw / 2 - 10, 118, tw + 20, 24, 12);
    ctx.fill();
    hudText(ctx, label, w / 2, 130, 13, '#bfe0ff', 'center');
  }
  // Centre message (ring scored, course clear, landed).
  if (mission.message && now < mission.messageUntil) {
    ctx.font = '700 26px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(10,18,28,0.55)';
    const tw = ctx.measureText(mission.message).width;
    ctx.fillRect(w / 2 - tw / 2 - 16, 168, tw + 32, 40);
    ctx.fillStyle = '#ffd76a';
    ctx.fillText(mission.message, w / 2, 189);
  }
  // Warnings, flashing.
  if (warnings.length > 0 && Math.sin(now * 6) > -0.2) {
    hudText(ctx, warnings.join('   •   '), w / 2, 232, 20, '#ff5a4d', 'center');
  }
}

/** Title screen: the game name, what it is, and how to fly it. */
export function drawTitle(ctx, cam, mission) {
  ctx.fillStyle = 'rgba(8,16,28,0.45)';
  ctx.fillRect(0, 0, cam.width, cam.height);
  hudText(ctx, 'SKYLINE RUN', cam.width / 2, 190, 84, '#ffffff', 'center');
  hudText(ctx, 'A VALLEY, A JET, EIGHT RINGS — AND ONE RUNWAY HOME', cam.width / 2, 252, 20, '#ffd76a', 'center');
  const lines = [
    'ARROWS / WASD — pitch and bank      SHIFT / CTRL — throttle up / down',
    'SPACE — afterburner      G — landing gear      F — flaps      M — mute',
    'MOUSE — hold and steer with the pointer      P — pause      R — restart',
    '',
    'Fly the ring course, then land gently on Skyline Field.',
    'Rings pay 100 points and 7% fuel. A smooth landing pays up to 500.',
    'Mind the fuel gauge — run dry and you glide, or you do not.',
  ];
  lines.forEach((line, i) => {
    hudText(ctx, line, cam.width / 2, 330 + i * 30, 17, '#dfeeff', 'center', '400');
  });
  if (Math.sin(Date.now() / 350) > -0.3) {
    hudText(ctx, 'PRESS ENTER OR CLICK TO FLY', cam.width / 2, 590, 24, '#ffffff', 'center');
  }
  hudText(ctx, 'SKYLINE FIELD  •  VALLEY OF THE EIGHT RINGS  •  ORIGINAL GAME, ORIGINAL ART', cam.width / 2, 650, 13, '#9fc4e8', 'center');
}

/** End screens: crashed, sortie landed, or paused. */
export function drawEndScreen(ctx, cam, kind, detail) {
  ctx.fillStyle = kind === 'crashed' ? 'rgba(30,8,8,0.62)' : 'rgba(8,20,32,0.6)';
  ctx.fillRect(0, 0, cam.width, cam.height);
  const title = kind === 'crashed' ? 'CRASHED' : kind === 'landed' ? 'SORTIE COMPLETE' : 'PAUSED';
  hudText(ctx, title, cam.width / 2, 250, 64, kind === 'crashed' ? '#ff6a5a' : '#ffffff', 'center');
  detail.forEach((line, i) => {
    hudText(ctx, line, cam.width / 2, 330 + i * 32, 19, '#dfeeff', 'center', '400');
  });
  const hint = kind === 'paused'
    ? 'P — RESUME      R — RESTART SORTIE'
    : kind === 'landed'
      ? 'ENTER — NEXT SORTIE      R — FLY THIS SORTIE AGAIN'
      : 'R — FLY AGAIN';
  hudText(ctx, hint, cam.width / 2, 330 + detail.length * 32 + 30, 20, '#ffd76a', 'center');
}
