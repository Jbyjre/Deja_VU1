/* Deja Vu1 arcade, part 3 of 7: the arcade Pac-Man and Breakout and the canvas fitting.
 * Loaded right after games-classic.js by app.js loadGames(); the parts share one global scope.
 */
/* Moved here from games.js when the arcade was split: these two aliases need the functions defined in this part.
 * Arcade Plus: authoritative offline arcade runtime. Installed after legacy declarations
 * Compatibility aliases keep the delayed picker installer safe while the legacy
 * declarations remain below this offline-only block.
 */
const newPacmanPlus = newPacmanArcade;
const newDoodleBreak = newBreakoutDeep;
function newPacmanArcade() {
  /* A maze chase played at a fixed 60 steps a second (frameEvery keeps
     the steps in time with the screen), so Pac-Man glides between tiles
     instead of jumping. The ghosts start inside their house and come out
     one at a time, and every life starts with a two-second READY, so a
     round can't be lost before you've had a chance to move.

     Maze key: # wall · . dot · o power pellet · space open floor ·
     X outside the maze · - ghost-house door · G inside the ghost house.
     Row 9 is the tunnel: leave one side and you come out of the other. */
  const t = plusTools(),
    key = 'dejavu1.pacman.v3.best',
    host = $('game-host');
  const MAP = [
    '###################',
    '#........#........#',
    '#o##.###.#.###.##o#',
    '#.................#',
    '#.##.#.#####.#.##.#',
    '#....#...#...#....#',
    '####.### # ###.####',
    'XXX#.#       #.#XXX',
    '####.# ##-## #.####',
    '    .  #GGG#  .    ',
    '####.# ##### #.####',
    'XXX#.#       #.#XXX',
    '####.# ##### #.####',
    '#........#........#',
    '#.##.###.#.###.##.#',
    '#o.#.....P.....#.o#',
    '##.#.#.#####.#.#.##',
    '#....#...#...#....#',
    '#.######.#.######.#',
    '#.................#',
    '###################'
  ];
  const COLS = 19,
    ROWS = 21,
    CELL = 24,
    W = COLS * CELL,
    H = ROWS * CELL,
    TUNNEL = 9,
    STEP = 1 / 60;
  const DIRS = { up: [0, -1], left: [-1, 0], down: [0, 1], right: [1, 0] },
    ORDER = ['up', 'left', 'down', 'right'];
  const BACK = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const HOME = { c: 9, r: 7 },
    HOUSE = { c: 9, r: 9 },
    START = { c: 9, r: 15 };
  const GHOSTS = [
    { name: 'Blinky', color: '#ff4b4b', corner: { c: 17, r: -2 }, start: { c: 9, r: 7 }, release: 0 },
    { name: 'Pinky', color: '#ffa6dc', corner: { c: 1, r: -2 }, start: { c: 9, r: 9 }, release: 1.5 },
    { name: 'Inky', color: '#4fe6f0', corner: { c: 18, r: 22 }, start: { c: 8, r: 9 }, release: 5 },
    { name: 'Clyde', color: '#ffb347', corner: { c: 0, r: 22 }, start: { c: 10, r: 9 }, release: 9 }
  ];
  // Scatter, chase, scatter, chase, scatter, then chase for good (seconds).
  const WAVES = [7, 20, 7, 20, 5, Infinity];
  plusStats([
    ['Score', 'pm-score'],
    ['Lives', 'pm-lives'],
    ['Level', 'pm-level'],
    ['Best', 'pm-best', true, gameBestV2(key) || '—']
  ]);
  plusFrame(
    'Pac-Man',
    'Arrow keys or WASD · swipe on a phone · P pauses · eat every dot, and eat ghosts while they are blue',
    `<div class="pac-deep"><div class="arcade-stage"><canvas id="pm-canvas" class="arcade-canvas" aria-label="Pac-Man maze"></canvas>
     <div class="game-overlay" id="pm-overlay"><div class="g-title">PAC-MAN</div><div class="g-sub">Clear every dot. A big flashing pellet turns the ghosts blue for a few seconds: that's when you can eat them.</div><button class="btn primary" type="button">Start</button></div></div>
     <div class="arcade-pad" aria-label="Direction pad"><button class="btn" type="button" data-pm="up" aria-label="Up">▲</button><button class="btn" type="button" data-pm="left" aria-label="Left">◀</button><button class="btn" type="button" data-pm="down" aria-label="Down">▼</button><button class="btn" type="button" data-pm="right" aria-label="Right">▶</button></div>
     <div class="arcade-actions"><button class="btn" type="button" id="pm-pause">Pause</button><span id="pm-message" role="status">Press Start, then steer with the arrow keys.</span></div></div>`,
    t
  );
  const canvas = $('pm-canvas'),
    ctx = canvas.getContext('2d'),
    dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.aspectRatio = `${W} / ${H}`;
  const at = (c, r) => (MAP[r] || '')[c] || 'X';
  const wrap = c => (c + COLS) % COLS;
  const openFor = (who, c, r) => {
    if (r === TUNNEL) c = wrap(c);
    const ch = at(c, r);
    if (ch === '#' || ch === 'X') return false;
    if (ch === '-' || ch === 'G') return who === 'eyes' || who === 'house';
    return true;
  };
  let grid,
    dots,
    pac,
    ghosts,
    score = 0,
    lives = 3,
    level = 1,
    state = 'idle',
    stateTime = 0,
    paused = false,
    fright = 0,
    frightChain = 0,
    waveIndex = 0,
    waveTime = 0,
    clock = 0,
    wanted = 'left',
    pops = [];
  const resetBoard = () => {
    grid = MAP.map(row => row.split('').map(ch => (ch === '.' || ch === 'o' ? ch : null)));
    dots = grid.flat().filter(Boolean).length;
  };
  const resetActors = () => {
    pac = { c: START.c, r: START.r, dir: 'left', p: 0, moving: false, mouth: 0 };
    wanted = 'left';
    ghosts = GHOSTS.map((g, i) => ({
      ...g,
      c: g.start.c,
      r: g.start.r,
      dir: i ? 'up' : 'left',
      p: 0,
      mode: i ? 'house' : 'active',
      bob: i * 0.7
    }));
    fright = 0;
    frightChain = 0;
    waveIndex = 0;
    waveTime = 0;
    clock = 0;
    pops = [];
  };
  const speeds = () => {
    const l = Math.min(level, 8) - 1;
    return {
      pac: 6.2 + l * 0.2,
      pacFright: 6.8 + l * 0.2,
      ghost: 5.4 + l * 0.25,
      tunnel: 3,
      blue: 3.2,
      eyes: 11,
      house: 2.4
    };
  };
  const pos = e => {
    const d = DIRS[e.dir];
    let x = e.c + d[0] * e.p,
      y = e.r + d[1] * e.p;
    if (y === TUNNEL && (x < -0.5 || x > COLS - 0.5)) x = (x + COLS) % COLS;
    return { x, y };
  };
  const message = (text, good = false) => {
    const m = $('pm-message');
    if (m) {
      m.textContent = text;
      m.classList.toggle('good', good);
    }
  };
  let hudKey = '';
  const hud = () => {
    const k = `${score}|${lives}|${level}`;
    if (k === hudKey) return;
    hudKey = k;
    $('pm-score').textContent = score.toLocaleString();
    $('pm-lives').textContent = lives;
    $('pm-level').textContent = level;
  };
  const setState = s => {
    state = s;
    stateTime = 0;
  };
  const chasing = () => waveIndex % 2 === 1;

  /* Move one actor `dist` tiles along its direction. At each tile centre
     `decide` picks the next direction (or null to stop there). */
  function advance(e, dist, who, decide) {
    let guard = 0;
    while (dist > 0 && guard++ < 6) {
      if (!e.moving) {
        const d = decide(e);
        if (!d) return;
        e.dir = d;
        e.moving = true;
      }
      const room = 1 - e.p;
      if (dist < room) {
        e.p += dist;
        return;
      }
      dist -= room;
      e.p = 0;
      e.c += DIRS[e.dir][0];
      e.r += DIRS[e.dir][1];
      if (e.r === TUNNEL) e.c = wrap(e.c);
      arrive(e);
      const d = decide(e);
      if (!d) {
        e.moving = false;
        return;
      }
      e.dir = d;
    }
  }
  function arrive(e) {
    if (e !== pac) return;
    const cell = grid[e.r]?.[e.c];
    if (!cell) return;
    grid[e.r][e.c] = null;
    dots--;
    if (cell === '.') {
      score += 10;
    } else {
      score += 50;
      const s = Math.max(2, 7 - (level - 1));
      fright = s;
      frightChain = 0;
      ghosts.forEach(g => {
        if (g.mode === 'active') {
          g.blue = true;
          g.dir = BACK[g.dir];
          g.p = g.moving ? 1 - g.p : 0;
          if (g.moving) {
            g.c -= DIRS[g.dir][0];
            g.r -= DIRS[g.dir][1];
            if (g.r === TUNNEL) g.c = wrap(g.c);
          }
        }
      });
      message('Ghosts are blue: chase them!', true);
    }
    if (dots <= 0) {
      setState('cleared');
      message(`Level ${level} cleared!`, true);
    }
  }
  const pacDecide = e => {
    if (openFor('pac', e.c + DIRS[wanted][0], e.r + DIRS[wanted][1])) return wanted;
    if (e.moving && openFor('pac', e.c + DIRS[e.dir][0], e.r + DIRS[e.dir][1])) return e.dir;
    return null;
  };
  function target(g) {
    if (g.mode === 'eyes') return HOME;
    if (!chasing()) return g.corner;
    const d = DIRS[pac.dir];
    if (g.name === 'Blinky') return { c: pac.c, r: pac.r };
    if (g.name === 'Pinky') return { c: pac.c + d[0] * 4, r: pac.r + d[1] * 4 };
    if (g.name === 'Inky') {
      const b = ghosts[0],
        mid = { c: pac.c + d[0] * 2, r: pac.r + d[1] * 2 };
      return { c: mid.c * 2 - b.c, r: mid.r * 2 - b.r };
    }
    return Math.hypot(g.c - pac.c, g.r - pac.r) > 8 ? { c: pac.c, r: pac.r } : g.corner;
  }
  const ghostDecide = g => {
    if (g.mode === 'eyes' && g.c === HOME.c && g.r === HOME.r) return null;
    const who = g.mode === 'eyes' ? 'eyes' : 'ghost';
    let options = ORDER.filter(d => d !== BACK[g.dir] && openFor(who, g.c + DIRS[d][0], g.r + DIRS[d][1]));
    // Ghosts don't walk back into the house unless they're only eyes.
    if (who !== 'eyes') options = options.filter(d => at(g.c + DIRS[d][0], g.r + DIRS[d][1]) !== '-');
    if (!options.length)
      return openFor(who, g.c + DIRS[BACK[g.dir]][0], g.r + DIRS[BACK[g.dir]][1]) ? BACK[g.dir] : null;
    if (g.blue) return options[Math.floor(Math.random() * options.length)];
    const goal = target(g);
    return options.reduce(
      (best, d) => {
        const n = Math.hypot(g.c + DIRS[d][0] - goal.c, g.r + DIRS[d][1] - goal.r);
        return n < best.n ? { d, n } : best;
      },
      { d: options[0], n: Infinity }
    ).d;
  };

  /* Leaving or re-entering the house is a scripted walk through the door. */
  function walkTo(g, goal, dist) {
    const x = g.c + DIRS[g.dir][0] * g.p,
      y = g.r + DIRS[g.dir][1] * g.p;
    let nx = x,
      ny = y;
    if (Math.abs(x - goal.c) > 0.01) {
      nx = x + Math.sign(goal.c - x) * Math.min(dist, Math.abs(goal.c - x));
    } else {
      nx = goal.c;
      ny = y + Math.sign(goal.r - y) * Math.min(dist, Math.abs(goal.r - y));
    }
    g.c = Math.round(nx);
    g.r = Math.round(ny);
    const dx = nx - g.c,
      dy = ny - g.r;
    if (Math.abs(dx) > 1e-6) {
      g.dir = dx > 0 ? 'right' : 'left';
      g.p = Math.abs(dx);
    } else if (Math.abs(dy) > 1e-6) {
      g.dir = dy > 0 ? 'down' : 'up';
      g.p = Math.abs(dy);
    } else g.p = 0;
    return Math.abs(nx - goal.c) < 1e-6 && Math.abs(ny - goal.r) < 1e-6;
  }

  function step() {
    if (paused || state === 'idle' || state === 'over') return;
    stateTime += STEP;
    if (state === 'ready') {
      if (stateTime >= 2) {
        setState('play');
        message('Go!');
      }
      return;
    }
    if (state === 'dying') {
      if (stateTime >= 1.5) {
        lives--;
        hud();
        if (lives <= 0) return finish();
        resetActors();
        setState('ready');
        message(`${lives} ${lives === 1 ? 'life' : 'lives'} left. Get ready…`);
      }
      return;
    }
    if (state === 'cleared') {
      if (stateTime >= 1.8) {
        level++;
        resetBoard();
        resetActors();
        hud();
        setState('ready');
        message(`Level ${level}: the ghosts are a little quicker.`);
      }
      return;
    }
    const v = speeds();
    clock += STEP;
    if (fright > 0) {
      fright -= STEP;
      if (fright <= 0) {
        fright = 0;
        ghosts.forEach(g => {
          g.blue = false;
        });
        message('The ghosts are back to normal.');
      }
    } else {
      waveTime += STEP;
      if (waveTime >= WAVES[waveIndex]) {
        waveTime = 0;
        waveIndex = Math.min(WAVES.length - 1, waveIndex + 1);
        ghosts.forEach(g => {
          if (g.mode === 'active' && g.moving) {
            g.dir = BACK[g.dir];
            g.p = 1 - g.p;
            g.c -= DIRS[g.dir][0];
            g.r -= DIRS[g.dir][1];
            if (g.r === TUNNEL) g.c = wrap(g.c);
          }
        });
      }
    }
    // Turning round mid-corridor is always allowed.
    if (pac.moving && wanted === BACK[pac.dir]) {
      pac.c += DIRS[pac.dir][0];
      pac.r += DIRS[pac.dir][1];
      if (pac.r === TUNNEL) pac.c = wrap(pac.c);
      pac.dir = wanted;
      pac.p = 1 - pac.p;
      if (pac.p >= 1) {
        pac.p = 0;
      }
    }
    advance(pac, (fright > 0 ? v.pacFright : v.pac) * STEP, 'pac', pacDecide);
    if (pac.moving) pac.mouth += STEP * 14;
    for (const g of ghosts) {
      if (g.mode === 'house') {
        g.bob += STEP * 5;
        if (clock >= g.release) g.mode = 'leaving';
        continue;
      }
      if (g.mode === 'leaving') {
        const done = walkTo(g, g.c === HOUSE.c || g.r < HOUSE.r ? HOME : { c: HOUSE.c, r: HOUSE.r }, v.house * STEP);
        if (done && g.r === HOME.r) {
          g.mode = 'active';
          g.dir = 'left';
          g.p = 0;
          g.moving = false;
        }
        continue;
      }
      if (g.mode === 'entering') {
        if (walkTo(g, HOUSE, v.eyes * 0.5 * STEP)) {
          g.mode = 'leaving';
          g.blue = false;
        }
        continue;
      }
      const inTunnel = g.r === TUNNEL && (g.c <= 3 || g.c >= 15);
      const speed = g.mode === 'eyes' ? v.eyes : inTunnel ? v.tunnel : g.blue ? v.blue : v.ghost;
      advance(g, speed * STEP, 'ghost', ghostDecide);
      // Eyes that somehow can't find the way home are fetched after 8 s.
      if (g.mode === 'eyes' && (g.eyeTime += STEP) > 8) {
        g.c = HOME.c;
        g.r = HOME.r;
        g.p = 0;
        g.moving = false;
      }
      if (g.mode === 'eyes' && g.c === HOME.c && g.r === HOME.r && !g.moving) {
        g.mode = 'entering';
        g.p = 0;
      }
    }
    if (state !== 'play') return;
    const pp = pos(pac);
    for (const g of ghosts) {
      if (g.mode !== 'active' && g.mode !== 'leaving') continue;
      const gp = pos(g);
      let dx = Math.abs(gp.x - pp.x);
      if (dx > COLS / 2) dx = COLS - dx;
      if (dx + Math.abs(gp.y - pp.y) > 0.7) continue;
      if (g.blue) {
        frightChain++;
        const pts = 200 * 2 ** Math.min(3, frightChain - 1);
        score += pts;
        pops.push({ x: gp.x, y: gp.y, text: String(pts), life: 1 });
        g.blue = false;
        g.mode = 'eyes';
        g.eyeTime = 0;
        message(`${g.name} eaten: +${pts}`, true);
      } else {
        setState('dying');
        message(`${g.name} caught you.`);
        break;
      }
    }
    pops.forEach(p => {
      p.life -= STEP;
      p.y -= STEP * 0.8;
    });
    pops = pops.filter(p => p.life > 0);
    hud();
  }

  function start() {
    if (state === 'idle' || state === 'over') {
      score = 0;
      lives = 3;
      level = 1;
      resetBoard();
      resetActors();
      hud();
    }
    paused = false;
    $('pm-overlay').style.display = 'none';
    $('pm-pause').textContent = 'Pause';
    setState('ready');
    message('Get ready…');
  }
  function finish() {
    setState('over');
    const best = Math.max(gameBestV2(key), score);
    saveBest(key, best);
    $('pm-best').textContent = best.toLocaleString();
    const o = $('pm-overlay');
    o.style.display = '';
    o.innerHTML = `<div class="g-title">GAME OVER</div><div class="g-sub">${score.toLocaleString()} points · reached level ${level}</div><button class="btn primary" type="button">Play again</button>`;
    message('Game over.');
  }
  function pause(on) {
    if (state === 'idle' || state === 'over') return;
    paused = on;
    $('pm-pause').textContent = paused ? 'Resume' : 'Pause';
    message(paused ? 'Paused. Press P or Resume to carry on.' : 'Back in the maze.');
  }

  /* ---- drawing ---- */
  const wall = (c, r) => at(c, r) === '#';
  function drawWalls() {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (!wall(c, r)) continue;
        const x = c * CELL,
          y = r * CELL,
          inset = 5;
        const l = wall(c - 1, r) ? 0 : inset,
          rt = wall(c + 1, r) ? 0 : inset,
          tp = wall(c, r - 1) ? 0 : inset,
          bt = wall(c, r + 1) ? 0 : inset;
        ctx.fillStyle = '#1d2fb8';
        ctx.fillRect(x + l, y + tp, CELL - l - rt, CELL - tp - bt);
      }
    // A brighter edge on every side that faces the corridor.
    ctx.strokeStyle = '#5d7bff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (!wall(c, r)) continue;
        const x = c * CELL,
          y = r * CELL,
          i = 5.5;
        if (!wall(c, r - 1)) {
          ctx.moveTo(x + (wall(c - 1, r) ? 0 : i), y + i);
          ctx.lineTo(x + CELL - (wall(c + 1, r) ? 0 : i), y + i);
        }
        if (!wall(c, r + 1)) {
          ctx.moveTo(x + (wall(c - 1, r) ? 0 : i), y + CELL - i);
          ctx.lineTo(x + CELL - (wall(c + 1, r) ? 0 : i), y + CELL - i);
        }
        if (!wall(c - 1, r)) {
          ctx.moveTo(x + i, y + (wall(c, r - 1) ? 0 : i));
          ctx.lineTo(x + i, y + CELL - (wall(c, r + 1) ? 0 : i));
        }
        if (!wall(c + 1, r)) {
          ctx.moveTo(x + CELL - i, y + (wall(c, r - 1) ? 0 : i));
          ctx.lineTo(x + CELL - i, y + CELL - (wall(c, r + 1) ? 0 : i));
        }
      }
    ctx.stroke();
    ctx.fillStyle = '#ffb8de';
    ctx.fillRect(9 * CELL + 2, 8 * CELL + CELL / 2 - 2, CELL - 4, 4);
  }
  function drawGhost(g) {
    const p = pos(g),
      x = p.x * CELL + CELL / 2,
      y = p.y * CELL + CELL / 2 + (g.mode === 'house' ? Math.sin(g.bob) * 2.5 : 0),
      R = CELL * 0.42;
    const flash = g.blue && fright < 2 && Math.floor(fright * 5) % 2 === 0;
    if (g.mode !== 'eyes' && g.mode !== 'entering') {
      ctx.fillStyle = g.blue ? (flash ? '#f4f4ff' : '#2440ff') : g.color;
      ctx.beginPath();
      ctx.arc(x, y - 1, R, Math.PI, 0);
      ctx.lineTo(x + R, y + R);
      const wave = Math.floor(clock * 8) % 2 ? 1 : 0;
      for (let i = 0; i < 4; i++) {
        const sx = x + R - (i + 0.5) * (R / 2);
        ctx.lineTo(sx, y + R - (i % 2 === wave ? 4 : 0));
      }
      ctx.lineTo(x - R, y + R);
      ctx.closePath();
      ctx.fill();
    }
    if (g.blue) {
      ctx.fillStyle = flash ? '#e0313a' : '#ffd0c0';
      ctx.fillRect(x - 4.5, y - 4, 3, 3);
      ctx.fillRect(x + 1.5, y - 4, 3, 3);
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x - 6, y + 4);
      for (let i = 1; i <= 4; i++) ctx.lineTo(x - 6 + i * 3, y + (i % 2 ? 2 : 4));
      ctx.stroke();
      return;
    }
    const d = DIRS[g.dir],
      ex = d[0] * 2,
      ey = d[1] * 2;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(x - 4, y - 3, 3.2, 4, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 4, y - 3, 3.2, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1d3bd8';
    ctx.beginPath();
    ctx.arc(x - 4 + ex, y - 3 + ey, 1.8, 0, Math.PI * 2);
    ctx.arc(x + 4 + ex, y - 3 + ey, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const flashing = state === 'cleared' && Math.floor(stateTime * 5) % 2 === 0;
    if (flashing) {
      ctx.save();
      ctx.filter = 'brightness(2.2)';
      drawWalls();
      ctx.restore();
    } else drawWalls();
    const blink = Math.floor(clock * 4) % 2 === 0 || state !== 'play';
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const d = grid?.[r]?.[c];
        if (!d) continue;
        const x = c * CELL + CELL / 2,
          y = r * CELL + CELL / 2;
        ctx.fillStyle = '#ffd3b8';
        if (d === '.') {
          ctx.fillRect(x - 2, y - 2, 4, 4);
        } else if (blink) {
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    if (state !== 'dying' || stateTime < 0.4) ghosts?.forEach(drawGhost);
    if (pac) {
      const p = pos(pac),
        x = p.x * CELL + CELL / 2,
        y = p.y * CELL + CELL / 2,
        R = CELL * 0.44,
        d = DIRS[pac.dir];
      let open = 0.05 + Math.abs(Math.sin(pac.mouth)) * 0.32;
      if (state === 'dying') open = Math.min(Math.PI, 0.2 + Math.max(0, stateTime - 0.4) * 2.6);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(d[1], d[0]));
      if (open < Math.PI) {
        ctx.fillStyle = '#ffe100';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R, open, Math.PI * 2 - open);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px ui-monospace, monospace';
    pops.forEach(p => {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = '#7df0ff';
      ctx.fillText(p.text, p.x * CELL + CELL / 2, p.y * CELL + CELL / 2);
    });
    ctx.globalAlpha = 1;
    const banner = state === 'ready' ? 'READY!' : paused ? 'PAUSED' : state === 'cleared' ? 'LEVEL CLEAR' : '';
    if (banner) {
      ctx.font = 'bold 16px ui-monospace, monospace';
      ctx.fillStyle = '#ffe100';
      ctx.fillText(banner, W / 2, 11 * CELL + CELL * 0.7);
    }
  }

  /* ---- controls ---- */
  const KEYS = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    KeyW: 'up',
    KeyS: 'down',
    KeyA: 'left',
    KeyD: 'right'
  };
  const steer = d => {
    wanted = d;
    if (state === 'idle' || state === 'over') start();
    else if (paused) pause(false);
  };
  t.on(document, 'keydown', e => {
    if ($('tab-games')?.hidden || e.target.closest?.('input,textarea,select')) return;
    const d = KEYS[e.code];
    if (d) {
      e.preventDefault();
      steer(d);
      return;
    }
    if (e.code === 'KeyP' || e.code === 'Space') {
      e.preventDefault();
      if (state === 'idle' || state === 'over') start();
      else pause(!paused);
    }
  });
  host.querySelectorAll('[data-pm]').forEach(b =>
    t.on(b, 'pointerdown', e => {
      e.preventDefault();
      steer(b.dataset.pm);
    })
  );
  let swipe = null;
  t.on(canvas, 'pointerdown', e => {
    swipe = { x: e.clientX, y: e.clientY };
  });
  t.on(canvas, 'pointerup', e => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x,
      dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  });
  t.on($('pm-overlay'), 'click', e => {
    if (e.target.closest('button')) start();
  });
  t.on($('pm-pause'), 'click', () => {
    if (state === 'idle' || state === 'over') start();
    else pause(!paused);
  });
  // Switching tabs or windows pauses the chase rather than losing a life.
  t.on(document, 'visibilitychange', () => {
    if (document.hidden && state !== 'idle' && state !== 'over') pause(true);
  });
  t.on(window, 'blur', () => {
    if (state === 'play' || state === 'ready') pause(true);
  });
  resetBoard();
  resetActors();
  hud();
  draw();
  t.every(step, 1000 / 60);
  t.every(draw, 0);
}

function newBreakoutDeep() {
  // Breakout fidelity: the first screen follows the original eight-row formation, then expands into Arkanoid-style patterns.
  const t = plusTools(),
    key = 'dejavu1.breakout.deep.best',
    W = 720,
    H = 480,
    host = $('game-host'),
    colors = ['#ff8a5b', '#ffcf70', '#67c9ff', '#77d58d', '#c58cff'];
  plusStats([
    ['Score', 'dbd-score'],
    ['Level', 'dbd-level'],
    ['Lives', 'dbd-lives'],
    ['Best', 'dbd-best', true, gameBestV2(key) || '—']
  ]);
  plusFrame(
    'Brick Break',
    'Drag or ← → · Space launch · P pause · curve the ball off the paddle',
    `<div class="break-deep"><canvas id="dbd-canvas" class="arcade-canvas" width="${W}" height="${H}" aria-label="Brick Break"></canvas><div class="break-actions"><button class="btn" id="dbd-pause">Pause</button><span id="dbd-message">Clear the formation and protect your lives.</span></div><div class="game-overlay" id="dbd-overlay"><div class="g-title">BRICK BREAK</div><div class="g-sub">Classic paddle physics, layered formations, armored bricks, and useful power capsules.</div><button class="btn primary">Launch ball</button></div></div>`,
    t
  );
  const canvas = $('dbd-canvas'),
    ctx = canvas.getContext('2d');
  let paddleX = W / 2,
    paddleWidth = 112,
    balls = [],
    bricks = [],
    capsules = [],
    sparks = [],
    pops = [],
    score = 0,
    level = 1,
    lives = 3,
    combo = 0,
    status = 'ready',
    timer,
    keys = {};
  const setMessage = (text, good = false) => {
    $('dbd-message').textContent = text;
    $('dbd-message').classList.toggle('good', good);
  };
  const speed = () => Math.min(9, 5 + level * 0.24),
    width = () => Math.min(170, paddleWidth + (wideTicks > 0 ? 42 : 0));
  let wideTicks = 0;
  function buildLegacyFormation() {
    const rows = Math.min(4 + Math.floor((level - 1) / 2), 9),
      pattern = level % 3;
    bricks = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < 10; c++) {
        const gap = pattern === 1 && r % 2 === 1 && (c === 0 || c === 9),
          solid = pattern === 2 && (r + c) % 5 === 0;
        if (gap) continue;
        const hp = level > 2 && (r + c + level) % 5 === 0 ? 2 : 1;
        bricks.push({
          x: 24 + c * 67,
          y: 34 + r * 24,
          w: 61,
          h: 17,
          hp,
          maxHp: hp,
          color: colors[r % colors.length],
          solid
        });
      }
    capsules = [];
    sparks = [];
    const s = speed();
    balls = [{ x: paddleX, y: H - 55, vx: (Math.random() < 0.5 ? -1 : 1) * s * 0.68, vy: -s, r: 7 }];
    wideTicks = 0;
  }
  // Classic Breakout starts with eight colored rows; later rounds borrow Arkanoid's
  // varied formations while preserving a readable first screen.
  function buildLevel() {
    const rows = level === 1 ? 8 : Math.min(4 + Math.floor((level - 1) / 2), 9),
      pattern = level % 3;
    bricks = [];
    const palette =
      level === 1 ? ['#d94330', '#d94330', '#e88b32', '#e88b32', '#5aa54b', '#5aa54b', '#d3b23a', '#d3b23a'] : colors;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < 10; c++) {
        const gap = level > 1 && pattern === 1 && r % 2 === 1 && (c === 0 || c === 9);
        if (gap) continue;
        const armored = level > 2 && (r + c + level) % 5 === 0;
        bricks.push({
          x: 24 + c * 67,
          y: 34 + r * 24,
          w: 61,
          h: 17,
          hp: armored ? 2 : 1,
          maxHp: armored ? 2 : 1,
          color: palette[r % palette.length],
          solid: false
        });
      }
    capsules = [];
    sparks = [];
    const s = speed();
    balls = [{ x: paddleX, y: H - 55, vx: (Math.random() < 0.5 ? -1 : 1) * s * 0.68, vy: -s, r: 7 }];
    wideTicks = 0;
  }
  function resetRun() {
    score = 0;
    level = 1;
    lives = 3;
    combo = 0;
    status = 'ready';
    paddleWidth = 112;
    paddleX = W / 2;
    buildLevel();
    $('dbd-overlay').innerHTML =
      '<div class="g-title">BRICK BREAK</div><div class="g-sub">Classic paddle physics, layered formations, armored bricks, and useful power capsules.</div><button class="btn primary">Launch ball</button>';
    $('dbd-overlay').style.display = 'flex';
    setMessage('Clear the formation and protect your lives.');
    draw();
  }
  function launch() {
    if (status === 'over' || status === 'ready') {
      if (status === 'over') resetRun();
      status = 'playing';
      $('dbd-overlay').style.display = 'none';
      clearInterval(timer);
      timer = t.every(tick, 16);
      setMessage('Keep the rally alive · edge hits create sharp returns.');
    } else if (status === 'paused') {
      status = 'playing';
      setMessage('Back in play.');
    }
  }
  function gameOver() {
    status = 'over';
    clearInterval(timer);
    timer = null;
    const best = Math.max(gameBestV2(key), score);
    saveBest(key, best);
    $('dbd-best').textContent = best;
    $('dbd-overlay').innerHTML =
      `<div class="g-title">RUN OVER</div><div class="g-sub">${score.toLocaleString()} points · level ${level}</div><button class="btn primary">Play again</button>`;
    $('dbd-overlay').style.display = 'flex';
    setMessage('The wall wins this round.');
  }
  function loseBall() {
    lives--;
    combo = 0;
    if (lives <= 0) {
      gameOver();
      return;
    }
    const s = speed();
    balls = [{ x: paddleX, y: H - 55, vx: (Math.random() < 0.5 ? -1 : 1) * s * 0.68, vy: -s, r: 7 }];
    setMessage(`${lives} lives left · find the center of the paddle`);
  }
  function burst(x, y, color = '#fff') {
    for (let i = 0; i < 8; i++)
      sparks.push({ x, y, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4, life: 1, color });
  }
  function applyPower(kind) {
    if (kind === 'wide') wideTicks = 480;
    if (kind === 'multi' && balls.length < 3) {
      const b = balls[0];
      balls.push({ x: b.x, y: b.y, vx: -b.vx, vy: b.vy, r: 7 });
    }
    if (kind === 'slow')
      balls.forEach(b => {
        b.vx *= 0.72;
        b.vy *= 0.72;
      });
    if (kind === 'life') {
      lives = Math.min(5, lives + 1);
    }
    setMessage(
      kind === 'life'
        ? '+1 life'
        : `${kind === 'wide' ? 'Wide paddle' : kind === 'multi' ? 'Multi-ball' : 'Slow motion'} collected`,
      true
    );
  }
  function tick() {
    if (status !== 'playing') return;
    if (wideTicks > 0) wideTicks--;
    const pw = width(),
      py = H - 32;
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i],
        oldX = b.x,
        oldY = b.y;
      b.x += b.vx;
      b.y += b.vy;
      (b.trail = b.trail || []).push({ x: b.x, y: b.y });
      if (b.trail.length > 6) b.trail.shift();
      if (b.x - b.r < 0 || b.x + b.r > W) {
        b.x = Math.max(b.r, Math.min(W - b.r, b.x));
        b.vx *= -1;
      }
      if (b.y - b.r < 0) {
        b.y = b.r;
        b.vy = Math.abs(b.vy);
      }
      if (b.vy > 0 && b.y + b.r >= py && b.y - b.r <= py + 14 && b.x >= paddleX - pw / 2 && b.x <= paddleX + pw / 2) {
        const offset = Math.max(-0.92, Math.min(0.92, (b.x - paddleX) / (pw / 2))),
          current = Math.max(4.2, Math.hypot(b.vx, b.vy));
        b.vx = offset * current * 0.92;
        b.vy = -Math.sqrt(Math.max(12, current * current - b.vx * b.vx));
        b.y = py - b.r - 1;
        combo++;
        if (combo % 5 === 0) setMessage(`Rally ×${combo}`, true);
      }
      let hitBrick = null;
      for (const brick of bricks) {
        if (
          !brick.hp ||
          b.x + b.r < brick.x ||
          b.x - b.r > brick.x + brick.w ||
          b.y + b.r < brick.y ||
          b.y - b.r > brick.y + brick.h
        )
          continue;
        hitBrick = brick;
        break;
      }
      if (hitBrick) {
        const horizontal = Math.abs(oldX - (hitBrick.x + hitBrick.w / 2)) > hitBrick.w / 2,
          vertical = Math.abs(oldY - (hitBrick.y + hitBrick.h / 2)) > hitBrick.h / 2;
        if (horizontal) b.vx *= -1;
        else b.vy *= -1;
        hitBrick.hp--;
        const pts = hitBrick.hp ? 5 : 10 + Math.min(40, combo * 2);
        score += pts;
        hitBrick.flash = 6;
        pops.push({ x: hitBrick.x + hitBrick.w / 2, y: hitBrick.y, text: '+' + pts, life: 1 });
        burst(b.x, b.y, hitBrick.color);
        if (!hitBrick.hp && !hitBrick.solid && Math.random() < 0.2) {
          const kinds = ['wide', 'multi', 'slow', 'life'],
            kind = kinds[Math.floor(Math.random() * kinds.length)];
          capsules.push({ x: hitBrick.x + hitBrick.w / 2, y: hitBrick.y, kind, vy: 2.1 });
        }
      }
      if (b.y - b.r > H) balls.splice(i, 1);
    }
    for (let i = capsules.length - 1; i >= 0; i--) {
      const p = capsules[i];
      p.y += p.vy;
      if (p.y > py - 8 && p.y < py + 18 && Math.abs(p.x - paddleX) < pw / 2 + 10) {
        applyPower(p.kind);
        capsules.splice(i, 1);
      } else if (p.y > H + 24) capsules.splice(i, 1);
    }
    sparks.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.06;
    });
    sparks = sparks.filter(p => p.life > 0);
    bricks.forEach(brick => {
      if (brick.flash) brick.flash--;
    });
    pops.forEach(sp => {
      sp.y -= 0.7;
      sp.life -= 0.04;
    });
    pops = pops.filter(sp => sp.life > 0);
    if (!balls.length) loseBall();
    if (bricks.every(b => !b.hp)) {
      level++;
      const best = Math.max(gameBestV2(key), score);
      saveBest(key, best);
      $('dbd-best').textContent = best;
      buildLevel();
      setMessage(`Level ${level} · new formation`, true);
    }
    draw();
  }
  function movePaddle(clientX) {
    const rect = canvas.getBoundingClientRect();
    paddleX = Math.max(width() / 2, Math.min(W - width() / 2, ((clientX - rect.left) / rect.width) * W));
    if (status !== 'playing') draw();
  }
  function draw() {
    // Atari Breakout dressing: flat black field, classic red/orange/green/yellow rows, Vaus-style paddle.
    ctx.fillStyle = '#07070b';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    for (let i = 0; i < 60; i++) ctx.fillRect((i * 83) % W, (i * 47) % H, 1, 1);
    bricks.forEach(brick => {
      if (!brick.hp) return;
      ctx.fillStyle = brick.color;
      ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.fillRect(brick.x + 2, brick.y + 2, brick.w - 4, 3);
      if (brick.maxHp > 1) {
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.lineWidth = 2;
        ctx.strokeRect(brick.x + 4, brick.y + 4, brick.w - 8, brick.h - 8);
      }
      if (brick.flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${((0.75 * brick.flash) / 6).toFixed(2)})`;
        ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
      }
    });
    const pw = width();
    const bodyGrad = ctx.createLinearGradient(0, H - 32, 0, H - 19);
    bodyGrad.addColorStop(0, '#f2f5fa');
    bodyGrad.addColorStop(0.5, '#c3cad7');
    bodyGrad.addColorStop(1, '#8e96a7');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.roundRect(paddleX - pw / 2 + 9, H - 32, pw - 18, 13, 6);
    ctx.fill();
    ctx.fillStyle = '#e0523c';
    ctx.beginPath();
    ctx.roundRect(paddleX - pw / 2, H - 32, 12, 13, 6);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(paddleX + pw / 2 - 12, H - 32, 12, 13, 6);
    ctx.fill();
    balls.forEach(b => {
      (b.trail || []).forEach((t, i) => {
        ctx.globalAlpha = ((i + 1) / Math.max(1, b.trail.length)) * 0.3;
        ctx.fillStyle = '#fff4c4';
        ctx.beginPath();
        ctx.arc(t.x, t.y, b.r * 0.75, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff4c4';
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });
    capsules.forEach(p => {
      const labels = { wide: 'W', multi: 'M', slow: 'S', life: '+' };
      ctx.fillStyle =
        p.kind === 'wide' ? '#5cc16f' : p.kind === 'multi' ? '#7fb2ff' : p.kind === 'life' ? '#ffcf70' : '#e0475f';
      ctx.beginPath();
      ctx.roundRect(p.x - 12, p.y - 12, 24, 24, 6);
      ctx.fill();
      ctx.fillStyle = '#102';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(labels[p.kind], p.x - 4, p.y + 5);
    });
    sparks.forEach(p => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 3, 3);
    });
    ctx.globalAlpha = 1;
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    pops.forEach(sp => {
      ctx.globalAlpha = Math.max(0, sp.life);
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText(sp.text, sp.x, sp.y);
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    $('dbd-score').textContent = score.toLocaleString();
    $('dbd-level').textContent = level;
    $('dbd-lives').textContent = lives;
  }
  const down = e => {
    if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Space', 'KeyP'].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    if (e.code === 'Space') launch();
    if (e.code === 'KeyP' && status === 'playing') {
      status = 'paused';
      setMessage('Paused · press P or the button to resume');
    }
  };
  const up = e => {
    keys[e.code] = false;
  };
  t.on(document, 'keydown', down);
  t.on(document, 'keyup', up);
  t.on(document, 'pointerup', () => {
    keys.ArrowLeft = false;
    keys.ArrowRight = false;
  });
  t.on(document, 'pointercancel', () => {
    keys.ArrowLeft = false;
    keys.ArrowRight = false;
  });
  t.on(canvas, 'pointermove', e => movePaddle(e.clientX));
  t.on(canvas, 'pointerdown', e => {
    e.preventDefault();
    movePaddle(e.clientX);
    launch();
  });
  t.on($('dbd-pause'), 'click', () => {
    if (status === 'playing') {
      status = 'paused';
      setMessage('Paused');
    } else if (status === 'paused') launch();
  });
  t.on($('dbd-overlay'), 'click', e => {
    if (e.target.closest('button')) {
      if (status === 'over') resetRun();
      launch();
    }
  });
  const drive = () => {
    if (keys.ArrowLeft || keys.KeyA) paddleX -= 8;
    if (keys.ArrowRight || keys.KeyD) paddleX += 8;
    paddleX = Math.max(width() / 2, Math.min(W - width() / 2, paddleX));
  };
  t.every(drive, 16);
  resetRun();
}

/* The biggest canvas in a game is its playing field: tag it, and tell the
   CSS its shape (theme.css "Games fit the window") so the whole field fits
   on screen. Runs again if a game resizes or replaces its canvas. */
let gameCanvasWatch = null;
/* Scroll so the whole game (toolbar, field, controls) is in view. */
function showWholeGame() {
  const host = $('game-host');
  if (!host) return;
  const r = (host.querySelector('.game-frame,.arcade-frame') || host).getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight)
    host.scrollIntoView({
      block: 'start',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
}
function fitGameCanvas() {
  const host = $('game-host');
  if (!host) return;
  const size = () => {
    const canvases = [...host.querySelectorAll('canvas')];
    if (!canvases.length) return;
    const main = canvases.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
    canvases.forEach(c => {
      if (c !== main) c.classList.remove('game-main');
    });
    main.classList.add('game-main');
    if (!main.width || !main.height) return;
    // Room across: the game's box, less anything beside the field (Tetris's side panel).
    const cs = getComputedStyle(host);
    let across = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const row = main.closest('.tetris-v2');
    if (row)
      [...row.children].forEach(el => {
        if (!el.contains(main)) across -= el.offsetWidth + 18;
      });
    const chrome = parseFloat(cs.getPropertyValue('--game-chrome')) || 300;
    const tall = document.fullscreenElement ? innerHeight - 150 : innerHeight - chrome;
    const width = Math.max(220, Math.min(across, 860, Math.max(200, tall) * (main.width / main.height)));
    const px = `${Math.floor(width)}px`;
    if (main.style.width !== px) main.style.width = px;
  };
  size();
  if (!gameCanvasWatch && window.MutationObserver) {
    gameCanvasWatch = new MutationObserver(() => size());
    gameCanvasWatch.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['width', 'height']
    });
    addEventListener('resize', size);
    document.addEventListener('fullscreenchange', () => setTimeout(size, 50));
  }
}
function installArcadePlus() {
  const games = {
    skydash: skyDashV2,
    pong: newSmartPong,
    mines: newMines,
    tetris: newTetris,
    pacman: newPacmanPlus,
    breakout: newDoodleBreak,
    blackjack: newBlackjack,
    asteroids: newAsteroids,
    snake: newSnake,
    twenty48: new2048
  };
  const legacyStop = stopCurrentGame;
  gameFullscreenV2 = (host, tools) => {
    const button = document.createElement('button');
    button.className = 'btn small game-fullscreen';
    button.type = 'button';
    button.textContent = '⛶ Fullscreen';
    tools.on(button, 'click', () => {
      const frame = host.querySelector('.game-frame') || host;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else frame.requestFullscreen?.().catch?.(() => {});
    });
    tools.on(document, 'fullscreenchange', () => {
      button.textContent = document.fullscreenElement ? '× Exit fullscreen' : '⛶ Fullscreen';
    });
    host.querySelector('.game-toolbar').appendChild(button);
  };
  stopCurrentGame = () => {
    legacyStop();
    plusStop();
    gamesCleanupV2?.();
    gamesCleanupV2 = () => {};
    activeGame = null;
  };
  renderGame = name => {
    stopCurrentGame();
    activeGame = name;
    (games[name] || games.skydash)();
    fitGameCanvas();
  };
  const picker = $('game-picker');
  if (picker) {
    const clean = picker.cloneNode(true);
    picker.replaceWith(clean);
    clean.querySelectorAll('button').forEach(b =>
      b.addEventListener('click', () => {
        clean.querySelectorAll('button').forEach(i => i.classList.toggle('active', i === b));
        renderGame(b.dataset.game);
        showWholeGame();
      })
    );
    const gameHost = $('game-host');
    if (gameHost && !gameHost.dataset.fitWired) {
      gameHost.dataset.fitWired = '1';
      gameHost.addEventListener('click', e => {
        if (e.target.closest('.game-overlay button, button.primary')) setTimeout(showWholeGame, 0);
      });
    }
    if (!$('tab-games').hidden) renderGame(clean.querySelector('button.active')?.dataset.game || 'skydash');
  }
}
