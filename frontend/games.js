/* The arcade in the Games tab, split into seven files that app.js loadGames() loads in this order: games.js,
 * games-classic.js, games-arcade.js, games-shell.js, games-puzzle.js, games-v2.js, games-world.js.
 * They share one global scope, like the single file they came from. This file: the frame scheduler, the shared
 * game tools, FreeCell, Snake, 2048 and Smart Pong.
 */
/* Deja Vu1 - the arcade in the Games tab ("While you wait").
 *
 * Kept apart from the dashboard (app.js) and loaded only the first time the
 * Games tab opens (app.js loadGames), so the dashboard downloads, parses and
 * starts without it. Plain JavaScript, offline: no game reads printer state
 * or calls the network. It uses app.js's shared helpers ($, esc, toast) and
 * defines startCurrentGame / stopCurrentGame, which replace app.js's
 * stand-ins when this file loads. Sloppy mode on purpose, as when this code
 * lived in app.js (no "use strict" there either).
 */

/* Game clock. Every game's repeating timer goes through frameEvery, which
   runs it from requestAnimationFrame at its own steady rate: steps land on
   screen refreshes (no setInterval stutter), the speed is the same on a
   60 Hz or a 144 Hz screen, a tab in the background pauses instead of
   piling up steps, and a slow frame catches up at most a few steps rather
   than leaping (up to eight steps). The ids it returns work with clearInterval/clearTimeout,
   which the games already call. */
const frameJobs = new Map();
let frameJobSeq = 2e9,
  frameJobRaf = 0,
  frameJobLast = 0;
const nativeClearInterval = window.clearInterval.bind(window),
  nativeClearTimeout = window.clearTimeout.bind(window);
window.clearInterval = id => {
  if (!frameJobs.delete(id)) nativeClearInterval(id);
};
window.clearTimeout = id => {
  if (!frameJobs.delete(id)) nativeClearTimeout(id);
};
function frameEvery(fn, ms) {
  const id = frameJobSeq++;
  // A step of about one frame is treated as exactly one 60 Hz frame.
  // ms 0 means "once every screen frame" (drawing); about one frame (15-17)
  // means exactly 60 steps a second.
  frameJobs.set(id, { fn, ms: ms === 0 ? 0 : ms >= 15 && ms <= 17 ? 1000 / 60 : Math.max(1, ms), due: 0 });
  if (!frameJobRaf) {
    frameJobLast = performance.now();
    frameJobRaf = requestAnimationFrame(frameJobTick);
  }
  return id;
}
function frameJobTick(now) {
  const dt = Math.min(250, Math.max(0, now - frameJobLast));
  frameJobLast = now;
  for (const [id, job] of frameJobs) {
    if (!job.ms) {
      try {
        job.fn();
      } catch (err) {
        frameJobs.delete(id);
        console.error(err);
      }
      continue;
    }
    job.due += dt;
    let steps = 0;
    while (job.due >= job.ms - 0.5 && frameJobs.has(id)) {
      job.due -= job.ms;
      if (++steps > 8) {
        job.due = 0;
        break;
      }
      try {
        job.fn();
      } catch (err) {
        frameJobs.delete(id);
        console.error(err);
      }
    }
  }
  frameJobRaf = frameJobs.size ? requestAnimationFrame(frameJobTick) : 0;
}

/* Arcade Plus: authoritative offline arcade runtime. Installed after legacy declarations
   so the public picker has one clean dispatch path and one cleanup owner. */
let plusStop = () => {};
function plusTools() {
  const events = [],
    timers = [];
  const on = (t, n, f, o) => {
    t.addEventListener(n, f, o);
    events.push(() => t.removeEventListener(n, f, o));
  };
  const every = (f, m) => {
    const id = frameEvery(f, m);
    timers.push(id);
    return id;
  };
  plusStop = () => {
    events.splice(0).forEach(f => f());
    timers.splice(0).forEach(id => {
      clearInterval(id);
      clearTimeout(id);
    });
    plusStop = () => {};
  };
  return { on, every };
}
function plusFrame(title, help, body, tools) {
  $('game-host').innerHTML = gameShellV2(title, help, body);
  gameFullscreenV2($('game-host'), tools);
}
function plusStats(items) {
  gameStats(
    items
      .map(
        ([k, id, a, v]) =>
          `<div class="game-stat"><div class="g-key">${k}</div><div class="g-val ${a ? 'accent' : ''}" id="${id}">${v ?? '0'}</div></div>`
      )
      .join('')
  );
}
function newFreeCell() {
  const t = plusTools(),
    key = 'dejavu1.freecell.best';
  plusStats([
    ['Score', 'fc-score'],
    ['Moves', 'fc-moves'],
    ['Best', 'fc-best', true, gameBestV2(key) || '—']
  ]);
  plusFrame(
    'FreeCell',
    'Click a face-up card, then a destination · A auto-moves a safe card',
    `<div class="freecell" id="fc-board"><div class="fc-top"><div class="fc-pockets" id="fc-free"></div><div class="fc-foundations" id="fc-found"></div></div><div class="fc-tableau" id="fc-tableau"></div><div class="fc-footer"><button class="btn" id="fc-new">New deal</button><button class="btn" id="fc-auto">Auto move</button><span id="fc-message">Build each suit from ace to king.</span></div></div>`,
    t
  );
  const suits = ['♠', '♥', '♦', '♣'],
    red = new Set(['♥', '♦']),
    ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  let cols, free, founds, selected, moves, score;
  const color = c => (red.has(c.s) ? 'red' : 'black'),
    label = c => ranks[c.n] + c.s,
    shuffle = a => {
      for (let i = a.length - 1; i; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    msg = (x, g) => {
      $('fc-message').textContent = x;
      $('fc-message').classList.toggle('good', !!g);
    };
  const valid = (p, i) => p.slice(i).every((c, j, r) => !j || (r[j - 1].n === c.n + 1 && color(r[j - 1]) !== color(c)));
  function deal() {
    const d = shuffle(suits.flatMap(s => Array.from({ length: 13 }, (_, i) => ({ s, n: i + 1 }))));
    cols = Array.from({ length: 8 }, () => []);
    d.forEach((c, i) => cols[i % 8].push(c));
    free = [null, null, null, null];
    founds = suits.map(() => []);
    selected = null;
    moves = score = 0;
    msg('Build each suit from ace to king.');
    draw();
  }
  const canCol = (c, i) => {
    const top = cols[i].at(-1);
    return top ? top.n === c.n + 1 && color(top) !== color(c) : c.n === 13;
  };
  const canFound = (c, i) => {
    const top = founds[i].at(-1);
    return c.s === suits[i] && (top ? top.n + 1 === c.n : c.n === 1);
  };
  function move(to) {
    if (!selected) return false;
    const s = selected,
      card = s.card;
    let ok = false;
    if (to.kind === 'free' && s.kind === 'column' && free[to.i] === null && s.row === cols[s.col].length - 1) {
      cols[s.col].pop();
      free[to.i] = card;
      ok = true;
    } else if (
      to.kind === 'column' &&
      s.kind === 'column' &&
      to.i !== s.col &&
      valid(cols[s.col], s.row) &&
      cols[s.col].length - s.row <= Math.max(1, free.filter(Boolean).length + cols.filter(c => !c.length).length) &&
      canCol(card, to.i)
    ) {
      cols[to.i].push(...cols[s.col].splice(s.row));
      ok = true;
    } else if (to.kind === 'column' && s.kind === 'free' && canCol(card, to.i)) {
      free[s.slot] = null;
      cols[to.i].push(card);
      ok = true;
    } else if (
      to.kind === 'foundation' &&
      canFound(card, to.i) &&
      ((s.kind === 'column' && s.row === cols[s.col].length - 1) || s.kind === 'free')
    ) {
      s.kind === 'column' ? cols[s.col].pop() : (free[s.slot] = null);
      founds[to.i].push(card);
      score += card.n === 1 ? 10 : 5;
      ok = true;
    }
    if (!ok) return false;
    selected = null;
    moves++;
    if (founds.every(p => p.length === 13)) {
      score += 500;
      const best = Math.max(gameBestV2(key), score);
      saveBest(key, best);
      $('fc-best').textContent = best;
      msg(`Complete in ${moves} moves · ${score} points`, true);
    }
    draw();
    return true;
  }
  function select(card, kind, a, b) {
    if (selected && move(kind === 'column' ? { kind: 'column', i: a } : { kind: 'foundation', i: a })) return;
    selected = kind === 'column' ? { card, kind, col: a, row: b } : { card, kind, slot: a };
    draw();
  }
  function auto() {
    for (let c = 0; c < cols.length; c++) {
      const card = cols[c].at(-1),
        i = suits.indexOf(card?.s);
      if (card && canFound(card, i)) {
        selected = { card, kind: 'column', col: c, row: cols[c].length - 1 };
        move({ kind: 'foundation', i });
        return;
      }
    }
    for (let i = 0; i < 4; i++) {
      const card = free[i],
        f = suits.indexOf(card?.s);
      if (card && canFound(card, f)) {
        selected = { card, kind: 'free', slot: i };
        move({ kind: 'foundation', i: f });
        return;
      }
    }
    msg('No safe auto-move found.');
  }
  function draw() {
    const fh = $('fc-free');
    fh.innerHTML = '';
    free.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'fc-slot';
      b.textContent = c ? label(c) : 'FREE';
      b.onclick = () => (c ? select(c, 'free', i) : move({ kind: 'free', i }));
      fh.appendChild(b);
    });
    const f = $('fc-found');
    f.innerHTML = '';
    founds.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'fc-slot foundation';
      b.textContent = p.at(-1) ? label(p.at(-1)) : suits[i];
      b.onclick = () => move({ kind: 'foundation', i });
      f.appendChild(b);
    });
    const th = $('fc-tableau');
    th.innerHTML = '';
    cols.forEach((p, c) => {
      const col = document.createElement('div');
      col.className = 'fc-column';
      p.forEach((card, i) => {
        const b = document.createElement('button');
        b.className = `fc-card up ${color(card)} ${selected?.card === card ? 'selected' : ''}`;
        b.textContent = label(card);
        b.style.top = `${i * 22}px`;
        b.onclick = () => select(card, 'column', c, i);
        col.appendChild(b);
      });
      const drop = document.createElement('button');
      drop.className = 'fc-drop';
      drop.textContent = 'K';
      drop.onclick = () => move({ kind: 'column', i: c });
      col.appendChild(drop);
      th.appendChild(col);
    });
    $('fc-score').textContent = score;
    $('fc-moves').textContent = moves;
  }
  t.on($('fc-new'), 'click', deal);
  t.on($('fc-auto'), 'click', auto);
  t.on(document, 'keydown', e => {
    if (e.key.toLowerCase() === 'a') auto();
  });
  deal();
}
function newSnake() {
  /* Snake on a 20 x 20 board. It waits for you: nothing moves until you
     press Start or an arrow key. Up to two turns are remembered between
     moves, so a quick "up, left" isn't lost, and the snake glides between
     squares rather than jumping. The edges wrap round. */
  const t = plusTools(),
    key = 'dejavu1.snake.best',
    N = 20,
    S = 24,
    W = N * S;
  plusStats([
    ['Score', 'sn-score'],
    ['Length', 'sn-length'],
    ['Best', 'sn-best', true, gameBestV2(key) || '—']
  ]);
  plusFrame(
    'Snake',
    "Arrow keys or WASD · swipe on a phone · P pauses · eat the apples, don't bite your own tail · the edges wrap round",
    `<div class="arcade-stage"><canvas id="sn-canvas" class="arcade-canvas" aria-label="Snake board"></canvas>
     <div class="game-overlay" id="sn-overlay"><div class="g-title">SNAKE</div><div class="g-sub">Each apple makes you longer and a little faster.</div><button class="btn primary" type="button">Start</button></div></div>
     <div class="arcade-pad" aria-label="Direction pad"><button class="btn" type="button" data-sn="up" aria-label="Up">▲</button><button class="btn" type="button" data-sn="left" aria-label="Left">◀</button><button class="btn" type="button" data-sn="down" aria-label="Down">▼</button><button class="btn" type="button" data-sn="right" aria-label="Right">▶</button></div>
     <div class="arcade-actions"><button class="btn" type="button" id="sn-pause">Pause</button><span id="sn-message" role="status">Press Start or an arrow key.</span></div>`,
    t
  );
  const canvas = $('sn-canvas'),
    ctx = canvas.getContext('2d'),
    dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = W * dpr;
  const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
  let snake,
    prev,
    dir,
    queue,
    food,
    score = 0,
    state = 'idle',
    paused = false,
    progress = 0,
    crash = 0;
  const same = (a, b) => a.x === b.x && a.y === b.y;
  const rate = () => Math.min(14, 7 + score * 0.35); // moves a second
  const place = () => {
    let p;
    do {
      p = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) };
    } while (snake.some(s => same(s, p)));
    return p;
  };
  const message = text => {
    $('sn-message').textContent = text;
  };
  const hud = () => {
    $('sn-score').textContent = score;
    $('sn-length').textContent = snake.length;
  };
  function reset() {
    snake = [
      { x: 10, y: 10 },
      { x: 9, y: 10 },
      { x: 8, y: 10 }
    ];
    prev = snake.map(s => ({ ...s }));
    dir = 'right';
    queue = [];
    score = 0;
    progress = 0;
    crash = 0;
    food = place();
    hud();
  }
  function start() {
    reset();
    state = 'play';
    paused = false;
    $('sn-overlay').style.display = 'none';
    $('sn-pause').textContent = 'Pause';
    message('Go!');
  }
  function over() {
    state = 'over';
    crash = 0;
    const best = Math.max(gameBestV2(key), score);
    saveBest(key, best);
    $('sn-best').textContent = best;
    const o = $('sn-overlay');
    o.style.display = '';
    o.innerHTML = `<div class="g-title">GAME OVER</div><div class="g-sub">${score} apple${score === 1 ? '' : 's'} · length ${snake.length}</div><button class="btn primary" type="button">Play again</button>`;
    message('You bit your tail.');
  }
  function pause(on) {
    if (state !== 'play') return;
    paused = on;
    $('sn-pause').textContent = on ? 'Resume' : 'Pause';
    message(on ? 'Paused.' : 'Go!');
  }
  function turn(d) {
    if (state !== 'play') {
      start();
    }
    if (paused) pause(false);
    const last = queue.length ? queue[queue.length - 1] : dir;
    if (d === last || (DIRS[d].x === -DIRS[last].x && DIRS[d].y === -DIRS[last].y)) return;
    if (queue.length < 2) queue.push(d);
  }
  function move() {
    if (queue.length) dir = queue.shift();
    const v = DIRS[dir],
      h = { x: (snake[0].x + v.x + N) % N, y: (snake[0].y + v.y + N) % N };
    const eats = same(h, food);
    // The tail moves out of the way this turn unless the snake is growing.
    const body = eats ? snake : snake.slice(0, -1);
    if (body.some(s => same(s, h))) {
      over();
      return;
    }
    prev = snake.map(s => ({ ...s }));
    snake.unshift(h);
    if (eats) {
      score++;
      food = place();
      prev.push({ ...prev[prev.length - 1] });
    } else snake.pop();
    hud();
  }
  function step() {
    if (state === 'play' && !paused) {
      progress += rate() / 60;
      while (progress >= 1 && state === 'play') {
        progress -= 1;
        move();
      }
    }
  }
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b1626';
    ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = 'rgba(255,255,255,.035)';
    for (let y = 0; y < N; y++) for (let x = y % 2; x < N; x += 2) ctx.fillRect(x * S, y * S, S, S);
    // Apple
    const fx = food.x * S + S / 2,
      fy = food.y * S + S / 2;
    ctx.fillStyle = '#ff5a4f';
    ctx.beginPath();
    ctx.arc(fx, fy + 1, S * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5fb35a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fx, fy - 5);
    ctx.quadraticCurveTo(fx + 3, fy - 10, fx + 6, fy - 10);
    ctx.stroke();
    const f = state === 'play' && !paused ? Math.min(1, progress) : 1;
    const at = i => {
      const a = prev[i] || snake[i],
        b = snake[i];
      if (Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1) return b;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    };
    for (let i = snake.length - 1; i >= 0; i--) {
      const p = at(i),
        shade = i === 0 ? '#c4f5a3' : `hsl(${135 - Math.min(40, i * 2)} 55% ${52 - Math.min(18, i)}%)`;
      ctx.fillStyle = state === 'over' && i === 0 ? '#ff7a6b' : shade;
      const pad = i === 0 ? 2 : 3;
      ctx.beginPath();
      ctx.roundRect
        ? ctx.roundRect(p.x * S + pad, p.y * S + pad, S - pad * 2, S - pad * 2, 6)
        : ctx.rect(p.x * S + pad, p.y * S + pad, S - pad * 2, S - pad * 2);
      ctx.fill();
    }
    const h = at(0),
      v = DIRS[dir];
    ctx.fillStyle = '#0b1626';
    [
      [-1, 1],
      [1, 1]
    ].forEach(([s]) => {
      const ex = h.x * S + S / 2 + v.x * 4 + (v.y ? s * 4 : 0),
        ey = h.y * S + S / 2 + v.y * 4 + (v.x ? s * 4 : 0);
      ctx.beginPath();
      ctx.arc(ex, ey, 2, 0, Math.PI * 2);
      ctx.fill();
    });
    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(0, 0, W, W);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, W / 2);
    }
  }
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
  t.on(document, 'keydown', e => {
    if ($('tab-games')?.hidden || e.target.closest?.('input,textarea,select')) return;
    if (KEYS[e.code]) {
      e.preventDefault();
      turn(KEYS[e.code]);
    } else if (e.code === 'KeyP' || e.code === 'Space') {
      e.preventDefault();
      if (state === 'play') pause(!paused);
      else start();
    }
  });
  document.querySelectorAll('[data-sn]').forEach(b =>
    t.on(b, 'pointerdown', e => {
      e.preventDefault();
      turn(b.dataset.sn);
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
    turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  });
  t.on($('sn-overlay'), 'click', e => {
    if (e.target.closest('button')) start();
  });
  t.on($('sn-pause'), 'click', () => {
    if (state === 'play') pause(!paused);
    else start();
  });
  t.on(document, 'visibilitychange', () => {
    if (document.hidden) pause(true);
  });
  t.on(window, 'blur', () => pause(true));
  reset();
  draw();
  t.every(step, 1000 / 60);
  t.every(draw, 0);
}
function new2048() {
  const t = plusTools(),
    key = 'dejavu1.2048.best';
  plusStats([
    ['Score', 'tw-score'],
    ['Best', 'tw-best', true, gameBestV2(key) || '—'],
    ['Goal', 'tw-goal', false, '2048']
  ]);
  plusFrame(
    '2048',
    'Arrow keys / swipe · combine equal tiles · reach 2048',
    `<div class="twenty-wrap"><div class="twenty-board" id="tw-board"></div><div class="twenty-actions"><button class="btn" id="tw-new">New game</button><button class="btn" id="tw-undo">Undo</button><span id="tw-message">Make your first move.</span></div></div>`,
    t
  );
  let board, score, previous, won, over, startPoint;
  const idx = (r, c) => r * 4 + c,
    add = () => {
      const p = board.map((v, i) => (v ? null : i)).filter(i => i !== null);
      if (p.length) {
        const i = p[Math.floor(Math.random() * p.length)];
        board[i] = Math.random() < 0.9 ? 2 : 4;
      }
    },
    line = a => {
      const v = a.filter(Boolean),
        o = [];
      for (let i = 0; i < v.length; i++) {
        if (v[i] === v[i + 1]) {
          o.push(v[i] * 2);
          score += v[i] * 2;
          i++;
        } else o.push(v[i]);
      }
      return o.concat([0, 0, 0, 0]).slice(0, 4);
    };
  function fresh() {
    board = Array(16).fill(0);
    score = 0;
    previous = null;
    won = over = false;
    add();
    add();
    draw();
  }
  function move(d) {
    if (over) return;
    const before = board.slice(),
      old = score,
      out = Array(16).fill(0);
    for (let r = 0; r < 4; r++) {
      let a = d === 'up' || d === 'down' ? [0, 1, 2, 3].map(c => board[idx(c, r)]) : board.slice(r * 4, r * 4 + 4);
      if (d === 'right' || d === 'down') a.reverse();
      a = line(a);
      if (d === 'left' || d === 'right') a.forEach((v, c) => (out[idx(r, d === 'left' ? c : 3 - c)] = v));
      else a.forEach((v, c) => (out[idx(d === 'up' ? c : 3 - c, r)] = v));
    }
    if (out.every((v, i) => v === before[i])) {
      score = old;
      return;
    }
    previous = { board: before, score: old, won, over };
    board = out;
    add();
    if (board.some(v => v >= 2048) && !won) {
      won = true;
      $('tw-message').textContent = '2048 reached. Keep going.';
    }
    if (
      board.every(Boolean) &&
      !board.some((v, i) => {
        const r = Math.floor(i / 4),
          c = i % 4;
        return (c < 3 && v === board[i + 1]) || (r < 3 && v === board[i + 4]);
      })
    ) {
      over = true;
      const best = Math.max(gameBestV2(key), score);
      saveBest(key, best);
      $('tw-best').textContent = best;
      $('tw-message').textContent = 'No moves left. Start a new board.';
    }
    draw();
  }
  function draw() {
    const h = $('tw-board');
    h.innerHTML = '';
    board.forEach(v => {
      const e = document.createElement('div');
      e.className = `tw-tile t${v ? Math.min(15, Math.log2(v)) : 0}`;
      e.textContent = v || '';
      h.appendChild(e);
    });
    $('tw-score').textContent = score;
  }
  t.on(document, 'keydown', e => {
    const d = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key];
    if (d) {
      e.preventDefault();
      move(d);
    }
  });
  t.on($('tw-new'), 'click', fresh);
  t.on($('tw-undo'), 'click', () => {
    if (previous) {
      board = previous.board;
      score = previous.score;
      won = previous.won;
      over = previous.over;
      previous = null;
      $('tw-message').textContent = 'Move undone.';
      draw();
    }
  });
  t.on($('tw-board'), 'pointerdown', e => {
    startPoint = { x: e.clientX, y: e.clientY };
  });
  t.on($('tw-board'), 'pointerup', e => {
    if (!startPoint) return;
    const dx = e.clientX - startPoint.x,
      dy = e.clientY - startPoint.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 20)
      move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
    startPoint = null;
  });
  t.on(document, 'pointercancel', () => {
    startPoint = null;
  });
  fresh();
}
function newSmartPong() {
  const t = plusTools(),
    key = 'dejavu1.pong.smart.best',
    W = 760,
    H = 420,
    host = $('game-host');
  plusStats([
    ['You', 'sp-you'],
    ['CPU', 'sp-cpu'],
    ['Rally', 'sp-rally'],
    ['Best', 'sp-best', true, gameBestV2(key) || '—']
  ]);
  plusFrame(
    'Pong',
    'Move with mouse, touch, or ↑↓ · first to 7 · edge hits create sharper angles',
    `<div class="smart-pong"><canvas id="sp-canvas" class="arcade-canvas" width="760" height="420"></canvas><div class="pong-pad"><button class="btn" data-pong="up">▲</button><button class="btn" data-pong="down">▼</button></div><div class="game-overlay" id="sp-overlay"><div class="g-title">PONG</div><div class="g-sub">The CPU reads the ball, but its reaction window gets shorter as the rally grows.</div><button class="btn primary">Serve</button></div></div>`,
    t
  );
  const c = $('sp-canvas'),
    x = c.getContext('2d');
  let py = H / 2 - 46,
    ay = py,
    ball,
    you = 0,
    cpu = 0,
    rally = 0,
    run = false,
    timer,
    keys = {};
  const reset = () => {
    py = H / 2 - 46;
    ay = py;
    ball = { x: W / 2, y: H / 2, vx: 5, vy: (Math.random() - 0.5) * 4 };
    you = cpu = rally = 0;
    run = true;
    $('sp-overlay').style.display = 'none';
    clearInterval(timer);
    timer = t.every(tick, 16);
    draw();
  };
  const predictY = () => {
    if (!ball || ball.vx <= 0) return H / 2;
    const targetX = W - 42,
      travel = Math.max(0, (targetX - ball.x) / ball.vx),
      top = 9,
      bottom = H - 9,
      span = bottom - top,
      period = span * 2;
    let projected = ball.y + ball.vy * travel;
    const folded = (((projected - top) % period) + period) % period;
    return folded <= span ? top + folded : bottom - (folded - span);
  };
  const chooseTarget = () => {
    if (!ball || ball.vx <= 0) return H / 2 - 46;
    const intercept = predictY(),
      edgeBias = Math.max(-1, Math.min(1, ball.vy / 6)) * Math.min(18, rally * 0.7),
      rallyRead = Math.min(14, rally * 0.35),
      noise = (Math.random() - 0.5) * Math.max(1.2, 4.5 - rally * 0.12);
    return intercept - 46 + edgeBias + rallyRead + noise;
  };
  const serve = d => {
    ball = { x: W / 2, y: H / 2, vx: d * (5 + Math.min(3, rally * 0.12)), vy: (Math.random() - 0.5) * 4 };
  };
  function point(won) {
    won ? you++ : cpu++;
    rally = 0;
    if (you >= 7 || cpu >= 7) {
      run = false;
      clearInterval(timer);
      const best = Math.max(gameBestV2(key), you);
      saveBest(key, best);
      $('sp-best').textContent = best;
      $('sp-overlay').innerHTML =
        `<div class="g-title">${you > cpu ? 'MATCH WON' : 'MATCH LOST'}</div><div class="g-sub">${you} - ${cpu}</div><button class="btn primary">Rematch</button>`;
      $('sp-overlay').style.display = 'flex';
    } else serve(won ? 1 : -1);
  }
  function steer(e) {
    const r = c.getBoundingClientRect();
    py = Math.max(0, Math.min(H - 92, ((e.clientY - r.top) / r.height) * H - 46));
  }
  function tick() {
    if (!run) return;
    if (keys.ArrowUp || keys.KeyW) py = Math.max(0, py - 6);
    if (keys.ArrowDown || keys.KeyS) py = Math.min(H - 92, py + 6);
    ball.x += ball.vx;
    ball.y += ball.vy;
    if (ball.y < 9 || ball.y > H - 9) {
      ball.y = Math.max(9, Math.min(H - 9, ball.y));
      ball.vy *= -1;
    }
    const target = ball.vx > 0 ? chooseTarget() : H / 2 - 46;
    const closing = Math.max(0, Math.min(1, (W - 150 - ball.x) / Math.max(1, W - 150)));
    const reaction = Math.min(0.24, 0.13 + rally * 0.002 + closing * 0.045);
    const maxStep = 5.2 + Math.min(2.4, rally * 0.08);
    const error = Math.max(0.025, 0.18 - rally * 0.004);
    const delta = target - ay;
    ay += Math.max(-maxStep, Math.min(maxStep, delta)) * reaction + (Math.random() - 0.5) * error;
    ay = Math.max(0, Math.min(H - 92, ay));
    if (ball.x < 42 && ball.x > 22 && ball.y > py - 8 && ball.y < py + 100 && ball.vx < 0) {
      ball.x = 42;
      const hit = (ball.y - (py + 46)) / 46;
      ball.vx = Math.min(11, Math.abs(ball.vx) * 1.04);
      ball.vy = hit * 5.7;
      rally++;
    }
    if (ball.x > W - 42 && ball.x < W - 22 && ball.y > ay - 8 && ball.y < ay + 100 && ball.vx > 0) {
      ball.x = W - 42;
      const hit = (ball.y - (ay + 46)) / 46;
      ball.vx = -Math.min(11, Math.abs(ball.vx) * 1.04);
      ball.vy = hit * 5.7;
      rally++;
    }
    if (ball.x < -20) point(false);
    if (ball.x > W + 20) point(true);
    draw();
  }
  function draw() {
    x.fillStyle = '#101827';
    x.fillRect(0, 0, W, H);
    x.setLineDash([8, 12]);
    x.strokeStyle = 'rgba(255,255,255,.16)';
    x.beginPath();
    x.moveTo(W / 2, 0);
    x.lineTo(W / 2, H);
    x.stroke();
    x.setLineDash([]);
    x.fillStyle = '#f7fbff';
    x.fillRect(22, py, 16, 92);
    x.fillStyle = '#ff9c66';
    x.fillRect(W - 38, ay, 16, 92);
    x.fillStyle = '#ffe69b';
    x.beginPath();
    x.arc(ball?.x || W / 2, ball?.y || H / 2, 8, 0, 7);
    x.fill();
    $('sp-you').textContent = you;
    $('sp-cpu').textContent = cpu;
    $('sp-rally').textContent = rally;
  }
  t.on(c, 'pointermove', steer);
  t.on(c, 'pointerdown', e => {
    steer(e);
    if (!run) reset();
  });
  t.on(document, 'keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS'].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
  });
  t.on(document, 'keyup', e => {
    keys[e.code] = false;
  });
  t.on(host.querySelector('.game-overlay button'), 'click', reset);
  document.querySelectorAll('[data-pong]').forEach(b =>
    t.on(b, 'pointerdown', () => {
      keys[b.dataset.pong === 'up' ? 'ArrowUp' : 'ArrowDown'] = true;
    })
  );
  document.querySelectorAll('[data-pong]').forEach(b =>
    t.on(b, 'pointerup', () => {
      keys[b.dataset.pong === 'up' ? 'ArrowUp' : 'ArrowDown'] = false;
    })
  );
  t.on(document, 'pointerup', () => {
    keys.ArrowUp = false;
    keys.ArrowDown = false;
  });
  t.on(document, 'pointercancel', () => {
    keys.ArrowUp = false;
    keys.ArrowDown = false;
  });
  reset();
}