[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/qienzdork/best-flight-game/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/qienzdork/best-flight-game/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

# Skyline Run — Best Flight Game

A chase-view arcade flight game that runs offline in a desktop browser from
static files. You fly a single-seat jet out of Skyline Field, thread a course
of eight glowing rings over a procedurally built valley — lake, town, road,
ridges — and then bring her home for a landing on the runway. Rings pay 100
points and 7% fuel; a smooth touchdown pays up to 500. Fuel, hull damage,
stalls and the valley itself turn every sortie into decisions.

## How to fly

- **Arrows / WASD** — pitch and bank (bank to turn)
- **Shift / Ctrl** — throttle up / down
- **Space** — afterburner (fast, and thirsty)
- **G** — landing gear, **F** — flaps, **M** — mute
- **Mouse** — hold and steer with the pointer
- **P** — pause, **R** — restart, **Enter** — start / next sortie

Land gently — gear down, slow, wings level, on the strip — and the next
sortie is lower and tighter. Hit the ground anywhere else and the valley wins.

## Structure

- `game/src/config.js` — tuning constants
- `game/src/random.js` — seeded RNG and value noise
- `game/src/terrain.js` — valley heightfield, lake, road, town, runway, ring course
- `game/src/flight.js` — the flight model (throttle, bank, stall, landing, crash)
- `game/src/missions.js` — sorties, rings, landing scores
- `game/src/render.js` — camera, sky, terrain, jet, HUD instruments
- `game/src/audio.js` — synthesised engine, wind and event sounds (WebAudio)
- `game/src/input.js` — keyboard and mouse
- `game/src/shots.js` — deterministic screenshot scenes
- `game/src/main.js` — screens and the game loop

Play it with any static server, e.g. from `game/`: `python3 -m http.server 8080`
and open http://localhost:8080 — or serve the folder with any static host.
No network requests, no external assets, no build step.
