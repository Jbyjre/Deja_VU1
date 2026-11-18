/* Deja Vu1 arcade, part 2 of 7: the first Pac-Man, Blackjack and the first Breakout.
 * Loaded right after games.js by app.js loadGames(); the parts share one global scope.
 */
function newPacmanLegacy() {
  const t = plusTools(),
    key = 'dejavu1.pacman.smart.best',
    map = [
      '###################',
      '#........#........#',
      '#.###.###.#.###.###',
      '#o###.###.#.###.##o',
      '#.................#',
      '#.###.#.#####.#.###',
      '#.....#...#...#...#',
      '#####.# ## ## #.#####',
      '#........#........#',
      '#####.# ## ## #.#####',
      '#.........#.........#',
      '#.###.#.#####.#.###',
      '#o..#.....#.....#..o#',
      '###.#.#.#####.#.#.###',
      '#.....#...#...#.....#',
      '#.######## ########.#',
      '###################'
    ];
  const rows = map.length,
    cols = 21,
    cell = 27,
    W = 567,
    H = 459;
  plusStats([
    ['Score', 'pp-score'],
    ['Lives', 'pp-lives'],
    ['Level', 'pp-level'],
    ['Best', 'pp-best', true, gameBestV2(key) || '—']
  ]);
  plusFrame(
    'Pac-Man',
    'WASD / arrows · use the arrow pad · eat dots, then hunt frightened ghosts',
    `<div class="pac-wrap"><canvas id="pp-canvas" class="arcade-canvas" width="570" height="510"></canvas><div class="pac-pad"><button class="btn" data-pac="up">▲</button><button class="btn" data-pac="left">◀</button><button class="btn" data-pac="down">▼</button><button class="btn" data-pac="right">▶</button></div><div class="game-overlay" id="pp-overlay"><div class="g-title">PAC-MAN</div><div class="g-sub">Four ghosts use different chase targets. Power pellets reverse the hunt.</div><button class="btn primary">Start chase</button></div></div>`,
    t
  );
  const c = $('pp-canvas'),
    x = c.getContext('2d'),
    dirs = { left: [0, -1], right: [0, 1], up: [-1, 0], down: [1, 0] };
  let grid,
    player,
    ghosts,
    score,
    lives,
    level,
    power,
    run,
    timer,
    wanted = 'left';
  const walk = (r, col) => r >= 0 && r < rows && col >= 0 && col < cols && map[r][col] !== '#';
  const neigh = (r, col) => ['up', 'left', 'down', 'right'].filter(d => walk(r + dirs[d][0], col + dirs[d][1]));
  const reset = () => {
    grid = map.map(row => row.split('').map(ch => (ch === '.' || ch === 'o' ? ch : null)));
    player = { r: 10, c: 1, dir: 'left' };
    ghosts = [
      { r: 8, c: 1, dir: 'left', color: '#ef5350', mode: 'blinky' },
      { r: 8, c: 2, dir: 'right', color: '#f6a6d5', mode: 'pinky' },
      { r: 8, c: 3, dir: 'up', color: '#55ddea', mode: 'inky' },
      { r: 10, c: 17, dir: 'left', color: '#ffb05a', mode: 'clyde' }
    ];
    score = 0;
    lives = 3;
    level = 1;
    power = 0;
    run = true;
    $('pp-overlay').style.display = 'none';
    clearInterval(timer);
    timer = t.every(tick, 135);
    draw();
  };
  const targetFor = g =>
    g.mode === 'blinky'
      ? player
      : g.mode === 'pinky'
        ? { r: player.r + dirs[player.dir][0] * 4, c: player.c + dirs[player.dir][1] * 4 }
        : g.mode === 'inky'
          ? { r: player.r + dirs[player.dir][0] * 2, c: player.c + dirs[player.dir][1] * 2 }
          : { r: Math.abs(g.r - player.r) + Math.abs(g.c - player.c) > 7 ? player : { r: 0, c: 0 } };
  const nextStep = (g, target) => {
    const q = [{ r: g.r, c: g.c }],
      seen = new Set([`${g.r},${g.c}`]),
      prev = new Map();
    while (q.length) {
      const p = q.shift();
      if (p.r === target.r && p.c === target.c) break;
      neigh(p.r, p.c).forEach(d => {
        const n = { r: p.r + dirs[d][0], c: p.c + dirs[d][1] },
          k = `${n.r},${n.c}`;
        if (!seen.has(k)) {
          seen.add(k);
          prev.set(k, { p, d });
          q.push(n);
        }
      });
    }
    let cur = { r: Math.max(0, Math.min(rows - 1, target.r)), c: Math.max(0, Math.min(cols - 1, target.c)) };
    while (prev.has(`${cur.r},${cur.c}`)) {
      const z = prev.get(`${cur.r},${cur.c}`);
      if (z.p.r === g.r && z.p.c === g.c) return z.d;
      cur = z.p;
    }
    return g.dir;
  };
  function tick() {
    if (!run) return;
    const pd = wanted;
    if (walk(player.r + dirs[pd][0], player.c + dirs[pd][1])) player.dir = pd;
    if (walk(player.r + dirs[player.dir][0], player.c + dirs[player.dir][1])) {
      player.r += dirs[player.dir][0];
      player.c += dirs[player.dir][1];
    }
    const dot = grid[player.r][player.c];
    if (dot) {
      grid[player.r][player.c] = null;
      score += dot === 'o' ? 50 : 10;
      if (dot === 'o') power = 55;
    }
    ghosts.forEach(g => {
      if (power) {
        const choices = neigh(g.r, g.c);
        g.dir = choices[Math.floor(Math.random() * choices.length)] || g.dir;
      } else g.dir = nextStep(g, targetFor(g));
      if (walk(g.r + dirs[g.dir][0], g.c + dirs[g.dir][1])) {
        g.r += dirs[g.dir][0];
        g.c += dirs[g.dir][1];
      }
      if (g.r === player.r && g.c === player.c) {
        if (power) {
          score += 200;
          g.r = 8;
          g.c = 1;
        } else {
          lives--;
          player = { r: 10, c: 1, dir: 'left' };
          ghosts.forEach((h, i) => {
            h.r = 8;
            h.c = 1 + i;
          });
          if (!lives) {
            run = false;
            clearInterval(timer);
            const best = Math.max(gameBestV2(key), score);
            saveBest(key, best);
            $('pp-best').textContent = best;
            $('pp-overlay').innerHTML =
              `<div class="g-title">GAME OVER</div><div class="g-sub">${score} points · level ${level}</div><button class="btn primary">Try again</button>`;
            $('pp-overlay').style.display = 'flex';
          }
        }
      }
    });
    if (power) power--;
    if (!grid.flat().some(Boolean)) {
      level++;
      grid = map.map(row => row.split('').map(ch => (ch === '.' || ch === 'o' ? ch : null)));
      player = { r: 10, c: 1, dir: 'left' };
      ghosts.forEach((g, i) => {
        g.r = 8;
        g.c = 1 + i;
      });
    }
    draw();
  }
  function draw() {
    x.fillStyle = '#070d1a';
    x.fillRect(0, 0, W, H);
    for (let r = 0; r < rows; r++)
      for (let col = 0; col < cols; col++) {
        if (map[r][col] === '#') {
          x.fillStyle = '#2349ad';
          x.fillRect(col * cell + 2, r * cell + 2, cell - 4, cell - 4);
        }
        const v = grid?.[r]?.[col];
        if (v) {
          x.fillStyle = v === 'o' ? '#ffdb70' : '#f3e7c5';
          x.beginPath();
          x.arc(col * cell + 15, r * cell + 15, v === 'o' ? 7 : 2, 0, 7);
          x.fill();
        }
      }
    const p = player || { r: 14, c: 9 };
    x.fillStyle = '#ffd447';
    x.beginPath();
    x.arc(p.c * cell + 15, p.r * cell + 15, 11, 0, 7);
    x.fill();
    ghosts?.forEach(g => {
      x.fillStyle = power ? '#7190ff' : g.color;
      x.beginPath();
      x.arc(g.c * cell + 15, g.r * cell + 15, 11, Math.PI, 0);
      x.lineTo(g.c * cell + 26, g.r * cell + 25);
      x.lineTo(g.c * cell + 20, g.r * cell + 20);
      x.lineTo(g.c * cell + 15, g.r * cell + 25);
      x.lineTo(g.c * cell + 10, g.r * cell + 20);
      x.lineTo(g.c * cell + 4, g.r * cell + 25);
      x.closePath();
      x.fill();
    });
    $('pp-score').textContent = score;
    $('pp-lives').textContent = lives;
    $('pp-level').textContent = level;
  }
  t.on(document, 'keydown', e => {
    const d = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      KeyW: 'up',
      KeyS: 'down',
      KeyA: 'left',
      KeyD: 'right'
    }[e.code];
    if (d) {
      e.preventDefault();
      wanted = d;
    }
  });
  document.querySelectorAll('[data-pac]').forEach(b =>
    t.on(b, 'pointerdown', () => {
      wanted = b.dataset.pac;
    })
  );
  t.on(c, 'pointerdown', () => {
    if (!run) reset();
  });
  t.on($('pp-overlay button'), 'click', reset);
  reset();
}
function newBlackjack() {
  const t = plusTools(),
    key = 'dejavu1.blackjack.best',
    suits = ['♠', '♥', '♦', '♣'],
    ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  plusStats([
    ['Bankroll', 'bj-bank'],
    ['Shoe', 'bj-shoe'],
    ['Wins', 'bj-wins'],
    ['Best', 'bj-best', true, gameBestV2(key) || '—']
  ]);
  plusFrame(
    'Blackjack',
    'H hit · S stand · D double · P basic-strategy hint · dealer stands on soft 17',
    `<div class="blackjack"><div class="bj-table"><div class="bj-hand"><b>DEALER</b><div id="bj-dealer"></div></div><div class="bj-message" id="bj-message">Place your hand.</div><div class="bj-hand"><b>PLAYER</b><div id="bj-player"></div></div></div><div class="bj-controls"><button class="btn primary" id="bj-deal">Deal</button><button class="btn" id="bj-hit">Hit</button><button class="btn" id="bj-stand">Stand</button><button class="btn" id="bj-double">Double</button><button class="btn" id="bj-hint">Hint</button></div></div>`,
    t
  );
  let shoe,
    hand = [],
    dealer = [],
    bank = 100,
    wins = 0,
    wager = 10,
    active = false,
    doubled = false;
  const card = () => {
    if (shoe.length < 24) shoe = freshShoe();
    return shoe.pop();
  };
  const newShoe = () => suits.flatMap(s => ranks.map((r, i) => ({ s, r, n: Math.min(i + 1, 10), ace: i === 0 })));
  const shuffle = a => {
    for (let i = a.length - 1; i; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const freshShoe = () => shuffle(Array.from({ length: 6 }, () => newShoe()).flat());
  const value = h => {
    let total = h.reduce((n, c) => n + c.n, 0),
      aces = h.filter(c => c.ace).length;
    while (aces && total + 10 <= 21) {
      total += 10;
      aces--;
    }
    return { total, soft: aces > 0 };
  };
  const face = c => c.r + c.s;
  const message = (m, good) => {
    $('bj-message').textContent = m;
    $('bj-message').classList.toggle('good', !!good);
  };
  function draw(hole = true) {
    $('bj-player').innerHTML = hand
      .map(c => `<span class="bj-card ${c.s === '♥' || c.s === '♦' ? 'red' : ''}">${face(c)}</span>`)
      .join('');
    $('bj-dealer').innerHTML = dealer
      .map(
        (c, i) =>
          `<span class="bj-card ${i === 1 && hole ? 'hidden-card' : ' '}">${i === 1 && hole ? '?' : face(c)}</span>`
      )
      .join('');
    $('bj-bank').textContent = bank;
    $('bj-wins').textContent = wins;
    $('bj-shoe').textContent = shoe.length;
  }
  function finish() {
    active = false;
    const p = value(hand).total,
      d = value(dealer).total,
      pbj = p === 21 && hand.length === 2,
      dbj = d === 21 && dealer.length === 2;
    if (p > 21) {
      bank -= wager;
      message('Bust. Dealer wins.');
    } else if (pbj && !dbj) {
      bank += wager * 1.5;
      wins++;
      message('Blackjack, paid 3:2!', true);
    } else if (dbj && !pbj) {
      bank -= wager;
      message('Dealer blackjack.');
    } else if (d > 21 || p > d) {
      bank += wager;
      wins++;
      message('You win.', true);
    } else if (p === d) {
      message('Push, your wager returns.');
    } else {
      bank -= wager;
      message('Dealer wins.');
    }
    draw(false);
    const best = Math.max(gameBestV2(key), bank);
    saveBest(key, best);
    $('bj-best').textContent = best;
  }
  function dealerTurn() {
    while (value(dealer).total < 17) dealer.push(card());
    finish();
  }
  function deal() {
    if (bank <= 0) {
      bank = 100;
      message('Bankroll reset for a new shoe.');
    }
    wager = 10;
    shoe = shoe?.length > 24 ? shoe : freshShoe();
    hand = [card(), card()];
    dealer = [card(), card()];
    doubled = false;
    active = true;
    if (value(hand).total === 21) {
      message('Blackjack, dealer check.');
      dealerTurn();
    } else {
      message('Your move: hit, stand, or double.');
    }
    draw();
  }
  function hit() {
    if (!active) return;
    hand.push(card());
    if (value(hand).total > 21) finish();
    else if (value(hand).total === 21) dealerTurn();
    else draw();
  }
  function stand() {
    if (active) dealerTurn();
  }
  function dbl() {
    if (!active || hand.length !== 2 || bank < wager) return;
    wager *= 2;
    doubled = true;
    hit();
  }
  function hint() {
    if (!active) return;
    const v = value(hand).total,
      up = dealer[0].n;
    if (v <= 11) message('Basic strategy: hit.');
    else if (v >= 17) message('Basic strategy: stand.');
    else if (v === 12 && up >= 4 && up <= 6) message('Basic strategy: stand against a weak up-card.');
    else message(up >= 7 ? 'Basic strategy: hit.' : 'Basic strategy: stand.');
  }
  t.on($('bj-deal'), 'click', deal);
  t.on($('bj-hit'), 'click', hit);
  t.on($('bj-stand'), 'click', stand);
  t.on($('bj-double'), 'click', dbl);
  t.on($('bj-hint'), 'click', hint);
  t.on(document, 'keydown', e => {
    if (e.key.toLowerCase() === 'h') hit();
    if (e.key.toLowerCase() === 's') stand();
    if (e.key.toLowerCase() === 'd') dbl();
    if (e.key.toLowerCase() === 'p') hint();
  });
  shoe = freshShoe();
  draw();
}
function newBreakoutLegacy() {
  const t = plusTools(),
    key = 'dejavu1.breakout.doodle.best',
    W = 640,
    H = 430;
  plusStats([
    ['Score', 'db-score'],
    ['Level', 'db-level'],
    ['Lives', 'db-lives'],
    ['Best', 'db-best', true, gameBestV2(key) || '—']
  ]);
  plusFrame(
    'Brick Break',
    'Mouse, touch, or ←→ paddle · angle the rebound · catch powerups and build a combo',
    `<div class="doodle-break"><canvas id="db-canvas" class="arcade-canvas" width="640" height="430"></canvas><div class="game-overlay" id="db-overlay"><div class="g-title">BRICK BREAK</div><div class="g-sub">A bright, fast doodle-style breakout. Clear the pattern before you run out of lives.</div><button class="btn primary">Launch</button></div></div>`,
    t
  );
  const c = $('db-canvas'),
    x = c.getContext('2d');
  let paddle = 260,
    balls,
    bricks,
    powers,
    score,
    level,
    lives,
    combo,
    run,
    timer,
    keys = {},
    pointer = 320;
  const colors = ['#ff7a2f', '#ffcc66', '#65c9ff', '#77d68a', '#e36bff'];
  function setup() {
    bricks = [];
    const rows = Math.min(4 + level, 8);
    for (let r = 0; r < rows; r++)
      for (let col = 0; col < 10; col++)
        bricks.push({
          x: 18 + col * 61,
          y: 36 + r * 23,
          w: 55,
          h: 17,
          hp: r + level > 7 && col % 3 === 0 ? 2 : 1,
          max: 1
        });
    balls = [{ x: W / 2, y: H - 62, vx: 3.2 + level * 0.2, vy: -4.6 - level * 0.18, r: 7 }];
    powers = [];
    combo = 0;
  }
  function start() {
    score = 0;
    level = 1;
    lives = 3;
    run = true;
    $('db-overlay').style.display = 'none';
    setup();
    clearInterval(timer);
    timer = t.every(tick, 16);
    draw();
  }
  function hit() {
    lives--;
    combo = 0;
    if (lives) {
      balls = [{ x: W / 2, y: H - 62, vx: 3.2 + level * 0.2, vy: -4.6 - level * 0.18, r: 7 }];
    } else {
      run = false;
      clearInterval(timer);
      const best = Math.max(gameBestV2(key), score);
      saveBest(key, best);
      $('db-best').textContent = best;
      $('db-overlay').innerHTML =
        `<div class="g-title">RUN OVER</div><div class="g-sub">${score} points · level ${level}</div><button class="btn primary">Play again</button>`;
      $('db-overlay').style.display = 'flex';
    }
  }
  function tick() {
    if (!run) return;
    const pw = level > 3 ? 76 : 94;
    if (keys.ArrowLeft || keys.KeyA) paddle = Math.max(paddle - 8, 0);
    if (keys.ArrowRight || keys.KeyD) paddle = Math.min(paddle + 8, W - pw);
    paddle = Math.max(0, Math.min(W - pw, pointer - pw / 2));
    balls.forEach(b => {
      b.x += b.vx;
      b.y += b.vy;
      if (b.x < b.r || b.x > W - b.r) {
        b.vx *= -1;
        b.x = Math.max(b.r, Math.min(W - b.r, b.x));
      }
      if (b.y < b.r) b.vy = Math.abs(b.vy);
      if (b.vy > 0 && b.y + b.r > H - 34 && b.y < H - 18 && b.x > paddle && b.x < paddle + pw) {
        const hit = (b.x - (paddle + pw / 2)) / (pw / 2);
        b.vx = hit * 6;
        b.vy = -Math.max(4, Math.hypot(b.vx, b.vy));
        combo++;
      }
      for (const br of bricks) {
        if (!br.hp || b.x + b.r < br.x || b.x - b.r > br.x + br.w || b.y + b.r < br.y || b.y - b.r > br.y + br.h)
          continue;
        br.hp--;
        b.vy *= -1;
        score += br.hp ? 5 : 10 + combo * 2;
        if (!br.hp && Math.random() < 0.18)
          powers.push({ x: br.x + br.w / 2, y: br.y, kind: Math.random() < 0.5 ? 'wide' : 'multi' });
        break;
      }
    });
    powers.forEach(p => (p.y += 2));
    powers = powers.filter(p => {
      if (p.y > H - 42 && p.x > paddle - 8 && p.x < paddle + pw + 8) {
        if (p.kind === 'wide') paddle = Math.max(0, paddle - 20);
        else if (balls.length < 3) balls.push({ ...balls[0], vx: -balls[0].vx });
        return false;
      }
      return p.y < H + 20;
    });
    if (balls.some(b => b.y > H + 20)) {
      balls = balls.filter(b => b.y <= H + 20);
      if (!balls.length) hit();
    }
    if (bricks.every(b => !b.hp)) {
      level++;
      const best = Math.max(gameBestV2(key), level);
      saveBest(key, best);
      $('db-best').textContent = best;
      setup();
    }
    draw();
  }
  function draw() {
    x.fillStyle = '#101c35';
    x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(255,255,255,.08)';
    for (let i = 0; i < 70; i++) x.fillRect((i * 97) % W, (i * 53) % H, 2, 2);
    bricks?.forEach(b => {
      if (!b.hp) return;
      x.fillStyle = colors[(Math.floor(b.y / 23) + Math.floor(b.x / 61)) % colors.length];
      x.fillRect(b.x, b.y, b.w, b.h);
      if (b.hp > 1) {
        x.strokeStyle = '#fff';
        x.strokeRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
      }
    });
    powers?.forEach(p => {
      x.fillStyle = p.kind === 'wide' ? '#5cc16f' : '#65c9ff';
      x.beginPath();
      x.arc(p.x, p.y, 10, 0, 7);
      x.fill();
      x.fillStyle = '#102';
      x.fillText(p.kind === 'wide' ? 'W' : 'M', p.x - 4, p.y + 4);
    });
    x.fillStyle = '#fff';
    x.fillRect(paddle, H - 25, level > 3 ? 76 : 94, 12);
    balls?.forEach(b => {
      x.fillStyle = '#ffe69b';
      x.beginPath();
      x.arc(b.x, b.y, b.r, 0, 7);
      x.fill();
    });
    $('db-score').textContent = score;
    $('db-level').textContent = level;
    $('db-lives').textContent = lives;
  }
  t.on(c, 'pointermove', e => {
    const r = c.getBoundingClientRect();
    pointer = ((e.clientX - r.left) / r.width) * W;
  });
  t.on(c, 'pointerdown', () => {
    if (!run) start();
  });
  t.on(document, 'keydown', e => {
    if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
  });
  t.on(document, 'keyup', e => {
    keys[e.code] = false;
  });
  t.on($('db-overlay button'), 'click', start);
  start();
}
