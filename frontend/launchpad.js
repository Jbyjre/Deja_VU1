/* First-run help and private preferences. The profile never leaves this browser. */
'use strict';
(() => {
  const key = 'dejavu1.private-name', seenKey = 'dejavu1.setup-seen';
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
    return `Keep the computer and printer on. Connect your phone to the same home Wi-Fi, then open ${address}. Use the computer’s address, not localhost or the printer’s address.`;
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
      content.innerHTML = `<div class="setup-mark" aria-hidden="true">◉</div><h2 id="setup-title">A little setup.<br>A clearer print day.</h2>
        <p class="setup-lead">Deja Vu1 is a dashboard for your Snapmaker U1. It runs on this computer and talks to your printer over your home network. Open it in a browser tab, in its own app window, or on your phone. Nothing goes to the cloud.</p>
        <ul class="setup-points"><li><strong>See it live:</strong> a 3D twin of your printer, progress and temperatures.</li><li><strong>Stay safe:</strong> every print is checked before it starts.</li><li><strong>Look after it:</strong> maintenance reminders and your filament shelf.</li></ul>
        <label for="setup-name">What should we call you? <span class="field-hint">Optional</span></label>
        <input id="setup-name" type="text" maxlength="40" autocomplete="off" placeholder="Your name" value="${esc(read(key))}">
        <p class="field-hint">${esc(privacy)}</p>`;
      $('setup-name').addEventListener('input', e => { if (!save(key, e.target.value.trim().slice(0,40))) $('setup-status').textContent='This browser is not allowing saved preferences.'; greeting(); });
    } else if (names[step] === 'Make it yours') {
      content.innerHTML = `<h2 id="setup-title">Make it yours.</h2><p class="setup-lead">Pick a background and its colours. Move your mouse (or drag a finger) around this screen to see it react. You can change it any time in Settings → Appearance.</p><div id="setup-backdrop"></div>`;
      if (typeof Backdrop !== 'undefined') Backdrop.picker($('setup-backdrop'));
    } else if (names[step] === 'Your printer') {
      content.innerHTML = `<h2 id="setup-title">Choose your starting point.</h2><p>Demo figures are labelled. Connecting a real printer does not start a print.</p>
        <div class="setup-choices"><button class="btn ${mode==='demo'?'primary':''}" id="setup-demo">Explore demo data</button><button class="btn ${mode==='real'?'primary':''}" id="setup-real" ${tourOn()?'disabled':''}>Connect my printer</button></div>
        ${tourOn()?'<p class="setup-note">Public demo · a recording only. To connect a printer, run the download on your own computer.</p>':''}
        <div id="setup-connect" ${mode==='demo'||tourOn()?'hidden':''}>
          <button class="btn" id="setup-find">Find printers</button><div id="setup-found"></div>
          <label for="setup-url">Printer address</label><input id="setup-url" type="url" placeholder="http://192.168.1.50:7125">
          <label for="setup-key">API key <span class="field-hint">Only if your printer asks for one</span></label><input id="setup-key" type="password" autocomplete="off">
          <button class="btn primary" id="setup-test">Test and connect</button>
          <p class="field-hint">No answer? Wake the printer, check its address on its screen or in your router, and use the same home network. Guest Wi-Fi can keep devices apart. Port 7125 is Moonraker’s usual address.</p>
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
          const test=await postJSON('/api/printers/test',body);
          if(view!==generation)return;
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
      content.innerHTML=`<h2 id="setup-title">Take the tour.</h2>
        <p class="setup-lead">${Guide.count()} short stops covering every screen. Each stop lights up the real part of the dashboard and says what it does; many have something to try.</p>
        <ul class="setup-points"><li><strong>The big picture:</strong> how your computer, screens and printers connect.</li><li><strong>The names you’ll see:</strong> Workshop, Studio and Garage are three pretend demo printers, and Photo studio is a different thing again.</li><li><strong>Every screen:</strong> Overview, Printers, Control, Files, Photo studio, Automations, Care, Settings and Games.</li></ul>
        <div class="setup-choices"><button class="btn primary" id="setup-guide">Start the tour</button></div>
        <p class="field-hint">The tour never moves or starts a printer. End it any time with × or Esc; it comes back here. Replay it later from Settings → Your space.</p>`;
      $('setup-guide').onclick=()=>{
        const at=step;generation++;clearHighlight();dialog.close();
        dialog.classList.remove('is-full');document.documentElement.classList.remove('setup-full-open');
        Guide.everything({onEnd:()=>{step=Math.min(at+1,names.length-1);dialog.showModal();render();}});
      };
    } else if (names[step] === 'Your phone') {
      content.innerHTML=`<h2 id="setup-title">Your bench. In your pocket.</h2><p class="setup-lead">Your phone opens the same dashboard as this computer. It needs no app store and no account.</p><p>${esc(phoneText())}</p><p>${esc(installText)}</p><details><summary>Phone cannot connect?</summary><p>Keep the launcher window open. Check that the computer is awake and both devices use the same home Wi-Fi. Allow Python through the computer’s firewall on your private network. Do not turn the firewall off.</p><p>A “Refused” message means the address is not allowed. Ordinary local IP addresses work; a custom tunnel name must be added to DEJAVU_ALLOWED_HOSTS on the computer. There is no app login: protect remote access with a private VPN or Cloudflare Access.</p></details>`;
    } else if (names[step] === 'Desktop app') {
      content.innerHTML=`<h2 id="setup-title">A window of its own.</h2>
        <p class="setup-lead">You are not stuck in a browser tab. Pick how Deja Vu1 opens on this computer; you can change it in Settings → Desktop app.</p>
        <div class="setup-ways">
          <div class="setup-way"><strong>Install it as an app</strong><span>An icon in the Start menu or Dock and its own window, from Chrome or Edge.</span><button class="btn primary" id="setup-install">Install Deja Vu1</button></div>
          <div class="setup-way"><strong>Open as a window at start</strong><span>The launcher opens a window with no tabs or address bar.</span><button class="btn" id="setup-window">Use an app window</button></div>
          <div class="setup-way"><strong>Keep the browser tab</strong><span>Nothing changes. It opens in your usual browser.</span></div>
        </div>
        <p class="field-hint" id="setup-desktop-note">${esc(installHelp())}</p>`;
      $('setup-install').onclick=()=>install($('setup-desktop-note'));
      $('setup-window').onclick=()=>saveWindow('window',$('setup-desktop-note'));
      if(tourOn()||serverMissing()){$('setup-install').disabled=true;$('setup-window').disabled=true;}
    } else {
      const kind=info&&info.install_kind==='git'?'Your copy was made with git or GitHub Desktop, so updates pull the newest version straight from GitHub.':'Updates install the newest release published on GitHub.';
      content.innerHTML=`<h2 id="setup-title">Stay up to date.</h2>
        <p class="setup-lead">This is Deja Vu1 <strong>v${esc(Versions.installed()||'?')}</strong>. ${esc(tourOn()||serverMissing()?'Updates belong to the copy on your own computer.':kind)}</p>
        <label class="setup-check setup-check-big"><input type="checkbox" id="setup-auto" ${info&&info.automatic?'checked':''} ${tourOn()||serverMissing()?'disabled':''}> Look for updates by itself, at startup and once a day</label>
        <p>When one is ready, the glass orb in the bottom-right corner tells you. Installing keeps your settings and files, restarts the dashboard, and puts the old version back if the new one fails to start. Wait until your printers are idle.</p>
        <p class="field-hint">A check sends GitHub no name, printer details or settings. Settings → Version &amp; updates has the version history and a tour of each version. Printer firmware updates are separate.</p>`;
      $('setup-auto').onchange=async e=>{const r=await postJSON('/api/app/updates/settings',{automatic:e.target.checked});if(!r.ok){e.target.checked=!e.target.checked;$('setup-status').textContent=r.body.error||'Could not save that.';}else{info={...info,...r.body};Versions.refresh();}};
    }
    $('setup-status').textContent='';
    const title=$('setup-title');title.tabIndex=-1;title.focus({preventScroll:true});
  }
  function open() {
    returnFocus=document.activeElement;step=0;mode=tourOn()?'demo':'real';
    dialog.showModal();render();refreshInfo();
  }
  $('setup-open').onclick=open;$('setup-replay').onclick=open;
  function openCamera() {
    showTab('modules');
    const camera=document.querySelector('.stock-camera');
    camera.open=true;camera.scrollIntoView({block:'center',behavior:'instant'});
    $('stock-camera-start').focus({preventScroll:true});
  }
  $('camera-open').onclick=openCamera;
  $('setup-skip').onclick=finish;
  $('setup-next').onclick=()=>{if(step===names.length-1)finish();else{step++;render();}};
  $('setup-back').onclick=()=>{step=Math.max(0,step-1);render();};
  dialog.addEventListener('cancel',e=>{e.preventDefault();finish();});
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
    if (!window.isSecureContext) return 'Install it on the computer that runs Deja Vu1, at http://localhost:8000. On a phone, use Add to Home Screen instead.';
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
  }
  $('da-install').onclick = () => install();
  $('da-modes').addEventListener('change', e => { if (e.target.name === 'da-mode') saveWindow(e.target.value, $('da-window-note')); });
  $('guide-replay').onclick = () => Guide.everything();
  window.DesktopApp = { install, help: installHelp };

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
      if(printer!==currentPrinter||document.hidden||$('tab-modules').hidden){stopStock();return;}
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
  Promise.all([serverReady(),allLoaded]).then(async()=>{await Versions.ready;info=Versions.info();renderDesktop();if(!read(seenKey))open();});
  if('serviceWorker' in navigator && window.isSecureContext)navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
