/* First-run help and private preferences. The profile never leaves this browser. */
'use strict';
(() => {
  const key = 'dejavu1.private-name', seenKey = 'dejavu1.setup-seen';
  // A phone that arrived by scanning the QR code (phone.js) joins a dashboard that is
  // already set up on the computer, so it goes straight to the dashboard, not setup.
  const viaPhoneLink = new URLSearchParams(location.search).has('pair');
  const read = k => { try { return localStorage.getItem(k) || ''; } catch (_) { return ''; } };
  const save = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); return true; } catch (_) { return false; } };
  const dialog = $('setup-dialog'), content = $('setup-content');
  let step = 0, mode = 'real', info = null, returnFocus = null, activeTarget = null, generation = 0;
  // Every step is full screen. The tour step hands over to the guided tour
  // (guide.js), which points at the real dashboard, then comes back here.
  const names = ['Welcome', 'Make it yours', 'Your printer', 'The tour', 'Your phone', 'Desktop app', 'Keep up to date'];
  const TOUR = names.indexOf('The tour');
  const privacy = 'Only saved in this browser on this device. Never sent to the server, logs, backups or update checks. Optional; delete it any time.';
  function greeting() {
    const name = read(key);
    $('private-greeting').textContent = name ? `Hello, ${name}` : 'Your print bench';
    $('private-name').value = name;
  }
  function clearHighlight() { if (activeTarget) activeTarget.classList.remove('setup-highlight'); activeTarget = null; }
  function jump(tab, target) {
    clearHighlight(); showTab(tab);
    const nav = matchMedia('(max-width:600px)').matches ? `#thumb-dock [data-tab="${tab}"]` : `.navtab[data-tab="${tab}"]`;
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
    if (step === 0) {
      content.innerHTML = `<div class="setup-mark" aria-hidden="true">◉</div><h2 id="setup-title">Set up your U1 workspace.</h2>
        <p class="setup-lead">Deja Vu1 runs on this computer and keeps an eye on your Snapmaker U1 printers over your home Wi-Fi. Open it here, in its own window, or on your phone. Your printer data stays at home.</p>
        <ul class="setup-points"><li><strong>Watch it live:</strong> your printer in 3D, its progress and temperatures.</li><li><strong>Check before printing:</strong> the file, the colours and the printer, before anything starts.</li><li><strong>Look after it:</strong> upkeep reminders and your filament.</li></ul>
        <label for="setup-name">What should we call you? <span class="field-hint">Optional</span></label>
        <input id="setup-name" type="text" maxlength="40" autocomplete="off" placeholder="Your name" value="${esc(read(key))}">
        <p class="field-hint">${esc(privacy)}</p>`;
      $('setup-name').addEventListener('input', e => { if (!save(key, e.target.value.trim().slice(0,40))) $('setup-status').textContent='This browser is not allowing saved preferences.'; greeting(); });
    } else if (names[step] === 'Make it yours') {
      content.innerHTML = `<h2 id="setup-title">Make it yours.</h2><p class="setup-lead">Pick a background and colours. Move your mouse or a finger across the screen and it reacts. Settings → Appearance changes it later.</p><div id="setup-backdrop"></div>`;
      if (typeof Backdrop !== 'undefined') Backdrop.picker($('setup-backdrop'));
    } else if (names[step] === 'Your printer') {
      content.innerHTML = `<h2 id="setup-title">Your printer, or a demo first?</h2><p class="setup-lead">The demo fills every screen with pretend printers, labelled as pretend. Connecting your own printer never starts a print.</p>
        <div class="setup-choices"><button class="btn ${mode==='demo'?'primary':''}" id="setup-demo">Try the demo</button><button class="btn ${mode==='real'?'primary':''}" id="setup-real" ${tourOn()?'disabled':''}>Connect my printer</button></div>
        ${tourOn()?'<p class="setup-note">Public demo · a recording only. To connect a printer, run the download on your own computer.</p>':''}
        <div id="setup-connect" ${mode==='demo'||tourOn()?'hidden':''}>
          <button class="btn" id="setup-find">Find printers on my Wi-Fi</button><div id="setup-found"></div>
          <label for="setup-url">Printer address</label><input id="setup-url" type="text" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="192.168.1.50">
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
        const btn=e.currentTarget;btn.disabled=true; $('setup-status').textContent='Looking on your home network…';
        try {
          const r=await postJSON('/api/printers/discover',{}); if(!r.ok)throw new Error(r.body.error);
          if(view!==generation)return;
          const found=r.body.printers||[];
          $('setup-found').replaceChildren();
          found.forEach(p=>{const b=document.createElement('button');b.className='btn';b.type='button';b.textContent=p.name||p.ip;b.onclick=()=>{$('setup-url').value=`http://${p.ip}:${p.port}`;};$('setup-found').append(b);});
          $('setup-status').textContent=found.length?'Choose a printer, then test the connection.':'No printers found. You can enter the printer address yourself.';
        } catch(e){if(view===generation)$('setup-status').textContent=e.message||'Could not search. Try entering the address yourself.';} finally{btn.disabled=false;}
      };
      if ($('setup-test')) $('setup-test').onclick=async e=>{
        const btn=e.currentTarget, url=$('setup-url').value.trim(), apiKey=$('setup-key').value;
        btn.disabled=true;$('setup-status').textContent='Testing the printer connection…';
        try {
          const body={moonraker_url:url,api_key:apiKey};
          // A printer behind a web-page sign-in: read its key with that sign-in first.
          if(!apiKey&&!$('setup-login').hidden&&$('setup-pass').value){
            $('setup-status').textContent='Signing in to the printer…';
            const login=await postJSON('/api/printers/login',{moonraker_url:url,username:$('setup-user').value,password:$('setup-pass').value});
            $('setup-pass').value='';
            if(view!==generation)return;
            if(!login.ok)throw new Error(login.body.error);
            body.api_key=login.body.api_key;body.moonraker_url=login.body.url;
          }
          const test=await postJSON('/api/printers/test',body);
          if(view!==generation)return;
          if(test.ok&&test.body.url)body.moonraker_url=test.body.url;
          if(test.ok&&test.body.needs_key){$('setup-login').hidden=false;$('setup-user').focus();}
          if(!test.ok||!test.body.ok||test.body.error)throw new Error(test.body.error||'The printer did not answer.');
          const r=await postJSON('/api/fleet/registry',{...body,name:'My U1'});
          if(!r.ok)throw new Error(r.body.error);
          setDemo(false);currentPrinter=r.body.id;store.set(PRINTER_KEY,currentPrinter);
          if(window.Workshop)Workshop.reconnect();refreshAll();
          if(view!==generation)return;
          $('setup-status').textContent='Connection test passed. Your printer is added; live readings will appear when the connection opens.';
          $('setup-key').value='';btn.textContent='Printer added';
        } catch(e){if(view===generation)$('setup-status').textContent=e.message||'Could not connect. Check the address and try again.';btn.disabled=false;}
      };
    } else if (step === TOUR) {
      content.innerHTML=`<h2 id="setup-title">Take the quick tour.</h2>
        <p class="setup-lead">${Guide.count()} stops, about a minute. A glass callout hops around the real dashboard and points at each part, and you can click things as you go.</p>
        <ul class="setup-points"><li><strong>What needs you</strong>, the live 3D printer, every printer at once, files, controls and care.</li><li><strong>Search and your phone:</strong> find anything with Ctrl+K, and open the dashboard on your phone by scanning a code.</li><li><strong>More on each screen:</strong> the “Show me this screen” button under the tab bar has a few tips for whichever screen is open.</li></ul>
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
        <div class="setup-way"><strong>Keep it on your Home Screen</strong><span>${esc(installText)}</span></div></div><details><summary>Phone cannot connect?</summary><p>Keep the launcher window open. Check that the computer is awake and both devices use the same home Wi-Fi (not a guest network). Allow Python through the computer’s firewall on your private network. Do not turn the firewall off.</p><p>Typing it instead? Use a colon before the port number (<code>:8000</code>), not a dot; with a dot, phones search the web instead. A “Refused” message means the address is not allowed: ordinary local IP addresses work; a custom tunnel name must be added to DEJAVU_ALLOWED_HOSTS on the computer. There is no app login: protect remote access with a private VPN or Cloudflare Access.</p></details>`;
      $('setup-phone').onclick=()=>window.Phone&&Phone.open();
    } else if (names[step] === 'Desktop app') {
      content.innerHTML=`<h2 id="setup-title">A window of its own.</h2>
        <p class="setup-lead">You are not stuck in a browser tab. Pick how Deja Vu1 opens on this computer; you can change it in Settings → Desktop app.</p>
        <div class="setup-ways">
          <div class="setup-way"><strong>Install it as an app</strong><span>An icon in the Start menu or Dock and its own window, from Chrome or Edge.</span><button class="btn primary" id="setup-install">Install Deja Vu1</button></div>
          <div class="setup-way"><strong>Open as a window at start</strong><span>The launcher opens a window with no tabs or address bar.</span><button class="btn" id="setup-window">Use an app window</button></div>
          <div class="setup-way"><strong>Keep the browser tab</strong><span>Nothing changes. It opens in your usual browser.</span></div>
          <div class="setup-way"><strong>Start with this computer</strong><span>Deja Vu1 starts when you sign in, so the dashboard is always ready to open.</span><button class="btn" id="setup-autostart">Start it with this computer</button></div>
        </div>
        <p class="field-hint" id="setup-desktop-note">${esc(installHelp())}</p>`;
      $('setup-install').onclick=()=>install($('setup-desktop-note'));
      $('setup-window').onclick=()=>saveWindow('window',$('setup-desktop-note'));
      const auto=info&&info.autostart;
      $('setup-autostart').onclick=async()=>{await saveAutostart(true);const on=!!(info&&info.autostart&&info.autostart.on);$('setup-autostart').textContent=on?'Starts with this computer':'Start it with this computer';$('setup-autostart').disabled=on;};
      if(auto&&auto.on){$('setup-autostart').textContent='Starts with this computer';$('setup-autostart').disabled=true;}
      if(tourOn()||serverMissing()||!auto||!auto.supported){$('setup-install').disabled=tourOn()||serverMissing();$('setup-window').disabled=tourOn()||serverMissing();$('setup-autostart').disabled=true;}
    } else {
      const kind=info&&info.install_kind==='git'?'Your copy came from git or GitHub Desktop, so updates come straight from GitHub.':'Updates arrive inside the app. In Settings you choose newest builds (each fix as it lands) or stable releases (fewer, bigger steps).';
      content.innerHTML=`<h2 id="setup-title">Stay up to date.</h2>
        <p class="setup-lead">This is Deja Vu1 <strong>v${esc(Versions.installed()||'?')}</strong>. ${esc(tourOn()||serverMissing()?'Updates belong to the copy on your own computer.':kind)}</p>
        <label class="setup-check setup-check-big"><input type="checkbox" id="setup-auto" ${info&&info.automatic?'checked':''} ${tourOn()||serverMissing()?'disabled':''}> Look for updates by itself</label>
        <p>When an update is ready, the glass orb in the bottom-right corner tells you. Installing keeps your settings and files, and puts the old version back if the new one won’t start.</p>
        <details class="setup-more"><summary>More about updates</summary><p>Deja Vu1 makes a safety copy before it installs anything, then restarts itself. Settings can let updates install on their own while every printer is idle. Start Deja Vu1 with its double-click launcher so it can restart after an update.</p><p class="field-hint">Checking sends GitHub no name, printer details or settings. Settings → Version &amp; updates lists every version and has a tour of each. Printer firmware updates are separate and come from Snapmaker.</p></details>`;
      $('setup-auto').onchange=async e=>{const r=await postJSON('/api/app/updates/settings',{automatic:e.target.checked});if(!r.ok){e.target.checked=!e.target.checked;$('setup-status').textContent=r.body.error||'Could not save that.';}else{info={...info,...r.body};Versions.refresh();}};
    }
    $('setup-status').textContent='';
    const title=$('setup-title');title.tabIndex=-1;title.focus({preventScroll:true});
  }
  function open() {
    returnFocus=document.activeElement;step=0;mode=tourOn()?'demo':'real';
    dialog.showModal();render();refreshInfo();
  }
  $('setup-replay').onclick=open;
  $('setup-skip').onclick=finish;
  $('setup-next').onclick=()=>{if(step===names.length-1)finish();else{step++;render();}};
  $('setup-back').onclick=()=>{step=Math.max(0,step-1);render();};
  dialog.addEventListener('cancel',e=>{e.preventDefault();finish();});
  // However the sheet closes, the page behind it must come back (full-screen setup hides it).
  dialog.addEventListener('close',()=>{if(!dialog.open){dialog.classList.remove('is-full');document.documentElement.classList.remove('setup-full-open');}});
  $('private-name').addEventListener('input',e=>{save(key,e.target.value.trim().slice(0,40));$('private-greeting').textContent=e.target.value.trim()?`Hello, ${e.target.value.trim()}`:'Your print bench';});
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
    const a = info && info.autostart, box = $('da-autostart');
    box.disabled = offline || !a || !a.supported;
    box.checked = !!(a && a.on);
    $('da-autostart-note').textContent = offline ? 'Belongs to the copy on your own computer.' : !a ? 'Loading…'
      : !a.supported ? 'This system has no sign-in start list Deja Vu1 knows how to use.'
      : a.on ? 'On. Deja Vu1 starts when you sign in, without opening a browser; open the dashboard or the installed app when you want it.'
      : 'Off. Until you start the launcher, the dashboard address shows an offline page.';
  }
  async function saveAutostart(on) {
    const r = await postJSON('/api/app/autostart', { on });
    if (!r.ok) { toast(r.body.error || 'Could not change that setting', 'bad'); renderDesktop(); return; }
    if (info) info.autostart = r.body;
    toast(on ? 'Deja Vu1 will start when this computer starts' : 'Deja Vu1 will no longer start with this computer', 'ok', 6000);
    renderDesktop();
  }
  $('da-install').onclick = () => install();
  $('da-autostart').onchange = e => saveAutostart(e.target.checked);
  $('da-modes').addEventListener('change', e => { if (e.target.name === 'da-mode') saveWindow(e.target.value, $('da-window-note')); });
  $('guide-replay').onclick = () => Guide.everything();
  window.DesktopApp = { install, help: installHelp, canPrompt: () => !!installEvent, standalone };
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
  Promise.all([serverReady(),allLoaded]).then(async()=>{await Versions.ready;info=Versions.info();renderDesktop();if(viaPhoneLink)save(seenKey,'1');else if(!read(seenKey))open();});
  if('serviceWorker' in navigator && window.isSecureContext)navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
