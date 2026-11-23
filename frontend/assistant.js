/* assistant.js: the AI assistant.
 *
 * The panel is a strip on the right edge (a sheet on a phone), so the twin and the camera stay in view
 * while the assistant works. It has four views:
 *   chat      the conversation: your message shows the moment you send it, the steps it takes are drawn
 *             like a toolpath, and results come back as small cards (readings, a sliced file, a new model,
 *             spools) with buttons that go straight there
 *   history   every saved conversation, newest first, to pick up where you left off
 *   connect   your own AI: a Claude or ChatGPT plan first (signed in from here), then a model on this
 *             computer, then an API key
 *   settle    a short moment after connecting while it reads the printer
 * It also draws the AI screen (#ai-page): the features first (print watch, print doctor, a spool from a
 * photo, rules in your own words, making a part, catching up), and the set-up in small cards below.
 *
 * With no AI connected the app looks as it does without this file, apart from a small Ask button and the
 * AI screen: the shortcuts in SPOTS, html.ai-on and every AI hint around the app exist only while an AI
 * answers, and go away the moment the last one is disconnected.
 * The server (backend/ai_assistant.py) decides what is allowed; this file only shows it. In the online
 * demo there is no server, so a small scripted helper answers and says that it is one.
 */
(function () {
  /* The rest of this closure lives in assistant-part1.js, assistant-part2.js (loaded before this file). */
  const { aiState, deleteChat, demo, el, glow, pickPhoto, ready, shrink, threadId } = AssistantPart1;
  const { applyProposal, build, decorate, demoPaint, demoSay, drawIdeas, goTo, openChat, openFile, poll, refresh,
    send, toggle, wirePage } = AssistantPart2;

function wire() {
    el.body.addEventListener('click', e => {
      const t = e.target.closest('[data-yes],[data-no],[data-always],[data-print],[data-file],[data-place],[data-apply],[data-say],[data-chat],[data-del],[data-retry]');
      if (!t || !el.body.contains(t)) return;
      if (t.dataset.retry) {
        t.parentElement.querySelectorAll('button').forEach(b => { b.disabled = true; });
        aiState.autoFrom = Math.min(aiState.autoFrom, aiState.seen);
        postJSON(api('/api/assistant/retry'), { thread: threadId(), provider: t.dataset.retry }).then(res => {
          if (!res.ok) { toast(res.body.error || 'That AI could not be asked', 'bad'); t.parentElement.querySelectorAll('button').forEach(b => { b.disabled = false; }); return; }
          refresh();
          poll();
        });
        return;
      }
      if (t.dataset.chat) { openChat(t.dataset.chat); return; }
      if (t.dataset.del) { deleteChat(t.dataset.del, t); return; }
      if (t.dataset.print) { if (window.Workshop) Workshop.openConfirm(t.dataset.print, t); return; }
      if (t.dataset.file) { openFile(t.dataset.file); return; }
      if (t.dataset.say) { send(t.dataset.say); return; }
      if (t.dataset.place) { goTo(t.dataset.place, t.dataset.part); return; }
      if (t.dataset.apply) { applyProposal(+t.dataset.apply); return; }
      const always = 'always' in t.dataset, yes = always || 'yes' in t.dataset, n = +(t.dataset.yes || t.dataset.no || t.dataset.always);
      t.parentElement.querySelectorAll('button').forEach(b => { b.disabled = true; });
      if (aiState.st.demo) return demoDecide(n, yes);
      aiState.autoFrom = Math.min(aiState.autoFrom, aiState.seen);
      postJSON(api('/api/assistant/decide'), { thread: threadId(), n, approve: yes, always }).then(res => {
        if (!res.ok) toast(res.body.error || 'That step could not be decided', 'bad');
        if (always) refresh();
        poll();
      });
    });
  }
async function demoDecide(n, yes) {
    const w = demo.wait;
    demo.wait = null;
    if (!w || w.m.n !== n) return;
    if (yes) await w.run(); else { w.m.status = 'declined'; demoSay('Left as it is.'); }
    demoPaint(false);
  }

  /* ---- start ------------------------------------------------------------ */

document.addEventListener('DOMContentLoaded', () => {
    build(); wire(); wirePage();
    window.addEventListener('dv-tab', e => { if (e.detail && e.detail.tab === 'ai') refresh(); });
    window.addEventListener('dv-state', e => { aiState.live = e.detail || {}; });
    ['dv-tab', 'dv-section'].forEach(name => window.addEventListener(name, () => setTimeout(decorate, 0)));
    // Warnings and refusals anywhere in the app become something the assistant can explain, while one is connected.
    const plain = window.toast;
    if (typeof plain === 'function') window.toast = function (message, kind) {
      if (ready() && (kind === 'bad' || kind === 'warn') && typeof message === 'string') { aiState.lastTrouble = message.slice(0, 400); if (aiState.open && el.body.dataset.view === 'chat') drawIdeas(); }
      return plain.apply(this, arguments);
    };
    setTimeout(refresh, 1200);
  });

window.Assistant = { open: () => toggle(true), close: () => toggle(false), ask: send, refresh, glow, goTo, openFile, pickPhoto, shrink };
})();
