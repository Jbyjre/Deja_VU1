/* First-run help and private preferences. The profile never leaves this browser. */
'use strict';
(() => {
  const key = 'dejavu1.private-name', seenKey = 'dejavu1.setup-seen';
  // A phone that arrived by scanning the QR code (phone.js) joins a dashboard that is
  // already set up on the computer, so it goes straight to the dashboard, not setup.
  const viaPhoneLink = new URLSearchParams(location.search).has('pair');
  // store (app.js) falls back to the tab's memory when the browser blocks saved settings; save() says whether it will last.
  const read = k => store.get(k) || '';
  const save = (k, v) => { if (v) return store.set(k, v); store.remove(k); return true; };
  const dialog = $('setup-dialog'), content = $('setup-content');
  let step = 0, mode = 'real', info = null, returnFocus = null, activeTarget = null, generation = 0;
  // The printer step: what was typed (kept when the step redraws), the printer once it is added, and a note for the next step.
  let typedUrl = '', added = '', carry = '', connecting = null, searched = false, engine = null, engineWatch = 0, benchy = true, aiAfter = false;
  // Every step is full screen. The tour step hands over to the guided tour
  // (guide.js), which points at the real dashboard, then comes back here.
  // A phone opens the dashboard of the computer that runs Deja Vu1, so it skips the steps about the computer
  // (showing a code for a phone, the desktop app, updates) and gets the Home Screen step instead.
  const COMPUTER_STEPS = ['Welcome', 'Make it yours', 'Your printer', 'Slicing engine', 'Your AI', 'The tour', 'Your phone', 'Desktop app', 'Keep up to date'];
  const PHONE_STEPS = ['Welcome', 'Make it yours', 'Your printer', 'The tour', 'Home Screen'];
  const onPhone = () => matchMedia('(max-width: 720px)').matches && matchMedia('(pointer: coarse)').matches;
  let names = COMPUTER_STEPS, TOUR = names.indexOf('The tour');
  // The Language step comes first, and only while a language besides English is installed and this browser has not chosen one yet
  // (i18n.js). Choosing a language other than the one on screen saves it and reloads the page, which reopens setup in that language.
  let installed = [];
  const loadLanguages = () => (window.I18n && I18n.available ? I18n.available() : Promise.resolve([])).then(list => { installed = list; return list; });
  const wantsLanguage = () => installed.length > 1 && window.I18n && I18n.canSave() && !I18n.chosen() && I18n.lang() !== 'pseudo';
  function suggestedLanguage() {
    const prefs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]).filter(Boolean);
    for (const p of prefs) {
      const code = String(p).toLowerCase();
      const hit = installed.find(l => l.code !== 'en' && (l.code.toLowerCase() === code || l.code.toLowerCase() === code.split('-')[0]));
      if (hit) return hit;
      if (code.split('-')[0] === 'en') return null;
    }
    return null;
  }
  const languageLabel = l => (l.code === 'en' || l.native === l.name ? l.name : `${l.native} (${l.name})`);
  const privacy = 'Only saved in this browser on this device. Never sent to the server, logs, backups or update checks. Optional; delete it any time.';
  function greeting() {
    const name = read(key);
    $('private-greeting').textContent = name ? `Hello, ${name}` : 'Your Snapmaker U1 dashboard';
    $('private-name').value = name;
  }
  function clearHighlight() { if (activeTarget) activeTarget.classList.remove('setup-highlight'); activeTarget = null; }
  function jump(tab, target) {
    clearHighlight(); showTab(tab);
    const rail = window.Rail && Rail.shown() ? `#rail [data-dest="${Rail.destFor(tab)}"]` : null;
    const nav = matchMedia('(max-width:600px)').matches ? `#thumb-dock [data-tab="${tab}"]` : rail || `.navtab[data-tab="${tab}"]`;
    activeTarget = document.querySelector(target || nav);
    if (activeTarget) { activeTarget.classList.add('setup-highlight'); activeTarget.scrollIntoView({block:'center', behavior:'instant'}); }
  }
  function finish() { generation++; save(seenKey, '1'); clearHighlight(); dialog.close(); dialog.classList.remove('is-full'); document.documentElement.classList.remove('setup-full-open'); if (returnFocus) returnFocus.focus(); }
  function setDemo(on) {
    if (tourOn()) return;
    $('demo-toggle').checked = on;
    $('demo-toggle').dispatchEvent(new Event('change'));
  }
  async function refreshInfo() {
    info = await Versions.refresh();
    renderDesktop();
  }
  function phoneText() {
    if (tourOn()) return 'This public site is a demo recording. Download and run Deja Vu1 on your computer first; then open that computer’s address on your phone.';
    const address = info && info.phone_address ? `http://${info.phone_address}:${info.port}` : 'the “From a phone” address printed in the launcher window';
    return `Connect your phone to the same home Wi-Fi and type ${address} into its browser. Use the computer’s address, not localhost or the printer’s address.`;
  }
  const installText = 'On iPhone: open Safari → Share → Add to Home Screen. On Android: open Chrome’s menu → Add to Home screen (or Install app, when offered). A normal http:// home-network address may only offer a shortcut; offline support and full app installation need a secure https:// address. Browser options vary.';
  // Tests the typed address and adds the printer. Resolves true once it is added, false (the reason on screen) when it is not.
  function connectPrinter() {
    if (!connecting) connecting = doConnect().finally(() => { connecting = null; });
    return connecting;
  }
  async function doConnect() {
    const view = generation, btn = $('setup-test'), status = $('setup-status');
    const url = $('setup-url').value.trim(), apiKey = $('setup-key').value;
    const say = text => { if (view === generation) status.textContent = text; };
    if (!url) { say('Type the printer’s address first. It is on the printer’s screen, like 192.168.1.50.'); $('setup-url').focus(); return false; }
    btn.disabled = true; say('Testing the printer connection…');
    try {
      const body = { moonraker_url: url, api_key: apiKey };
      // A printer behind a web-page sign-in: read its key with that sign-in first.
      if (!apiKey && !$('setup-login').hidden && $('setup-pass').value) {
        say('Signing in to the printer…');
        const login = await postJSON('/api/printers/login', { moonraker_url: url, username: $('setup-user').value, password: $('setup-pass').value });
        if (view !== generation) return false;
        $('setup-pass').value = '';
        if (!login.ok) throw new Error(login.body.error);
        body.api_key = login.body.api_key; body.moonraker_url = login.body.url;
      }
      const test = await postJSON('/api/printers/test', body);
      if (view !== generation) return false;
      if (test.ok && test.body.url) body.moonraker_url = test.body.url;
      if (test.ok && test.body.needs_key) { $('setup-login').hidden = false; $('setup-user').focus(); }
      if (!test.ok || !test.body.ok || test.body.error) throw new Error(test.body.error || 'The printer did not answer.');
      // Replaying setup with a printer that is already in the list uses that printer instead of failing as a duplicate.
      const bare = u => String(u || '').replace(/\/+$/, '');
      const listed = await getJSON('/api/fleet/registry').catch(() => null);
      const same = listed && (listed.printers || []).find(p => bare(p.moonraker_url) === bare(body.moonraker_url));
      let printerId = same && same.id;
      if (!printerId) {
        const r = await postJSON('/api/fleet/registry', { ...body, name: 'My U1' });
        if (!r.ok) throw new Error(r.body.error);
        printerId = r.body.id;
      }
      setDemo(false); currentPrinter = printerId; store.set(PRINTER_KEY, currentPrinter);
      if (window.Workshop) Workshop.reconnect();
      refreshAll();
      added = body.moonraker_url; typedUrl = '';
      if (view === generation) { status.textContent = 'Connection test passed. Your printer is added; live readings will appear when the connection opens.'; $('setup-key').value = ''; btn.textContent = 'Printer added'; }
      return true;
    } catch (e) {
      say(e.message || 'Could not connect. Check the address and try again.');
      if (view === generation) btn.disabled = false;
      return false;
    }
  }
  // Continue with an address typed but not connected yet connects it first, so the address is not thrown away.
  const wantsConnect = () => !tourOn() && mode === 'real' && !added && !!$('setup-url') && !!$('setup-url').value.trim();
  let skipFor = '';
  function render() {
    const view = ++generation;
    clearHighlight();
    if (!dialog.matches(':modal')) { dialog.close(); dialog.showModal(); }
    $('setup-step').textContent = `Step ${step + 1} of ${names.length} · ${names[step]}`;
    $('setup-steps').innerHTML = names.map((n, i) => `<li class="${i < step ? 'done' : i === step ? 'now' : ''}"${i === step ? ' aria-current="step"' : ''}><span>${esc(n)}</span></li>`).join('');
    $('setup-back').hidden = step === 0;
    $('setup-next').textContent = step === names.length - 1 ? 'Finish setup' : 'Continue';
    dialog.classList.add('is-full');
    document.documentElement.classList.add('setup-full-open');
    if (names[step] === 'Language') {
      const suggested = suggestedLanguage(), now = I18n.lang();
      content.innerHTML = `<h2 id="setup-title">Choose your language.</h2><p class="setup-lead">Deja Vu1 is available in more than one language. Pick the one you read best. Settings, Appearance changes it later.</p>
        <div class="setup-choices" role="group" aria-label="Language">${installed.map(l => `<button class="btn ${l.code === (suggested ? suggested.code : now) ? 'primary' : ''}" type="button" data-setup-lang="${esc(l.code)}" lang="${esc(l.code)}" translate="no" aria-pressed="${l.code === now}">${esc(languageLabel(l))}</button>`).join('')}</div>
        ${suggested ? `<p class="field-hint">Your browser is set to ${esc(suggested.name)}. Press ${esc(languageLabel(suggested))} to use it, or Continue to stay in English.</p>` : ''}
        <p class="field-hint">A new translation may have mistakes, and a text without one shows in English.</p>`;
      content.querySelectorAll('[data-setup-lang]').forEach(b => { b.onclick = () => {
        const code = b.dataset.setupLang;
        if (code === I18n.lang()) { I18n.choose(code); step++; render(); return; }
        $('setup-status').textContent = '…';
        I18n.setLanguage(code);
      }; });
    } else if (names[step] === 'Welcome') {
      content.innerHTML = `<div class="setup-mark" aria-hidden="true">◉</div><h2 id="setup-title">Set up your U1 workspace.</h2>
        <p class="setup-lead">Deja Vu1 runs on this computer and keeps an eye on your Snapmaker U1 printers over your home Wi-Fi. Open it here, in its own window, or on your phone. Your printer data stays at home.</p>
        <ul class="setup-points"><li><strong>Watch it live:</strong> your printer in 3D, its progress and temperatures.</li><li><strong>Check before printing:</strong> the file, the colours and the printer, before anything starts.</li><li><strong>Look after it:</strong> upkeep reminders and your filament.</li></ul>
        <label for="setup-name">What should we call you? <span class="field-hint">Optional</span></label>
        <input id="setup-name" type="text" maxlength="40" autocomplete="off" placeholder="Your name" value="${esc(read(key))}">
        <p class="field-hint">${esc(privacy)}</p>`;
      $('setup-name').addEventListener('input', e => { $('setup-status').textContent = save(key, e.target.value.trim().slice(0,40)) ? '' : 'This browser is blocking saved settings, so your name is only kept until this tab closes.'; greeting(); });
      $('setup-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('setup-next').click(); } });
    } else if (names[step] === 'Make it yours') {
      const exp = window.DVTheme ? DVTheme.experience() : 'know';
      content.innerHTML = `<h2 id="setup-title">Make it yours.</h2><p class="setup-lead">How much help should the screens give? Short hints for your first visits, or none. Settings changes it later.</p>
        <div class="setup-choices" role="group" aria-label="Your experience"><button class="btn ${exp==='new'?'primary':''}" type="button" id="setup-exp-new" aria-pressed="${exp==='new'}">New to 3D printing</button><button class="btn ${exp==='know'?'primary':''}" type="button" id="setup-exp-know" aria-pressed="${exp==='know'}">I know my way around</button></div>
        <p class="setup-lead">Pick a background and colours. Move your mouse or a finger across the screen and it reacts. Settings → Appearance changes it later.</p><div id="setup-backdrop"></div>`;
      ['new', 'know'].forEach(v => { $('setup-exp-' + v).onclick = () => {
        if (window.DVTheme) DVTheme.setExperience(v);
        ['new', 'know'].forEach(o => { const b = $('setup-exp-' + o); b.classList.toggle('primary', o === v); b.setAttribute('aria-pressed', String(o === v)); });
      }; });
      if (typeof Backdrop !== 'undefined') Backdrop.picker($('setup-backdrop'));
    } else if (names[step] === 'Your printer') {
      content.innerHTML = `<h2 id="setup-title">Your printer, or a demo first?</h2><p class="setup-lead">The demo fills every screen with pretend printers, labelled as pretend. Connecting your own printer never starts a print.</p>
        <div class="setup-choices"><button class="btn ${mode==='demo'?'primary':''}" id="setup-demo" aria-pressed="${mode==='demo'}">Try the demo</button><button class="btn ${mode==='real'?'primary':''}" id="setup-real" aria-pressed="${mode==='real'}" ${tourOn()?'disabled':''}>Connect my printer</button></div>
        ${tourOn()?'<p class="setup-note">Public demo · a recording only. To connect a printer, run the download on your own computer.</p>':''}
        ${added&&mode==='real'&&!tourOn()?`<p class="setup-note">Added: My U1 at ${esc(added)}. More printers can be added later under Printers.</p>`:''}
        <div id="setup-connect" ${mode==='demo'||tourOn()||added?'hidden':''}>
          <button class="btn" id="setup-find">Find printers on my Wi-Fi</button><div id="setup-found"></div>
          <label for="setup-url">Printer address</label><input id="setup-url" type="text" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="192.168.1.50" value="${esc(typedUrl)}">
          <div id="setup-login" hidden>
            <p class="field-hint">This printer asks for a sign-in. Use the username and password from its web page. Only the printer’s key is kept, never the password.</p>
            <label for="setup-user">Printer username</label><input id="setup-user" type="text" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="admin">
            <label for="setup-pass">Printer password</label><input id="setup-pass" type="password" autocomplete="current-password">
          </div>
          <details class="setup-key-more"><summary>I have an API key instead</summary>
          <label for="setup-key">API key</label><input id="setup-key" type="password" autocomplete="off"></details>
          <button class="btn primary" id="setup-test">Test and connect</button>
          <p class="field-hint">No answer? Wake the printer and put it on the same Wi-Fi as this computer (not a guest network). Its address is on the printer’s screen or in your router’s list of devices. Type just the numbers; the app adds the rest.</p>
        </div>`;
      $('setup-demo').onclick=()=>{mode='demo';setDemo(true);render();};
      $('setup-real').onclick=()=>{mode='real';setDemo(false);render();};
      if ($('setup-find')) $('setup-find').onclick = async e => {
        const btn=e.currentTarget||$('setup-find');btn.disabled=true;searched=true; $('setup-status').textContent='Looking on your home network…';
        try {
          const r=await postJSON('/api/printers/discover',{}); if(!r.ok)throw new Error(r.body.error);
          if(view!==generation)return;
          const found=r.body.printers||[];
          $('setup-found').replaceChildren();
          found.forEach(p=>{const b=document.createElement('button');b.className='btn';b.type='button';b.textContent=p.name||p.ip;b.onclick=()=>{$('setup-url').value=`http://${p.ip}:${p.port}`;};$('setup-found').append(b);});
          $('setup-status').textContent=found.length?'Choose a printer, then test the connection.':'No printers found. The U1 joins 2.4 GHz Wi-Fi only: if your router names its 2.4 GHz and 5 GHz networks apart, put the printer on the 2.4 GHz one, with this computer on the same router. You can also enter the printer address yourself.';
        } catch(e){if(view===generation)$('setup-status').textContent=e.message||'Could not search. Try entering the address yourself.';} finally{btn.disabled=false;}
      };
      if ($('setup-url')) {
        $('setup-url').addEventListener('input', e => { typedUrl = e.target.value; });
        $('setup-connect').addEventListener('input', () => { skipFor = ''; });
        $('setup-url').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); connectPrinter(); } });
      }
      if ($('setup-test')) $('setup-test').onclick = () => connectPrinter();
      // Look for the printer straight away the first time this step opens, so the usual case is one press.
      if ($('setup-find') && !searched && !tourOn() && !serverMissing()) $('setup-find').onclick({ currentTarget: $('setup-find') });
    } else if (names[step] === 'Slicing engine') {
      renderEngine(view);
    } else if (names[step] === 'Your AI') {
      content.innerHTML = `<h2 id="setup-title">An AI of your own, if you want one.</h2>
        <p class="setup-lead">Deja Vu1 works fully without one. With your own AI connected, it can explain errors in plain words, watch a print through the camera and answer questions about your printer.</p>
        <ul class="setup-points"><li><strong>Your key, your account:</strong> it stays on this computer and is only sent to the AI you choose.</li><li><strong>Nothing happens behind your back:</strong> anything that would move or start a printer still waits for you.</li></ul>
        <div class="setup-choices"><button class="btn" type="button" id="setup-ai" ${tourOn() || serverMissing() ? 'disabled' : ''}>Set up an AI after this</button></div>
        <p class="field-hint">Skip this if you are not sure. The AI screen in the sidebar connects one any time.</p>`;
      $('setup-ai').onclick = () => { aiAfter = true; $('setup-ai').textContent = 'The AI screen opens when you finish'; $('setup-ai').disabled = true; };
      if (aiAfter) { $('setup-ai').textContent = 'The AI screen opens when you finish'; $('setup-ai').disabled = true; }
    } else if (step === TOUR) {
      content.innerHTML=`<h2 id="setup-title">Take the quick tour.</h2>
        <p class="setup-lead">${Guide.count()} stops, about a minute. A glass callout hops around the real dashboard and points at each part, and you can click things as you go.</p>
        <ul class="setup-points"><li><strong>What needs you</strong>, the live 3D printer, every printer at once, files, controls and care.</li><li><strong>Search and your phone:</strong> find anything with Ctrl+K, and open the dashboard on your phone by scanning a code.</li><li><strong>More on each screen:</strong> press Ctrl+K and choose Show me this screen for a few tips about whichever screen is open.</li></ul>
        <div class="setup-choices"><button class="btn primary" id="setup-guide">Start the tour</button></div>
        <p class="field-hint">The tour never moves or starts a printer. End it any time with × or Esc; it comes back here. Replay it later from Settings → Your space.</p>`;
      $('setup-guide').onclick=()=>{
        const at=step;generation++;clearHighlight();dialog.close();
        dialog.classList.remove('is-full');document.documentElement.classList.remove('setup-full-open');
        Guide.everything({onEnd:()=>{step=Math.min(at+1,names.length-1);dialog.showModal();render();}});
      };
    } else if (names[step] === 'Your phone') {
      content.innerHTML=`<h2 id="setup-title">Open it on your phone.</h2><p class="setup-lead">Your phone opens the same dashboard as this computer. No app store, no account, and nothing to type: scan a code with the phone’s camera.</p>
        <div class="setup-choices setup-phone-go"><button class="btn primary" id="setup-phone">Show the code to scan</button></div>
        <div class="setup-ways"><div class="setup-way"><strong>No camera handy?</strong><span>${esc(phoneText())}</span></div>
        <div class="setup-way"><strong>Keep it on your Home Screen</strong><span>${esc(installText)}</span></div></div><details><summary>Phone cannot connect?</summary><p>Check that Deja Vu1 is running on the computer (open http://localhost:8000 there; if it doesn't load, paste the Start block from Settings) and that the computer is awake and both devices use the same home Wi-Fi (not a guest network). Allow Python through the computer’s firewall on your private network. Do not turn the firewall off.</p><p>Typing it instead? Use a colon before the port number (<code>:8000</code>), not a dot; with a dot, phones search the web instead. A “Refused” message means the address is not allowed: ordinary local IP addresses work; a custom tunnel name must be added to DEJAVU_ALLOWED_HOSTS on the computer. There is no app login: protect remote access with a private VPN or Cloudflare Access.</p></details>`;
      $('setup-phone').onclick=()=>window.Phone&&Phone.open();
    } else if (names[step] === 'Desktop app') {
      content.innerHTML=`<h2 id="setup-title">A window of its own.</h2>
        <p class="setup-lead">You are not stuck in a browser tab. Pick how Deja Vu1 opens on this computer; you can change it in Settings → Desktop app.</p>
        <div class="setup-ways">
          <div class="setup-way"><strong>Install it as an app</strong><span>An icon in the Start menu or Dock and its own window, from Chrome or Edge.</span><button class="btn primary" id="setup-install">Install Deja Vu1</button></div>
          <div class="setup-way"><strong>Open as a window at start</strong><span>The launcher opens a window with no tabs or address bar.</span><button class="btn" id="setup-window">Use an app window</button></div>
          <div class="setup-way"><strong>Keep the browser tab</strong><span>Nothing changes. It opens in your usual browser.</span></div>
          <div class="setup-way"><strong>Only while you use it</strong><span>Deja Vu1 never starts with this computer. It stops by itself a few minutes after its last page closes, so nothing of it runs while you are not using it.</span></div>
        </div>
        <p class="field-hint" id="setup-desktop-note">${esc(installHelp())}</p>`;
      $('setup-install').onclick=()=>install($('setup-desktop-note'));
      $('setup-window').onclick=()=>saveWindow('window',$('setup-desktop-note'));
      if(tourOn()||serverMissing()){$('setup-install').disabled=true;$('setup-window').disabled=true;}
    } else if (names[step] === 'Home Screen') {
      content.innerHTML=`<h2 id="setup-title">Keep it on your Home Screen.</h2>
        <p class="setup-lead">This phone shows the dashboard of the computer that runs Deja Vu1. No app store and no account. Put it on your Home Screen to open it like an app.</p>
        <div class="setup-ways"><div class="setup-way"><strong>Add it to your Home Screen</strong><span>${esc(installText)}</span></div></div>
        <p class="field-hint">Updates and the computer’s own settings are changed on the computer. Keep the computer awake and on the same Wi-Fi as this phone.</p>`;
    } else {
      const kind=info&&info.install_kind==='git'?'Your copy came from git or GitHub Desktop, so updates come straight from GitHub.':'Updates arrive inside the app. In Settings you choose newest builds (each fix as it lands) or stable releases (fewer, bigger steps).';
      content.innerHTML=`<h2 id="setup-title">Stay up to date.</h2>
        <p class="setup-lead">This is Deja Vu1 <strong>v${esc(Versions.installed()||'?')}</strong>. ${esc(tourOn()||serverMissing()?'Updates belong to the copy on your own computer.':kind)}</p>
        ${tourOn()||serverMissing()?'':`<label class="setup-check"><input type="checkbox" id="setup-benchy" ${benchy?'checked':''}> Open the sample 3DBenchy in the Slicer when I finish</label>`}
        <label class="setup-check setup-check-big"><input type="checkbox" id="setup-auto" ${info&&info.automatic?'checked':''} ${tourOn()||serverMissing()?'disabled':''}> Look for updates by itself</label>
        <p>When an update is ready, the glass orb in the bottom-right corner tells you. Installing keeps your settings and files, and puts the old version back if the new one won’t start.</p>
        <details class="setup-more"><summary>More about updates</summary><p>Deja Vu1 makes a safety copy before it installs anything, then restarts itself. Settings can let updates install on their own while every printer is idle. Start Deja Vu1 with its double-click launcher so it can restart after an update.</p><p class="field-hint">Checking sends GitHub no name, printer details or settings. Settings → Version &amp; updates lists every version and has a tour of each. Printer firmware updates are separate and come from Snapmaker.</p></details>`;
      if($('setup-benchy'))$('setup-benchy').onchange=e=>{benchy=e.target.checked;};
      $('setup-auto').onchange=async e=>{const r=await postJSON('/api/app/updates/settings',{automatic:e.target.checked});if(!r.ok){e.target.checked=!e.target.checked;$('setup-status').textContent=r.body.error||'Could not save that.';}else{info={...info,...r.body};Versions.refresh();}};
    }
    $('setup-status').textContent=carry;carry='';
    const title=$('setup-title');title.tabIndex=-1;title.focus({preventScroll:true});
  }
  /* The slicing engine step: what is on this computer, and one press to install Snapmaker's engine. The install keeps
     running if setup moves on; the Slicer's own engine card shows it too. */
  async function renderEngine(view) {
    if (tourOn() || serverMissing()) {
      content.innerHTML = `<h2 id="setup-title">The slicing engine.</h2><p class="setup-lead">On your own computer, Deja Vu1 installs Snapmaker’s official slicing engine for you here, so models turn into prints without a second app.</p>`;
      return;
    }
    content.innerHTML = `<h2 id="setup-title">Turn models into prints.</h2><p class="setup-lead">The Slicer uses Snapmaker’s official slicing engine, Snapmaker Orca, run as a separate program. If it is already on this computer, Deja Vu1 uses that copy; if not, it can download it for you.</p><div id="setup-engine" aria-live="polite"><p class="field-hint">Checking this computer…</p></div>`;
    try { engine = await getJSON('/api/slicer/engine'); } catch (e) { engine = { error: e.message || 'The engine could not be checked.' }; }
    if (view !== generation) return;
    paintEngineStep(view);
  }
  function paintEngineStep(view) {
    const box = $('setup-engine'), e = engine || {};
    if (!box || view !== generation) return;
    const job = e.job, running = job && job.state === 'running', inst = e.installed;
    let html;
    if (e.error) html = `<p class="setup-note">${esc(e.error)} The Slicer can install it later.</p>`;
    else if (running) {
      const pct = Math.round((job.progress || 0) * 100);
      html = `<p class="setup-note">Installing… ${pct}%. You can carry on: it keeps going, and the Slicer says when it is ready.</p><div class="sl-bar" role="progressbar" aria-label="Engine install" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>`;
    } else if (inst) html = `<p class="setup-note">Ready: ${esc(inst.app || 'Snapmaker Orca')} ${esc(inst.engine_version || inst.version || '')} is installed and checked.</p>`;
    else if (e.own) html = `<p class="setup-note">Ready: Deja Vu1 uses the ${esc(e.own.name)} already on this computer, so there is nothing to install.</p><p class="field-hint">${esc(e.own.path)}</p>`;
    else if (!e.supported) html = `<p class="setup-note">${esc(e.reason || 'Deja Vu1 cannot install the engine on this computer.')} In the Slicer, “Use my own Snapmaker Orca” points it at a copy you installed yourself.</p>`;
    else {
      const failed = job && job.state === 'failed' ? `<p class="setup-note" role="alert">${esc(job.error)}</p>` : '';
      html = `${failed}<div class="setup-choices"><button class="btn primary" type="button" id="setup-engine-go">${(e.offer || {}).size_words ? `Install the engine (${esc(e.offer.size_words)})` : 'Install the engine'}</button></div>
        <p class="field-hint">A download from Snapmaker’s own GitHub release, checked before it runs. Skip it and the Slicer offers it again.</p>`;
    }
    box.innerHTML = html;
    const go = $('setup-engine-go');
    if (go) go.onclick = async () => {
      go.disabled = true; go.textContent = 'Starting…';
      const r = await postJSON('/api/slicer/engine/install', {});
      if (view !== generation) return;
      if (!r.ok) { engine = { ...engine, job: { state: 'failed', error: r.body.error || 'The install could not start.' } }; paintEngineStep(view); return; }
      engine = r.body; paintEngineStep(view); watchEngine(view);
      if (window.Activity) Activity.refresh();
    };
    if (running) watchEngine(view);
  }
  function watchEngine(view) {
    if (engineWatch) return;
    engineWatch = setInterval(async () => {
      if (view !== generation || !dialog.open) { clearInterval(engineWatch); engineWatch = 0; return; }
      const next = await getJSON('/api/slicer/engine').catch(() => null);
      if (!next || view !== generation) return;
      engine = next;
      paintEngineStep(view);
      if (!(next.job && next.job.state === 'running')) { clearInterval(engineWatch); engineWatch = 0; }
    }, 1000);
  }
  /* What the last step asked for, once setup has closed: the sample Benchy on the Slicer's plate, AI settings. */
  async function afterSetup() {
    if (aiAfter && !tourOn()) { showTab('ai'); return; }
    if (!benchy || tourOn() || serverMissing() || !window.Slicer || onPhone()) return;
    try {
      const list = (await getJSON('/api/files')).files || [];
      if (!list.some(f => f.name === '3dbenchy.stl')) await postJSON('/api/files/samples', {});
      await Slicer.open('3dbenchy.stl');
    } catch (e) { toast(`The sample could not be opened: ${e.message || e}`, 'warn'); }
  }
  function open() {
    returnFocus=document.activeElement;step=0;mode=tourOn()?'demo':'real';
    names=(onPhone()?PHONE_STEPS:COMPUTER_STEPS).slice();if(wantsLanguage())names.unshift('Language');TOUR=names.indexOf('The tour');typedUrl='';added='';carry='';skipFor='';searched=false;aiAfter=false;benchy=true;
    dialog.showModal();render();refreshInfo();
  }
  $('setup-replay').onclick=open;
  $('setup-skip').onclick=finish;
  $('setup-next').onclick=async()=>{
    const next=$('setup-next');
    if(names[step]==='Your printer'&&wantsConnect()){
      const typed=$('setup-url').value.trim();
      // A second Continue for an address that did not connect moves on: the printer can be added later under Printers.
      if(typed!==skipFor){
        next.disabled=true;const ok=await connectPrinter();next.disabled=false;
        if(!ok){skipFor=typed;if($('setup-url'))$('setup-status').textContent+=' Press Continue again to skip this and add the printer later under Printers.';return;}
        carry='Printer added: My U1.';
      }
    }
    if(names[step]==='Language'&&window.I18n&&!I18n.chosen())I18n.choose(I18n.lang());
    if(step===names.length-1){const last=names[step]==='Keep up to date';finish();if(last)afterSetup();}else{step++;render();}
  };
  $('setup-back').onclick=()=>{step=Math.max(0,step-1);render();};
  dialog.addEventListener('cancel',e=>{e.preventDefault();finish();});
  // However the sheet closes, the page behind it must come back (full-screen setup hides it).
  dialog.addEventListener('close',()=>{if(!dialog.open){dialog.classList.remove('is-full');document.documentElement.classList.remove('setup-full-open');}});
  $('private-name').addEventListener('input',e=>{save(key,e.target.value.trim().slice(0,40));$('private-greeting').textContent=e.target.value.trim()?`Hello, ${e.target.value.trim()}`:'Your Snapmaker U1 dashboard';});
  $('private-delete').onclick=()=>{save(key,'');greeting();toast('Name deleted from this browser','ok');};
  /* ---- the desktop app -----------------------------------------------------
     Two ways out of the browser tab: install the dashboard as an app (Chrome
     and Edge offer this on the computer's own http://localhost address), or
     let the launcher open an app window (backend/desktop.py). */
  let installEvent = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; renderDesktop(); });
  addEventListener('appinstalled', () => { installEvent = null; toast('Deja Vu1 is installed. Open it from the Start menu, the Dock or your desktop.', 'ok', 7000); renderDesktop(); });
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function browserName() {
    const ua = navigator.userAgent;
    if (/Edg\//.test(ua)) return 'Edge';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Chrome\//.test(ua) && !/OPR\//.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua)) return 'Safari';
    return '';
  }
  function installHelp() {
    if (tourOn() || serverMissing()) return 'This public page is a demo recording. Download Deja Vu1 and run it on your computer, then install that copy.';
    if (standalone()) return 'You are using the installed app right now.';
    if (!window.isSecureContext) return 'Install it on the computer that runs Deja Vu1, at http://localhost:8000. On a phone, open More → Install app.';
    if (installEvent) return 'Your browser is ready: press Install Deja Vu1.';
    return {
      Edge: 'In Edge: the app icon at the right of the address bar, or the menu (…) → Apps → Install this site as an app.',
      Chrome: 'In Chrome: the install icon at the right of the address bar, or the menu (⋮) → Cast, save and share → Install page as app.',
      Safari: 'In Safari on macOS Sonoma or newer: File → Add to Dock.',
      Firefox: 'Firefox cannot install websites as apps. Choose “In its own app window” below, which uses Edge or Chrome, or open localhost:8000 in one of those.',
    }[browserName()] || 'Look in your browser’s menu for Install or Add to Dock. The wording varies between browsers and versions.';
  }
  async function install(note) {
    if (installEvent) {
      const ev = installEvent; installEvent = null;
      ev.prompt();
      const choice = await ev.userChoice.catch(() => null);
      if (choice && choice.outcome !== 'accepted') installEvent = ev;
    } else {
      (note || $('da-install-note')).textContent = installHelp();
      toast(installHelp(), 'info', 8000);
    }
    renderDesktop();
  }
  async function saveWindow(mode, note) {
    const r = await postJSON('/api/app/desktop', { open_as: mode });
    if (!r.ok) { toast(r.body.error || 'Could not save that choice', 'bad'); return; }
    if (info) info.desktop = r.body;
    const msg = mode === 'window' ? (r.body.window_browser ? `Next time you start the launcher, Deja Vu1 opens in its own ${r.body.window_browser} app window.` : 'Saved, but neither Edge nor Chrome was found on this computer, so the launcher will open a normal browser tab.')
      : mode === 'none' ? 'Next time, the launcher opens nothing. Open http://localhost:8000 or the installed app yourself.' : 'Next time, the launcher opens a browser tab.';
    if (note) note.textContent = msg;
    toast(msg, 'ok', 7000);
    renderDesktop();
  }
  function renderDesktop() {
    const btn = $('da-install'), offline = tourOn() || serverMissing();
    btn.disabled = offline || standalone();
    btn.textContent = standalone() ? 'Installed · in use now' : 'Install Deja Vu1';
    $('da-install-note').textContent = installHelp();
    const d = info && info.desktop;
    document.querySelectorAll('#da-modes input').forEach(r => { r.disabled = offline || !d; r.checked = !!d && r.value === d.open_as; });
    $('da-window-note').textContent = offline ? 'Belongs to the copy on your own computer.' : !d ? 'Loading…'
      : d.window_browser ? `The app window uses ${d.window_browser}, found on this computer. Applies the next time you start the launcher.`
      : 'Neither Edge nor Chrome was found on this computer, so an app window would open as a normal tab.';
    $('da-autostart-note').textContent = offline ? 'Belongs to the copy on your own computer.' : stopWords(info && info.idle_stop);
  }
  /* In words: when this copy stops by itself, or why it is still running. */
  function stopWords(s) {
    if (!s) return 'Deja Vu1 stops by itself when nobody has used it for a while.';
    if (!s.started_by_launcher) return 'This copy was started by hand (python3 backend/app.py), so it runs until its window closes.';
    const n = s.minutes;
    if (s.busy && s.busy.length) {
      const what = s.busy.join(', ');
      return n === 1 ? `Still running for ${what}; it stops by itself 1 minute after that ends and no page is open.`
        : `Still running for ${what}; it stops by itself ${n} minutes after that ends and no page is open.`;
    }
    if (s.stops_in_seconds != null) {
      const left = Math.max(1, Math.round(s.stops_in_seconds / 60));
      return left === 1 ? 'No page is open, so it stops by itself in about a minute.'
        : `No page is open, so it stops by itself in about ${left} minutes.`;
    }
    return n === 1 ? 'It stops by itself 1 minute after its last page closes.' : `It stops by itself ${n} minutes after its last page closes.`;
  }
  $('da-install').onclick = () => install();
  $('da-modes').addEventListener('change', e => { if (e.target.name === 'da-mode') saveWindow(e.target.value, $('da-window-note')); });
  $('guide-replay').onclick = () => Guide.everything();
  window.DesktopApp = { install, help: installHelp, canPrompt: () => !!installEvent, standalone };

  /* One quiet offer after the first real connection: a message with one button, shown once. Never on a phone, never in the demo, and
     never when the app is already installed or the launcher already opens its own window. The permanent home is Settings, Desktop app. */
  const OFFER_KEY = 'dejavu1.desktopOffer';
  const offerBusy = () => !!document.querySelector('#setup-dialog[open]') || document.documentElement.classList.contains('guide-open');
  function offerDesktop(tries) {
    if (read(OFFER_KEY) || tourOn() || serverMissing() || standalone() || matchMedia('(max-width: 720px)').matches) return;
    const d = info && info.desktop;
    if (d && d.open_as === 'window') return;
    if (offerBusy()) { if ((tries || 0) < 6) setTimeout(() => offerDesktop((tries || 0) + 1), 10000); return; }
    save(OFFER_KEY, '1');
    // Where the browser can install it straight away, the one button does that; elsewhere it shows the Desktop app settings.
    const ready = !!installEvent;
    toast(ready ? 'Deja Vu1 can be installed as an app: its own window and an icon, same dashboard.'
      : 'Deja Vu1 can open in its own window instead of a browser tab.', 'info', 15000, {
      action: ready ? { label: 'Install', run: () => install() }
        : { label: 'See how', run: () => { location.hash = '#/settings'; setTimeout(() => window.Settings && Settings.search('desktop app'), 400); } }
    });
  }
  const connNow = $('conn');
  if (connNow) {
    new MutationObserver(() => {
      if (connNow.classList.contains('is-live') && !connNow.classList.contains('is-demo')) setTimeout(() => offerDesktop(0), 8000);
    }).observe(connNow, { attributes: true, attributeFilter: ['class'] });
  }
  addEventListener('beforeinstallprompt', () => window.Phone && Phone.refreshInstall());

  // The search box lives in finder.js.
  let cameraRun = 0, cameraURL = null, cameraTimer = null;
  function stopStock() {
    cameraRun++;clearTimeout(cameraTimer);
    if(cameraURL)URL.revokeObjectURL(cameraURL);cameraURL=null;
    $('stock-camera-image').hidden=true;$('stock-camera-image').removeAttribute('src');
    $('stock-camera-start').hidden=false;$('stock-camera-stop').hidden=true;
  }
  $('stock-camera-stop').onclick=()=>{stopStock();$('stock-camera-status').textContent='Stopped. The printer camera connection closes after it is idle.';};
  $('stock-camera-start').onclick=()=>{
    if(tourOn()){stopStock();$('stock-camera-status').textContent='This public demo is a recording; it has no live camera. Run your own copy to connect a printer.';return;}
    stopStock();const run=cameraRun, printer=currentPrinter;
    $('stock-camera-start').hidden=true;$('stock-camera-stop').hidden=false;
    async function frame(){
      if(run!==cameraRun)return;
      if(printer!==currentPrinter||document.hidden||$('tab-control').hidden){stopStock();return;}
      try{
        $('stock-camera-status').textContent=demoOn?'Demo illustration · not a camera photo':'Requesting a new camera picture…';
        const response=await fetch(api('/api/camera/snapshot?t='+Date.now()));
        if(!response.ok||(response.headers.get('Content-Type')||'').includes('json')){
          const d=await response.json();throw new Error(d.error||'No printer connected. Connect your U1 or choose demo data.');
        }
        const blob=await response.blob();if(run!==cameraRun)return;
        if(cameraURL)URL.revokeObjectURL(cameraURL);cameraURL=URL.createObjectURL(blob);
        $('stock-camera-image').src=cameraURL;$('stock-camera-image').hidden=false;
        $('stock-camera-status').textContent=blob.type.includes('svg')?'Demo illustration · not a camera photo':'Picture received from the selected printer';
        cameraTimer=setTimeout(frame,1500);
      }catch(e){stopStock();$('stock-camera-status').textContent=e.message||'The camera did not answer. Check the printer and try again.';}
    }
    frame();
  };
  greeting();
  // versions.js loads after this file, so wait until every script has run.
  const allLoaded=new Promise(r=>document.readyState==='loading'?addEventListener('DOMContentLoaded',r,{once:true}):r());
  Promise.all([serverReady(),allLoaded,loadLanguages()]).then(async()=>{await Versions.ready;info=Versions.info();renderDesktop();if(viaPhoneLink)save(seenKey,'1');else if(!read(seenKey)&&!tourOn())open();});
  if('serviceWorker' in navigator && window.isSecureContext)navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
