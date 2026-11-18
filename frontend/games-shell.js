/* Deja Vu1 arcade, part 4 of 7: the arcade shell and picker, Asteroids, Pong and Minesweeper.
 * Loaded right after games-arcade.js by app.js loadGames(); the parts share one global scope.
 */
/* ==========================================================================
   While You Wait: six fresh offline arcade games

   Rebuilt from the rules of Asteroids, Pong, Minesweeper, Guideline Tetris,
   Pac-Man, and Klondike. This section owns every game timer and listener;
   it never reads printer state and never calls the network.
   ========================================================================== */
let activeGame = null;
let gameStop = () => {};
const gameBest = key => {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch (_) {
    return 0;
  }
};
const setGameBest = (key, value) => {
  try {
    localStorage.setItem(key, String(value));
  } catch (_) {}
};
function gameTools() {
  const clean = [],
    timers = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    clean.push(() => target.removeEventListener(type, fn, opts));
  };
  const every = (fn, ms) => {
    const id = frameEvery(fn, ms);
    timers.push(id);
    return id;
  };
  const later = (fn, ms) => {
    const id = setTimeout(fn, ms);
    timers.push(id);
    return id;
  };
  gameStop = () => {
    clean.splice(0).forEach(fn => fn());
    timers.splice(0).forEach(clearTimeout);
    gameStop = () => {};
  };
  return { on, every, later };
}
function gameFrame(title, help, content) {
  return `<div class="arcade-frame"><div class="arcade-head"><div><b>${title}</b><span>${help}</span></div></div>${content}</div>`;
}
function gameStats(html) {
  $('game-stats').innerHTML = html;
}
function gameFull(host, tools) {
  const button = document.createElement('button');
  button.className = 'btn small arcade-full';
  button.type = 'button';
  button.textContent = '⛶ Fullscreen';
  tools.on(button, 'click', () => {
    const frame = host.querySelector('.arcade-frame');
    if (document.fullscreenElement) document.exitFullscreen?.().catch?.(() => {});
    else frame?.requestFullscreen?.().catch?.(() => {});
  });
  tools.on(document, 'fullscreenchange', () => {
    button.textContent = document.fullscreenElement ? '× Exit fullscreen' : '⛶ Fullscreen';
  });
  host.querySelector('.arcade-head').appendChild(button);
}
function gameCanvas(host, id, width, height) {
  const canvas = host.querySelector(`#${id}`);
  canvas.width = width;
  canvas.height = height;
  return [canvas, canvas.getContext('2d')];
}
function stopCurrentGame() {
  gameStop();
  activeGame = null;
}
function renderGame(name) {
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
}
function startCurrentGame() {
  const button = document.querySelector('#game-picker button.active');
  renderGame(button?.dataset.game || 'asteroids');
}
function initGames() {
  document.querySelectorAll('#game-picker button').forEach(button =>
    button.addEventListener('click', () => {
      document
        .querySelectorAll('#game-picker button')
        .forEach(item => item.classList.toggle('active', item === button));
      renderGame(button.dataset.game);
    })
  );
}
function arcadeShell(host, title, help, body, stats, tools) {
  gameStats(stats);
  host.innerHTML = gameFrame(title, help, body);
  gameFull(host, tools);
}

function newAsteroids() {
  const tools = gameTools(),
    key = 'dejavu1.asteroids.best',
    W = 760,
    H = 440,
    host = $('game-host');
  /* Classic-fidelity pass, tuned against the 1979 arcade original: all-large
     waves (4, 6, 8, 10, capped at 11), large -> medium -> small splitting,
     20/50/100 scoring with an extra ship every 10,000, big and small saucers
     whose aim sharpens as the score climbs, a hyperspace that can kill you,
     a respawn that waits for a clear center, and touch pads for mobile. */
  arcadeShell(
    host,
    'Asteroids',
    'Rotate with the arrows, thrust, and shoot · H hyperspaces at a risk · saucers hunt you as you score',
    '<canvas id="arcade-asteroids" class="arcade-canvas" aria-label="Asteroids"></canvas><div class="pong-pad"><button class="btn" data-ast="ccw">↺</button><button class="btn" data-ast="fire">◉</button><button class="btn" data-ast="cw">↻</button><button class="btn" data-ast="thrust">▲</button><button class="btn" data-ast="hyper">H</button></div><div class="arcade-overlay" id="asteroids-overlay"><b>ASTEROIDS</b><span>Momentum, wraparound, splitting rocks, and saucers that learn your position.</span><button class="btn primary">Launch</button></div>',
    `<div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="as-score">0</div></div><div class="game-stat"><div class="g-key">Ships</div><div class="g-val" id="as-lives">3</div></div><div class="game-stat"><div class="g-key">Wave</div><div class="g-val" id="as-wave">1</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="as-best">${gameBest(key) || '—'}</div></div>`,
    tools
  );
  const [canvas, ctx] = gameCanvas(host, 'arcade-asteroids', W, H);
  let ship = null,
    rocks = [],
    shots = [],
    sparks = [],
    saucer = null,
    saucerTimer = null,
    score = 0,
    lives = 3,
    wave = 1,
    nextExtra = 10000,
    playing = false,
    loop = null,
    respawnWait = 0;
  const keys = {};
  const wrap = o => {
    o.x = (o.x + W) % W;
    o.y = (o.y + H) % H;
  };
  const makeRock = (x, y, size = 3, speedScale = 1) => ({
    x,
    y,
    size,
    r: size * 13,
    vx: (Math.random() - 0.5) * 2.2 * speedScale,
    vy: (Math.random() - 0.5) * 2.2 * speedScale,
    spin: (Math.random() - 0.5) * 0.05,
    angle: Math.random() * 6.28,
    points: Array.from({ length: 9 }, (_, i) => 0.78 + Math.random() * 0.35 + Math.sin(i * 2.7) * 0.04)
  });
  /* Every wave opens with large rocks only, spread away from the ship, and
     drifts a little faster each wave, the original ramp. */
  const waveRocks = count => {
    rocks = [];
    const px = ship ? ship.x : W / 2,
      py = ship ? ship.y : H / 2;
    for (let i = 0; i < count; i++) {
      let x, y;
      do {
        x = Math.random() * W;
        y = Math.random() * H;
      } while (Math.hypot(x - px, y - py) < 150);
      rocks.push(makeRock(x, y, 3, 1 + wave * 0.06));
    }
  };
  const spawnSaucer = () => {
    const small = score >= 40000 || Math.random() < 0.35;
    const fromLeft = Math.random() < 0.5;
    saucer = {
      x: fromLeft ? -22 : W + 22,
      y: 40 + Math.random() * (H - 80),
      vx: (small ? 1.9 : 1.1) * (fromLeft ? 1 : -1),
      vy: (Math.random() - 0.5) * 0.9,
      small,
      r: small ? 12 : 18,
      cd: 60
    };
  };
  const scheduleSaucer = () => {
    if (saucerTimer) return;
    saucerTimer = tools.later(
      () => {
        saucerTimer = null;
        if (playing && !saucer) spawnSaucer();
      },
      12000 + Math.random() * 9000
    );
  };
  function reset() {
    ship = { x: W / 2, y: H / 2, a: -Math.PI / 2, vx: 0, vy: 0, inv: 120 };
    rocks = [];
    shots = [];
    sparks = [];
    saucer = null;
    score = 0;
    lives = 3;
    wave = 1;
    nextExtra = 10000;
    respawnWait = 0;
    playing = true;
    $('asteroids-overlay').style.display = 'none';
    clearInterval(loop);
    loop = tools.every(tick, 16);
    waveRocks(4);
    scheduleSaucer();
  }
  function burst(x, y, color = '#ffcf66', count = 12) {
    for (let i = 0; i < count; i++)
      sparks.push({ x, y, vx: (Math.random() - 0.5) * 5, vy: (Math.random() - 0.5) * 5, life: 1, color });
  }
  function awardPoints(points) {
    score += points;
    if (score >= nextExtra) {
      lives++;
      nextExtra += 10000;
      burst(W / 2, 24, '#9ef0b1', 14);
    }
  }
  /* Four shots in flight, matching the arcade cabinet's shot limit. */
  function fire() {
    if (!playing || !ship || shots.filter(s => !s.hostile).length >= 4) return;
    shots.push({
      x: ship.x + Math.cos(ship.a) * 15,
      y: ship.y + Math.sin(ship.a) * 15,
      vx: ship.vx + Math.cos(ship.a) * 9,
      vy: ship.vy + Math.sin(ship.a) * 9,
      life: 60
    });
  }
  /* Hyperspace is the classic gamble: a small chance of self-destruct, and
     you can rematerialize right on top of a rock. */
  function hyperspace() {
    if (!playing || !ship) return;
    burst(ship.x, ship.y, '#65c9ff', 14);
    ship.x = Math.random() * W;
    ship.y = Math.random() * H;
    ship.vx = ship.vy = 0;
    if (Math.random() < 0.06) {
      hitShip(true);
      return;
    }
    ship.inv = 40;
  }
  function loseGame() {
    playing = false;
    clearInterval(loop);
    loop = null;
    const best = Math.max(gameBest(key), score);
    setGameBest(key, best);
    $('as-best').textContent = best;
    $('asteroids-overlay').innerHTML =
      `<b>FIELD LOST</b><span>${score.toLocaleString()} points · wave ${wave}</span><button class="btn primary">Retry</button>`;
    $('asteroids-overlay').style.display = 'flex';
  }
  function hitShip(force) {
    if (ship.inv > 0 && !force) return;
    burst(ship.x, ship.y, '#ff806e', 26);
    ship = null;
    lives--;
    if (lives <= 0) {
      loseGame();
      return;
    }
    respawnWait = 90;
  }
  function tick() {
    if (!playing) return;
    if (ship) {
      if (keys.ArrowLeft || keys.KeyA) ship.a -= 0.082;
      if (keys.ArrowRight || keys.KeyD) ship.a += 0.082;
      if (keys.ArrowUp || keys.KeyW) {
        ship.vx += Math.cos(ship.a) * 0.12;
        ship.vy += Math.sin(ship.a) * 0.12;
        burst(ship.x - Math.cos(ship.a) * 11, ship.y - Math.sin(ship.a) * 11, '#ff9c66', 1);
      }
      ship.vx *= 0.991;
      ship.vy *= 0.991;
      ship.x += ship.vx;
      ship.y += ship.vy;
      wrap(ship);
      if (ship.inv) ship.inv--;
    } else if (respawnWait > 0) {
      /* Classic respawn discipline: never drop a new ship into danger. */
      respawnWait--;
      if (respawnWait === 0) {
        const danger =
          rocks.some(r => Math.hypot(W / 2 - r.x, H / 2 - r.y) < r.r + 90) ||
          (saucer && Math.hypot(W / 2 - saucer.x, H / 2 - saucer.y) < 120);
        if (danger) respawnWait = 30;
        else ship = { x: W / 2, y: H / 2, a: -Math.PI / 2, vx: 0, vy: 0, inv: 150 };
      }
    }
    shots.forEach(s => {
      s.x += s.vx;
      s.y += s.vy;
      s.life--;
      wrap(s);
    });
    shots = shots.filter(s => s.life > 0);
    rocks.forEach(r => {
      r.x += r.vx;
      r.y += r.vy;
      r.angle += r.spin;
      wrap(r);
    });
    if (saucer) {
      saucer.x += saucer.vx;
      saucer.y += saucer.vy;
      if (Math.random() < 0.012) saucer.vy = (Math.random() - 0.5) * 1.2;
      if (saucer.y < 24 || saucer.y > H - 24) {
        saucer.y = Math.max(24, Math.min(H - 24, saucer.y));
        saucer.vy *= -1;
      }
      saucer.cd--;
      /* The small saucer leads its shots; its accuracy tightens with score,
         becoming near-hitscan deep into a run, exactly like the original. */
      if (saucer.cd <= 0) {
        saucer.cd = saucer.small ? 34 : 80;
        let angle;
        const aimChance = Math.min(1, 0.12 + score / 60000);
        if (saucer.small && ship && Math.random() < aimChance)
          angle =
            Math.atan2(ship.y - saucer.y, ship.x - saucer.x) +
            (Math.random() - 0.5) * Math.max(0.05, 0.5 - score / 80000);
        else angle = Math.random() * Math.PI * 2;
        shots.push({
          x: saucer.x,
          y: saucer.y,
          vx: Math.cos(angle) * 5.2,
          vy: Math.sin(angle) * 5.2,
          life: 70,
          hostile: true
        });
      }
      if ((saucer.x < -30 && saucer.vx < 0) || (saucer.x > W + 30 && saucer.vx > 0)) {
        saucer = null;
        scheduleSaucer();
      }
    }
    for (let si = shots.length - 1; si >= 0; si--) {
      const s = shots[si];
      let consumed = false;
      for (let ri = rocks.length - 1; ri >= 0; ri--) {
        const r = rocks[ri];
        if (Math.hypot(s.x - r.x, s.y - r.y) < r.r) {
          shots.splice(si, 1);
          rocks.splice(ri, 1);
          awardPoints(r.size === 3 ? 20 : r.size === 2 ? 50 : 100);
          burst(r.x, r.y);
          if (r.size > 1) {
            const childSpeed = 1 + wave * 0.06 + (3 - r.size) * 0.25;
            rocks.push(makeRock(r.x, r.y, r.size - 1, childSpeed), makeRock(r.x, r.y, r.size - 1, childSpeed));
          }
          if (!rocks.length && !saucer) {
            wave++;
            $('as-wave').textContent = wave;
            waveRocks(Math.min(4 + (wave - 1) * 2, 11));
          }
          consumed = true;
          break;
        }
      }
      if (consumed) continue;
      if (saucer && Math.hypot(s.x - saucer.x, s.y - saucer.y) < saucer.r + 3) {
        shots.splice(si, 1);
        awardPoints(saucer.small ? 1000 : 200);
        burst(saucer.x, saucer.y, '#ff8e68', 22);
        saucer = null;
        scheduleSaucer();
        continue;
      }
      if (s.hostile && ship && Math.hypot(s.x - ship.x, s.y - ship.y) < 12) {
        shots.splice(si, 1);
        hitShip();
      }
    }
    if (ship) {
      rocks.forEach(r => {
        if (Math.hypot(ship.x - r.x, ship.y - r.y) < r.r + 8) hitShip();
      });
      if (ship && saucer && Math.hypot(ship.x - saucer.x, ship.y - saucer.y) < saucer.r + 10) hitShip();
    }
    sparks.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.04;
    });
    sparks = sparks.filter(p => p.life > 0);
    draw();
  }
  function draw() {
    ctx.fillStyle = '#07111e';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    for (let i = 0; i < 55; i++) ctx.fillRect((i * 137) % W, (i * 71) % H, 1, 1);
    if (ship) {
      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.rotate(ship.a);
      ctx.globalAlpha = ship.inv && Math.floor(ship.inv / 6) % 2 ? 0.25 : 1;
      ctx.strokeStyle = '#f4f7ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-11, -10);
      ctx.lineTo(-7, 0);
      ctx.lineTo(-11, 10);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    rocks.forEach(r => {
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.angle);
      ctx.strokeStyle = r.size === 3 ? '#9eb7ca' : r.size === 2 ? '#d1a96d' : '#ff8e68';
      ctx.beginPath();
      r.points.forEach((p, i) => {
        const a = (i * Math.PI * 2) / r.points.length;
        const x = Math.cos(a) * r.r * p,
          y = Math.sin(a) * r.r * p;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    });
    if (saucer) {
      ctx.save();
      ctx.translate(saucer.x, saucer.y);
      ctx.strokeStyle = saucer.small ? '#ff6e6e' : '#d1a96d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, saucer.r, saucer.r * 0.55, 0, 0, 7);
      ctx.moveTo(-saucer.r, 0);
      ctx.lineTo(saucer.r, 0);
      ctx.moveTo(-saucer.r * 0.45, -saucer.r * 0.55);
      ctx.lineTo(saucer.r * 0.45, -saucer.r * 0.55);
      ctx.stroke();
      ctx.restore();
    }
    shots.forEach(s => {
      ctx.fillStyle = s.hostile ? '#ff8e68' : '#ffe69b';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.2, 0, 7);
      ctx.fill();
    });
    sparks.forEach(p => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 3, 3);
    });
    ctx.globalAlpha = 1;
    $('as-score').textContent = score.toLocaleString();
    $('as-lives').textContent = lives;
  }
  /* Hold-to-move pads register on pointerdown; a document-wide pointerup and
     pointercancel release them, so a finger sliding off a button cannot leave
     thrust or rotation stuck on. */
  const padMap = { ccw: 'ArrowLeft', cw: 'ArrowRight', thrust: 'ArrowUp', fire: 'Space', hyper: 'KeyH' };
  document.querySelectorAll('[data-ast]').forEach(button => {
    button.style.touchAction = 'none';
  });
  document.querySelectorAll('[data-ast]').forEach(button => {
    const code = padMap[button.dataset.ast];
    tools.on(button, 'pointerdown', e => {
      e.preventDefault();
      if (code === 'Space') {
        if (playing) fire();
        else reset();
        return;
      }
      if (code === 'KeyH') {
        hyperspace();
        return;
      }
      keys[code] = true;
    });
  });
  const releasePads = () => {
    keys.ArrowLeft = keys.ArrowRight = keys.ArrowUp = false;
  };
  tools.on(document, 'pointerup', releasePads);
  tools.on(document, 'pointercancel', releasePads);
  const input = event => {
    if (event.code === 'Space') {
      event.preventDefault();
      if (event.type === 'keydown') {
        if (playing) fire();
        else reset();
      }
      return;
    }
    if (event.code === 'KeyH') {
      if (event.type === 'keydown') hyperspace();
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyD', 'KeyS'].includes(event.code)) {
      event.preventDefault();
      keys[event.code] = event.type === 'keydown';
    }
  };
  tools.on(document, 'keydown', input);
  tools.on(document, 'keyup', input);
  tools.on(canvas, 'pointerdown', () => {
    if (!playing) reset();
    else fire();
  });
  tools.on(host.querySelector('.arcade-overlay button'), 'click', reset);
  ship = { x: W / 2, y: H / 2, a: -Math.PI / 2, vx: 0, vy: 0, inv: 0 };
  waveRocks(4);
  draw();
}

function newPong() {
  const tools = gameTools(),
    key = 'dejavu1.pong.best',
    W = 760,
    H = 420,
    host = $('game-host');
  arcadeShell(
    host,
    'Pong',
    'Move the left paddle · first to 11 · angle comes from where you hit',
    '<canvas id="arcade-pong" class="arcade-canvas"></canvas><div class="arcade-overlay" id="pong-overlay"><b>PONG</b><span>Beat the adaptive opponent. Center hits stay flat; edge hits cut sharp angles.</span><button class="btn primary">Serve</button></div>',
    `<div class="game-stat"><div class="g-key">You</div><div class="g-val" id="po-you">0</div></div><div class="game-stat"><div class="g-key">Rally</div><div class="g-val" id="po-rally">0</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="po-best">${gameBest(key) || '—'}</div></div>`,
    tools
  );
  const [canvas, ctx] = gameCanvas(host, 'arcade-pong', W, H);
  let p = H / 2 - 45,
    ai = p,
    ball,
    you = 0,
    them = 0,
    rally = 0,
    playing = false,
    loop;
  function reset() {
    p = H / 2 - 45;
    ai = p;
    ball = { x: W / 2, y: H / 2, vx: 5, vy: (Math.random() - 0.5) * 4 };
    you = them = rally = 0;
    playing = true;
    $('pong-overlay').style.display = 'none';
    loop = tools.every(tick, 16);
  }
  function serve(direction) {
    ball = { x: W / 2, y: H / 2, vx: direction * (5 + Math.min(2, rally * 0.08)), vy: (Math.random() - 0.5) * 4 };
  }
  function point(won) {
    if (won) you++;
    else them++;
    rally = 0;
    if (you >= 11 || them >= 11) {
      playing = false;
      clearInterval(loop);
      const best = Math.max(gameBest(key), you);
      setGameBest(key, best);
      $('po-best').textContent = best;
      $('pong-overlay').innerHTML =
        `<b>${you > them ? 'MATCH WON' : 'MATCH LOST'}</b><span>${you} - ${them}</span><button class="btn primary">Rematch</button>`;
      $('pong-overlay').style.display = 'flex';
    } else serve(won ? 1 : -1);
  }
  function tick() {
    if (!playing) return;
    ball.x += ball.vx;
    ball.y += ball.vy;
    if (ball.y < 10 || ball.y > H - 10) ball.vy *= -1;
    const target = ball.vx > 0 ? ball.y - 42 : H / 2 - 45;
    ai += Math.max(-3.8, Math.min(3.8, target - ai)) * 0.08;
    if (ball.x < 38 && ball.x > 22 && ball.y > p - 8 && ball.y < p + 98 && ball.vx < 0) {
      ball.x = 38;
      const impact = (ball.y - (p + 45)) / 45;
      ball.vx = Math.min(9, Math.abs(ball.vx) * 1.045);
      ball.vy = impact * 5.2;
      rally++;
    }
    if (ball.x > W - 38 && ball.x < W - 22 && ball.y > ai - 8 && ball.y < ai + 98 && ball.vx > 0) {
      ball.x = W - 38;
      const impact = (ball.y - (ai + 45)) / 45;
      ball.vx = -Math.min(9, Math.abs(ball.vx) * 1.045);
      ball.vy = impact * 5.2;
      rally++;
    }
    if (ball.x < -20) point(false);
    if (ball.x > W + 20) point(true);
    draw();
  }
  function draw() {
    ctx.fillStyle = '#101827';
    ctx.fillRect(0, 0, W, H);
    ctx.setLineDash([8, 12]);
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#f8fbff';
    ctx.fillRect(22, p, 16, 90);
    ctx.fillStyle = '#ff9c66';
    ctx.fillRect(W - 38, ai, 16, 90);
    ctx.fillStyle = '#ffe69b';
    ctx.beginPath();
    ctx.arc(ball?.x || W / 2, ball?.y || H / 2, 8, 0, 7);
    ctx.fill();
    $('po-you').textContent = you;
    $('po-rally').textContent = rally;
  }
  const steer = event => {
    const rect = canvas.getBoundingClientRect();
    p = Math.max(0, Math.min(H - 90, ((event.clientY - rect.top) / rect.height) * H - 45));
  };
  tools.on(canvas, 'pointermove', steer);
  tools.on(canvas, 'pointerdown', () => {
    if (!playing) reset();
  });
  tools.on(host.querySelector('.arcade-overlay button'), 'click', reset);
  draw();
}

function newMines() {
  const tools = gameTools(),
    key = 'dejavu1.mines.best',
    S = 9,
    M = 10,
    host = $('game-host');
  arcadeShell(
    host,
    'Minesweeper',
    'Reveal safe ground · right-click or long-press to flag · clear every non-mine tile',
    '<div class="mine-layout"><div class="mine-board" id="mine-board"></div><div class="mine-side"><div class="mine-face" id="mine-face">🙂</div><p id="mine-message">First reveal is always safe.</p><button class="btn" id="mine-new">New field</button></div></div>',
    `<div class="game-stat"><div class="g-key">Mines</div><div class="g-val" id="mi-count">10</div></div><div class="game-stat"><div class="g-key">Time</div><div class="g-val" id="mi-time">0</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="mi-best">${gameBest(key) || '—'}</div></div>`,
    tools
  );
  const board = $('mine-board');
  let cells, started, over, flags, seconds, timer;
  function newGame() {
    cells = Array.from({ length: S * S }, () => ({ mine: false, open: false, flag: false, n: 0 }));
    started = over = false;
    flags = seconds = 0;
    clearInterval(timer);
    board.innerHTML = '';
    for (let i = 0; i < S * S; i++) {
      const button = document.createElement('button');
      button.className = 'mine-cell';
      button.dataset.i = i;
      board.appendChild(button);
    }
    draw();
  }
  const neighbors = i => {
    const r = Math.floor(i / S),
      c = i % S,
      out = [];
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr,
          cc = c + dc;
        if ((dr || dc) && rr >= 0 && rr < S && cc >= 0 && cc < S) out.push(rr * S + cc);
      }
    return out;
  };
  function plant(first) {
    const safe = new Set([first, ...neighbors(first)]),
      choices = [...Array(S * S).keys()].filter(i => !safe.has(i));
    for (let i = choices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [choices[i], choices[j]] = [choices[j], choices[i]];
    }
    choices.slice(0, M).forEach(i => (cells[i].mine = true));
    cells.forEach((cell, i) => {
      cell.n = neighbors(i).filter(n => cells[n].mine).length;
    });
    started = true;
    timer = tools.every(() => {
      seconds++;
      $('mi-time').textContent = seconds;
    }, 1000);
  }
  function reveal(i) {
    if (over || cells[i].flag || cells[i].open) return;
    if (!started) plant(i);
    cells[i].open = true;
    if (cells[i].mine) {
      over = true;
      cells.forEach(c => {
        if (c.mine) c.open = true;
      });
      $('mine-face').textContent = '💥';
      $('mine-message').textContent = 'Field lost. Start another sweep.';
      clearInterval(timer);
      draw();
      return;
    }
    if (!cells[i].n) neighbors(i).forEach(reveal);
    const safe = cells.filter(c => !c.mine && c.open).length;
    if (safe === S * S - M) {
      over = true;
      clearInterval(timer);
      const best = gameBest(key);
      if (!best || seconds < best) {
        setGameBest(key, seconds);
        $('mi-best').textContent = seconds;
      }
      $('mine-face').textContent = '😎';
      $('mine-message').textContent = 'Clear field. Clean sweep.';
    }
    draw();
  }
  function flag(i) {
    if (over || cells[i].open) return;
    cells[i].flag = !cells[i].flag;
    flags += cells[i].flag ? 1 : -1;
    draw();
  }
  function draw() {
    [...board.children].forEach((button, i) => {
      const c = cells[i];
      button.className = `mine-cell ${c.open ? 'open' : ''} ${c.flag ? 'flag' : ''} ${c.mine && c.open ? 'mine' : ''}`;
      button.textContent = c.flag ? '⚑' : c.open ? (c.mine ? '✹' : c.n || '') : '';
      button.style.setProperty('--n', c.n);
    });
    $('mi-count').textContent = M - flags;
  }
  tools.on(board, 'click', e => {
    const cell = e.target.closest('.mine-cell');
    if (cell) reveal(Number(cell.dataset.i));
  });
  tools.on(board, 'contextmenu', e => {
    e.preventDefault();
    const cell = e.target.closest('.mine-cell');
    if (cell) flag(Number(cell.dataset.i));
  });
  tools.on($('mine-new'), 'click', newGame);
  newGame();
}
