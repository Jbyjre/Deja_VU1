/* Deja Vu1 arcade, part 7 of 7: the in-place games (Sky Dash, Echo Maze, Block World, Stacker, Merge, Brick
 * Break) and start-up.
 * Loaded right after games-v2.js by app.js loadGames(); the parts share one global scope.
 * The two start-up timers that settle which game functions are active sit at the end of this file, so they start
 * only once every part has run.
 */

/* ---- Game 1: Sky Dash (flappy-style, no printer theming) --------------- */

function initSkyDash() {
  const BEST_KEY = 'dejavu1.skydash.best';
  const W = 640,
    H = 380,
    GRAVITY = 0.55,
    FLAP = -8,
    X = 90,
    R = 13;
  // The visual body stays R, but what actually collides is a couple of
  // pixels smaller - the classic "forgiving hitbox" trick that makes a near
  // miss feel fair instead of feeling like the game lied about the sprite.
  const COLLIDE_R = R - 4;
  // Difficulty ramps with score: faster obstacles, a tighter gap to thread.
  const speedFor = score => Math.min(3 + score * 0.12, 7.5);
  const gapFor = score => Math.max(128 - score * 2, 86);
  // Past a score threshold, some gaps drift up and down instead of sitting
  // still - real variety instead of just "everything gets faster."
  const moverChanceFor = score => Math.min(Math.max((score - 10) * 0.03, 0), 0.55);
  const ZONES = [
    { at: 0, name: 'Calm Skies' },
    { at: 12, name: 'Crosswinds' },
    { at: 26, name: 'Turbulence' },
    { at: 45, name: 'Storm Front' },
    { at: 70, name: 'Jet Stream' }
  ];
  const zoneFor = score =>
    ZONES.slice()
      .reverse()
      .find(z => score >= z.at).name;
  const CLOSE_CALL_MARGIN = 12;

  $('game-stats').innerHTML = `
    <div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="sd-score">0</div></div>
    <div class="game-stat"><div class="g-key">Zone</div><div class="g-val" id="sd-zone" style="font-size:15px;">${ZONES[0].name}</div></div>
    <div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="sd-best">${readBest(BEST_KEY) ?? '—'}</div></div>`;

  $('game-host').innerHTML = `
    <div class="game-surface sky-dash" id="sd-surface" style="width:${W}px; max-width:100%; height:${H}px;">
      <div class="sd-avatar" id="sd-avatar"></div>
      <div class="sd-popups" id="sd-popups"></div>
      <div class="game-overlay" id="sd-overlay"><div class="g-title">Sky Dash</div><div class="g-sub">Click to start, click again to flap</div></div>
    </div>`;

  let state = { status: 'idle', y: H / 2, v: 0, squash: 0, obstacles: [], score: 0, time: 0 };

  function popup(text) {
    const host = $('sd-popups');
    const el = document.createElement('div');
    el.className = 'sd-popup';
    el.textContent = text;
    el.style.left = `${X + 24}px`;
    el.style.top = `${state.y - 24}px`;
    host.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }

  function draw() {
    const scaleX = 1 + state.squash * 0.22,
      scaleY = 1 - state.squash * 0.16;
    $('sd-avatar').style.top = `${state.y - R}px`;
    $('sd-avatar').style.left = `${X - R}px`;
    $('sd-avatar').style.transform =
      `rotate(${Math.max(-25, Math.min(45, state.v * 4))}deg) scale(${scaleX}, ${scaleY})`;

    document.querySelectorAll('.sd-obstacle').forEach(el => el.remove());
    const surface = $('sd-surface');
    const gap = gapFor(state.score);
    state.obstacles.forEach(o => {
      const gapY = obstacleGapY(o);
      const top = document.createElement('div');
      top.className = 'sd-obstacle top' + (o.mover ? ' mover' : '');
      top.style.left = `${o.x}px`;
      top.style.top = '0px';
      top.style.height = `${Math.max(0, gapY - gap / 2)}px`;
      surface.appendChild(top);
      const bottom = document.createElement('div');
      bottom.className = 'sd-obstacle bottom' + (o.mover ? ' mover' : '');
      bottom.style.left = `${o.x}px`;
      bottom.style.top = `${gapY + gap / 2}px`;
      bottom.style.height = `${Math.max(0, H - (gapY + gap / 2))}px`;
      surface.appendChild(bottom);
    });

    $('sd-score').textContent = state.score;
    $('sd-zone').textContent = zoneFor(state.score);
    const overlay = $('sd-overlay');
    if (state.status === 'playing') {
      overlay.style.display = 'none';
    } else {
      overlay.style.display = 'flex';
      overlay.innerHTML =
        state.status === 'over'
          ? `<div class="g-title">Crashed</div><div class="g-sub">Score ${state.score} in ${zoneFor(state.score)}: click to try again</div>`
          : `<div class="g-title">Sky Dash</div><div class="g-sub">Click to start, click again to flap</div>`;
    }
  }

  // A moving obstacle's gap drifts up/down over time on a sine wave, seeded
  // per-obstacle so several on screen never move in lockstep.
  function obstacleGapY(o) {
    if (!o.mover) return o.gapY;
    return o.gapY + Math.sin(state.time * 0.05 + o.phase) * o.amplitude;
  }

  function tick() {
    if (state.status !== 'playing') return;
    state.time += 1;
    const speed = speedFor(state.score);
    const gap = gapFor(state.score);
    state.v += GRAVITY;
    state.v = Math.min(state.v, 11);
    state.y += state.v;
    state.squash *= 0.8;

    state.obstacles = state.obstacles.map(o => ({ ...o, x: o.x - speed })).filter(o => o.x > -60);
    const last = state.obstacles[state.obstacles.length - 1];
    if (!last || last.x < W - 260) {
      const makeMover = Math.random() < moverChanceFor(state.score);
      const gapY = 100 + Math.random() * (H - 200);
      state.obstacles.push({
        x: W,
        gapY,
        passed: false,
        mover: makeMover,
        amplitude: makeMover ? 30 + Math.random() * 40 : 0,
        phase: Math.random() * Math.PI * 2
      });
    }

    let collided = state.y - COLLIDE_R < 0 || state.y + COLLIDE_R > H;
    state.obstacles.forEach(o => {
      if (o.passed || o.x + 50 >= X) return;
      o.passed = true;
      state.score += 1;
      const gapY = obstacleGapY(o);
      const clearance = Math.min(state.y - (gapY - gap / 2), gapY + gap / 2 - state.y);
      if (clearance < CLOSE_CALL_MARGIN) {
        state.score += 2;
        popup('Close call! +2');
      }
    });
    state.obstacles.forEach(o => {
      if (o.x < X + COLLIDE_R && o.x + 50 > X - COLLIDE_R) {
        const gapY = obstacleGapY(o);
        if (state.y - COLLIDE_R < gapY - gap / 2 || state.y + COLLIDE_R > gapY + gap / 2) collided = true;
      }
    });

    if (collided) {
      state.status = 'over';
      clearInterval(gameLoopHandle);
      gameLoopHandle = null;
      const best = Math.max(readBest(BEST_KEY) ?? 0, state.score);
      saveBest(BEST_KEY, best);
      $('sd-best').textContent = best;
    }
    draw();
  }

  $('sd-surface').addEventListener('click', () => {
    if (state.status !== 'playing') {
      state = { status: 'playing', y: H / 2, v: 0, squash: 0, obstacles: [], score: 0, time: 0 };
    } else {
      state.v = FLAP;
      state.squash = 1;
    }
    if (!gameLoopHandle) gameLoopHandle = setInterval(tick, 30);
    draw();
  });

  draw();
}

/* ---- Game 2: Echo Maze (real CSS 3D room-by-room maze) ------------------*/

function initEchoMaze() {
  // Best is now the deepest level reached rather than a raw step count:
  // once a hunting pursuer and growing mazes exist, "fewest steps" from the
  // old scoring model can't be compared across different maze sizes, so
  // this evolves to a level-based best like Block World and Brick Break use.
  const BEST_KEY = 'dejavu1.echomaze.bestlevel';
  const FACINGS = ['N', 'E', 'S', 'W'];
  const DELTA = { N: [-1, 0], E: [0, 1], S: [1, 0], W: [0, -1] };
  const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const MIN_N = 7,
    MAX_N = 10;
  const sizeForLevel = lvl => Math.min(MIN_N + (lvl - 1), MAX_N);
  const key = (r, c) => `${r},${c}`;

  function generate(n) {
    const cells = Array.from({ length: n }, () =>
      Array.from({ length: n }, () => ({ N: true, E: true, S: true, W: true }))
    );
    const seen = Array.from({ length: n }, () => new Array(n).fill(false));
    function shuffle(a) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }
    function carve(r, c) {
      seen[r][c] = true;
      for (const dir of shuffle(FACINGS.slice())) {
        const [dr, dc] = DELTA[dir];
        const nr = r + dr,
          nc = c + dc;
        if (nr < 0 || nr >= n || nc < 0 || nc >= n || seen[nr][nc]) continue;
        cells[r][c][dir] = false;
        cells[nr][nc][OPPOSITE[dir]] = false;
        carve(nr, nc);
      }
    }
    carve(0, 0);
    return cells;
  }

  // Breadth-first search over the maze graph - genuine pathfinding, not a
  // straight-line chase, so the pursuer actually reasons about walls the
  // same way the player has to.
  function bfsDistances(grid, n, start) {
    const dist = Array.from({ length: n }, () => new Array(n).fill(-1));
    dist[start.row][start.col] = 0;
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      const cell = grid[cur.row][cur.col];
      for (const dir of FACINGS) {
        if (cell[dir]) continue;
        const [dr, dc] = DELTA[dir];
        const nr = cur.row + dr,
          nc = cur.col + dc;
        if (nr < 0 || nr >= n || nc < 0 || nc >= n || dist[nr][nc] !== -1) continue;
        dist[nr][nc] = dist[cur.row][cur.col] + 1;
        queue.push({ row: nr, col: nc });
      }
    }
    return dist;
  }

  function bfsNextStep(grid, n, from, to) {
    if (from.row === to.row && from.col === to.col) return null;
    const cameFrom = new Map([[key(from.row, from.col), null]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      if (cur.row === to.row && cur.col === to.col) break;
      const cell = grid[cur.row][cur.col];
      for (const dir of FACINGS) {
        if (cell[dir]) continue;
        const [dr, dc] = DELTA[dir];
        const nr = cur.row + dr,
          nc = cur.col + dc;
        if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
        const k = key(nr, nc);
        if (cameFrom.has(k)) continue;
        cameFrom.set(k, cur);
        queue.push({ row: nr, col: nc });
      }
    }
    if (!cameFrom.has(key(to.row, to.col))) return null;
    let cur = { row: to.row, col: to.col };
    while (
      cameFrom.get(key(cur.row, cur.col)) &&
      !(cameFrom.get(key(cur.row, cur.col)).row === from.row && cameFrom.get(key(cur.row, cur.col)).col === from.col)
    ) {
      cur = cameFrom.get(key(cur.row, cur.col));
    }
    return cur;
  }

  function popup(text) {
    const host = $('em-viewport');
    const el = document.createElement('div');
    el.className = 'em-popup';
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  function newMaze(lvl) {
    const n = sizeForLevel(lvl);
    const grid = generate(n);
    const start = { row: 0, col: 0 };
    const exit = { row: n - 1, col: n - 1 };
    const distFromStart = bfsDistances(grid, n, start);
    // The pursuer's lair is the room farthest from the entrance (excluding
    // the exit itself, so it can never simply camp the way out).
    let lairDist = -1,
      lair = { row: n - 1, col: 0 };
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        if (r === exit.row && c === exit.col) continue;
        if (distFromStart[r][c] > lairDist) {
          lairDist = distFromStart[r][c];
          lair = { row: r, col: c };
        }
      }
    return {
      n,
      grid,
      row: 0,
      col: 0,
      rotation: 0,
      steps: 0,
      won: false,
      caught: 0,
      visited: new Set([key(0, 0)]),
      lair,
      pursuer: { ...lair }
    };
  }

  let level = 1;
  let maze = newMaze(level);

  $('game-host').innerHTML = `
    <div style="display:flex; gap:24px; align-items:flex-start; flex-wrap:wrap;">
      <div style="flex:1; min-width:260px;">
        <p class="card-sub" style="margin-bottom:12px; max-width:38ch;">Every room looks the same as the last, on purpose. The map only remembers rooms you've been in. Something is hunting you through the walls you can't see. Find the glowing exit before it finds you.</p>
        <div class="maze-viewport" id="em-viewport">
          <div class="maze-cube" id="em-cube">
            <div class="maze-wall" id="em-wall-N"></div>
            <div class="maze-wall" id="em-wall-E"></div>
            <div class="maze-wall" id="em-wall-S"></div>
            <div class="maze-wall" id="em-wall-W"></div>
          </div>
          <div class="game-overlay" id="em-overlay" style="display:none;"></div>
        </div>
        <div style="display:flex; justify-content:center; gap:10px; margin-top:18px;">
          <button class="btn" id="em-left">↰ Turn left</button>
          <button class="btn primary" id="em-forward">Move forward</button>
          <button class="btn" id="em-right">Turn right ↱</button>
        </div>
      </div>
      <div style="flex:0 0 150px;">
        <p class="card-sub" style="text-align:center; margin-bottom:8px;">Map</p>
        <div class="maze-map" id="em-map" style="display:grid;"></div>
        <button class="btn block" id="em-new" style="margin-top:12px;">New maze</button>
      </div>
    </div>`;

  $('game-stats').innerHTML = `
    <div class="game-stat"><div class="g-key">Level</div><div class="g-val" id="em-level">1</div></div>
    <div class="game-stat"><div class="g-key">Steps</div><div class="g-val" id="em-steps">0</div></div>
    <div class="game-stat"><div class="g-key">Echo</div><div class="g-val" id="em-echo">—</div></div>
    <div class="game-stat"><div class="g-key">Best level</div><div class="g-val accent" id="em-best">${readBest(BEST_KEY) ?? '—'}</div></div>`;

  function draw() {
    const cell = maze.grid[maze.row][maze.col];
    $('em-cube').style.transform = `rotateY(${-maze.rotation}deg)`;
    FACINGS.forEach(dir => {
      const wall = $(`em-wall-${dir}`);
      wall.classList.toggle('solid', Boolean(cell[dir]));
      wall.classList.toggle('open', !cell[dir]);
    });
    $('em-wall-N').style.transform = 'rotateY(0deg) translateZ(110px)';
    $('em-wall-E').style.transform = 'rotateY(90deg) translateZ(110px)';
    $('em-wall-S').style.transform = 'rotateY(180deg) translateZ(110px)';
    $('em-wall-W').style.transform = 'rotateY(-90deg) translateZ(110px)';

    $('em-level').textContent = maze.n - MIN_N + 1;
    $('em-steps').textContent = maze.steps;
    const idx = ((Math.round(maze.rotation / 90) % 4) + 4) % 4;
    const facing = FACINGS[idx];
    $('em-forward').disabled = Boolean(cell[facing]) || maze.won;

    const echoDist = bfsDistances(maze.grid, maze.n, maze.pursuer)[maze.row][maze.col];
    $('em-echo').textContent = maze.won ? '—' : `${echoDist} room${echoDist === 1 ? '' : 's'}`;
    const viewport = $('em-viewport');
    viewport.classList.toggle('em-danger', !maze.won && echoDist <= 2);

    const map = $('em-map');
    map.style.gridTemplateColumns = `repeat(${maze.n}, 1fr)`;
    map.innerHTML = '';
    for (let r = 0; r < maze.n; r++) {
      for (let c = 0; c < maze.n; c++) {
        const cellEl = document.createElement('div');
        const seen = maze.visited.has(key(r, c));
        const isExit = r === maze.n - 1 && c === maze.n - 1;
        const isPursuer = seen && r === maze.pursuer.row && c === maze.pursuer.col;
        cellEl.className =
          'mc' +
          (r === maze.row && c === maze.col ? ' here' : '') +
          (isExit && seen ? ' exit' : '') +
          (!seen ? ' unseen' : '') +
          (isPursuer ? ' pursuer' : '');
        map.appendChild(cellEl);
      }
    }

    const overlay = $('em-overlay');
    overlay.style.display = maze.won ? 'flex' : 'none';
    if (maze.won) {
      const best = Math.max(readBest(BEST_KEY) ?? 0, maze.n - MIN_N + 1);
      saveBest(BEST_KEY, best);
      $('em-best').textContent = best;
      overlay.innerHTML = `<div class="g-title">You escaped</div><div class="g-sub">${maze.steps} steps, ${maze.caught} close call${maze.caught === 1 ? '' : 's'}, click New maze for a bigger one</div>`;
    }
  }

  function movePursuer() {
    const step = bfsNextStep(maze.grid, maze.n, maze.pursuer, { row: maze.row, col: maze.col });
    if (step) maze.pursuer = step;
    if (maze.pursuer.row === maze.row && maze.pursuer.col === maze.col) {
      maze.caught += 1;
      maze.steps += 5;
      maze.row = 0;
      maze.col = 0;
      maze.rotation = 0;
      maze.pursuer = { ...maze.lair };
      popup('The Echo caught you, back to the start');
    }
  }

  $('em-left').addEventListener('click', () => {
    if (!maze.won) {
      maze.rotation -= 90;
      draw();
    }
  });
  $('em-right').addEventListener('click', () => {
    if (!maze.won) {
      maze.rotation += 90;
      draw();
    }
  });
  $('em-forward').addEventListener('click', () => {
    if (maze.won) return;
    const idx = ((Math.round(maze.rotation / 90) % 4) + 4) % 4;
    const facing = FACINGS[idx];
    const cell = maze.grid[maze.row][maze.col];
    if (cell[facing]) return;
    const [dr, dc] = DELTA[facing];
    maze.row += dr;
    maze.col += dc;
    maze.steps += 1;
    maze.visited.add(key(maze.row, maze.col));
    if (maze.row === maze.n - 1 && maze.col === maze.n - 1) {
      maze.won = true;
    } else {
      movePursuer();
    }
    draw();
  });
  $('em-new').addEventListener('click', () => {
    if (maze.won) level = Math.min(level + 1, MAX_N - MIN_N + 1);
    maze = newMaze(level);
    draw();
  });

  draw();
}

/* ---- Game 3: Block World (continuous free-roam 3D voxel world) ----------
 * Echo Maze snaps between rooms on a grid. This one doesn't: the player has
 * a real (x, y) position and a facing angle that both change continuously,
 * the same rotate-by-negative-yaw-around-the-camera trick Echo Maze uses,
 * just generalized from 90-degree room snaps to a free-roam world:
 *   world.transform = rotateZ(-yaw) translate3d(-px, -py, 0)
 * translate3d runs first (moves the world so the player is at the origin),
 * then rotateZ turns that around the camera to match which way they're
 * facing - so the terrain the player hasn't reached yet visibly slides and
 * spins past as they walk and turn, instead of a room simply swapping out.
 *
 * Minecraft-inspired, not a clone: a blocky, deterministically-generated
 * chunk (flat-topped voxels, elevation via translateZ, real rotated CSS
 * side faces only where a tile is actually taller than its neighbor - the
 * same "only draw exposed faces" idea real voxel engines use, just done by
 * hand for a couple dozen tiles instead of a renderer). Walk into ore or
 * trees to mine/chop them, then spend wood to place your own blocks. There
 * is no jump and no collision with terrain height - the player always
 * walks at a fixed height, so a hill is climbed by walking onto it rather
 * than jumped up, a deliberate simplification for a browser mini-game.
 * --------------------------------------------------------------------- */

let beaconKeyDownHandler = () => {};
let beaconKeyUpHandler = () => {};
let beaconPointerUpHandler = () => {};

function initBeacon() {
  const BEST_KEY = 'dejavu1.beacon.best';
  const MOVE_SPEED = 3.4,
    TURN_SPEED = 2.6,
    COLLECT_RADIUS = 58;
  const ACCEL = 0.18,
    TURN_ACCEL = 0.25;
  const BASE_TIME = 55;
  const GRID = 9,
    HALF = 4,
    BLOCK = 110,
    BLOCK_H = 46;
  const WORLD_HALF = HALF * BLOCK + BLOCK * 0.4;
  const CRITTER_WANDER_SPEED = 0.55,
    CRITTER_FLEE_SPEED = 2.7,
    CRITTER_FLEE_RADIUS = 150;

  const TIERS = [
    { top: '#8bc97e', side: '#6b9a5c' }, // grass
    { top: '#b7bcc4', side: '#8f959e' }, // stone
    { top: '#eef2f6', side: '#c7cdd6' } // snow cap
  ];
  const BUILT_COLORS = {
    wood: { top: 'var(--accent-light)', side: 'var(--accent)' },
    torch: { top: '#fff3c4', side: '#e0a83c' }
  };

  $('game-stats').innerHTML = `
    <div class="game-stat"><div class="g-key">Level</div><div class="g-val" id="bc-level">1</div></div>
    <div class="game-stat"><div class="g-key">Wood</div><div class="g-val" id="bc-wood">0</div></div>
    <div class="game-stat"><div class="g-key">Ore</div><div class="g-val" id="bc-ore">0</div></div>
    <div class="game-stat"><div class="g-key">Best level</div><div class="g-val accent" id="bc-best">${readBest(BEST_KEY) ?? '—'}</div></div>`;

  $('game-host').innerHTML = `
    <p class="card-sub" style="margin-bottom:12px; max-width:52ch;">Mine every glowing ore vein and tree in the chunk before time runs out. Spend wood on a plain block, or 3 ore on a glowing torch. Something skittish shares the chunk with you. It keeps its distance unless you crowd it. WASD or arrow keys to move and turn, E to place wood, Q for a torch.</p>
    <div class="beacon-viewport" id="bc-viewport">
      <div class="beacon-hud"><span id="bc-hud-left">Resources: 0/0</span><span id="bc-hud-right">Time: —</span></div>
      <div class="beacon-horizon">
        <div class="beacon-world" id="bc-world">
          <div class="beacon-ground"></div>
        </div>
      </div>
      <div class="beacon-reticle" aria-hidden="true"></div>
      <div class="game-overlay" id="bc-overlay"><div class="g-title">Block World</div><div class="g-sub">Click to start. WASD / arrows to move and turn</div></div>
    </div>
    <div class="beacon-controls">
      <button class="btn" id="bc-turnl" data-hold="turnL">↺ Turn</button>
      <button class="btn primary" id="bc-fwd" data-hold="fwd">▲ Forward</button>
      <button class="btn" id="bc-back" data-hold="back">▼ Back</button>
      <button class="btn" id="bc-turnr" data-hold="turnR">Turn ↻</button>
      <button class="btn" id="bc-place">⬛ Place (1 wood)</button>
      <button class="btn" id="bc-torch">🔥 Torch (3 ore)</button>
    </div>`;

  const keys = {};
  let state = { status: 'idle' };

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Cheap deterministic pseudo-noise (no external library): three
  // out-of-phase sine/cosine waves combined, seeded per level so each
  // level is a fresh but reproducible-looking chunk, not literal Perlin
  // noise but enough to cluster into hills instead of pure random static.
  function noise(col, row, seed) {
    const v =
      Math.sin((col + seed) * 0.9) + Math.cos((row + seed * 1.7) * 0.9) + Math.sin((col + row + seed * 2.3) * 0.5);
    return (v + 3) / 6;
  }

  function buildTerrain(level) {
    const seed = level * 13.37;
    const tiles = new Map();
    for (let col = -HALF; col <= HALF; col++) {
      for (let row = -HALF; row <= HALF; row++) {
        const n = noise(col, row, seed);
        const tier = n > 0.72 ? 2 : n > 0.5 ? 1 : 0;
        tiles.set(`${col},${row}`, { col, row, x: col * BLOCK, y: row * BLOCK, tier, h: tier * BLOCK_H });
      }
    }
    return tiles;
  }

  function placeResources(tiles, oreCount, woodCount) {
    const candidates = shuffle([...tiles.values()].filter(t => Math.hypot(t.col, t.row) > 1.5));
    return [
      ...candidates.slice(0, oreCount).map(t => ({ x: t.x, y: t.y, h: t.h, kind: 'ore', got: false, el: null })),
      ...candidates
        .slice(oreCount, oreCount + woodCount)
        .map(t => ({ x: t.x, y: t.y, h: t.h, kind: 'wood', got: false, el: null }))
    ];
  }

  // A small, low-stakes wandering creature: it ambles in a random direction
  // until the player gets close, then flees directly away - a simple
  // reactive state machine (wander vs. flee), not a scripted path.
  function spawnCritter(tiles) {
    const candidates = [...tiles.values()].filter(t => Math.hypot(t.col, t.row) > 2);
    const t = candidates[Math.floor(Math.random() * candidates.length)] || { x: 0, y: 0 };
    return { x: t.x, y: t.y, dx: 1, dy: 0, wanderTimer: 0 };
  }

  function updateCritter() {
    const c = state.critter;
    if (!c) return;
    const toPlayerX = state.px - c.x,
      toPlayerY = state.py - c.y;
    const dist = Math.hypot(toPlayerX, toPlayerY) || 1;
    if (dist < CRITTER_FLEE_RADIUS) {
      c.x -= (toPlayerX / dist) * CRITTER_FLEE_SPEED;
      c.y -= (toPlayerY / dist) * CRITTER_FLEE_SPEED;
      c.wanderTimer = 0;
    } else {
      c.wanderTimer -= 1;
      if (c.wanderTimer <= 0) {
        const angle = Math.random() * Math.PI * 2;
        c.dx = Math.cos(angle);
        c.dy = Math.sin(angle);
        c.wanderTimer = 50 + Math.random() * 70;
      }
      c.x += c.dx * CRITTER_WANDER_SPEED;
      c.y += c.dy * CRITTER_WANDER_SPEED;
    }
    c.x = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, c.x));
    c.y = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, c.y));
  }

  // One flat top face plus real rotated CSS side faces, but only toward a
  // neighbor that's actually lower - the same "don't draw a face nothing
  // will ever occlude" idea a voxel engine uses, applied to ~80 tiles by
  // hand instead of by a renderer.
  function renderVoxel(host, x, y, h, neighborH, colors) {
    const top = document.createElement('div');
    top.className = 'voxel-top';
    top.style.width = top.style.height = `${BLOCK}px`;
    top.style.marginLeft = top.style.marginTop = `${-BLOCK / 2}px`;
    top.style.background = colors.top;
    top.style.transform = `translate3d(${x}px, ${y}px, ${h}px)`;
    host.appendChild(top);

    const sides = [
      { dx: 0, dy: 1, w: BLOCK, hh: null, rot: 'rotateX(90deg)' }, // south
      { dx: 0, dy: -1, w: BLOCK, hh: null, rot: 'rotateX(90deg)' }, // north
      { dx: 1, dy: 0, w: null, hh: BLOCK, rot: 'rotateY(90deg)' }, // east
      { dx: -1, dy: 0, w: null, hh: BLOCK, rot: 'rotateY(90deg)' } // west
    ];
    sides.forEach(s => {
      const nh = neighborH(s.dx, s.dy);
      if (nh === null || nh >= h) return;
      const face = document.createElement('div');
      face.className = 'voxel-side';
      const faceH = h - nh;
      face.style.width = `${s.w ?? faceH}px`;
      face.style.height = `${s.hh ?? faceH}px`;
      face.style.marginLeft = `${-(s.w ?? faceH) / 2}px`;
      face.style.marginTop = `${-(s.hh ?? faceH) / 2}px`;
      face.style.background = colors.side;
      face.style.transform = `translate3d(${x + (s.dx * BLOCK) / 2}px, ${y + (s.dy * BLOCK) / 2}px, ${(h + nh) / 2}px) ${s.rot}`;
      host.appendChild(face);
    });
  }

  function renderTerrain() {
    const world = $('bc-world');
    world.querySelectorAll('.voxel-top, .voxel-side').forEach(el => el.remove());
    state.tiles.forEach(t => {
      const neighborH = (dx, dy) => {
        const n = state.tiles.get(`${t.col + dx},${t.row + dy}`);
        return n ? n.h : null;
      };
      renderVoxel(world, t.x, t.y, t.h, neighborH, TIERS[t.tier]);
    });
  }

  function renderResources() {
    const world = $('bc-world');
    world.querySelectorAll('.voxel-ore, .voxel-wood').forEach(el => el.remove());
    state.resources.forEach(r => {
      const el = document.createElement('div');
      el.className = r.kind === 'ore' ? 'voxel-ore' : 'voxel-wood';
      world.appendChild(el);
      r.el = el;
    });
    positionResources();
  }

  // Collected resources get a scale-and-fade animation (see .collected in
  // CSS) instead of vanishing instantly - a small "you got that" beat.
  // Once collected, a resource's element is left alone rather than repositioned.
  function positionResources() {
    state.resources.forEach(r => {
      if (r.got || !r.el) return;
      r.el.style.transform = `translate3d(${r.x}px, ${r.y}px, ${r.h + 30}px)`;
    });
  }

  function renderCritter() {
    const world = $('bc-world');
    world.querySelectorAll('.voxel-critter').forEach(el => el.remove());
    const wrap = document.createElement('div');
    wrap.className = 'voxel-critter';
    wrap.innerHTML = '<div class="voxel-critter-body"></div>';
    world.appendChild(wrap);
    positionCritter();
  }

  function positionCritter() {
    if (!state.critter) return;
    const el = document.querySelector('#bc-world .voxel-critter');
    if (!el) return;
    el.style.transform = `translate3d(${state.critter.x}px, ${state.critter.y}px, 20px)`;
  }

  function renderBuilt() {
    const world = $('bc-world');
    world.querySelectorAll('.voxel-built').forEach(el => el.remove());
    state.built.forEach(b => {
      const wrap = document.createElement('div');
      wrap.className = 'voxel-built' + (b.kind === 'torch' ? ' voxel-built-torch' : '');
      renderVoxel(
        wrap,
        b.x,
        b.y,
        BLOCK_H,
        (dx, dy) => (dx === 0 && dy === 0 ? null : 0),
        BUILT_COLORS[b.kind] || BUILT_COLORS.wood
      );
      world.appendChild(wrap);
    });
  }

  function popup(text) {
    const host = $('bc-viewport');
    const el = document.createElement('div');
    el.className = 'bc-popup';
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => el.remove(), 750);
  }

  function newLevel(level) {
    const oreCount = Math.min(4 + level, 11);
    const woodCount = Math.min(3 + Math.floor(level / 2), 9);
    const carried = { wood: state.wood || 0, ore: state.ore || 0 };
    const tiles = buildTerrain(level);
    state = {
      status: 'playing',
      level,
      wood: carried.wood,
      ore: carried.ore,
      px: 0,
      py: 0,
      yaw: 0,
      speed: 0,
      turnRate: 0,
      tiles,
      resources: placeResources(tiles, oreCount, woodCount),
      built: [],
      critter: spawnCritter(tiles),
      timeLeft: Math.max(BASE_TIME - (level - 1) * 2, 28),
      collected: 0,
      goal: oreCount + woodCount
    };
    renderTerrain();
    renderResources();
    renderBuilt();
    renderCritter();
  }

  function draw() {
    if (state.status === 'idle') {
      $('bc-world').style.transform = 'translate3d(0,0,0)';
      $('bc-overlay').style.display = 'flex';
      return;
    }
    $('bc-world').style.transform = `rotateZ(${-state.yaw}deg) translate3d(${-state.px}px, ${-state.py}px, 0)`;
    $('bc-level').textContent = state.level;
    $('bc-wood').textContent = state.wood;
    $('bc-ore').textContent = state.ore;
    $('bc-hud-left').textContent = `Resources: ${state.collected}/${state.goal}`;
    $('bc-hud-right').textContent = `Time: ${Math.max(Math.ceil(state.timeLeft), 0)}s`;

    const overlay = $('bc-overlay');
    overlay.style.display = state.status === 'playing' ? 'none' : 'flex';
    if (state.status === 'over') {
      overlay.innerHTML = `<div class="g-title">Out of time</div><div class="g-sub">Reached level ${state.level}: ${state.wood} wood, ${state.ore} ore. Click to try again</div>`;
    }
  }

  function place() {
    if (state.status !== 'playing' || state.wood < 1) return;
    state.wood -= 1;
    const yawRad = (state.yaw * Math.PI) / 180;
    state.built.push({
      x: state.px + Math.sin(yawRad) * 95,
      y: state.py - Math.cos(yawRad) * 95,
      kind: 'wood'
    });
    renderBuilt();
    draw();
  }

  function placeTorch() {
    if (state.status !== 'playing' || state.ore < 3) return;
    state.ore -= 3;
    const yawRad = (state.yaw * Math.PI) / 180;
    state.built.push({
      x: state.px + Math.sin(yawRad) * 95,
      y: state.py - Math.cos(yawRad) * 95,
      kind: 'torch'
    });
    renderBuilt();
    draw();
  }

  function tick() {
    if (state.status !== 'playing') return;

    // Acceleration instead of an instant fixed speed - held input eases
    // toward its target velocity each tick, so starting and stopping (and
    // turning) reads as real momentum rather than a toggle switch.
    const turnInput = (keys.turnR ? 1 : 0) - (keys.turnL ? 1 : 0);
    const moveInput = (keys.fwd ? 1 : 0) - (keys.back ? 1 : 0);
    state.turnRate += (turnInput * TURN_SPEED - state.turnRate) * TURN_ACCEL;
    state.speed += (moveInput * MOVE_SPEED - state.speed) * ACCEL;
    state.yaw += state.turnRate;
    const yawRad = (state.yaw * Math.PI) / 180;
    state.px += Math.sin(yawRad) * state.speed;
    state.py += -Math.cos(yawRad) * state.speed;
    state.px = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, state.px));
    state.py = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, state.py));

    state.resources.forEach(r => {
      if (r.got) return;
      if (Math.hypot(r.x - state.px, r.y - state.py) < COLLECT_RADIUS) {
        r.got = true;
        state.collected += 1;
        if (r.kind === 'ore') state.ore += 1;
        else state.wood += 1;
        if (r.el) r.el.classList.add('collected');
        popup(r.kind === 'ore' ? '+1 Ore' : '+1 Wood');
      }
    });
    positionResources();
    updateCritter();
    positionCritter();

    state.timeLeft -= 0.03;

    if (state.collected === state.goal) {
      const best = Math.max(readBest(BEST_KEY) ?? 0, state.level);
      saveBest(BEST_KEY, best);
      $('bc-best').textContent = best;
      newLevel(state.level + 1);
    } else if (state.timeLeft <= 0) {
      state.status = 'over';
      clearInterval(gameLoopHandle);
      gameLoopHandle = null;
      const best = Math.max(readBest(BEST_KEY) ?? 0, state.level);
      saveBest(BEST_KEY, best);
      $('bc-best').textContent = best;
    }
    draw();
  }

  function start() {
    newLevel(1);
    gameLoopHandle = setInterval(tick, 30);
    draw();
  }

  $('bc-viewport').addEventListener('click', () => {
    if (state.status !== 'playing') start();
  });
  $('bc-place').addEventListener('click', place);
  $('bc-torch').addEventListener('click', placeTorch);

  document.querySelectorAll('[data-hold]').forEach(btn => {
    const key = btn.dataset.hold;
    const down = e => {
      e.preventDefault();
      keys[key] = true;
    };
    const up = () => {
      keys[key] = false;
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('pointercancel', up);
  });
  // On touch, a finger can slide off a small button while still held down,
  // pointerleave won't always catch that. A document-wide release clears
  // every held key so a stray touch never leaves movement stuck on.
  beaconPointerUpHandler = () => {
    Object.keys(keys).forEach(k => {
      keys[k] = false;
    });
  };
  document.addEventListener('pointerup', beaconPointerUpHandler);
  document.addEventListener('pointercancel', beaconPointerUpHandler);

  const KEY_MAP = {
    KeyW: 'fwd',
    ArrowUp: 'fwd',
    KeyS: 'back',
    ArrowDown: 'back',
    KeyA: 'turnL',
    ArrowLeft: 'turnL',
    KeyD: 'turnR',
    ArrowRight: 'turnR'
  };
  beaconKeyDownHandler = e => {
    if (KEY_MAP[e.code]) {
      e.preventDefault();
      keys[KEY_MAP[e.code]] = true;
    } else if (e.code === 'KeyE') {
      e.preventDefault();
      place();
    } else if (e.code === 'KeyQ') {
      e.preventDefault();
      placeTorch();
    }
  };
  beaconKeyUpHandler = e => {
    if (KEY_MAP[e.code]) keys[KEY_MAP[e.code]] = false;
  };
  document.addEventListener('keydown', beaconKeyDownHandler);
  document.addEventListener('keyup', beaconKeyUpHandler);

  draw();
}

/* ---- Game 4: Block Stacker ------------------------------------------- */

function initStacker() {
  const BEST_KEY = 'dejavu1.stacker.best';
  const W = 300,
    H = 420,
    BLOCK_H = 26,
    VISIBLE_ROWS = Math.floor(H / BLOCK_H);
  // A drop this close to fully flush with the block below counts as
  // "perfect" - the classic tower-game reward: no shrinkage, a combo tick,
  // and a snap to dead-flush alignment instead of the exact pixel offset.
  const PERFECT_MARGIN = 6;

  $('game-stats').innerHTML = `
    <div class="game-stat"><div class="g-key">Height</div><div class="g-val" id="st-height">0</div></div>
    <div class="game-stat"><div class="g-key">Combo</div><div class="g-val" id="st-combo">0</div></div>
    <div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="st-best">${readBest(BEST_KEY) ?? '—'}</div></div>`;

  $('game-host').innerHTML = `
    <div class="game-surface stacker" id="st-surface" style="width:${W}px; max-width:100%; height:${H}px;">
      <div class="game-overlay" id="st-overlay"><div class="g-title">Block Stacker</div><div class="g-sub">Click to start, click to drop each block</div></div>
    </div>`;

  const COLORS = ['#ff9c66', '#7fb2ff', '#5cc16f', '#e0475f'];
  let blocks = []; // placed blocks, bottom to top
  let moving = null;
  let level = 0;
  let combo = 0;
  let status = 'idle';

  function popup(text) {
    const host = $('st-surface');
    const el = document.createElement('div');
    el.className = 'stacker-popup';
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }

  function draw() {
    const surface = $('st-surface');
    surface.querySelectorAll('.stacker-block').forEach(el => el.remove());
    const visible = blocks.slice(-VISIBLE_ROWS);
    visible.forEach((b, i) => {
      const el = document.createElement('div');
      el.className = 'stacker-block' + (b.perfect ? ' perfect' : '');
      el.style.left = `${b.x}px`;
      el.style.width = `${b.width}px`;
      el.style.bottom = `${i * BLOCK_H}px`;
      el.style.background = b.color;
      surface.appendChild(el);
    });
    if (moving && status === 'playing') {
      const el = document.createElement('div');
      el.className = 'stacker-block';
      el.style.left = `${moving.x}px`;
      el.style.width = `${moving.width}px`;
      el.style.bottom = `${Math.min(level, VISIBLE_ROWS - 1) * BLOCK_H}px`;
      el.style.background = moving.color;
      surface.appendChild(el);
    }
    $('st-height').textContent = level;
    $('st-combo').textContent = combo;
    const overlay = $('st-overlay');
    overlay.style.display = status === 'playing' ? 'none' : 'flex';
    if (status === 'over')
      overlay.innerHTML = `<div class="g-title">Missed</div><div class="g-sub">Height ${level}, best combo this run ${combo}. Click to try again</div>`;
  }

  function spawnMoving() {
    const prev = blocks[blocks.length - 1];
    const width = prev ? prev.width : 90;
    moving = { x: 0, width, dir: 1, color: COLORS[level % COLORS.length] };
  }

  function tick() {
    if (status !== 'playing' || !moving) return;
    // Speeds up as the tower gets taller, and the margin for a clean drop
    // (blocks shrink toward the overlap already) gets less forgiving.
    const speed = Math.min(4 + level * 0.35, 11);
    moving.x += moving.dir * speed;
    if (moving.x <= 0 || moving.x + moving.width >= W) moving.dir *= -1;
    moving.x = Math.max(0, Math.min(W - moving.width, moving.x));
    draw();
  }

  function drop() {
    const prev = blocks[blocks.length - 1];
    if (!prev) {
      blocks.push({ x: moving.x, width: moving.width, color: moving.color, perfect: true });
    } else {
      const left = Math.max(prev.x, moving.x);
      const right = Math.min(prev.x + prev.width, moving.x + moving.width);
      const overlap = right - left;
      if (overlap <= 4) {
        status = 'over';
        clearInterval(gameLoopHandle);
        gameLoopHandle = null;
        const best = Math.max(readBest(BEST_KEY) ?? 0, level);
        saveBest(BEST_KEY, best);
        $('st-best').textContent = best;
        draw();
        return;
      }
      if (overlap >= moving.width - PERFECT_MARGIN) {
        combo += 1;
        blocks.push({ x: prev.x, width: moving.width, color: moving.color, perfect: true });
        popup(combo > 1 ? `Perfect! x${combo}` : 'Perfect!');
      } else {
        combo = 0;
        blocks.push({ x: left, width: overlap, color: moving.color, perfect: false });
      }
    }
    level += 1;
    spawnMoving();
    draw();
  }

  $('st-surface').addEventListener('click', () => {
    if (status !== 'playing') {
      blocks = [];
      level = 0;
      combo = 0;
      status = 'playing';
      spawnMoving();
      gameLoopHandle = setInterval(tick, 20);
    } else {
      drop();
    }
    draw();
  });

  draw();
}

/* ---- Game 5: Merge Puzzle (2048-style) --------------------------------- */

let mergeKeyHandler = () => {};

function initMerge() {
  const BEST_KEY = 'dejavu1.merge.best';
  const SIZE = 4;
  const DIRECTIONS = ['up', 'down', 'left', 'right'];

  $('game-stats').innerHTML = `
    <div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="mg-score">0</div></div>
    <div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="mg-best">${readBest(BEST_KEY) ?? '—'}</div></div>`;

  $('game-host').innerHTML = `
    <p class="card-sub" style="text-align:center; margin-bottom:14px;">Arrow keys to play, or use the buttons below on touch. Hint suggests a move; Undo steps back once.</p>
    <div class="merge-board" id="mg-board"></div>
    <div style="display:flex; justify-content:center; gap:8px; margin-top:16px; flex-wrap:wrap;">
      <button class="btn mg-dirbtn" id="mg-up">↑</button>
      <button class="btn mg-dirbtn" id="mg-down">↓</button>
      <button class="btn mg-dirbtn" id="mg-left">←</button>
      <button class="btn mg-dirbtn" id="mg-right">→</button>
    </div>
    <div style="display:flex; justify-content:center; gap:8px; margin-top:8px; flex-wrap:wrap;">
      <button class="btn" id="mg-hint">💡 Hint</button>
      <button class="btn" id="mg-undo">↩ Undo</button>
      <button class="btn primary" id="mg-new">New game</button>
    </div>
    <div class="game-overlay" id="mg-overlay" style="display:none; position:static; margin-top:14px; background:none; backdrop-filter:none;"></div>`;

  const TILE_COLORS = {
    2: '#f0f1f5',
    4: '#ffe8d5',
    8: '#ffd0a8',
    16: '#ffb17a',
    32: '#ff9c66',
    64: '#ff7a2f',
    128: '#e0475f',
    256: '#c8102e',
    512: '#7fb2ff',
    1024: '#3b82f6',
    2048: '#34c759'
  };

  let grid = [];
  let score = 0;
  let over = false;
  let spawnPos = null;
  let undoState = null;

  function emptyGrid() {
    return Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
  }
  function cloneGrid(g) {
    return g.map(row => row.slice());
  }

  function addRandomTile(g, scoreForOdds) {
    const empties = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (g[r][c] === 0) empties.push([r, c]);
    if (!empties.length) return null;
    const [r, c] = empties[Math.floor(Math.random() * empties.length)];
    // The higher the score climbs, the more often a 4 shows up instead of a
    // 2 - harder to plan around, same as the real game gets harder late.
    const twoChance = Math.max(0.9 - scoreForOdds / 15000, 0.68);
    g[r][c] = Math.random() < twoChance ? 2 : 4;
    return [r, c];
  }

  function newGame() {
    grid = emptyGrid();
    score = 0;
    over = false;
    undoState = null;
    addRandomTile(grid, 0);
    spawnPos = addRandomTile(grid, 0);
    draw();
  }

  function slideRow(row) {
    const values = row.filter(v => v !== 0);
    const merged = [];
    let gained = 0;
    for (let i = 0; i < values.length; i++) {
      if (i < values.length - 1 && values[i] === values[i + 1]) {
        merged.push(values[i] * 2);
        gained += values[i] * 2;
        i++;
      } else {
        merged.push(values[i]);
      }
    }
    while (merged.length < SIZE) merged.push(0);
    return { row: merged, gained };
  }

  function rotateGrid(g) {
    const result = emptyGrid();
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) result[c][SIZE - 1 - r] = g[r][c];
    return result;
  }

  // Pure: simulates a move on any grid without touching game state, so it
  // can be reused both for the real move and for the hint's what-if search.
  function simulateMove(sourceGrid, direction) {
    let working = sourceGrid;
    const rotations = { left: 0, up: 1, right: 2, down: 3 }[direction];
    for (let i = 0; i < rotations; i++) working = rotateGrid(working);

    let moved = false;
    let gainedTotal = 0;
    const result = working.map(row => {
      const before = row.join(',');
      const { row: after, gained } = slideRow(row);
      if (after.join(',') !== before) moved = true;
      gainedTotal += gained;
      return after;
    });

    for (let i = 0; i < (4 - rotations) % 4; i++) working = rotateGrid(result);
    const final = rotations === 0 ? result : working;
    return { grid: final, moved, gained: gainedTotal };
  }

  function move(direction) {
    if (over) return;
    const { grid: final, moved, gained } = simulateMove(grid, direction);
    if (moved) {
      undoState = { grid: cloneGrid(grid), score };
      grid = final;
      score += gained;
      spawnPos = addRandomTile(grid, score);
      if (!hasMoves()) over = true;
      draw();
      if (over) {
        const best = Math.max(readBest(BEST_KEY) ?? 0, score);
        saveBest(BEST_KEY, best);
        $('mg-best').textContent = best;
      }
    }
  }

  function undo() {
    if (!undoState || over) return;
    grid = undoState.grid;
    score = undoState.score;
    undoState = null;
    spawnPos = null;
    draw();
  }

  // A small heuristic search (empty cells, "smoothness" between neighbors,
  // and keeping the biggest tile cornered) - not full lookahead, but real
  // evaluation of the resulting board rather than a coin flip between
  // directions that happen to be legal.
  function evaluateGrid(g) {
    let empty = 0,
      monotonicity = 0,
      maxVal = 0;
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        if (g[r][c] === 0) empty++;
        maxVal = Math.max(maxVal, g[r][c]);
      }
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE - 1; c++) {
        if (g[r][c] && g[r][c + 1]) monotonicity -= Math.abs(Math.log2(g[r][c]) - Math.log2(g[r][c + 1]));
      }
    for (let c = 0; c < SIZE; c++)
      for (let r = 0; r < SIZE - 1; r++) {
        if (g[r][c] && g[r + 1][c]) monotonicity -= Math.abs(Math.log2(g[r][c]) - Math.log2(g[r + 1][c]));
      }
    const corners = [g[0][0], g[0][SIZE - 1], g[SIZE - 1][0], g[SIZE - 1][SIZE - 1]];
    const cornerBonus = corners.includes(maxVal) ? maxVal : 0;
    return empty * 8 + monotonicity * 2 + cornerBonus * 0.5;
  }

  function hint() {
    if (over) return;
    let best = null,
      bestScore = -Infinity;
    DIRECTIONS.forEach(dir => {
      const { grid: g, moved } = simulateMove(grid, dir);
      if (!moved) return;
      const s = evaluateGrid(g);
      if (s > bestScore) {
        bestScore = s;
        best = dir;
      }
    });
    document.querySelectorAll('.mg-dirbtn').forEach(b => b.classList.remove('suggested'));
    if (best) {
      const btn = $(`mg-${best}`);
      btn.classList.add('suggested');
      setTimeout(() => btn.classList.remove('suggested'), 1300);
    }
  }

  function hasMoves() {
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c] === 0) return true;
        if (c < SIZE - 1 && grid[r][c] === grid[r][c + 1]) return true;
        if (r < SIZE - 1 && grid[r][c] === grid[r + 1][c]) return true;
      }
    return false;
  }

  function draw() {
    const board = $('mg-board');
    board.innerHTML = '';
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        const value = grid[r][c];
        const cell = document.createElement('div');
        cell.className = 'merge-cell' + (spawnPos && spawnPos[0] === r && spawnPos[1] === c ? ' spawn' : '');
        if (value) {
          cell.textContent = value;
          cell.style.background = TILE_COLORS[value] || '#1c1c1e';
          cell.style.color = value <= 4 ? 'var(--text)' : '#fff';
        }
        board.appendChild(cell);
      }
    $('mg-score').textContent = score;
    $('mg-undo').disabled = !undoState;
    const overlay = $('mg-overlay');
    overlay.style.display = over ? 'flex' : 'none';
    if (over) overlay.innerHTML = `<div class="g-title">No more moves</div><div class="g-sub">Score ${score}</div>`;
  }

  mergeKeyHandler = e => {
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (map[e.key]) {
      e.preventDefault();
      move(map[e.key]);
    } else if (e.key === 'h' || e.key === 'H') {
      hint();
    } else if (e.key === 'z' || e.key === 'Z') {
      undo();
    }
  };
  document.addEventListener('keydown', mergeKeyHandler);

  $('mg-up').addEventListener('click', () => move('up'));
  $('mg-down').addEventListener('click', () => move('down'));
  $('mg-left').addEventListener('click', () => move('left'));
  $('mg-right').addEventListener('click', () => move('right'));
  $('mg-hint').addEventListener('click', hint);
  $('mg-undo').addEventListener('click', undo);
  $('mg-new').addEventListener('click', newGame);

  newGame();
}

/* ---- Game 6: Brick Break (breakout, with level progression) ------------ */

function initBreakout() {
  const BEST_KEY = 'dejavu1.breakout.best';
  const W = 480,
    H = 360,
    PADDLE_W_BASE = 80,
    PADDLE_H = 12,
    BALL_R = 6;
  const COLS = 8,
    BRICK_H = 18,
    ROWS_MAX = 7;
  const MAX_BALLS = 3,
    WIDE_TICKS = 480,
    POWERUP_CHANCE = 0.16;
  const POWERUP_TYPES = [
    { kind: 'multi', label: 'Multi-ball!', letter: 'M', color: '#7fb2ff' },
    { kind: 'wide', label: 'Paddle grow!', letter: 'W', color: '#34c759' },
    { kind: 'slow', label: 'Slowed down!', letter: 'S', color: '#e0475f' }
  ];

  $('game-stats').innerHTML = `
    <div class="game-stat"><div class="g-key">Level</div><div class="g-val" id="bo-level">1</div></div>
    <div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="bo-score">0</div></div>
    <div class="game-stat"><div class="g-key">Best level</div><div class="g-val accent" id="bo-best">${readBest(BEST_KEY) ?? '—'}</div></div>`;

  $('game-host').innerHTML = `
    <div class="game-surface breakout" id="bo-surface" style="width:${W}px; max-width:100%; height:${H}px;">
      <div class="bo-paddle" id="bo-paddle" style="width:${PADDLE_W_BASE}px;"></div>
      <div class="game-overlay" id="bo-overlay"><div class="g-title">Brick Break</div><div class="g-sub">Move the mouse to steer, click to launch. Tougher bricks take two hits; falling capsules are worth catching.</div></div>
    </div>`;

  const BRICK_W = W / COLS;
  const COLORS = ['#ff9c66', '#ffcc66', '#7fb2ff', '#5cc16f', '#e0475f', '#34c759', '#a78bfa'];

  // Every level shrinks the paddle a little and speeds the ball up, on top
  // of one more row of bricks, up to ROWS_MAX - it keeps going instead of
  // stopping the moment the board clears.
  let level = 1;
  let paddleW = PADDLE_W_BASE;
  let paddleX = W / 2 - paddleW / 2;
  let balls = [];
  let bricks = [];
  let powerups = [];
  let wideTicks = 0;
  let score = 0;
  let status = 'idle';

  function ballSpeedMultiplier() {
    return 1 + (level - 1) * 0.14;
  }

  function effectivePaddleW() {
    return wideTicks > 0 ? Math.min(paddleW * 1.4, W * 0.55) : paddleW;
  }

  function popup(text) {
    const host = $('bo-surface');
    const el = document.createElement('div');
    el.className = 'bo-popup';
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => el.remove(), 750);
  }

  // Past level 2, some bricks need two hits - a crack shows after the
  // first, distinct from a one-hit brick instead of just "more health".
  function resetBricks(forLevel) {
    const rows = Math.min(3 + Math.floor((forLevel - 1) / 1), ROWS_MAX);
    const toughChance = Math.min(Math.max((forLevel - 2) * 0.07, 0), 0.35);
    bricks = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < COLS; c++) {
        const hp = Math.random() < toughChance ? 2 : 1;
        bricks.push({
          x: c * BRICK_W,
          y: r * BRICK_H + 10,
          w: BRICK_W - 4,
          h: BRICK_H - 4,
          color: COLORS[r % COLORS.length],
          hp,
          maxHp: hp,
          alive: true
        });
      }
  }

  function setupLevel(forLevel) {
    level = forLevel;
    paddleW = Math.max(PADDLE_W_BASE - (level - 1) * 4, 40);
    paddleX = Math.max(0, Math.min(W - paddleW, paddleX));
    wideTicks = 0;
    powerups = [];
    resetBricks(level);
    const speed = 3.4 * ballSpeedMultiplier();
    balls = [{ x: W / 2, y: H - 40, vx: speed * 0.7, vy: -speed }];
  }

  function draw() {
    const surface = $('bo-surface');
    surface.querySelectorAll('.bo-brick, .bo-ball, .bo-powerup').forEach(el => el.remove());
    bricks.forEach(b => {
      if (!b.alive) return;
      const el = document.createElement('div');
      el.className = 'bo-brick' + (b.hp < b.maxHp ? ' cracked' : '');
      el.style.left = `${b.x + 2}px`;
      el.style.top = `${b.y}px`;
      el.style.width = `${b.w}px`;
      el.style.height = `${b.h}px`;
      el.style.background = b.color;
      surface.appendChild(el);
    });
    balls.forEach(b => {
      const el = document.createElement('div');
      el.className = 'bo-ball';
      el.style.left = `${b.x - BALL_R}px`;
      el.style.top = `${b.y - BALL_R}px`;
      surface.appendChild(el);
    });
    powerups.forEach(p => {
      const el = document.createElement('div');
      el.className = 'bo-powerup';
      el.style.left = `${p.x - 11}px`;
      el.style.top = `${p.y - 11}px`;
      el.style.background = p.color;
      el.textContent = p.letter;
      surface.appendChild(el);
    });
    const effW = effectivePaddleW();
    $('bo-paddle').style.left = `${paddleX}px`;
    $('bo-paddle').style.width = `${effW}px`;
    $('bo-paddle').style.bottom = '10px';
    $('bo-paddle').classList.toggle('wide', wideTicks > 0);
    $('bo-level').textContent = level;
    $('bo-score').textContent = score;

    const overlay = $('bo-overlay');
    overlay.style.display = status === 'playing' ? 'none' : 'flex';
    if (status === 'over')
      overlay.innerHTML = `<div class="g-title">Game over</div><div class="g-sub">Reached level ${level}, score ${score}. Click to try again</div>`;
  }

  function applyPowerup(type) {
    if (type === 'multi') {
      if (balls.length < MAX_BALLS && balls.length) {
        const src = balls[0];
        balls.push({ x: src.x, y: src.y, vx: -src.vx || (Math.random() < 0.5 ? -2.4 : 2.4), vy: src.vy });
      }
    } else if (type === 'wide') {
      wideTicks = WIDE_TICKS;
      paddleX = Math.max(0, Math.min(W - effectivePaddleW(), paddleX));
    } else if (type === 'slow') {
      balls.forEach(b => {
        b.vx *= 0.6;
        b.vy *= 0.6;
      });
    }
    const meta = POWERUP_TYPES.find(p => p.kind === type);
    if (meta) popup(meta.label);
  }

  function tick() {
    if (status !== 'playing') return;
    if (wideTicks > 0) wideTicks -= 1;
    const effW = effectivePaddleW();
    const paddleY = H - 10 - PADDLE_H;

    for (let i = balls.length - 1; i >= 0; i--) {
      const ball = balls[i];
      ball.x += ball.vx;
      ball.y += ball.vy;

      if (ball.x - BALL_R < 0 || ball.x + BALL_R > W) ball.vx *= -1;
      if (ball.y - BALL_R < 0) ball.vy *= -1;

      if (
        ball.y + BALL_R >= paddleY &&
        ball.y + BALL_R <= paddleY + PADDLE_H + 6 &&
        ball.x >= paddleX &&
        ball.x <= paddleX + effW &&
        ball.vy > 0
      ) {
        const hitPos = (ball.x - paddleX) / effW - 0.5;
        const speed = 3.4 * ballSpeedMultiplier();
        ball.vx = hitPos * speed * 2.2;
        ball.vy = -Math.abs(speed);
      }

      bricks.forEach(b => {
        if (!b.alive) return;
        if (
          ball.x + BALL_R > b.x &&
          ball.x - BALL_R < b.x + b.w &&
          ball.y + BALL_R > b.y &&
          ball.y - BALL_R < b.y + b.h
        ) {
          b.hp -= 1;
          ball.vy *= -1;
          if (b.hp <= 0) {
            b.alive = false;
            score += 10;
            if (Math.random() < POWERUP_CHANCE) {
              const meta = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
              powerups.push({
                x: b.x + b.w / 2,
                y: b.y,
                vy: 1.7,
                kind: meta.kind,
                letter: meta.letter,
                color: meta.color
              });
            }
          } else {
            score += 4;
          }
        }
      });

      if (ball.y - BALL_R > H) balls.splice(i, 1);
    }

    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.y += p.vy;
      if (p.y - 11 >= paddleY - 4 && p.y - 11 <= paddleY + PADDLE_H + 6 && p.x >= paddleX && p.x <= paddleX + effW) {
        applyPowerup(p.kind);
        powerups.splice(i, 1);
      } else if (p.y > H) {
        powerups.splice(i, 1);
      }
    }

    if (!balls.length) {
      status = 'over';
      clearInterval(gameLoopHandle);
      gameLoopHandle = null;
      const best = Math.max(readBest(BEST_KEY) ?? 0, level);
      saveBest(BEST_KEY, best);
      $('bo-best').textContent = best;
    } else if (bricks.every(b => !b.alive)) {
      // Cleared the board - advance instead of stopping. Score carries over.
      setupLevel(level + 1);
      const best = Math.max(readBest(BEST_KEY) ?? 0, level);
      saveBest(BEST_KEY, best);
      $('bo-best').textContent = best;
    }
    draw();
  }

  $('bo-surface').addEventListener('pointermove', e => {
    const rect = $('bo-surface').getBoundingClientRect();
    const effW = effectivePaddleW();
    paddleX = Math.max(0, Math.min(W - effW, e.clientX - rect.left - effW / 2));
    if (status !== 'playing') draw();
  });

  $('bo-surface').addEventListener('click', () => {
    if (status !== 'playing') {
      score = 0;
      status = 'playing';
      setupLevel(1);
      gameLoopHandle = setInterval(tick, 16);
    }
  });

  setupLevel(1);
  draw();
}

// The two start-up timers from the original single file (part 2 and part 4 of the arcade): they run once
// every part has loaded, exactly as they did when the arcade was one file.
setTimeout(installArcadePlus, 50);
/* The legacy block below is shadowed after script evaluation so only the new arcade runtime is reachable. */
setTimeout(() => {
  stopCurrentGame = () => {
    gameStop();
    activeGame = null;
  };
  renderGame = name => {
    stopCurrentGame();
    activeGame = name;
    (
      ({
        asteroids: newAsteroids,
        pong: newPong,
        mines: newMines,
        tetris: newTetris,
        pacman: newPacman,
        solitaire: newSolitaire
      })[name] || newAsteroids
    )();
  };
  const picker = $('game-picker');
  if (picker) {
    const cleanPicker = picker.cloneNode(true);
    picker.replaceWith(cleanPicker);
    cleanPicker.querySelectorAll('button').forEach(button =>
      button.addEventListener('click', () => {
        cleanPicker.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
        renderGame(button.dataset.game);
      })
    );
    // Only when the Games tab is open: a game started while hidden keeps its
    // keyboard handlers, and Sky Dash's would swallow every Space typed
    // anywhere on the page. Opening the tab starts it (showTab).
    if (!$('tab-games').hidden) renderGame(cleanPicker.querySelector('button.active')?.dataset.game || 'asteroids');
  }
}, 0);
// app.js used to call this at start-up; now it runs when this file arrives.
initGames();
