/* First-run help and private preferences. The profile never leaves this browser. */
'use strict';
(() => {
  const key = 'dejavu1.private-name', seenKey = 'dejavu1.setup-seen';
  const read = k => { try { return localStorage.getItem(k) || ''; } catch (_) { return ''; } };
  const save = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); return true; } catch (_) { return false; } };
  const dialog = $('setup-dialog'), content = $('setup-content');
  let step = 0, mode = 'real', info = null, returnFocus = null, activeTarget = null, generation = 0;
  // Full screen for every step except the tour, which shrinks to a corner
  // card so the dashboard it points at can be seen.
  const names = ['Welcome', 'Make it yours', 'Your printer', 'Find your way', 'Your phone', 'Keep up to date'];
  const TOUR = names.indexOf('Find your way');
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
    if (tourOn() || serverMissing()) { renderUpdates(); return; }
    try { info = await getJSON('/api/app/info'); } catch (_) { info = null; }
    renderUpdates();
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
    if (step === TOUR && dialog.matches(':modal')) { dialog.close(); dialog.show(); }
    if (step !== TOUR && !dialog.matches(':modal')) { dialog.close(); dialog.showModal(); }
    $('setup-step').textContent = `Step ${step + 1} of ${names.length} · ${names[step]}`;
    $('setup-steps').innerHTML = names.map((n, i) => `<li class="${i < step ? 'done' : i === step ? 'now' : ''}"${i === step ? ' aria-current="step"' : ''}><span>${esc(n)}</span></li>`).join('');
    $('setup-back').hidden = step === 0;
    $('setup-next').textContent = step === names.length - 1 ? 'Finish setup' : 'Continue';
    dialog.classList.toggle('setup-tour', step === TOUR);
    dialog.classList.toggle('is-full', step !== TOUR);
    document.documentElement.classList.toggle('setup-full-open', step !== TOUR);
    if (step === 0) {
      content.innerHTML = `<div class="setup-mark" aria-hidden="true">◉</div><h2 id="setup-title">Set up your U1 workspace.</h2>
        <p class="setup-lead">Deja Vu1 is a dashboard for your Snapmaker U1. It runs on this computer, talks to your printer over your home network, and works from your phone too. Core printer data stays on your network. Optional services connect only when configured.</p>
        <ul class="setup-points"><li><strong>See it live:</strong> a 3D twin of your printer, progress and temperatures.</li><li><strong>Review the job:</strong> check the file, tools and printer before starting.</li><li><strong>Look after it:</strong> maintenance reminders and your filament shelf.</li></ul>
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
      content.innerHTML='<h2 id="setup-title">Find your everyday controls.</h2><p>Choose an area to highlight it in the dashboard. This tour does not send printer commands.</p><div class="setup-choices" id="setup-tour-links"></div>';
      [['overview','Progress'],['control','Pause & cancel'],['files','Files & queue'],['modules','Camera & settings']].forEach(([tab,label])=>{
        const b=document.createElement('button');b.className='btn';b.textContent=label;b.onclick=()=>jump(tab);$('setup-tour-links').append(b);
      });
      jump('overview');
    } else if (names[step] === 'Your phone') {
      content.innerHTML=`<h2 id="setup-title">Open it on your phone.</h2><p>${esc(phoneText())}</p><p>${esc(installText)}</p><details><summary>Phone cannot connect?</summary><p>Keep the launcher window open. Check that the computer is awake and both devices use the same home Wi-Fi. Allow Python through the computer’s firewall on your private network. Do not turn the firewall off.</p><p>A “Refused” message means the address is not allowed. Ordinary local IP addresses work; a custom tunnel name must be added to DEJAVU_ALLOWED_HOSTS on the computer. There is no app login: protect remote access with a private VPN or Cloudflare Access.</p></details>`;
    } else {
      content.innerHTML='<h2 id="setup-title">Stay in control of updates.</h2><p>Settings → App updates checks GitHub for a newer release. Automatic checks start off. If you enable them, checks happen at startup, at most once a day.</p><p>Install from the double-click launcher when your printers are idle. The launcher keeps your data and restores the previous files if the new server fails its startup check.</p><p class="field-hint">The public demo cannot update a downloaded copy. Printer firmware updates are a separate feature.</p>';
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
  function renderUpdates() {
    const box=$('app-update-status'), check=$('app-update-check'), install=$('app-update-install');
    if(tourOn()||serverMissing()){box.textContent='Public demo only. Updates belong to the copy running on your computer.';check.disabled=true;$('app-update-auto').disabled=true;install.hidden=true;return;}
    if(!info||info.error){box.textContent='App information is unavailable. Check that the server is running.';return;}
    const latest=info.latest;
    box.textContent=`Version ${info.version}. ${latest?(latest.error||latest.message):'No update check yet.'}`;
    $('app-update-auto').checked=!!info.automatic;
    install.hidden=!(latest&&latest.installable&&info.install_supported);
    $('app-update-note').textContent=info.install_supported?'Installing restarts the dashboard. Wait until every real printer is connected and idle.':'To install inside the app, use a downloaded release and its double-click launcher. Development copies are updated with git.';
    $('app-update-badge').hidden=!(latest&&latest.available);
  }
  $('app-update-check').onclick=async e=>{
    const btn=e.currentTarget;btn.disabled=true;$('app-update-status').textContent='Checking GitHub…';
    try{const r=await postJSON('/api/app/updates/check',{});info=r.body;renderUpdates();}catch(_){$('app-update-status').textContent='Could not check. Try again when your connection is back.';}finally{btn.disabled=false;}
  };
  $('app-update-auto').onchange=async e=>{
    const r=await postJSON('/api/app/updates/settings',{automatic:e.target.checked});if(r.ok){info=r.body;renderUpdates();}else{e.target.checked=!e.target.checked;toast(r.body.error||'Could not save that preference','bad');}
  };
  $('app-update-install').onclick=async e=>{
    const btn=e.currentTarget;btn.disabled=true;$('app-update-status').textContent='Downloading and checking the release…';
    try{const r=await postJSON('/api/app/updates/install',{});if(!r.ok)throw new Error(r.body.error);$('app-update-status').textContent='Restarting. Keep the launcher window open. Reload this page when it is ready.';setTimeout(()=>location.reload(),8000);}catch(e){$('app-update-status').textContent=e.message||'The update could not be installed.';btn.disabled=false;}
  };
  const search=$('feature-search');
  const destinations=[['Progress','overview'],['Pause, resume or cancel a print','control'],['Camera and time-lapses','modules'],['Files, models, slicing and queue','files'],['Printers and farm planning','fleet'],['Photo studio','studio'],['Automation rules','automations'],['Maintenance and filament','maintenance'],['Settings and app updates','modules']];
  search.oninput=()=>{
    const out=$('feature-results');out.replaceChildren();const q=search.value.trim().toLowerCase();out.hidden=!q;
    if(!q)return;const hits=destinations.filter(([name])=>name.toLowerCase().includes(q));
    hits.forEach(([name,tab])=>{const b=document.createElement('button');b.className='btn';b.textContent=name;b.onclick=()=>{out.hidden=true;search.value='';if(name.startsWith('Camera')){openCamera();return;}showTab(tab);const panel=$(`tab-${tab}`);panel.tabIndex=-1;panel.focus();};out.append(b);});
    if(!hits.length)out.textContent='No matching area. Try “camera”, “files” or “printer”.';
  };
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();search.focus();}if(e.key==='Escape')$('feature-results').hidden=true;});
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
  serverReady().then(async()=>{await refreshInfo();if(!read(seenKey))open();});
  if('serviceWorker' in navigator && window.isSecureContext)navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
