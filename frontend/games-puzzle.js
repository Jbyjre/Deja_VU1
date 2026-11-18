/* Deja Vu1 arcade, part 5 of 7: Tetris, Pac-Man and Solitaire.
 * Loaded right after games-shell.js by app.js loadGames(); the parts share one global scope.
 */
function newTetris() {
  /* Falling blocks on the standard 10 x 20 well: a shuffled bag of all
     seven pieces, a ghost showing where the piece will land, hold, wall
     kicks when a turn is blocked, half a second to slide a piece once it
     lands, and gravity that speeds up every ten lines. Tapping the board
     turns the piece; it never restarts the game. */
  const t = plusTools(),
    key = 'dejavu1.tetris.v2.best',
    COLS = 10,
    ROWS = 20,
    C = 30,
    W = COLS * C,
    H = ROWS * C;
  const SHAPES = [
    [[1, 1, 1, 1]],
    [
      [1, 0, 0],
      [1, 1, 1]
    ],
    [
      [0, 0, 1],
      [1, 1, 1]
    ],
    [
      [1, 1],
      [1, 1]
    ],
    [
      [0, 1, 1],
      [1, 1, 0]
    ],
    [
      [0, 1, 0],
      [1, 1, 1]
    ],
    [
      [1, 1, 0],
      [0, 1, 1]
    ]
  ];
  const NAMES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
  const COLORS = ['#4fd8ff', '#5b7cff', '#ff9f43', '#ffd84a', '#5ee07a', '#c77dff', '#ff5f6d'];
  plusStats([
    ['Score', 'te-score'],
    ['Lines', 'te-lines'],
    ['Level', 'te-level'],
    ['Best', 'te-best', true, gameBestV2(key) || '—']
  ]);
  plusFrame(
    'Tetris',
    '← → move · ↑ or X turns · Z turns back · ↓ drops faster · Space drops at once · C holds · P pauses',
    `<div class="tetris-v2"><div class="arcade-stage"><canvas id="te-canvas" class="tetris-canvas" aria-label="Tetris well"></canvas>
       <div class="game-overlay" id="te-overlay"><div class="g-title">TETRIS</div><div class="g-sub">Fill a whole row to clear it. Clear four at once for the biggest score.</div><button class="btn primary" type="button">Start</button></div></div>
     <aside class="tetris-side"><b>Next</b><canvas id="te-next" width="96" height="216" aria-label="Next pieces"></canvas><b>Hold</b><canvas id="te-hold" width="96" height="72" aria-label="Held piece"></canvas><button class="btn" type="button" id="te-pause">Pause</button></aside></div>
     <div class="arcade-pad wide" aria-label="Tetris buttons"><button class="btn" type="button" data-te="left" aria-label="Move left">◀</button><button class="btn" type="button" data-te="rotate" aria-label="Turn">⟳</button><button class="btn" type="button" data-te="right" aria-label="Move right">▶</button><button class="btn" type="button" data-te="soft" aria-label="Drop faster">▼</button><button class="btn" type="button" data-te="hard" aria-label="Drop at once">⤓</button><button class="btn" type="button" data-te="hold" aria-label="Hold">Hold</button></div>
     <div class="arcade-actions"><span id="te-message" role="status">Press Start.</span></div>`,
    t
  );
  const canvas = $('te-canvas'),
    ctx = canvas.getContext('2d'),
    dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  let board,
    bag,
    queue,
    cur,
    hold,
    usedHold,
    score = 0,
    lines = 0,
    level = 1,
    state = 'idle',
    paused = false,
    fallClock = 0,
    lockClock = 0,
    lockMoves = 0,
    flash = null,
    flashClock = 0;
  const msg = text => {
    $('te-message').textContent = text;
  };
  const hud = () => {
    $('te-score').textContent = score.toLocaleString();
    $('te-lines').textContent = lines;
    $('te-level').textContent = level;
  };
  const shuffle = a => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const take = () => {
    if (!bag.length) bag = shuffle([0, 1, 2, 3, 4, 5, 6]);
    return bag.pop();
  };
  const spawn = id => ({
    id,
    shape: SHAPES[id].map(r => r.slice()),
    x: Math.floor((COLS - SHAPES[id][0].length) / 2),
    y: 0
  });
  const hits = (p, dx = 0, dy = 0, shape = p.shape) =>
    shape.some((row, r) =>
      row.some((v, c) => {
        if (!v) return false;
        const x = p.x + c + dx,
          y = p.y + r + dy;
        return x < 0 || x >= COLS || y >= ROWS || (y >= 0 && board[y][x]);
      })
    );
  // Seconds per row: the usual guideline curve, about 1 s at level 1.
  const gravity = () => Math.max(0.03, Math.pow(0.8 - (level - 1) * 0.007, level - 1));
  function next() {
    cur = spawn(queue.shift());
    queue.push(take());
    usedHold = false;
    fallClock = 0;
    lockClock = 0;
    lockMoves = 0;
    if (hits(cur)) gameOver();
    drawSide();
  }
  function start() {
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    bag = [];
    queue = [take(), take(), take()];
    hold = null;
    score = 0;
    lines = 0;
    level = 1;
    flash = null;
    state = 'play';
    paused = false;
    $('te-overlay').style.display = 'none';
    $('te-pause').textContent = 'Pause';
    msg('Fill whole rows to clear them.');
    hud();
    next();
  }
  function gameOver() {
    state = 'over';
    const best = Math.max(gameBestV2(key), score);
    saveBest(key, best);
    $('te-best').textContent = best.toLocaleString();
    const o = $('te-overlay');
    o.style.display = '';
    o.innerHTML = `<div class="g-title">GAME OVER</div><div class="g-sub">${score.toLocaleString()} points · ${lines} lines · level ${level}</div><button class="btn primary" type="button">Play again</button>`;
    msg('The stack reached the top.');
  }
  function pause(on) {
    if (state !== 'play') return;
    paused = on;
    $('te-pause').textContent = on ? 'Resume' : 'Pause';
    msg(on ? 'Paused.' : 'Back to it.');
  }
  const grounded = () => hits(cur, 0, 1);
  function shift(dx) {
    if (!hits(cur, dx, 0)) {
      cur.x += dx;
      if (grounded() && lockMoves < 15) {
        lockClock = 0;
        lockMoves++;
      }
    }
  }
  function rotate(dir) {
    const s = cur.shape,
      r =
        dir > 0
          ? s[0].map((_, i) => s.map(row => row[i]).reverse())
          : s[0].map((_, i) => s.map(row => row[row.length - 1 - i]));
    for (const [kx, ky] of [
      [0, 0],
      [-1, 0],
      [1, 0],
      [-2, 0],
      [2, 0],
      [0, -1]
    ]) {
      if (!hits(cur, kx, ky, r)) {
        cur.x += kx;
        cur.y += ky;
        cur.shape = r;
        if (grounded() && lockMoves < 15) {
          lockClock = 0;
          lockMoves++;
        }
        return;
      }
    }
  }
  function lock() {
    cur.shape.forEach((row, r) =>
      row.forEach((v, c) => {
        if (v && cur.y + r >= 0) board[cur.y + r][cur.x + c] = cur.id + 1;
      })
    );
    const full = board.map((row, i) => (row.every(Boolean) ? i : -1)).filter(i => i >= 0);
    if (full.length) {
      flash = full;
      flashClock = 0;
      const n = full.length;
      score += [0, 100, 300, 500, 800][n] * level;
      lines += n;
      msg(n === 4 ? 'Tetris! Four lines at once.' : `${n} line${n > 1 ? 's' : ''} cleared.`);
      const lv = Math.floor(lines / 10) + 1;
      if (lv > level) {
        level = lv;
        msg(`Level ${level}: pieces fall faster.`);
      }
      hud();
    } else next();
  }
  function hard() {
    let n = 0;
    while (!hits(cur, 0, 1)) {
      cur.y++;
      n++;
    }
    score += n * 2;
    hud();
    lock();
  }
  function soft() {
    if (!hits(cur, 0, 1)) {
      cur.y++;
      score += 1;
      fallClock = 0;
      hud();
    }
  }
  function holdPiece() {
    if (usedHold) return;
    const id = cur.id;
    if (hold == null) {
      hold = id;
      next();
    } else {
      cur = spawn(hold);
      hold = id;
    }
    usedHold = true;
    drawSide();
  }
  function step() {
    if (state === 'play' && !paused) {
      const dt = 1 / 60;
      if (flash) {
        flashClock += dt;
        if (flashClock > 0.22) {
          board = board.filter((_, i) => !flash.includes(i));
          while (board.length < ROWS) board.unshift(Array(COLS).fill(0));
          flash = null;
          next();
        }
      } else if (grounded()) {
        lockClock += dt;
        if (lockClock >= 0.5) lock();
      } else {
        fallClock += dt;
        if (fallClock >= gravity()) {
          fallClock = 0;
          cur.y++;
        }
      }
    }
  }
  const cellAt = (c2, x, y, col, alpha = 1) => {
    c2.globalAlpha = alpha;
    c2.fillStyle = col;
    c2.fillRect(x + 1, y + 1, C - 2, C - 2);
    c2.fillStyle = 'rgba(255,255,255,.22)';
    c2.fillRect(x + 1, y + 1, C - 2, 4);
    c2.globalAlpha = 1;
  };
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d1624';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.beginPath();
    for (let x = 1; x < COLS; x++) {
      ctx.moveTo(x * C + 0.5, 0);
      ctx.lineTo(x * C + 0.5, H);
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.moveTo(0, y * C + 0.5);
      ctx.lineTo(W, y * C + 0.5);
    }
    ctx.stroke();
    if (!board) return;
    board.forEach((row, y) =>
      row.forEach((v, x) => {
        if (v)
          cellAt(
            ctx,
            x * C,
            y * C,
            flash && flash.includes(y) && Math.floor(flashClock * 20) % 2 ? '#ffffff' : COLORS[v - 1]
          );
      })
    );
    if (cur && state !== 'over' && !flash) {
      let gy = 0;
      while (!hits(cur, 0, gy + 1)) gy++;
      cur.shape.forEach((row, r) =>
        row.forEach((v, c) => {
          if (v && cur.y + r + gy >= 0) {
            ctx.strokeStyle = COLORS[cur.id];
            ctx.globalAlpha = 0.55;
            ctx.strokeRect((cur.x + c) * C + 2.5, (cur.y + r + gy) * C + 2.5, C - 5, C - 5);
            ctx.globalAlpha = 1;
          }
        })
      );
      cur.shape.forEach((row, r) =>
        row.forEach((v, c) => {
          if (v && cur.y + r >= 0) cellAt(ctx, (cur.x + c) * C, (cur.y + r) * C, COLORS[cur.id]);
        })
      );
    }
    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, H / 2);
    }
  }
  function mini(cv, ids) {
    const c2 = cv.getContext('2d');
    c2.clearRect(0, 0, cv.width, cv.height);
    ids.forEach((id, i) => {
      if (id == null) return;
      const s = SHAPES[id],
        m = 18,
        ox = (cv.width - s[0].length * m) / 2,
        oy = i * 72 + (72 - s.length * m) / 2;
      s.forEach((row, r) =>
        row.forEach((v, c) => {
          if (v) {
            c2.fillStyle = COLORS[id];
            c2.fillRect(ox + c * m + 1, oy + r * m + 1, m - 2, m - 2);
          }
        })
      );
    });
  }
  function drawSide() {
    mini($('te-next'), queue.slice(0, 3));
    mini($('te-hold'), [hold]);
  }
  const act = a => {
    if (state !== 'play') {
      if (a === 'start') start();
      return;
    }
    if (a === 'pause') {
      pause(!paused);
      return;
    }
    if (paused || flash) return;
    ({
      left: () => shift(-1),
      right: () => shift(1),
      rotate: () => rotate(1),
      back: () => rotate(-1),
      soft,
      hard,
      hold: holdPiece
    })[a]?.();
  };
  const KEYS = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'rotate',
    KeyX: 'rotate',
    KeyZ: 'back',
    ArrowDown: 'soft',
    Space: 'hard',
    KeyC: 'hold',
    KeyP: 'pause',
    Escape: 'pause'
  };
  t.on(document, 'keydown', e => {
    if ($('tab-games')?.hidden || e.target.closest?.('input,textarea,select')) return;
    const a = KEYS[e.code];
    if (!a) return;
    e.preventDefault();
    if (state !== 'play' && (a === 'hard' || a === 'rotate')) {
      start();
      return;
    }
    if (e.repeat && (a === 'hard' || a === 'hold' || a === 'rotate' || a === 'back' || a === 'pause')) return;
    act(a);
  });
  document.querySelectorAll('[data-te]').forEach(b =>
    t.on(b, 'pointerdown', e => {
      e.preventDefault();
      if (state !== 'play') start();
      else act(b.dataset.te);
    })
  );
  let touch = null;
  t.on(canvas, 'pointerdown', e => {
    touch = { x: e.clientX, y: e.clientY };
  });
  t.on(canvas, 'pointerup', e => {
    if (!touch || state !== 'play') return;
    const dx = e.clientX - touch.x,
      dy = e.clientY - touch.y;
    touch = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 14) {
      act('rotate');
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      const cells = Math.max(1, Math.round(Math.abs(dx) / (canvas.getBoundingClientRect().width / COLS)));
      for (let i = 0; i < cells; i++) act(dx > 0 ? 'right' : 'left');
    } else if (dy > 0) act('hard');
  });
  t.on($('te-overlay'), 'click', e => {
    if (e.target.closest('button')) start();
  });
  t.on($('te-pause'), 'click', () => {
    if (state === 'play') pause(!paused);
    else start();
  });
  t.on(document, 'visibilitychange', () => {
    if (document.hidden) pause(true);
  });
  t.on(window, 'blur', () => pause(true));
  board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  bag = [];
  queue = [take(), take(), take()];
  hold = null;
  hud();
  draw();
  drawSide();
  t.every(step, 1000 / 60);
  t.every(draw, 0);
}

function newPacman() {
  const tools = gameTools(),
    key = 'dejavu1.pacman.best',
    W = 570,
    H = 630,
    host = $('game-host'),
    map = [
      '###################',
      '#........#........#',
      '#.###.###.#.###.###',
      '#o###.###.#.###.##o',
      '#.................#',
      '#.###.#.#####.#.###',
      '#.....#...#...#...#',
      '#####.### # ###.#####',
      '    #.#       #.#    ',
      '#####.# ## ## #.#####',
      '#.........#.........#',
      '#####.#.#####.#.#####',
      '    #.#...#...#.#    ',
      '#######.###.#######',
      '#.................#',
      '#.###.###.#.###.###',
      '#o..#.....#.....#..o#',
      '###.#.#.#####.#.#.###',
      '#.....#...#...#.....#',
      '#.######## ########.#',
      '###################'
    ];
  arcadeShell(
    host,
    'Pac-Man',
    'Arrow keys / WASD · eat every dot · power pellets turn the ghosts blue',
    `<canvas id="arcade-pacman" class="arcade-canvas"></canvas><div class="arcade-overlay" id="pac-overlay"><b>MAZE CHASE</b><span>Four personalities, one hungry maze.</span><button class="btn primary">Start run</button></div>`,
    `<div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="pa-score">0</div></div><div class="game-stat"><div class="g-key">Lives</div><div class="g-val" id="pa-lives">3</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="pa-best">${gameBest(key) || '—'}</div></div>`,
    tools
  );
  const [canvas, ctx] = gameCanvas(host, 'arcade-pacman', W, H),
    rows = map.length,
    cols = 19,
    cell = 30;
  let grid,
    player,
    ghosts,
    score,
    lives,
    power,
    dots,
    playing,
    loop,
    wanted = 'left';
  const walk = (r, c) => {
    const cc = (c + cols) % cols;
    return r >= 0 && r < rows && map[r][cc] !== '#' && map[r][cc] !== ' ';
  };
  const pos = (r, c) => ({ x: c * cell + cell / 2, y: r * cell + cell / 2 });
  function reset() {
    grid = map.map(row =>
      row
        .padEnd(cols, ' ')
        .split('')
        .map(ch => (ch === '.' || ch === 'o' ? ch : null))
    );
    dots = grid.flat().filter(Boolean).length;
    score = 0;
    lives = 3;
    power = 0;
    player = { r: 16, c: 9, dir: 'left' };
    ghosts = [
      { r: 10, c: 8, dir: 'left', color: '#ef5350', mode: 0 },
      { r: 10, c: 9, dir: 'right', color: '#f6a6d5', mode: 1 },
      { r: 10, c: 10, dir: 'up', color: '#55ddea', mode: 2 },
      { r: 12, c: 9, dir: 'left', color: '#ffb05a', mode: 3 }
    ];
    playing = true;
    $('pac-overlay').style.display = 'none';
    loop = tools.every(tick, 130);
  }
  const dirs = { left: [0, -1], right: [0, 1], up: [-1, 0], down: [1, 0] };
  const turn = (r, c, d) => walk(r + dirs[d][0], c + dirs[d][1]);
  function bfs(start, target) {
    const q = [start],
      prev = new Map([[`${start.r},${start.c}`, null]]);
    while (q.length) {
      const p = q.shift();
      if (p.r === target.r && p.c === target.c) break;
      for (const d of ['up', 'left', 'down', 'right']) {
        const n = { r: p.r + dirs[d][0], c: (p.c + dirs[d][1] + cols) % cols },
          k = `${n.r},${n.c}`;
        if (walk(n.r, n.c) && !prev.has(k)) {
          prev.set(k, { ...p, d });
          q.push(n);
        }
      }
    }
    let p = target;
    while (prev.has(`${p.r},${p.c}`) && prev.get(`${p.r},${p.c}`)) {
      const z = prev.get(`${p.r},${p.c}`);
      if (z.r === start.r && z.c === start.c) return z.d;
      p = z;
    }
    return null;
  }
  function loseLife() {
    lives--;
    if (!lives) {
      playing = false;
      clearInterval(loop);
      const best = Math.max(gameBest(key), score);
      setGameBest(key, best);
      $('pa-best').textContent = best;
      $('pac-overlay').innerHTML =
        `<b>GAME OVER</b><span>${score} points</span><button class="btn primary">Try again</button>`;
      $('pac-overlay').style.display = 'flex';
    } else {
      player = { r: 16, c: 9, dir: 'left' };
      ghosts.forEach((g, i) => Object.assign(g, { r: 10, c: 8 + (i % 3) }));
    }
  }
  function tick() {
    if (!playing) return;
    if (turn(player.r, player.c, wanted)) player.dir = wanted;
    if (turn(player.r, player.c, player.dir)) {
      player.r += dirs[player.dir][0];
      player.c = (player.c + dirs[player.dir][1] + cols) % cols;
    }
    const item = grid[player.r][player.c];
    if (item) {
      grid[player.r][player.c] = null;
      dots--;
      score += item === 'o' ? 50 : 10;
      if (item === 'o') power = 45;
    }
    ghosts.forEach((g, i) => {
      if (power) {
        const options = ['up', 'left', 'down', 'right'].filter(d => walk(g.r + dirs[d][0], g.c + dirs[d][1]));
        g.dir = options[Math.floor(Math.random() * options.length)];
      } else {
        const target =
          i === 0
            ? player
            : i === 1
              ? { r: player.r + dirs[player.dir][0] * 4, c: player.c + dirs[player.dir][1] * 4 }
              : i === 2
                ? { r: player.r + dirs[player.dir][0] * 2, c: player.c + dirs[player.dir][1] * 2 }
                : { r: player.r, c: player.c };
        g.dir = bfs(g, { r: Math.max(0, Math.min(rows - 1, target.r)), c: (target.c + cols) % cols }) || g.dir;
      }
      if (walk(g.r + dirs[g.dir][0], g.c + dirs[g.dir][1])) {
        g.r += dirs[g.dir][0];
        g.c = (g.c + dirs[g.dir][1] + cols) % cols;
      }
      if (g.r === player.r && g.c === player.c) {
        if (power) {
          score += 200;
          g.r = 10;
          g.c = 9;
        } else loseLife();
      }
    });
    if (power) power--;
    if (!dots) {
      playing = false;
      clearInterval(loop);
      score += 500;
      const best = Math.max(gameBest(key), score);
      setGameBest(key, best);
      $('pa-best').textContent = best;
      $('pac-overlay').innerHTML =
        `<b>MAZE CLEARED</b><span>${score} points</span><button class="btn primary">Next maze</button>`;
      $('pac-overlay').style.display = 'flex';
    }
    draw();
  }
  function draw() {
    ctx.fillStyle = '#070d1a';
    ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (map[r][c] === '#') {
          ctx.fillStyle = '#203f9c';
          ctx.fillRect(c * cell + 2, r * cell + 2, cell - 4, cell - 4);
        }
        const v = grid[r][c];
        if (v) {
          ctx.fillStyle = v === 'o' ? '#ffdb70' : '#f3e7c5';
          ctx.beginPath();
          ctx.arc(c * cell + 15, r * cell + 15, v === 'o' ? 7 : 2, 0, 7);
          ctx.fill();
        }
      }
    const pp = pos(player.r, player.c);
    ctx.fillStyle = '#ffd447';
    ctx.beginPath();
    ctx.arc(pp.x, pp.y, 11, 0, 7);
    ctx.fill();
    ghosts.forEach(g => {
      const p = pos(g.r, g.c);
      ctx.fillStyle = power ? '#6a88ff' : g.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11, Math.PI, 0);
      ctx.lineTo(p.x + 11, p.y + 10);
      ctx.lineTo(p.x + 5, p.y + 6);
      ctx.lineTo(p.x, p.y + 10);
      ctx.lineTo(p.x - 5, p.y + 6);
      ctx.lineTo(p.x - 11, p.y + 10);
      ctx.closePath();
      ctx.fill();
    });
    $('pa-score').textContent = score;
    $('pa-lives').textContent = lives;
  }
  const onKey = e => {
    const d = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
      KeyA: 'left',
      KeyD: 'right',
      KeyW: 'up',
      KeyS: 'down'
    }[e.code];
    if (d) {
      e.preventDefault();
      wanted = d;
    }
  };
  tools.on(document, 'keydown', onKey);
  tools.on(host.querySelector('.arcade-overlay button'), 'click', reset);
  tools.on(canvas, 'pointerdown', () => {
    if (!playing) reset();
  });
  reset();
}

function newSolitaire() {
  const tools = gameTools(),
    key = 'dejavu1.solitaire.best',
    host = $('game-host');
  arcadeShell(
    host,
    'Klondike',
    'Click a face-up card, then click a legal destination · double-click sends to foundation',
    '<div class="solitaire" id="solitaire-board"><div class="sol-top"><button class="card-slot" id="so-stock">▣</button><button class="card-slot" id="so-waste">—</button><div class="foundations" id="so-foundations"></div></div><div class="tableau" id="so-tableau"></div><div class="sol-actions"><button class="btn" id="so-new">New deal</button><span id="so-message"></span></div></div>',
    `<div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="so-score">0</div></div><div class="game-stat"><div class="g-key">Moves</div><div class="g-val" id="so-moves">0</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="so-best">${gameBest(key) || '—'}</div></div>`,
    tools
  );
  const suits = ['♠', '♥', '♦', '♣'],
    red = new Set(['♥', '♦']);
  let stock, waste, tableau, found, selected, moves, won;
  const deck = () =>
    suits.flatMap(s => Array.from({ length: 13 }, (_, i) => ({ s, n: i + 1, up: false, id: `${s}${i + 1}` })));
  const label = c => `${c.n === 1 ? 'A' : c.n === 11 ? 'J' : c.n === 12 ? 'Q' : c.n === 13 ? 'K' : c.n}${c.s}`;
  const color = c => (red.has(c.s) ? 'red' : 'black');
  function deal() {
    let d = deck();
    for (let i = d.length - 1; i; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    tableau = Array.from({ length: 7 }, () => []);
    for (let col = 0; col < 7; col++)
      for (let r = 0; r <= col; r++) {
        const c = d.pop();
        c.up = r === col;
        tableau[col].push(c);
      }
    stock = d.map(c => ({ ...c, up: false }));
    waste = [];
    found = Array.from({ length: 4 }, () => []);
    selected = null;
    moves = 0;
    won = false;
    draw();
  }
  function canTableau(card, col) {
    const pile = tableau[col],
      top = pile[pile.length - 1];
    return top ? top.up && top.n === card.n + 1 && color(top) !== color(card) : card.n === 13;
  }
  function canFoundation(card, i) {
    const pile = found[i],
      top = pile[pile.length - 1];
    return card.s === suits[i] && (top ? top.n + 1 === card.n : card.n === 1);
  }
  function flip(pile) {
    if (pile.length && !pile[pile.length - 1].up) {
      pile[pile.length - 1].up = true;
      scoreChange(5);
    }
  }
  function scoreChange(n) {
    $('so-score').textContent = Number($('so-score').textContent) + n;
  }
  function moveCard(card, from, to) {
    if (from.type === 'tableau') {
      const pile = tableau[from.i],
        idx = pile.indexOf(card);
      tableau[from.i] = pile.slice(0, idx);
      tableau[to.i].push(...pile.slice(idx));
      flip(tableau[from.i]);
    } else if (from.type === 'waste') waste.pop();
    to.type === 'foundation' ? found[to.i].push(card) : tableau[to.i].push(card);
    moves++;
    selected = null;
    draw();
  }
  function clickCard(card, from) {
    if (!card.up) return;
    if (selected) {
      if (from.type === 'tableau' && canTableau(selected.card, from.i))
        moveCard(selected.card, selected.from, { type: 'tableau', i: from.i });
      else if (from.type === 'foundation' && canFoundation(selected.card, from.i))
        moveCard(selected.card, selected.from, { type: 'foundation', i: from.i });
      else if (from.type === 'waste' && canFoundation(selected.card, from.i))
        moveCard(selected.card, selected.from, { type: 'foundation', i: from.i });
      else selected = null;
    } else selected = { card, from };
    draw();
  }
  function draw() {
    const tab = $('so-tableau');
    tab.innerHTML = '';
    tableau.forEach((pile, i) => {
      const col = document.createElement('div');
      col.className = 'sol-col';
      pile.forEach((c, j) => {
        const b = document.createElement('button');
        b.className = `playing-card ${c.up ? 'up' : 'down'} ${color(c)}`;
        b.textContent = c.up ? label(c) : '◆';
        b.style.top = `${j * 25}px`;
        b.onclick = () => clickCard(c, { type: 'tableau', i });
        col.appendChild(b);
      });
      const drop = document.createElement('button');
      drop.className = 'sol-drop';
      drop.textContent = 'K';
      drop.onclick = () => {
        if (selected && canTableau(selected.card, i)) moveCard(selected.card, selected.from, { type: 'tableau', i });
      };
      col.appendChild(drop);
      tab.appendChild(col);
    });
    const fs = $('so-foundations');
    fs.innerHTML = '';
    found.forEach((pile, i) => {
      const b = document.createElement('button');
      b.className = 'card-slot';
      b.textContent = pile.length ? label(pile[pile.length - 1]) : suits[i];
      b.onclick = () => {
        if (selected && canFoundation(selected.card, i))
          moveCard(selected.card, selected.from, { type: 'foundation', i });
      };
      fs.appendChild(b);
    });
    $('so-waste').textContent = waste.length ? label(waste[waste.length - 1]) : '—';
    $('so-stock').textContent = stock.length ? '▣' : '↻';
    $('so-moves').textContent = moves;
    if (found.every(p => p.length === 13)) {
      won = true;
      $('so-message').textContent = 'Deck complete';
      const best = Math.max(gameBest(key), Number($('so-score').textContent));
      setGameBest(key, best);
      $('so-best').textContent = best;
    }
  }
  tools.on($('so-stock'), 'click', () => {
    if (stock.length) waste.push(stock.pop());
    else {
      stock = waste.reverse().map(c => ({ ...c, up: false }));
      waste = [];
    }
    draw();
  });
  tools.on($('so-waste'), 'click', () => {
    if (waste.length) clickCard(waste[waste.length - 1], { type: 'waste' });
  });
  tools.on($('so-new'), 'click', deal);
  deal();
}
