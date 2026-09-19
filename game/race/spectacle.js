/**
 * Race screen spectacle layer (loaded by game/net/mgp-client.js when the race page is opened with ?live=1).
 *
 * Purely visual. It only LISTENS to what the server already sends (window events 'mgp:state' and
 * 'mgp:event', published by MgpClient) and never touches the V5 engine, physics or the server:
 *   1. FINAL LAP     big flashing "FINAL LAP", then "EVERYONE BOOST!"
 *   2. BOOST cue     a brief pulse on the team's legend chip and a floating "+N" (N = boosts in the burst)
 *   3. Clean HUD     hides the demo racer's Time / Last Lap / Fastest Lap boxes (meaningless in a server race)
 *
 * Safety: flashing is a slow pulse (~2 Hz, well under the 3 flashes/s photosensitivity limit) and is
 * disabled for prefers-reduced-motion (the text is still shown).
 */
(function () {
  var COLORS = { red: '#ff4b4b', blue: '#3d8bff', green: '#2fd66b', yellow: '#ffd928' };
  var FINAL_LAP_POSITION = 0.75; // server default; only used to catch FINAL_LAP while CHAOS masks the status
  var FINAL_MS = 2300;           // "FINAL LAP"
  var EVERYONE_MS = 3000;        // "EVERYONE BOOST!"

  var css = document.createElement('style');
  css.textContent =
    /* 3. clean HUD */
    '#current_lap_time, #last_lap_time, #fast_lap_time { display: none !important; }' +
    /* 2. boost cue */
    '#teams .team { position: relative; }' +
    '@keyframes mgpHitA { 0% { filter: brightness(1.9); transform: scale(1.12); } 100% { filter: none; transform: none; } }' +
    '@keyframes mgpHitB { 0% { filter: brightness(1.9); transform: scale(1.12); } 100% { filter: none; transform: none; } }' +
    '#teams .team.mgp-hit-a { animation: mgpHitA 0.25s ease-out; }' +
    '#teams .team.mgp-hit-b { animation: mgpHitB 0.25s ease-out; }' +
    '#mgp-fx { position: fixed; inset: 0; z-index: 7; pointer-events: none; overflow: hidden; }' +
    '.mgp-plus { position: absolute; font: 900 1.6em Verdana, Geneva, sans-serif; text-shadow: 0 2px 4px #000, 0 0 10px #000; opacity: 0; transform: translateX(-50%); }' +
    '@keyframes mgpPlusA { 0% { opacity: 1; margin-top: 0; } 100% { opacity: 0; margin-top: -46px; } }' +
    '@keyframes mgpPlusB { 0% { opacity: 1; margin-top: 0; } 100% { opacity: 0; margin-top: -46px; } }' +
    '.mgp-plus.go-a { animation: mgpPlusA 0.8s ease-out forwards; }' +
    '.mgp-plus.go-b { animation: mgpPlusB 0.8s ease-out forwards; }' +
    /* 1. final lap */
    '#mgp-final { position: fixed; inset: 0; z-index: 8; display: none; align-items: center; justify-content: center; flex-direction: column; text-align: center; pointer-events: none; background: radial-gradient(ellipse at center, rgba(0,0,0,0.05), rgba(0,0,0,0.55)); }' +
    '#mgp-final.show { display: flex; }' +
    '#mgp-final .big { font: 900 16vw/1 Impact, "Arial Black", sans-serif; letter-spacing: 0.03em; color: #ffe100; -webkit-text-stroke: 0.012em #b30000; text-shadow: 0 0.04em 0 #b30000, 0 0 0.3em rgba(255,60,0,0.9); }' +
    '#mgp-final .sub { margin-top: 0.15em; font: 900 8vw/1 Impact, "Arial Black", sans-serif; color: #fff; text-shadow: 0 0.05em 0 #000, 0 0 0.35em #f0f; }' +
    '#mgp-final .dots { margin-top: 0.3em; font-size: 7vw; line-height: 1; }' +
    '@keyframes mgpPulse { 0% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(1.06); } 100% { opacity: 1; transform: scale(1); } }' +
    '#mgp-final.pulse .big, #mgp-final.pulse .sub { animation: mgpPulse 0.5s ease-in-out infinite; }' +
    '@media (prefers-reduced-motion: reduce) { #mgp-final.pulse .big, #mgp-final.pulse .sub, #teams .team.mgp-hit-a, #teams .team.mgp-hit-b { animation: none; } }';
  (document.head || document.documentElement).appendChild(css);

  var fx, finalEl, bigEl, subEl, dotsEl;
  function build() {
    if (fx) return;
    fx = document.createElement('div');
    fx.id = 'mgp-fx';
    document.body.appendChild(fx);
    finalEl = document.createElement('div');
    finalEl.id = 'mgp-final';
    finalEl.innerHTML = '<div class="big"></div><div class="sub"></div><div class="dots"></div>';
    document.body.appendChild(finalEl);
    bigEl = finalEl.querySelector('.big');
    subEl = finalEl.querySelector('.sub');
    dotsEl = finalEl.querySelector('.dots');
  }

  // ---- 1. FINAL LAP -> EVERYONE BOOST -------------------------------------------------------------------
  var finalShown = false;
  var timers = [];
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  function hideFinal() {
    clearTimers();
    if (finalEl) finalEl.classList.remove('show', 'pulse');
  }

  function showFinal() {
    build();
    hideFinal();
    bigEl.textContent = 'FINAL LAP';
    subEl.textContent = '';
    dotsEl.textContent = '';
    finalEl.classList.add('show', 'pulse');
    timers.push(setTimeout(function () {
      bigEl.textContent = 'EVERYONE';
      subEl.textContent = 'BOOST!';
      dotsEl.textContent = '🔴 🔵 🟢 🟡';
    }, FINAL_MS));
    timers.push(setTimeout(hideFinal, FINAL_MS + EVERYONE_MS));
  }

  function leaderPosition(s) {
    var best = 0;
    (s.teams || []).forEach(function (t) { if (t.position > best) best = t.position; });
    return best;
  }

  window.addEventListener('mgp:state', function (e) {
    var s = e.detail;
    if (!s) return;
    if (s.status === 'LOBBY' || s.status === 'COUNTDOWN') { finalShown = false; hideFinal(); return; }
    if (s.status === 'FINISHED') { hideFinal(); return; }
    // FINAL_LAP is the server's status, but CHAOS can mask it; the leader position tells the truth.
    var inFinal = s.status === 'FINAL_LAP' || (s.status === 'CHAOS' && leaderPosition(s) >= FINAL_LAP_POSITION);
    if (inFinal && !finalShown) { finalShown = true; showFinal(); }
  });

  // ---- 2. BOOST cue -------------------------------------------------------------------------------------
  var acc = {};        // team -> boosts in the current burst
  var plus = {};       // team -> floating element (one per team, reused: no DOM churn at 20 events/s)
  var hitToggle = 0;

  function plusFor(team) {
    if (plus[team]) return plus[team];
    build();
    var el = document.createElement('div');
    el.className = 'mgp-plus';
    el.style.color = COLORS[team] || '#fff';
    el.addEventListener('animationend', function () { acc[team] = 0; });
    fx.appendChild(el);
    plus[team] = el;
    return el;
  }

  window.addEventListener('mgp:event', function (e) {
    var m = e.detail;
    if (!m || m.type !== 'BOOST') return;
    var chip = document.querySelector('#teams .team-' + m.team);
    if (!chip) return;

    hitToggle ^= 1; // two identical animations swapped per hit restart it without timers or reflow tricks
    chip.classList.remove(hitToggle ? 'mgp-hit-b' : 'mgp-hit-a');
    chip.classList.add(hitToggle ? 'mgp-hit-a' : 'mgp-hit-b');

    var el = plusFor(m.team);
    acc[m.team] = (acc[m.team] || 0) + (m.amount || 1);
    el.textContent = '+' + acc[m.team];
    var r = chip.getBoundingClientRect();
    el.style.left = (r.left + r.width / 2) + 'px';
    el.style.top = (r.bottom + 4) + 'px';
    el.classList.remove(hitToggle ? 'go-b' : 'go-a');
    el.classList.add(hitToggle ? 'go-a' : 'go-b');
  });
})();
