/* Deja Vu1 arcade, part 6 of 7: the six "While you wait" games and the dispatch that picks the active game set.
 * Loaded right after games-puzzle.js by app.js loadGames(); the parts share one global scope.
 */
let gamesCleanupV2 = () => {};
let gameToastTimeoutsV2 = [];
function gamesToolsV2() {
  const events = [],
    intervals = [],
    timeouts = [];
  const on = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    events.push(() => target.removeEventListener(type, handler, options));
  };
  const every = (handler, ms) => {
    const id = frameEvery(handler, ms);
    intervals.push(id);
    return id;
  };
  const later = (handler, ms) => {
    const id = setTimeout(handler, ms);
    timeouts.push(id);
    return id;
  };
  gamesCleanupV2 = () => {
    events.splice(0).forEach(remove => remove());
    intervals.splice(0).forEach(id => clearInterval(id));
    timeouts.splice(0).forEach(id => clearTimeout(id));
    gameToastTimeoutsV2.splice(0).forEach(id => clearTimeout(id));
  };
  return { on, every, later };
}
const gameBestV2 = key => readBest(key) || 0;
const randomV2 = max => Math.floor(Math.random() * max);
function gameShellV2(title, help, body) {
  return `<div class="game-frame"><div class="game-toolbar"><div><strong>${title}</strong><span>${help}</span></div></div>${body}</div>`;
}
function gameToastV2(host, text, kind = '') {
  const toast = document.createElement('div');
  toast.className = `game-toast ${kind}`;
  toast.textContent = text;
  host.appendChild(toast);
  const timeout = setTimeout(() => toast.remove(), 850);
  gameToastTimeoutsV2.push(timeout);
}
function gameFullscreenV2(host, tools) {
  const button = document.createElement('button');
  button.className = 'btn small game-fullscreen';
  button.type = 'button';
  button.textContent = '⛶ Fullscreen';
  tools.on(button, 'click', () => {
    const target = host.querySelector('.game-frame') || host;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    const request = target.requestFullscreen?.();
    request?.catch?.(() => {});
  });
  tools.on(document, 'fullscreenchange', () => {
    button.textContent = document.fullscreenElement ? '× Exit fullscreen' : '⛶ Fullscreen';
  });
  host.querySelector('.game-toolbar').appendChild(button);
}
const stopLegacyGamesV2 = stopCurrentGame;
stopCurrentGame = () => {
  stopLegacyGamesV2();
  gamesCleanupV2();
  gamesCleanupV2 = () => {};
};
renderGame = name => {
  stopCurrentGame();
  activeGame = name;
  const games = {
    skydash: skyDashV2,
    echomaze: echoMazeV2,
    beacon: blockWorldV2,
    stacker: blockStackerV2,
    merge: mergePuzzleV2,
    breakout: brickBreakV2
  };
  (games[name] || skyDashV2)();
};

/* Sky Dash: persistent one-button flight with forgiving hitboxes and streaks. */
function skyDashV2() {
  /* Fly through the gaps. Drawn on one canvas at a steady 60 steps a
     second, with physics in pixels per second: a flap lifts you about
     sixty pixels, the fall is firm but catchable, and the first gate is
     a few seconds away so there's time to find the rhythm. */
  const t = plusTools(),
    BEST_KEY = 'dejavu1.skydash.best',
    W = 680,
    H = 390,
    GROUND = H - 34,
    BIRD_X = 150,
    R = 13;
  plusStats([
    ['Score', 's2-score'],
    ['Streak', 's2-streak'],
    ['Best', 's2-best', true, gameBestV2(BEST_KEY) || '0']
  ]);
  plusFrame(
    'Sky Dash',
    'Space, click or tap to flap · fly through the gaps · P pauses',
    `<div class="arcade-stage"><canvas id="s2-canvas" class="arcade-canvas" aria-label="Sky Dash"></canvas>
     <div class="game-overlay" id="s2-overlay"><div class="g-title">SKY DASH</div><div class="g-sub">Each flap lifts you a little. Tap in a steady rhythm to fly through the gaps.</div><button class="btn primary" type="button">Start flight</button></div></div>
     <div class="arcade-actions"><span id="s2-message" role="status">Press Space, click or tap to flap.</span></div>`,
    t
  );
  const canvas = $('s2-canvas'),
    ctx = canvas.getContext('2d'),
    dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const STEP = 1 / 60,
    GRAVITY = 1500,
    FLAP = -430,
    TERMINAL = 620;
  let state = 'ready',
    paused = false,
    y = H / 2,
    vy = 0,
    score = 0,
    streak = 0,
    pipes = [],
    clock = 0,
    spawnIn = 1.6,
    crashT = 0;
  const clouds = Array.from({ length: 5 }, (_, i) => ({
    x: i * 160 + Math.random() * 60,
    y: 30 + Math.random() * 110,
    s: 0.6 + Math.random() * 0.6
  }));
  const say = text => {
    $('s2-message').textContent = text;
  };
  const hud = () => {
    $('s2-score').textContent = score;
    $('s2-streak').textContent = streak;
  };
  const speed = () => Math.min(240, 150 + score * 4);
  const gapSize = () => Math.max(112, 150 - score * 1.5);
  function start() {
    state = 'play';
    paused = false;
    y = H / 2;
    vy = FLAP;
    score = 0;
    streak = 0;
    pipes = [];
    clock = 0;
    spawnIn = 1.6;
    crashT = 0;
    $('s2-overlay').style.display = 'none';
    hud();
    say('Keep a steady rhythm.');
  }
  function flap() {
    if (state === 'ready' || state === 'over') {
      start();
      return;
    }
    if (paused) {
      paused = false;
      say('Back in the air.');
    }
    if (state === 'play') vy = FLAP;
  }
  function crash() {
    state = 'crash';
    crashT = 0;
    const best = Math.max(gameBestV2(BEST_KEY), score);
    saveBest(BEST_KEY, best);
    $('s2-best').textContent = best;
  }
  function showOver() {
    state = 'over';
    const o = $('s2-overlay');
    o.style.display = '';
    o.innerHTML = `<div class="g-title">FLIGHT ENDED</div><div class="g-sub">${score} gate${score === 1 ? '' : 's'}${streak > 2 ? ` · best run of ${streak}` : ''}</div><button class="btn primary" type="button">Fly again</button>`;
    say('Press Space or tap to fly again.');
  }
  function step() {
    if (!paused) {
      clock += STEP;
      clouds.forEach(c => {
        c.x -= (state === 'play' ? 18 : 8) * c.s * STEP;
        if (c.x < -80) {
          c.x = W + 40;
          c.y = 30 + Math.random() * 110;
        }
      });
      if (state === 'ready') y = H / 2 + Math.sin(clock * 3) * 8;
      if (state === 'play' || state === 'crash') {
        vy = Math.min(TERMINAL, vy + GRAVITY * STEP);
        y += vy * STEP;
        if (y > GROUND - R) {
          y = GROUND - R;
          vy = 0;
          if (state === 'play') crash();
        }
        if (y < R) {
          y = R;
          vy = Math.max(0, vy);
        }
      }
      if (state === 'play') {
        const v = speed();
        pipes.forEach(p => {
          p.x -= v * STEP;
        });
        pipes = pipes.filter(p => p.x > -70);
        spawnIn -= STEP;
        if (spawnIn <= 0) {
          const g = gapSize();
          pipes.push({
            x: W + 10,
            w: 62,
            gap: 70 + g / 2 + Math.random() * (GROUND - 140 - g),
            size: g,
            passed: false
          });
          spawnIn = 270 / v;
        }
        for (const p of pipes) {
          if (!p.passed && p.x + p.w < BIRD_X - R) {
            p.passed = true;
            score++;
            streak++;
            hud();
            if (streak % 5 === 0) say(`${streak} in a row!`);
          }
          // A couple of pixels of forgiveness, so a graze isn't a crash.
          const top = p.gap - p.size / 2,
            bottom = p.gap + p.size / 2,
            r = R - 2;
          if (BIRD_X + r > p.x && BIRD_X - r < p.x + p.w && (y - r < top || y + r > bottom)) {
            crash();
            break;
          }
        }
      }
      if (state === 'crash') {
        crashT += STEP;
        if (crashT > 0.7) showOver();
      }
    }
  }
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#8fd3ff');
    sky.addColorStop(1, '#dff3ff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255, 236, 150, .9)';
    ctx.beginPath();
    ctx.arc(W - 90, 70, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    clouds.forEach(c => {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 36 * c.s, 14 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + 22 * c.s, c.y - 8 * c.s, 24 * c.s, 14 * c.s, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    pipes.forEach(p => {
      const top = p.gap - p.size / 2,
        bottom = p.gap + p.size / 2;
      const body = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
      body.addColorStop(0, '#3fa34d');
      body.addColorStop(0.45, '#7fd66b');
      body.addColorStop(1, '#2f7f3a');
      ctx.fillStyle = body;
      ctx.fillRect(p.x, 0, p.w, top);
      ctx.fillRect(p.x, bottom, p.w, GROUND - bottom);
      ctx.fillStyle = '#2f7f3a';
      ctx.fillRect(p.x - 4, top - 16, p.w + 8, 16);
      ctx.fillRect(p.x - 4, bottom, p.w + 8, 16);
    });
    ctx.fillStyle = '#c9b27a';
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = '#7fc96b';
    ctx.fillRect(0, GROUND, W, 6);
    ctx.fillStyle = 'rgba(0,0,0,.08)';
    const off = (clock * (state === 'play' ? speed() : 40)) % 24;
    for (let x = -off; x < W; x += 24) ctx.fillRect(x, GROUND + 12, 12, 4);
    // The bird tips nose-up when it flaps and nose-down as it falls.
    const tilt = Math.max(-0.45, Math.min(1.1, vy / 520));
    ctx.save();
    ctx.translate(BIRD_X, y);
    ctx.rotate(state === 'ready' ? 0 : tilt);
    ctx.fillStyle = state === 'crash' || state === 'over' ? '#ff8a65' : '#ffb020';
    ctx.beginPath();
    ctx.ellipse(0, 0, R + 2, R, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd36b';
    const wing = Math.sin(clock * 22) * 4;
    ctx.beginPath();
    ctx.ellipse(-4, 2 + (state === 'play' ? wing : 0), 7, 4.5, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(6, -4, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1b1b';
    ctx.beginPath();
    ctx.arc(7.5, -4, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff6b3d';
    ctx.beginPath();
    ctx.moveTo(R, 0);
    ctx.lineTo(R + 9, 3);
    ctx.lineTo(R, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (state === 'play') {
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.font = 'bold 34px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,.25)';
      ctx.strokeText(score, W / 2, 52);
      ctx.fillText(score, W / 2, 52);
    }
    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED · flap to carry on', W / 2, H / 2);
    }
  }
  const pause = () => {
    if (state === 'play' && !paused) {
      paused = true;
      say('Paused. Flap to carry on.');
    }
  };
  t.on(document, 'keydown', e => {
    if ($('tab-games')?.hidden || e.target.closest?.('input,textarea,select,button')) return;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      if (!e.repeat) flap();
    } else if (e.code === 'KeyP') {
      e.preventDefault();
      if (paused) flap();
      else pause();
    }
  });
  t.on(canvas, 'pointerdown', e => {
    e.preventDefault();
    flap();
  });
  t.on($('s2-overlay'), 'click', e => {
    if (e.target.closest('button')) start();
  });
  t.on(document, 'visibilitychange', () => {
    if (document.hidden) pause();
  });
  t.on(window, 'blur', pause);
  hud();
  draw();
  t.every(step, 1000 / 60);
  t.every(draw, 0);
}

/* Echo Maze: a first-person CSS room, memory map, and BFS pursuer. */
function echoMazeV2() {
  const tools = gamesToolsV2(),
    BEST_KEY = 'dejavu1.echomaze.bestlevel';
  let size = 9,
    level = 1,
    grid,
    player,
    echo,
    facing = 0,
    steps = 0,
    status = 'ready';
  const DIRS = [
      [-1, 0],
      [0, 1],
      [1, 0],
      [0, -1]
    ],
    cellKey = (r, c) => `${r},${c}`;
  $('game-stats').innerHTML =
    `<div class="game-stat"><div class="g-key">Level</div><div class="g-val" id="e2-level">1</div></div><div class="game-stat"><div class="g-key">Steps</div><div class="g-val" id="e2-steps">0</div></div><div class="game-stat"><div class="g-key">Echo distance</div><div class="g-val" id="e2-echo">—</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="e2-best">${gameBestV2(BEST_KEY) || '—'}</div></div>`;
  $('game-host').innerHTML = gameShellV2(
    'Echo Maze',
    'WASD / arrows move · turn in the 3D room · escape the Echo',
    `<div class="maze-layout"><div><div class="game-stage game-surface maze-v2" id="e2-stage"><div class="maze-camera"><div class="maze-room" id="e2-room"><div class="maze-ceiling"></div><div class="maze-floor"></div><div class="maze-wall3d front" id="e2-front"></div><div class="maze-wall3d left" id="e2-left"></div><div class="maze-wall3d right" id="e2-right"></div><div class="maze-beacon">◆</div></div></div><div class="maze-vignette"></div><div class="game-overlay" id="e2-overlay"><div class="g-title">Echo Maze</div><div class="g-sub">Reach the green beacon. The red Echo uses the shortest route through every opening.</div><button class="btn primary" type="button">Enter maze</button></div></div><div class="maze-controls"><button class="btn" data-maze-action="left">↶ Turn left</button><button class="btn primary" data-maze-action="forward">Move forward</button><button class="btn" data-maze-action="right">Turn right ↷</button></div></div><aside class="maze-side"><div class="maze-map-v2" id="e2-map"></div><div class="maze-legend">● You &nbsp; ◆ Exit &nbsp; ■ Echo</div><button class="btn" id="e2-new" type="button">New maze</button></aside></div>`
  );
  const stage = $('e2-stage'),
    map = $('e2-map'),
    room = $('e2-room');
  gameFullscreenV2($('game-host'), tools);
  function generate() {
    grid = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => ({ walls: [1, 1, 1, 1], seen: false }))
    );
    const visited = new Set();
    function carve(r, c) {
      visited.add(cellKey(r, c));
      [
        [0, 1, 1, 3],
        [1, 0, 2, 0],
        [-1, 0, 0, 2],
        [0, -1, 3, 1]
      ]
        .sort(() => Math.random() - 0.5)
        .forEach(([dr, dc, wall, opposite]) => {
          const nr = r + dr,
            nc = c + dc;
          if (nr < 0 || nr >= size || nc < 0 || nc >= size || visited.has(cellKey(nr, nc))) return;
          grid[r][c].walls[wall] = 0;
          grid[nr][nc].walls[opposite] = 0;
          carve(nr, nc);
        });
    }
    carve(0, 0);
    player = { r: 0, c: 0 };
    echo = { r: size - 1, c: 0 };
    facing = 0;
    steps = 0;
    status = 'ready';
    grid[0][0].seen = true;
    draw();
  }
  function nextEchoStep(from, target) {
    const queue = [from],
      came = new Map([[cellKey(from.r, from.c), null]]);
    while (queue.length) {
      const current = queue.shift();
      if (current.r === target.r && current.c === target.c) break;
      grid[current.r][current.c].walls.forEach((wall, direction) => {
        if (wall) return;
        const nr = current.r + DIRS[direction][0],
          nc = current.c + DIRS[direction][1],
          next = cellKey(nr, nc);
        if (nr >= 0 && nr < size && nc >= 0 && nc < size && !came.has(next)) {
          came.set(next, current);
          queue.push({ r: nr, c: nc });
        }
      });
    }
    let current = target;
    if (!came.has(cellKey(current.r, current.c))) return from;
    while (came.get(cellKey(current.r, current.c))) {
      const parent = came.get(cellKey(current.r, current.c));
      if (parent.r === from.r && parent.c === from.c) return current;
      current = parent;
    }
    return current;
  }
  function draw() {
    const current = grid[player.r][player.c],
      left = (facing + 3) % 4,
      right = (facing + 1) % 4;
    [
      ['e2-front', current.walls[facing]],
      ['e2-left', current.walls[left]],
      ['e2-right', current.walls[right]]
    ].forEach(([id, solid]) => $(id).classList.toggle('open', !solid));
    const distance = Math.abs(player.r - echo.r) + Math.abs(player.c - echo.c);
    room.classList.toggle('danger', status === 'playing' && distance <= 3);
    $('e2-level').textContent = level;
    $('e2-steps').textContent = steps;
    $('e2-echo').textContent = status === 'won' ? 'escaped' : `${distance} rooms`;
    map.innerHTML = '';
    grid.forEach((row, r) =>
      row.forEach((cell, c) => {
        const dot = document.createElement('i');
        dot.className = !cell.seen
          ? 'fog'
          : r === player.r && c === player.c
            ? 'you'
            : r === echo.r && c === echo.c
              ? 'echo'
              : r === size - 1 && c === size - 1
                ? 'goal'
                : '';
        map.appendChild(dot);
      })
    );
    const overlay = $('e2-overlay');
    overlay.style.display = status === 'playing' ? 'none' : 'flex';
    if (status === 'won')
      overlay.innerHTML = `<div class="g-title">Beacon found</div><div class="g-sub">${steps} steps · level ${level} cleared</div><button class="btn primary" type="button">Next level</button>`;
  }
  function begin() {
    if (status === 'ready') {
      status = 'playing';
      draw();
    }
  }
  function move(direction) {
    if (status === 'won') {
      level = Math.min(12, level + 1);
      size = Math.min(12, 8 + level);
      generate();
      begin();
      return;
    }
    begin();
    if (direction === 'left') {
      facing = (facing + 3) % 4;
      draw();
      return;
    }
    if (direction === 'right') {
      facing = (facing + 1) % 4;
      draw();
      return;
    }
    const cell = grid[player.r][player.c];
    if (cell.walls[facing]) {
      gameToastV2(stage, 'A wall blocks the way', 'maze-toast');
      return;
    }
    player.r += DIRS[facing][0];
    player.c += DIRS[facing][1];
    grid[player.r][player.c].seen = true;
    steps++;
    echo = nextEchoStep(echo, player);
    if (echo.r === player.r && echo.c === player.c) {
      gameToastV2(stage, 'The Echo caught you, back to the entrance', 'maze-toast');
      player = { r: 0, c: 0 };
      echo = { r: size - 1, c: 0 };
    }
    if (player.r === size - 1 && player.c === size - 1) {
      status = 'won';
      const best = Math.max(gameBestV2(BEST_KEY), level);
      saveBest(BEST_KEY, best);
      $('e2-best').textContent = best;
    }
    draw();
  }
  const onKey = event => {
    const direction = {
      ArrowUp: 'forward',
      ArrowDown: 'back',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      w: 'forward',
      s: 'back',
      a: 'left',
      d: 'right'
    }[event.key];
    if (!direction) return;
    event.preventDefault();
    if (direction === 'back') {
      facing = (facing + 2) % 4;
      move('forward');
    } else move(direction);
  };
  tools.on(document, 'keydown', onKey);
  tools.on(stage, 'pointerdown', event => {
    if (event.target.closest('.game-overlay')) move('forward');
  });
  document
    .querySelectorAll('[data-maze-action]')
    .forEach(button => tools.on(button, 'click', () => move(button.dataset.mazeAction)));
  tools.on($('e2-new'), 'click', generate);
  generate();
}

/* Block World: a genuinely large chunk-loaded voxel valley. */
function blockWorldV2() {
  const tools = gamesToolsV2(),
    BEST_KEY = 'dejavu1.beacon.best',
    WORLD_W = 120,
    WORLD_H = 84,
    CHUNK = 8,
    VIEW_W = 31,
    VIEW_H = 21;
  let x = 60,
    y = 42,
    facing = { x: 0, y: -1 },
    wood = 0,
    stone = 0,
    ore = 0,
    gatheredWood = 0,
    gatheredOre = 0,
    builtCount = 0,
    selected = 'wood',
    status = 'ready',
    frame = 0,
    keys = {},
    resources = new Map(),
    removed = new Set(),
    built = new Map(),
    loadedChunks = new Set(),
    critters = [];
  const key = (a, b) => `${a},${b}`;
  const hash = (a, b) => {
    const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  $('game-stats').innerHTML =
    `<div class="game-stat"><div class="g-key">Valley</div><div class="g-val">120 × 84</div></div><div class="game-stat"><div class="g-key">Wood</div><div class="g-val" id="w2-wood">0</div></div><div class="game-stat"><div class="g-key">Ore</div><div class="g-val" id="w2-ore">0</div></div><div class="game-stat"><div class="g-key">Best day</div><div class="g-val accent" id="w2-best">${gameBestV2(BEST_KEY) || '—'}</div></div>`;
  $('game-host').innerHTML = gameShellV2(
    'Block World',
    '120 × 84 valley · WASD / arrows · Space mine · E build',
    `<div class="world-layout"><div class="game-stage game-surface block-world-v2" id="w2-stage"><div class="world-grid" id="w2-grid"></div><div class="world-player">◆</div><div class="world-crosshair">+</div><div class="world-hud" id="w2-hud">Day 1 · Morning · Grassland</div><div class="game-overlay" id="w2-overlay"><div class="g-title">Block World</div><div class="g-sub">A real valley to wander: streamed chunks, persistent resources, buildable shelters, and wildlife that reacts when you get close.</div><button class="btn primary" type="button">Enter the valley</button></div></div><aside class="world-panel"><div class="world-card"><b>Inventory</b><span>🪵 <em id="w2-wood">0</em> wood</span><span>◆ <em id="w2-ore">0</em> ore</span><span>▣ <em id="w2-stone">0</em> stone</span></div><div class="world-card"><b>Daily quest</b><span id="w2-quest">Gather 3 wood · 3 ore · build 3 blocks</span><div class="quest-bar"><i id="w2-quest-fill"></i></div></div><div class="world-actions"><button class="btn" id="w2-mine" type="button">⛏ Mine ahead</button><button class="btn primary" id="w2-build" type="button">▣ Build <span id="w2-selected">wood</span></button></div><div class="world-hotbar"><button class="selected" data-material="wood">🪵 wood</button><button data-material="stone">▣ stone</button><button data-material="torch">✦ torch</button></div><div class="touch-pad"><button data-world-move="up">▲</button><button data-world-move="left">◀</button><button data-world-move="down">▼</button><button data-world-move="right">▶</button></div><p class="world-help">WASD / arrows move · Space mine · E build · Q torch</p></aside></div>`
  );
  const stage = $('w2-stage'),
    gridHost = $('w2-grid');
  gameFullscreenV2($('game-host'), tools);
  function terrain(wx, wy) {
    const wave = Math.sin(wx * 0.15) + Math.cos(wy * 0.12) + Math.sin((wx + wy) * 0.07);
    if (wave < -1.35) return 'water';
    if (wave < -0.65) return 'sand';
    if (wave > 1.45) return 'stone';
    if (hash(wx, wy) > 0.73) return 'forest';
    return 'grass';
  }
  function nodeAt(wx, wy) {
    const nodeKey = key(wx, wy);
    if (removed.has(nodeKey) || built.has(nodeKey)) return null;
    if (!resources.has(nodeKey)) {
      let kind = null;
      if (
        (wx === 59 && wy === 42) ||
        (wx === 61 && wy === 42) ||
        (terrain(wx, wy) === 'forest' && hash(wx + 9, wy - 3) < 0.23)
      )
        kind = 'wood';
      else if ((wx === 60 && wy === 41) || (terrain(wx, wy) === 'stone' && hash(wx - 5, wy + 8) < 0.28)) kind = 'ore';
      else if ((wx === 60 && wy === 43) || (terrain(wx, wy) === 'stone' && hash(wx + 4, wy + 4) < 0.2)) kind = 'stone';
      resources.set(nodeKey, kind);
    }
    return resources.get(nodeKey);
  }
  function ensureChunks() {
    const cx = Math.floor(x / CHUNK),
      cy = Math.floor(y / CHUNK);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) loadedChunks.add(key(cx + dx, cy + dy));
  }
  function draw() {
    ensureChunks();
    const centerX = Math.floor(x),
      centerY = Math.floor(y),
      minX = Math.max(0, Math.min(WORLD_W - VIEW_W, centerX - 15)),
      minY = Math.max(0, Math.min(WORLD_H - VIEW_H, centerY - 10));
    gridHost.innerHTML = '';
    for (let wy = minY; wy < minY + VIEW_H; wy++)
      for (let wx = minX; wx < minX + VIEW_W; wx++) {
        const cell = document.createElement('i'),
          pos = { left: ((wx - minX) / VIEW_W) * 100, top: ((wy - minY) / VIEW_H) * 100 };
        cell.className = `world-cell ${terrain(wx, wy)}${built.has(key(wx, wy)) ? ` built ${built.get(key(wx, wy))}` : ''}`;
        cell.style.left = `${pos.left}%`;
        cell.style.top = `${pos.top}%`;
        gridHost.appendChild(cell);
        const node = nodeAt(wx, wy);
        if (node) {
          const resource = document.createElement('i');
          resource.className = `world-resource ${node}`;
          resource.style.left = `${pos.left + 1}%`;
          resource.style.top = `${pos.top + 1}%`;
          gridHost.appendChild(resource);
        }
      }
    critters.forEach(critter => {
      if (critter.x < minX - 1 || critter.x > minX + VIEW_W || critter.y < minY - 1 || critter.y > minY + VIEW_H)
        return;
      const creature = document.createElement('i');
      creature.className = 'world-critter';
      creature.style.left = `${((critter.x - minX) / VIEW_W) * 100 + 1}%`;
      creature.style.top = `${((critter.y - minY) / VIEW_H) * 100 + 1}%`;
      gridHost.appendChild(creature);
    });
    const day = Math.max(1, Math.floor(frame / 720) + 1),
      evening = frame % 720 >= 360,
      quest = Math.min(1, (Math.min(gatheredWood, 3) + Math.min(gatheredOre, 3) + Math.min(builtCount, 3)) / 9);
    $('w2-wood').textContent = wood;
    $('w2-ore').textContent = ore;
    $('w2-stone').textContent = stone;
    $('w2-selected').textContent = selected;
    $('w2-quest-fill').style.width = `${quest * 100}%`;
    $('w2-quest').textContent =
      quest >= 1
        ? 'Quest complete · build a landmark next'
        : `Gather ${Math.max(0, 3 - gatheredWood)} wood · ${Math.max(0, 3 - gatheredOre)} ore · build ${Math.max(0, 3 - builtCount)} blocks`;
    $('w2-hud').textContent =
      `Day ${day} · ${evening ? 'Evening' : 'Morning'} · ${terrain(centerX, centerY)} · chunks ${loadedChunks.size}`;
    stage.classList.toggle('night', evening);
    if (quest >= 1) {
      const best = Math.max(gameBestV2(BEST_KEY), day);
      saveBest(BEST_KEY, best);
      $('w2-best').textContent = best;
    }
  }
  function target() {
    return {
      x: Math.max(0, Math.min(WORLD_W - 1, Math.round(x + facing.x))),
      y: Math.max(0, Math.min(WORLD_H - 1, Math.round(y + facing.y)))
    };
  }
  function mine() {
    if (status !== 'playing') return;
    const spot = target(),
      nodeKey = key(spot.x, spot.y);
    if (built.has(nodeKey)) {
      const kind = built.get(nodeKey);
      built.delete(nodeKey);
      if (kind === 'wood') wood++;
      else if (kind === 'stone') stone++;
      else ore++;
      gameToastV2(stage, `Removed ${kind} block`);
      draw();
      return;
    }
    const kind = nodeAt(spot.x, spot.y);
    if (!kind) {
      gameToastV2(stage, 'Face a glowing tree, vein, or stone');
      return;
    }
    removed.add(nodeKey);
    resources.set(nodeKey, null);
    if (kind === 'wood') {
      wood++;
      gatheredWood++;
    } else if (kind === 'ore') {
      ore++;
      gatheredOre++;
    } else stone++;
    gameToastV2(stage, `+1 ${kind}`, 'world-toast');
    draw();
  }
  function build() {
    if (status !== 'playing') return;
    const spot = target(),
      nodeKey = key(spot.x, spot.y);
    if (terrain(spot.x, spot.y) === 'water' || built.has(nodeKey) || nodeAt(spot.x, spot.y)) {
      gameToastV2(stage, 'That block is occupied');
      return;
    }
    const cost = selected === 'wood' ? wood : selected === 'stone' ? stone : ore;
    if (cost < 1) {
      gameToastV2(stage, `Need ${selected} to build`);
      return;
    }
    if (selected === 'wood') wood--;
    else if (selected === 'stone') stone--;
    else ore--;
    built.set(nodeKey, selected);
    builtCount++;
    gameToastV2(stage, `${selected} block placed`, 'world-toast');
    draw();
  }
  function start() {
    if (status === 'playing') return;
    status = 'playing';
    critters = [
      { x: 55, y: 39, dx: 1, dy: 0, t: 20 },
      { x: 66, y: 45, dx: -1, dy: 0, t: 40 },
      { x: 74, y: 35, dx: 0, dy: 1, t: 70 },
      { x: 42, y: 52, dx: 1, dy: 0, t: 10 }
    ];
    draw();
    tools.every(tick, 45);
  }
  function tick() {
    if (status !== 'playing') return;
    frame++;
    const dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
      dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (dx || dy) {
      const length = Math.hypot(dx, dy);
      facing = { x: Math.round(dx / length), y: Math.round(dy / length) };
      const nx = Math.max(1, Math.min(WORLD_W - 2, x + (dx / length) * 0.22)),
        ny = Math.max(1, Math.min(WORLD_H - 2, y + (dy / length) * 0.22));
      if (terrain(Math.round(nx), Math.round(ny)) !== 'water') {
        x = nx;
        y = ny;
      }
    }
    critters.forEach(critter => {
      if (--critter.t <= 0) {
        critter.dx = randomV2(3) - 1;
        critter.dy = randomV2(3) - 1;
        critter.t = 30 + randomV2(60);
      }
      const awayX = critter.x - x,
        awayY = critter.y - y,
        distance = Math.hypot(awayX, awayY);
      if (distance < 4) {
        critter.x += Math.sign(awayX) * 0.12 || 0.08;
        critter.y += Math.sign(awayY) * 0.12 || 0.08;
      } else {
        critter.x += critter.dx * 0.035;
        critter.y += critter.dy * 0.035;
      }
      critter.x = Math.max(1, Math.min(WORLD_W - 2, critter.x));
      critter.y = Math.max(1, Math.min(WORLD_H - 2, critter.y));
    });
    if (frame % 2 === 0) draw();
  }
  const keyMap = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      KeyW: 'up',
      KeyS: 'down',
      KeyA: 'left',
      KeyD: 'right'
    },
    onKey = event => {
      if (keyMap[event.code]) {
        event.preventDefault();
        keys[keyMap[event.code]] = true;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        mine();
      }
      if (event.code === 'KeyE') {
        event.preventDefault();
        build();
      }
      if (event.code === 'KeyQ') {
        selected = 'torch';
        draw();
      }
    },
    offKey = event => {
      if (keyMap[event.code]) keys[keyMap[event.code]] = false;
    },
    release = () => {
      keys = {};
    };
  tools.on(document, 'keydown', onKey);
  tools.on(document, 'keyup', offKey);
  tools.on(document, 'pointerup', release);
  tools.on(document, 'pointercancel', release);
  tools.on(stage, 'pointerdown', event => {
    if (event.target.closest('.game-overlay')) start();
  });
  tools.on($('w2-mine'), 'click', mine);
  tools.on($('w2-build'), 'click', build);
  document.querySelectorAll('[data-material]').forEach(button =>
    tools.on(button, 'click', () => {
      selected = button.dataset.material;
      document.querySelectorAll('[data-material]').forEach(item => item.classList.toggle('selected', item === button));
      draw();
    })
  );
  document.querySelectorAll('[data-world-move]').forEach(button => {
    const direction = button.dataset.worldMove,
      down = event => {
        event.preventDefault();
        keys[direction] = true;
      },
      up = () => {
        keys[direction] = false;
      };
    tools.on(button, 'pointerdown', down);
    tools.on(button, 'pointerup', up);
    tools.on(button, 'pointercancel', up);
    tools.on(button, 'pointerleave', up);
  });
  draw();
}

/* Block Stacker: swing, clip, lean, and three chances to recover. */
function blockStackerV2() {
  const tools = gamesToolsV2(),
    BEST_KEY = 'dejavu1.stacker.best',
    W = 360;
  let blocks = [],
    moving = null,
    height = 0,
    combo = 0,
    misses = 0,
    status = 'ready',
    timer = null;
  $('game-stats').innerHTML =
    `<div class="game-stat"><div class="g-key">Height</div><div class="g-val" id="t2-height">0</div></div><div class="game-stat"><div class="g-key">Combo</div><div class="g-val" id="t2-combo">0</div></div><div class="game-stat"><div class="g-key">Misses</div><div class="g-val" id="t2-misses">0 / 3</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="t2-best">${gameBestV2(BEST_KEY) || '—'}</div></div>`;
  $('game-host').innerHTML = gameShellV2(
    'Block Stacker',
    'Click, tap, or press Space · perfect alignment builds the tower',
    `<div class="game-stage game-surface stack-v2" id="t2-stage"><div class="stack-skyline"></div><div class="stack-crane" id="t2-crane"></div><div class="stack-tower" id="t2-tower"></div><div class="game-overlay" id="t2-overlay"><div class="g-title">Block Stacker</div><div class="g-sub">The crane swings. Drop three clean floors to steady your tower.</div><button class="btn primary" type="button">Start stacking</button></div></div>`
  );
  const stage = $('t2-stage'),
    tower = $('t2-tower');
  gameFullscreenV2($('game-host'), tools);
  const colors = ['#ff9c66', '#7fb2ff', '#5cc16f', '#e0475f', '#f2c14e'];
  function spawn() {
    moving = { x: 0, w: blocks.length ? blocks[blocks.length - 1].w : 108, dir: 1 };
  }
  function draw() {
    tower.innerHTML = '';
    blocks.slice(-15).forEach((block, index) => {
      const el = document.createElement('i');
      el.className = block.perfect ? 'perfect' : '';
      el.style.left = `${(block.x / W) * 100}%`;
      el.style.width = `${(block.w / W) * 100}%`;
      el.style.bottom = `${index * 27}px`;
      el.style.background = block.color;
      tower.appendChild(el);
    });
    if (moving && status === 'playing') {
      const el = document.createElement('i');
      el.className = 'stack-moving';
      el.style.left = `${(moving.x / W) * 100}%`;
      el.style.width = `${(moving.w / W) * 100}%`;
      el.style.bottom = `${Math.min(height, 14) * 27}px`;
      el.style.background = colors[height % colors.length];
      tower.appendChild(el);
      $('t2-crane').style.left = `${((moving.x + moving.w / 2) / W) * 100}%`;
    }
    $('t2-height').textContent = height;
    $('t2-combo').textContent = combo;
    $('t2-misses').textContent = `${misses} / 3`;
    $('t2-overlay').style.display = status === 'playing' ? 'none' : 'flex';
    if (status === 'dead')
      $('t2-overlay').innerHTML =
        `<div class="g-title">Tower tilted</div><div class="g-sub">Height ${height} · combo ${combo} · ${misses} misses</div><button class="btn primary" type="button">Try again</button>`;
  }
  function start() {
    if (timer) clearInterval(timer);
    blocks = [];
    moving = null;
    height = 0;
    combo = 0;
    misses = 0;
    status = 'playing';
    spawn();
    timer = tools.every(tick, 20);
    draw();
  }
  function tick() {
    if (status !== 'playing' || !moving) return;
    moving.x += moving.dir * (4.2 + height * 0.28);
    if (moving.x <= 0 || moving.x + moving.w >= W) moving.dir *= -1;
    draw();
  }
  function drop() {
    if (status !== 'playing') {
      start();
      return;
    }
    const previous = blocks[blocks.length - 1];
    if (!previous) blocks.push({ x: moving.x, w: moving.w, color: colors[0], perfect: true });
    else {
      const overlap = Math.min(previous.x + previous.w, moving.x + moving.w) - Math.max(previous.x, moving.x);
      if (overlap < 8) {
        misses++;
        combo = 0;
        if (misses >= 3) {
          status = 'dead';
          clearInterval(timer);
          timer = null;
          const best = Math.max(gameBestV2(BEST_KEY), height);
          saveBest(BEST_KEY, best);
          $('t2-best').textContent = best;
        } else {
          gameToastV2(stage, `${3 - misses} chances left`);
          spawn();
        }
        draw();
        return;
      }
      const perfect = overlap >= moving.w - 9;
      combo = perfect ? combo + 1 : 0;
      blocks.push({
        x: perfect ? previous.x : Math.max(previous.x, moving.x),
        w: perfect ? moving.w : overlap,
        color: colors[height % colors.length],
        perfect
      });
      if (perfect) gameToastV2(stage, combo > 1 ? `Perfect ×${combo}` : 'Perfect!', 'stack-toast');
    }
    height++;
    spawn();
    draw();
  }
  const action = event => {
    if (event.type === 'keydown' && event.code !== 'Space') return;
    event.preventDefault();
    drop();
  };
  tools.on(stage, 'pointerdown', action);
  tools.on(document, 'keydown', action);
  draw();
}

/* Merge Puzzle: faithful 2048 rules, touch swipe, hint, and undo. */
function mergePuzzleV2() {
  const tools = gamesToolsV2(),
    BEST_KEY = 'dejavu1.merge.best',
    N = 4;
  let grid = [],
    score = 0,
    undo = null,
    over = false,
    won = false;
  const empty = () => Array.from({ length: N }, () => Array(N).fill(0));
  $('game-stats').innerHTML =
    `<div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="q2-score">0</div></div><div class="game-stat"><div class="g-key">Largest</div><div class="g-val" id="q2-max">2</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="q2-best">${gameBestV2(BEST_KEY) || '—'}</div></div>`;
  $('game-host').innerHTML = gameShellV2(
    'Merge Puzzle',
    'Swipe or use arrows · keep your largest tile in a corner',
    `<div class="merge-v2"><div class="merge-board" id="q2-board"></div><div class="merge-controls"><button class="btn" data-merge-direction="up">↑</button><button class="btn" data-merge-direction="left">←</button><button class="btn" data-merge-direction="down">↓</button><button class="btn" data-merge-direction="right">→</button></div><div class="merge-tools"><button class="btn" id="q2-undo" type="button">↩ Undo</button><button class="btn" id="q2-hint" type="button">💡 Hint</button><button class="btn primary" id="q2-new" type="button">New run</button></div><div class="merge-message" id="q2-message"></div></div>`
  );
  const board = $('q2-board');
  gameFullscreenV2($('game-host'), tools);
  function addTile() {
    const spaces = [];
    grid.forEach((row, r) =>
      row.forEach((value, c) => {
        if (!value) spaces.push([r, c]);
      })
    );
    if (spaces.length) {
      const [r, c] = spaces[randomV2(spaces.length)];
      grid[r][c] = Math.random() < 0.9 ? 2 : 4;
    }
  }
  function collapse(values) {
    const compact = values.filter(Boolean),
      result = [],
      gained = [];
    for (let i = 0; i < compact.length; i++) {
      if (compact[i] === compact[i + 1]) {
        result.push(compact[i] * 2);
        gained.push(compact[i] * 2);
        i++;
      } else result.push(compact[i]);
    }
    while (result.length < N) result.push(0);
    return { result, gained };
  }
  function simulate(direction) {
    const next = empty(),
      gains = [];
    for (let index = 0; index < N; index++) {
      const values = [];
      for (let step = 0; step < N; step++) {
        const r = direction === 'up' ? step : direction === 'down' ? N - 1 - step : index;
        const c = direction === 'left' ? step : direction === 'right' ? N - 1 - step : index;
        values.push(grid[r][c]);
      }
      const line = collapse(values);
      gains.push(...line.gained);
      line.result.forEach((value, step) => {
        const r = direction === 'up' ? step : direction === 'down' ? N - 1 - step : index;
        const c = direction === 'left' ? step : direction === 'right' ? N - 1 - step : index;
        next[r][c] = value;
      });
    }
    return { next, gained: gains.reduce((a, b) => a + b, 0), changed: JSON.stringify(next) !== JSON.stringify(grid) };
  }
  function hasMoves() {
    return grid.some((row, r) => row.some((value, c) => !value || grid[r + 1]?.[c] === value || row[c + 1] === value));
  }
  function evaluate(candidate) {
    let spaces = 0,
      smooth = 0,
      max = 0;
    candidate.forEach((row, r) =>
      row.forEach((value, c) => {
        if (!value) spaces++;
        max = Math.max(max, value);
        if (value && candidate[r]?.[c + 1]) smooth -= Math.abs(Math.log2(value) - Math.log2(candidate[r][c + 1]));
        if (value && candidate[r + 1]?.[c]) smooth -= Math.abs(Math.log2(value) - Math.log2(candidate[r + 1][c]));
      })
    );
    const corners = [candidate[0][0], candidate[0][3], candidate[3][0], candidate[3][3]];
    return spaces * 8 + smooth * 2 + (corners.includes(max) ? max * 0.5 : 0);
  }
  function move(direction) {
    if (over) return;
    const result = simulate(direction);
    if (!result.changed) return;
    undo = { grid: grid.map(row => row.slice()), score };
    grid = result.next;
    score += result.gained;
    addTile();
    saveBest(BEST_KEY, Math.max(gameBestV2(BEST_KEY), score));
    if (grid.some(row => row.includes(2048))) won = true;
    over = !hasMoves();
    draw();
  }
  function draw() {
    board.innerHTML = '';
    grid.forEach(row =>
      row.forEach(value => {
        const tile = document.createElement('i');
        tile.className = value ? `tile t${Math.min(15, Math.log2(value))}` : '';
        tile.textContent = value || '';
        board.appendChild(tile);
      })
    );
    $('q2-score').textContent = score;
    $('q2-max').textContent = Math.max(...grid.flat());
    $('q2-best').textContent = gameBestV2(BEST_KEY) || '—';
    $('q2-undo').disabled = !undo;
    const message = $('q2-message');
    message.textContent = over
      ? `No more moves · score ${score}`
      : won
        ? '2048 reached. Keep going for a bigger tile.'
        : '';
    message.classList.toggle('is-win', won);
  }
  function newGame() {
    grid = empty();
    score = 0;
    undo = null;
    over = false;
    won = false;
    addTile();
    addTile();
    draw();
  }
  const onKey = event => {
    const direction = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[event.key];
    if (direction) {
      event.preventDefault();
      move(direction);
    }
  };
  tools.on(document, 'keydown', onKey);
  document
    .querySelectorAll('[data-merge-direction]')
    .forEach(button => tools.on(button, 'click', () => move(button.dataset.mergeDirection)));
  tools.on($('q2-undo'), 'click', () => {
    if (undo && !over) {
      grid = undo.grid;
      score = undo.score;
      undo = null;
      draw();
    }
  });
  tools.on($('q2-new'), 'click', newGame);
  tools.on($('q2-hint'), 'click', () => {
    const directions = ['up', 'left', 'down', 'right'];
    const best = directions
      .map(direction => ({ direction, result: simulate(direction) }))
      .filter(item => item.result.changed)
      .sort((a, b) => evaluate(b.result.next) - evaluate(a.result.next))[0];
    if (!best) return;
    board.classList.remove('hint');
    void board.offsetWidth;
    board.classList.add('hint');
    gameToastV2(board, `Try ${best.direction}`, 'merge-toast');
  });
  let startX = 0,
    startY = 0;
  tools.on(board, 'pointerdown', event => {
    startX = event.clientX;
    startY = event.clientY;
  });
  tools.on(board, 'pointerup', event => {
    const dx = event.clientX - startX,
      dy = event.clientY - startY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= 24)
      move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  });
  newGame();
}

/* Brick Break: paddle physics, lives, armored bricks, and capsules. */
function brickBreakV2() {
  const tools = gamesToolsV2(),
    BEST_KEY = 'dejavu1.breakout.best',
    W = 520,
    H = 380,
    COLS = 10;
  let paddleX = W / 2,
    paddleWidth = 94,
    balls = [],
    bricks = [],
    capsules = [],
    lives = 3,
    score = 0,
    level = 1,
    status = 'ready',
    timer = null,
    wideTicks = 0;
  const powerups = [
    { kind: 'wide', label: 'W', color: '#34c759' },
    { kind: 'multi', label: 'M', color: '#7fb2ff' },
    { kind: 'slow', label: 'S', color: '#e0475f' }
  ];
  $('game-stats').innerHTML =
    `<div class="game-stat"><div class="g-key">Level</div><div class="g-val" id="b2-level">1</div></div><div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="b2-score">0</div></div><div class="game-stat"><div class="g-key">Lives</div><div class="g-val" id="b2-lives">3</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="b2-best">${gameBestV2(BEST_KEY) || '—'}</div></div>`;
  $('game-host').innerHTML = gameShellV2(
    'Brick Break',
    'Drag the paddle · catch capsules · armored bricks take two hits',
    `<div class="game-stage game-surface brick-v2" id="b2-stage"><div class="brick-paddle" id="b2-paddle"></div><div class="game-overlay" id="b2-overlay"><div class="g-title">Brick Break</div><div class="g-sub">Keep the ball alive, use the walls, and clear the pattern.</div><button class="btn primary" type="button">Launch ball</button></div></div>`
  );
  const stage = $('b2-stage');
  gameFullscreenV2($('game-host'), tools);
  function setupLevel() {
    bricks = [];
    const rows = Math.min(4 + level, 8);
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < COLS; col++)
        bricks.push({
          x: (col * W) / COLS + 3,
          y: 24 + row * 22,
          w: W / COLS - 6,
          h: 17,
          hp: (row + level) % 4 === 0 ? 2 : 1
        });
    const speed = 4.4 + level * 0.2;
    balls = [{ x: W / 2, y: H - 52, vx: speed * 0.7, vy: -speed }];
    capsules = [];
    wideTicks = 0;
  }
  function effectiveWidth() {
    return wideTicks > 0 ? Math.min(paddleWidth * 1.5, 180) : paddleWidth;
  }
  function draw() {
    stage.querySelectorAll('.brick,.brick-ball,.brick-capsule').forEach(el => el.remove());
    bricks.forEach(brick => {
      if (!brick.hp) return;
      const el = document.createElement('i');
      el.className = `brick ${brick.hp > 1 ? 'armored' : ''}`;
      el.style.left = `${(brick.x / W) * 100}%`;
      el.style.top = `${(brick.y / H) * 100}%`;
      el.style.width = `${(brick.w / W) * 100}%`;
      el.style.height = `${(brick.h / H) * 100}%`;
      stage.appendChild(el);
    });
    balls.forEach(ball => {
      const el = document.createElement('i');
      el.className = 'brick-ball';
      el.style.left = `${(ball.x / W) * 100}%`;
      el.style.top = `${(ball.y / H) * 100}%`;
      stage.appendChild(el);
    });
    capsules.forEach(capsule => {
      const el = document.createElement('i');
      el.className = 'brick-capsule';
      el.textContent = capsule.label;
      el.style.left = `${(capsule.x / W) * 100}%`;
      el.style.top = `${(capsule.y / H) * 100}%`;
      el.style.background = capsule.color;
      stage.appendChild(el);
    });
    const width = effectiveWidth();
    $('b2-paddle').style.left = `${((paddleX - width / 2) / W) * 100}%`;
    $('b2-paddle').style.width = `${(width / W) * 100}%`;
    $('b2-paddle').classList.toggle('wide', wideTicks > 0);
    $('b2-level').textContent = level;
    $('b2-score').textContent = score;
    $('b2-lives').textContent = lives;
    $('b2-overlay').style.display = status === 'playing' ? 'none' : 'flex';
    if (status === 'dead')
      $('b2-overlay').innerHTML =
        `<div class="g-title">Wall rebuilt</div><div class="g-sub">Level ${level} · score ${score}</div><button class="btn primary" type="button">Launch again</button>`;
  }
  function steer(event) {
    const rect = stage.getBoundingClientRect(),
      width = effectiveWidth();
    paddleX = Math.max(width / 2, Math.min(W - width / 2, ((event.clientX - rect.left) / rect.width) * W));
    draw();
  }
  function applyPower(kind) {
    if (kind === 'wide') wideTicks = 500;
    if (kind === 'multi' && balls.length && balls.length < 3) {
      const source = balls[0];
      balls.push({ x: source.x, y: source.y, vx: -source.vx, vy: source.vy });
    }
    if (kind === 'slow')
      balls.forEach(ball => {
        ball.vx *= 0.65;
        ball.vy *= 0.65;
      });
    const power = powerups.find(item => item.kind === kind);
    if (power) gameToastV2(stage, `${power.label} power-up`, 'break-toast');
  }
  function tick() {
    if (status !== 'playing') return;
    if (wideTicks > 0) wideTicks--;
    const width = effectiveWidth(),
      paddleY = H - 25;
    for (let index = balls.length - 1; index >= 0; index--) {
      const ball = balls[index];
      ball.x += ball.vx;
      ball.y += ball.vy;
      if (ball.x < 6 || ball.x > W - 6) {
        ball.x = Math.max(6, Math.min(W - 6, ball.x));
        ball.vx *= -1;
      }
      if (ball.y < 6) {
        ball.y = 6;
        ball.vy *= -1;
      }
      if (
        ball.vy > 0 &&
        ball.y > paddleY - 8 &&
        ball.y < paddleY + 10 &&
        ball.x > paddleX - width / 2 &&
        ball.x < paddleX + width / 2
      ) {
        const offset = (ball.x - paddleX) / (width / 2);
        const speed = Math.hypot(ball.vx, ball.vy);
        ball.vx = offset * speed * 0.9;
        ball.vy = -Math.max(3.4, speed * 0.85);
      }
      let struck = false;
      for (const brick of bricks) {
        if (
          struck ||
          !brick.hp ||
          ball.x + 6 < brick.x ||
          ball.x - 6 > brick.x + brick.w ||
          ball.y + 6 < brick.y ||
          ball.y - 6 > brick.y + brick.h
        )
          continue;
        brick.hp--;
        ball.vy *= -1;
        score += brick.hp ? 5 : 10;
        struck = true;
        if (!brick.hp && Math.random() < 0.2) {
          const power = powerups[randomV2(powerups.length)];
          capsules.push({
            x: brick.x + brick.w / 2,
            y: brick.y,
            label: power.label,
            color: power.color,
            kind: power.kind
          });
        }
      }
      if (ball.y > H + 12) balls.splice(index, 1);
    }
    for (let index = capsules.length - 1; index >= 0; index--) {
      const capsule = capsules[index];
      capsule.y += 2.1;
      if (capsule.y > H - 42 && capsule.y < H - 12 && Math.abs(capsule.x - paddleX) < width / 2 + 10) {
        applyPower(capsule.kind);
        capsules.splice(index, 1);
      } else if (capsule.y > H + 20) capsules.splice(index, 1);
    }
    if (!balls.length) {
      lives--;
      if (lives > 0) {
        const speed = 4.4 + level * 0.2;
        balls = [{ x: paddleX, y: H - 52, vx: speed * 0.7, vy: -speed }];
        gameToastV2(stage, `${lives} lives left`);
      } else {
        status = 'dead';
        clearInterval(timer);
        timer = null;
        const best = Math.max(gameBestV2(BEST_KEY), level);
        saveBest(BEST_KEY, best);
        $('b2-best').textContent = best;
      }
    } else if (bricks.every(brick => !brick.hp)) {
      level++;
      const best = Math.max(gameBestV2(BEST_KEY), level);
      saveBest(BEST_KEY, best);
      $('b2-best').textContent = best;
      setupLevel();
      gameToastV2(stage, `Level ${level}`, 'break-toast');
    }
    draw();
  }
  function start() {
    if (timer) clearInterval(timer);
    status = 'playing';
    lives = 3;
    score = 0;
    level = 1;
    setupLevel();
    timer = tools.every(tick, 16);
    draw();
  }
  tools.on(stage, 'pointermove', steer);
  tools.on(stage, 'pointerdown', event => {
    event.preventDefault();
    if (status !== 'playing') start();
    steer(event);
  });
  draw();
}

/* ---- the moving specular highlight -------------------------------------*/
let gameLoopHandle = null;

function stopCurrentGame() {
  if (gameLoopHandle) {
    clearInterval(gameLoopHandle);
    gameLoopHandle = null;
  }
  document.removeEventListener('keydown', mergeKeyHandler);
  document.removeEventListener('keydown', beaconKeyDownHandler);
  document.removeEventListener('keyup', beaconKeyUpHandler);
  document.removeEventListener('pointerup', beaconPointerUpHandler);
  document.removeEventListener('pointercancel', beaconPointerUpHandler);
  activeGame = null;
}

function readBest(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? parseInt(v, 10) : null;
  } catch (e) {
    return null;
  }
}
function saveBest(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (e) {
    /* ignore */
  }
}

function startCurrentGame() {
  const active = document.querySelector('#game-picker button.active');
  renderGame(active ? active.dataset.game : 'skydash');
}

function initGames() {
  document.querySelectorAll('#game-picker button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#game-picker button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderGame(btn.dataset.game);
    });
  });
}

function renderGame(name) {
  stopCurrentGame();
  activeGame = name;
  const games = {
    skydash: initSkyDash,
    echomaze: initEchoMaze,
    beacon: initBeacon,
    stacker: initStacker,
    merge: initMerge,
    breakout: initBreakout
  };
  (games[name] || initSkyDash)();
}