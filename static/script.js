// ═══════════════════════════════════════════════════════════════
//  GLOBAL STATE
// ═══════════════════════════════════════════════════════════════
const audioPlayer = new Audio();
let gainNode = null;  // module-level so volume persists across calls
let currentTrackUrl = null;
let mediaRecorder   = null;
let audioChunks     = [];
let isRecording     = false;
let waveSurfers     = {};   // keyed by container id

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function showToast(msg, type = 'info') {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = `position:fixed;bottom:30px;left:50%;transform:translateX(-50%);
      padding:12px 24px;border-radius:8px;font-size:.9rem;z-index:9999;
      color:#fff;transition:opacity .3s;pointer-events:none;`;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background = type==='error'?'#e74c3c':type==='success'?'#27ae60':'#333';
  t.style.opacity = '1';
  clearTimeout(t._t);
  t._t = setTimeout(() => t.style.opacity='0', 3000);
}

function setLoading(btn, loading, original) {
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading ? '<i class="fa-solid fa-spinner fa-spin"></i> Please wait...' : original;
}

// ═══════════════════════════════════════════════════════════════
//  LOADING SCREEN  (shown during AI generation)
// ═══════════════════════════════════════════════════════════════
function showLoadingScreen() {
  let screen = document.getElementById('ai-loading-screen');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'ai-loading-screen';
    screen.style.cssText = `
      position:fixed;inset:0;background:rgba(10,10,20,0.97);
      display:flex;align-items:center;justify-content:center;
      z-index:99999;flex-direction:column;font-family:'Inter',sans-serif;`;
    screen.innerHTML = `
      <style>
        .lb { display:flex; gap:6px; align-items:flex-end; height:50px; margin-bottom:16px; }
        .lb span {
          width:7px; border-radius:4px;
          background: linear-gradient(180deg,#a78bfa,#7c3aed);
          animation: bounce 1.2s ease-in-out infinite;
        }
        .lb span:nth-child(1){height:20px;animation-delay:0s}
        .lb span:nth-child(2){height:35px;animation-delay:0.1s}
        .lb span:nth-child(3){height:50px;animation-delay:0.2s}
        .lb span:nth-child(4){height:30px;animation-delay:0.3s}
        .lb span:nth-child(5){height:40px;animation-delay:0.4s}
        .lb span:nth-child(6){height:25px;animation-delay:0.5s}
        .lb span:nth-child(7){height:45px;animation-delay:0.6s}
        .lb span:nth-child(8){height:35px;animation-delay:0.7s}
        @keyframes bounce {
          0%,100%{transform:scaleY(0.4);opacity:0.5}
          50%{transform:scaleY(1);opacity:1}
        }
        .progress-wrap { width:340px;height:5px;background:#1a1a2e;border-radius:3px;margin:10px 0 20px; }
        .progress-fill { height:100%;border-radius:3px;width:0%;transition:width 1s ease;
          background:linear-gradient(90deg,#7c3aed,#a78bfa); }

        /* QUIZ STYLES */
        .quiz-box {
          background:#13131f; border:1px solid #2a2a3a; border-radius:16px;
          padding:24px; width:420px; max-width:95vw;
        }
        .quiz-header {
          display:flex; justify-content:space-between; align-items:center;
          margin-bottom:16px;
        }
        .quiz-score { color:#a78bfa; font-size:0.85rem; font-weight:600; }
        .quiz-timer {
          width:36px;height:36px;border-radius:50%;
          background:conic-gradient(#7c3aed var(--p,100%), #2a2a3a 0);
          display:flex;align-items:center;justify-content:center;
          font-size:0.8rem;color:#fff;font-weight:700;
          transition: --p 1s linear;
        }
        .quiz-q {
          color:#fff; font-size:1rem; font-weight:600;
          margin-bottom:18px; line-height:1.5; min-height:48px;
        }
        .quiz-options { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        .quiz-opt {
          padding:12px 10px; border-radius:10px;
          border:1.5px solid #2a2a3a; background:#1a1a2e;
          color:#ccc; cursor:pointer; font-size:0.85rem;
          text-align:center; transition:all 0.2s; line-height:1.3;
        }
        .quiz-opt:hover:not(:disabled) { border-color:#7c3aed; color:#a78bfa; background:#1e1533; }
        .quiz-opt.correct { border-color:#27ae60; background:#0d2e1a; color:#27ae60; }
        .quiz-opt.wrong   { border-color:#e74c3c; background:#2e0d0d; color:#e74c3c; }
        .quiz-fact {
          margin-top:14px; padding:10px 14px;
          background:#1e1533; border-radius:8px;
          color:#a78bfa; font-size:0.8rem; display:none;
          line-height:1.5;
        }
        .quiz-next {
          margin-top:14px; width:100%; padding:10px;
          background:#7c3aed; color:#fff; border:none;
          border-radius:8px; cursor:pointer; font-size:0.9rem;
          display:none; transition:background 0.2s;
        }
        .quiz-next:hover { background:#6d28d9; }
        .quiz-result {
          text-align:center; padding:10px 0;
        }
        .quiz-result h3 { color:#fff; font-size:1.3rem; margin-bottom:8px; }
        .quiz-result p  { color:#888; font-size:0.9rem; }
        .quiz-result .score-big { font-size:2.5rem; color:#a78bfa; font-weight:700; }
      </style>

      <div class="lb">
        <span></span><span></span><span></span><span></span>
        <span></span><span></span><span></span><span></span>
      </div>
      <h2 style="color:#fff;margin:0;font-size:1.3rem;font-weight:700">🎵 AI is Composing...</h2>
      <p id="loading-status" style="color:#a78bfa;margin:6px 0 0;font-size:0.85rem">Loading music engine...</p>
      <div class="progress-wrap"><div class="progress-fill" id="loading-bar"></div></div>

      <div class="quiz-box" id="quiz-box">
        <div style="text-align:center;color:#666;padding:20px">
          <i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;color:#7c3aed"></i>
          <p style="margin-top:10px;font-size:0.9rem">Loading quiz...</p>
        </div>
      </div>

      <p style="color:#444;font-size:0.75rem;margin-top:16px">Music generation runs in the background</p>
    `;
    document.body.appendChild(screen);
  }
  screen.style.display = 'flex';

  // Progress bar
  let progress = 0;
  const barEl = document.getElementById('loading-bar');
  const statusEl = document.getElementById('loading-status');
  const statuses = [
    'Initializing music engine...', 'Analyzing your prompt...',
    'Selecting instruments...', 'Generating melody patterns...',
    'Composing rhythm section...', 'Mixing audio layers...',
    'Applying mastering...', 'Almost ready...'
  ];
  let si = 0;
  screen._interval = setInterval(() => {
    progress = Math.min(progress + Math.random() * 6 + 2, 92);
    if (barEl) barEl.style.width = progress + '%';
    if (statusEl) statusEl.textContent = statuses[si % statuses.length];
    si++;
  }, 15000);

  // Load and run quiz
  loadQuiz();
}

// ── QUIZ ENGINE ───────────────────────────────────────────────
async function loadQuiz() {
  const box = document.getElementById('quiz-box');
  if (!box) return;

  let questions = [];
  let current = 0;
  let score = 0;
  let timerInterval = null;

  try {
    const res = await fetch('/api/quiz/questions');
    const data = await res.json();
    if (data.success) questions = data.questions;
  } catch(e) {
    questions = [
      {question:"How many strings does a standard guitar have?", options:["4","5","6","7"], answer:"6", fact:"Standard guitar has 6 strings tuned E-A-D-G-B-E"},
      {question:"What does BPM stand for?", options:["Bass Per Minute","Beats Per Minute","Bars Per Measure","Beat Pattern Mode"], answer:"Beats Per Minute", fact:"BPM measures the tempo of a song"},
      {question:"Who is the King of Pop?", options:["Elvis Presley","Michael Jackson","Prince","David Bowie"], answer:"Michael Jackson", fact:"Michael Jackson sold over 400 million records worldwide"},
    ];
  }

  function renderQuestion() {
    if (current >= questions.length) {
      renderResult(); return;
    }
    const q = questions[current];
    let timeLeft = 15;

    box.innerHTML = `
      <div class="quiz-header">
        <span style="color:#888;font-size:0.8rem">Question ${current+1}/${questions.length}</span>
        <span class="quiz-score">⭐ ${score} pts</span>
        <div class="quiz-timer" id="qtimer">${timeLeft}</div>
      </div>
      <div class="quiz-q">${q.question}</div>
      <div class="quiz-options">
        ${q.options.map(o => `<button class="quiz-opt" data-opt="${o}">${o}</button>`).join('')}
      </div>
      <div class="quiz-fact" id="qfact">💡 ${q.fact}</div>
      <button class="quiz-next" id="qnext">Next Question →</button>
    `;

    // Timer
    const timerEl = document.getElementById('qtimer');
    timerInterval = setInterval(() => {
      timeLeft--;
      if (timerEl) {
        timerEl.textContent = timeLeft;
        const pct = (timeLeft / 15) * 100;
        timerEl.style.background = `conic-gradient(${timeLeft > 5 ? '#7c3aed' : '#e74c3c'} ${pct}%, #2a2a3a 0)`;
      }
      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        revealAnswer(null);
      }
    }, 1000);

    // Option click
    box.querySelectorAll('.quiz-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        clearInterval(timerInterval);
        revealAnswer(btn.dataset.opt);
      });
    });
  }

  function revealAnswer(chosen) {
    const q = questions[current];
    box.querySelectorAll('.quiz-opt').forEach(btn => {
      btn.disabled = true;
      if (btn.dataset.opt === q.answer) btn.classList.add('correct');
      else if (btn.dataset.opt === chosen) btn.classList.add('wrong');
    });
    if (chosen === q.answer) score += 10;
    const factEl = document.getElementById('qfact');
    const nextEl = document.getElementById('qnext');
    if (factEl) factEl.style.display = 'block';
    if (nextEl) nextEl.style.display = 'block';
    if (nextEl) nextEl.addEventListener('click', () => { current++; renderQuestion(); });
  }

  function renderResult() {
    const emoji = score >= 40 ? '🏆' : score >= 20 ? '🎵' : '🎶';
    const msg   = score >= 40 ? 'Music Genius!' : score >= 20 ? 'Good Ear!' : 'Keep Listening!';
    box.innerHTML = `
      <div class="quiz-result">
        <div class="score-big">${emoji}</div>
        <h3>${msg}</h3>
        <p>You scored <strong style="color:#a78bfa">${score}/${questions.length*10}</strong> points</p>
        <p style="margin-top:8px;color:#555">Your music should be ready soon...</p>
        <button class="quiz-next" style="display:block;margin-top:16px" onclick="loadQuiz()">
          Play Again 🔄
        </button>
      </div>
    `;
  }

  renderQuestion();
}

function hideLoadingScreen() {
  const screen = document.getElementById('ai-loading-screen');
  if (!screen) return;
  const barEl = document.getElementById('loading-bar');
  if (barEl) barEl.style.width = '100%';
  clearInterval(screen._interval);
  setTimeout(() => screen.style.display = 'none', 500);
}

// ═══════════════════════════════════════════════════════════════
//  WAVEFORM VISUALIZER  (wavesurfer.js)
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
//  WAVEFORM VISUALIZER — Canvas only, zero WaveSurfer audio
//  audioPlayer is the ONLY audio engine. Canvas just visualises it.
// ═══════════════════════════════════════════════════════════════
function createWaveform(containerId, audioUrl, trackId) {
  if (waveSurfers[containerId]) {
    try { waveSurfers[containerId].destroy(); } catch(e) {}
  }
  const container = document.getElementById(containerId);
  if (!container) return { destroy:()=>{}, isPlaying:()=>false, play:()=>{}, pause:()=>{}, on:()=>{} };
  container.innerHTML = '';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:64px;cursor:pointer;border-radius:6px;display:block;';
  container.appendChild(canvas);

  const ctx2d = canvas.getContext('2d');
  let peaks = [], dur = 0, rafId = null;
  const C_BG = 'rgba(167,139,250,0.3)', C_FILL = '#7c3aed';

  function draw() {
    const W = canvas.width  = canvas.offsetWidth  || 300;
    const H = canvas.height = canvas.offsetHeight || 64;
    if (!peaks.length) return;
    const progress = dur > 0 ? Math.min(1, audioPlayer.currentTime / dur) : 0;
    const barW = W / peaks.length;
    const filled = Math.floor(progress * peaks.length);
    ctx2d.clearRect(0, 0, W, H);
    for (let i = 0; i < peaks.length; i++) {
      const bh = Math.max(2, peaks[i] * H * 0.9);
      ctx2d.fillStyle = i < filled ? C_FILL : C_BG;
      ctx2d.beginPath();
      if (ctx2d.roundRect) ctx2d.roundRect(i*barW+1,(H-bh)/2,Math.max(1,barW-2),bh,2);
      else ctx2d.rect(i*barW+1,(H-bh)/2,Math.max(1,barW-2),bh);
      ctx2d.fill();
    }
  }

  function startLoop() {
    cancelAnimationFrame(rafId);
    (function loop(){ draw(); rafId = requestAnimationFrame(loop); })();
  }

  // Show placeholder bars immediately so user sees something right away
  peaks = Array.from({length:120}, (_,i) => 0.2 + 0.5 * Math.abs(Math.sin(i * 0.25)));
  startLoop();

  // Decode audio in background to get real peaks
  (async () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      const resp = await fetch(audioUrl);
      const buf  = await resp.arrayBuffer();
      const decoded = await ac.decodeAudioData(buf);
      dur = decoded.duration;
      const durEl = document.getElementById(containerId + '-duration');
      if (durEl) durEl.textContent = formatTime(dur);
      const totalEl = document.getElementById('total-time');
      if (totalEl) totalEl.textContent = formatTime(dur);

      const BARS = 120, ch = decoded.getChannelData(0);
      const step = Math.floor(ch.length / BARS);
      peaks = [];
      for (let i = 0; i < BARS; i++) {
        let max = 0;
        for (let j = 0; j < step; j++) { const v = Math.abs(ch[i*step+j]||0); if(v>max) max=v; }
        peaks.push(max);
      }
      const maxP = Math.max(...peaks, 0.001);
      peaks = peaks.map(p => p / maxP);
      ac.close();
    } catch(e) {
      peaks = Array.from({length:120}, () => 0.3 + Math.random()*0.7);
      console.warn('Waveform decode failed, using fallback:', e.message);
    }
    // peaks updated — canvas loop continues running, it will pick up new peaks
  })();

  canvas.addEventListener('click', e => {
    const totalDur = dur || audioPlayer.duration;
    if (!totalDur) return;
    const pct  = (e.clientX - canvas.getBoundingClientRect().left) / canvas.offsetWidth;
    const time = pct * totalDur;
    audioPlayer.currentTime = time;
    const sl = document.querySelector('.progress-slider');
    if (sl && audioPlayer.duration) sl.value = (time / audioPlayer.duration) * 100;
    const curEl = document.getElementById('current-time');
    if (curEl) curEl.textContent = formatTime(time);
    const wCur = document.getElementById(containerId + '-current');
    if (wCur) wCur.textContent = formatTime(time);
    if (trackId) fetch(`/api/track/play/${trackId}`, {method:'POST'});
  });

  const onTimeUpdate = () => {
    const el = document.getElementById(containerId + '-current');
    if (el) el.textContent = formatTime(audioPlayer.currentTime);
  };
  audioPlayer.addEventListener('timeupdate', onTimeUpdate);

  // Store karaoke listeners so we can remove them on destroy
  const _shimListeners = {};

  const shim = {
    isPlaying: () => !audioPlayer.paused,
    play:      () => audioPlayer.play(),
    pause:     () => audioPlayer.pause(),
    getCurrentTime: () => audioPlayer.currentTime,
    destroy:   () => {
      cancelAnimationFrame(rafId);
      audioPlayer.removeEventListener('timeupdate', onTimeUpdate);
      if (_shimListeners['audioprocess']) {
        audioPlayer.removeEventListener('timeupdate', _shimListeners['audioprocess']);
      }
      container.innerHTML = '';
      delete waveSurfers[containerId];
    },
    // Map wavesurfer-style 'audioprocess' → audioPlayer timeupdate
    on: (event, cb) => {
      if (event === 'audioprocess') {
        const handler = () => cb(audioPlayer.currentTime);
        _shimListeners['audioprocess'] = handler;
        audioPlayer.addEventListener('timeupdate', handler);
      }
    },
  };
  waveSurfers[containerId] = shim;
  return shim;
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

// ═══════════════════════════════════════════════════════════════
//  GLOBAL PLAYER (footer)
// ═══════════════════════════════════════════════════════════════
function playTrack(url, title = 'AI Track', artist = 'AI Music Studio', trackId = null) {
  const player = document.getElementById('global-player');
  if (player) player.classList.remove('hidden');

  if (currentTrackUrl !== url) {
    audioPlayer.src = url;
    currentTrackUrl = url;

    // Update total time once metadata loads
    audioPlayer.addEventListener('loadedmetadata', () => {
      const totalEl = document.getElementById('total-time');
      if (totalEl) totalEl.textContent = formatTime(audioPlayer.duration);
    }, { once: true });

    if (trackId) fetch(`/api/track/play/${trackId}`, { method: 'POST' });
  }
  audioPlayer.play();

  const t = document.getElementById('playing-title');
  const a = document.getElementById('playing-artist');
  if (t) t.textContent = title;
  if (a) a.textContent = artist;
  const pp = $('.play-pause');
  if (pp) pp.innerHTML = '<i class="fa-solid fa-pause"></i>';
}

function initPlayerControls() {
  const pp  = $('.play-pause');
  const sl  = $('.progress-slider');

  if (pp) pp.addEventListener('click', () => {
    if (audioPlayer.paused) {
      audioPlayer.play().catch(() => {});
    } else {
      audioPlayer.pause();
    }
  });

  // Keep icon in sync with actual audio state (catches external pauses/plays too)
  audioPlayer.addEventListener('play',  () => { if (pp) pp.innerHTML = '<i class="fa-solid fa-pause"></i>'; });
  audioPlayer.addEventListener('pause', () => { if (pp) pp.innerHTML = '<i class="fa-solid fa-play"></i>'; });
  audioPlayer.addEventListener('ended', () => { if (pp) pp.innerHTML = '<i class="fa-solid fa-play"></i>'; });

  audioPlayer.addEventListener('timeupdate', () => {
    if (!sl || !audioPlayer.duration) return;
    sl.value = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    const currentEl = document.getElementById('current-time');
    if (currentEl) currentEl.textContent = formatTime(audioPlayer.currentTime);
  });

  if (sl) sl.addEventListener('input', () => {
    audioPlayer.currentTime = (sl.value / 100) * audioPlayer.duration;
  });

  // ── Volume control — simple and reliable ─────────────────
  // Set all sliders to 100% on init
  document.querySelectorAll('.volume-slider').forEach(v => { v.value = 100; });
  audioPlayer.volume = 1.0;

  // Single apply function used by all sliders
  function applyVolume(pct) {
    // 0-100 → 0.0 to 1.0 direct volume
    // 100-150 → try GainNode boost if available, else cap at 1.0
    const vol = Math.min(pct / 100, 1.0);
    audioPlayer.volume = vol;

    if (gainNode && pct > 100) {
      gainNode.gain.value = 1.0 + ((pct - 100) / 100);  // up to 2x
    } else if (gainNode) {
      gainNode.gain.value = pct / 100;
    }

    // Sync all sliders to same value
    document.querySelectorAll('.volume-slider').forEach(v => { v.value = pct; });
  }

  // Attach listener to every volume slider on the page
  document.querySelectorAll('.volume-slider').forEach(v => {
    v.addEventListener('input', () => applyVolume(parseInt(v.value)));
  });

  // ── Try Web Audio GainNode for boost above 100% ───────────
  // Only attempt AFTER user interaction to avoid browser policy errors
  document.addEventListener('click', () => {
    if (gainNode) return;  // already set up
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const audioCtx = new AudioContext();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const source = audioCtx.createMediaElementSource(audioPlayer);
      gainNode = audioCtx.createGain();
      gainNode.gain.value = 1.0;
      source.connect(gainNode);
      gainNode.connect(audioCtx.destination);
    } catch(e) {
      console.warn('GainNode setup failed, using standard volume:', e.message);
    }
  }, { once: true });
}

// ═══════════════════════════════════════════════════════════════
//  SIDEBAR
// ═══════════════════════════════════════════════════════════════
function initSidebar() {
  $$('.nav-menu button[title]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.getAttribute('title');
      if (t === 'Studio')    location.href = '/studio';
      if (t === 'Discovery') location.href = '/discovery';
      if (t === 'Profile')   location.href = '/profile';
      if (t === 'Gallery')   location.href = '/gallery';
    });
  });

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', () => location.href = '/api/auth/logout');

  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    if (localStorage.getItem('theme') === 'dark-theme') document.body.classList.add('dark-theme');
    themeBtn.addEventListener('click', () => {
      document.body.classList.toggle('dark-theme');
      localStorage.setItem('theme', document.body.classList.contains('dark-theme') ? 'dark-theme' : 'light');
      themeBtn.querySelector('i').className = document.body.classList.contains('dark-theme')
        ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    });
  }
}

// ═══════════════════════════════════════════════════════════════
//  LOGIN PAGE
// ═══════════════════════════════════════════════════════════════
function initLoginPage() {
  if (!document.getElementById('send-code-btn')) return;

  const emailBtn = document.getElementById('btn-email');
  const phoneBtn = document.getElementById('btn-phone');
  const input    = document.getElementById('main-input');
  const sendBtn  = document.getElementById('send-code-btn');
  const verifyBtn= document.getElementById('verify-btn');
  const step1    = document.getElementById('step-login');
  const step2    = document.getElementById('step-verify');
  const changeLink=document.getElementById('change-link');
  let timerInterval;

  emailBtn.addEventListener('click', () => {
    emailBtn.classList.add('active'); phoneBtn.classList.remove('active');
    input.placeholder = 'your@email.com'; input.type = 'email';
  });
  phoneBtn.addEventListener('click', () => {
    phoneBtn.classList.add('active'); emailBtn.classList.remove('active');
    input.placeholder = '+91 9876543210'; input.type = 'tel';
  });

  sendBtn.addEventListener('click', async () => {
    const id = input.value.trim();
    if (!id) return showToast('Enter email or phone', 'error');
    setLoading(sendBtn, true, 'Send Verification Code');
    const res  = await fetch('/api/auth/send-code', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ identifier: id })
    });
    const data = await res.json();
    setLoading(sendBtn, false, 'Send Verification Code');
    if (data.success) {
      step1.classList.add('hidden');
      step2.classList.remove('hidden');
      startTimer(); $$('.otp-box')[0].focus();
      // Show OTP on screen for Colab/dev use
      if (data.dev_otp) {
        const existing = document.getElementById('otp-hint');
        if (existing) existing.remove();
        const hint = document.createElement('div');
        hint.id = 'otp-hint';
        hint.style.cssText = 'background:#1e1533;border:1px solid #7c3aed;border-radius:8px;padding:12px;margin:12px 0;text-align:center;color:#a78bfa;font-size:0.9rem;';
        hint.innerHTML = `🔑 Your verification code: <strong style="font-size:1.5rem;letter-spacing:6px;display:block;margin-top:6px;color:#fff">${data.dev_otp}</strong>`;
        document.getElementById('step-verify').prepend(hint);
        // Auto-fill the boxes
        const boxes = $$('.otp-box');
        data.dev_otp.split('').forEach((d, i) => { if (boxes[i]) boxes[i].value = d; });
      }
    } else showToast(data.message, 'error');
  });

  $$('.otp-box').forEach((box, i, arr) => {
    box.addEventListener('input',   () => { if (box.value && arr[i+1]) arr[i+1].focus(); });
    box.addEventListener('keydown', e => { if (e.key==='Backspace' && !box.value && arr[i-1]) arr[i-1].focus(); });
  });

  verifyBtn.addEventListener('click', async () => {
    const otp = $$('.otp-box').map(b => b.value).join('');
    if (otp.length < 4) return showToast('Enter the 4-digit code', 'error');
    setLoading(verifyBtn, true, 'Verify & Continue');
    const res  = await fetch('/api/auth/verify', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ identifier: input.value.trim(), otp })
    });
    const data = await res.json();
    setLoading(verifyBtn, false, 'Verify & Continue');
    if (data.success) {
      showToast(`Welcome, ${data.user.name}!`, 'success');
      setTimeout(() => location.href = '/studio', 800);
    } else showToast(data.message, 'error');
  });

  changeLink.addEventListener('click', () => {
    step2.classList.add('hidden'); step1.classList.remove('hidden');
    clearInterval(timerInterval);
  });
  document.getElementById('resend-btn').addEventListener('click', () => sendBtn.click());

  function startTimer() {
    let t = 60;
    const el = document.getElementById('timer-val');
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (el) el.textContent = `${--t}s`;
      if (t <= 0) { clearInterval(timerInterval); if (el) el.textContent = 'Expired'; }
    }, 1000);
  }
}

// ═══════════════════════════════════════════════════════════════
//  STUDIO PAGE
// ═══════════════════════════════════════════════════════════════

// ── MOOD PRESETS ─────────────────────────────────────────────
const MOODS = {
  'Happy':    { prompt:'upbeat cheerful pop, bright piano, 120 BPM, major key, joyful', bass:50, melody:75, drummer:60 },
  'Sad':      { prompt:'melancholic slow piano ballad, minor key, 60 BPM, emotional strings', bass:30, melody:80, drummer:20 },
  'Epic':     { prompt:'cinematic orchestral epic, powerful brass, 90 BPM, massive drums, heroic', bass:70, melody:70, drummer:85 },
  'Chill':    { prompt:'lo-fi chill hop, soft jazz chords, 75 BPM, warm vinyl texture, relaxed', bass:55, melody:60, drummer:35 },
  'EDM':      { prompt:'electronic dance music, four-on-the-floor kick, 128 BPM, synth lead, drop', bass:80, melody:65, drummer:80 },
  'Romantic': { prompt:'romantic jazz, soft guitar, 70 BPM, gentle piano, warm saxophone, intimate', bass:40, melody:75, drummer:25 },
};

// ── GENRES ───────────────────────────────────────────────────
const GENRES = {
  'Lo-fi':     'lo-fi hip hop, dusty samples, vinyl crackle, chill beats',
  'Jazz':      'smooth jazz, improvised saxophone, upright bass, brushed drums',
  'EDM':       'electronic dance, synthesizer, four-on-the-floor, buildup and drop',
  'Cinematic': 'cinematic orchestral score, strings, brass, epic atmosphere',
  'Hip-Hop':   'hip hop, boom bap drums, deep bass, sampled melody',
  'Ambient':   'ambient atmospheric, evolving pads, no drums, spacious reverb',
};

function initStudioPage() {
  if (!document.querySelector('#main-generate-btn')) return;

  const promptInput    = document.getElementById('prompt-input');
  const durationSlider = document.getElementById('duration-slider');
  const timeLabel      = document.getElementById('time-label');
  const genBtn         = document.getElementById('main-generate-btn');
  const trackCont      = document.getElementById('generated-track-container');
  const refSelect      = document.getElementById('reference-track-select');
  const faders         = $$('.v-fader');
  const faderKeys      = ['drummer', 'melody', 'bass'];
  let activeFeature    = 'music';
  let karaokeTimestamps = [];
  let karaokeWS         = null;

  // Duration label
  if (durationSlider) durationSlider.addEventListener('input', () => {
    const s = parseInt(durationSlider.value);
    if (timeLabel) timeLabel.textContent =
      `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  });

  // Instrument chips
  $$('.instrument-chip').forEach(c => c.addEventListener('click', () => c.classList.toggle('active')));

  // ── FEATURE TABS ───────────────────────────────────────────
  $$('.feature-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeFeature = tab.dataset.feature;
      $$('.feature-tab').forEach(t => {
        t.style.background   = 'transparent';
        t.style.color        = '';
        t.style.borderColor  = '#e5e7eb';
      });
      tab.style.background  = '#7c3aed';
      tab.style.color       = '#fff';
      tab.style.borderColor = '#7c3aed';

      // Show/hide panels based on active tab
      const lyricsOpts  = document.getElementById('lyrics-options');
      const remixOpts   = document.getElementById('remix-options');
      const videoOpts   = document.getElementById('video-options');
      const promptCard  = document.getElementById('prompt-card');
      const refineCard  = document.getElementById('refine-card');

      if (lyricsOpts) lyricsOpts.classList.toggle('hidden', activeFeature !== 'lyrics');
      if (remixOpts)  remixOpts.classList.toggle('hidden',  activeFeature !== 'remix');
      if (videoOpts)  videoOpts.classList.toggle('hidden',  activeFeature !== 'video');
      // Hide prompt/refine for remix and video tabs
      if (promptCard) promptCard.classList.toggle('hidden', activeFeature === 'remix' || activeFeature === 'video');
      if (refineCard) refineCard.classList.toggle('hidden', activeFeature === 'remix' || activeFeature === 'video');
      if (genBtn)     genBtn.classList.toggle('hidden',     activeFeature === 'remix' || activeFeature === 'video');

      // Show mixer panel for all tabs (keeps right panel consistent)
      const mixerPanel = document.querySelector('.mixer-panel');
      if (mixerPanel) mixerPanel.style.display = '';
    });
  });

  // ── MASHUP DURATION SLIDER ─────────────────────────────────
  const mashupDurSlider = document.getElementById('mashup-duration-slider');
  const mashupDurLabel  = document.getElementById('mashup-duration-label');
  if (mashupDurSlider) {
    mashupDurSlider.addEventListener('input', () => {
      const s = parseInt(mashupDurSlider.value);
      if (mashupDurLabel) mashupDurLabel.textContent = s + 's';
    });
  }

  // ── REMIX FILES LABEL ──────────────────────────────────────
  const remixInput = document.getElementById('remix-files-input');
  const remixLabel = document.getElementById('remix-files-label');
  if (remixInput) {
    remixInput.addEventListener('change', () => {
      const n = remixInput.files.length;
      if (remixLabel) remixLabel.textContent = n > 0 ? `${n} file(s) selected` : 'Click to select 2-5 audio files';
    });
  }

  // ── VIDEO FILE LABEL — with drag & drop ───────────────────
  const videoInput = document.getElementById('video-upload-input');
  const videoLabel = document.getElementById('video-upload-name');
  const videoDropLabel = document.getElementById('video-drop-label');

  function setVideoFile(f) {
    if (!f || !f.type.startsWith('video/')) {
      showToast('Please select a video file', 'error'); return;
    }
    // Inject file into the input programmatically is not possible, 
    // so store it and use it on submit
    videoDropLabel._selectedFile = f;
    if (videoLabel) {
      videoLabel.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#10b981;margin-right:6px;"></i><strong style="color:#10b981;">${f.name}</strong> <span style="color:#888;font-size:0.8rem;">(${(f.size/1024/1024).toFixed(1)} MB)</span>`;
    }
    if (videoDropLabel) {
      videoDropLabel.style.borderColor = '#10b981';
      videoDropLabel.style.background  = '#f0fdf4';
    }
  }

  if (videoInput) {
    videoInput.addEventListener('change', () => {
      const f = videoInput.files[0];
      if (f) setVideoFile(f);
    });
  }

  if (videoDropLabel) {
    videoDropLabel.addEventListener('dragover', e => {
      e.preventDefault();
      videoDropLabel.style.borderColor = '#7c3aed';
      videoDropLabel.style.background  = '#f5f3ff';
    });
    videoDropLabel.addEventListener('dragleave', e => {
      if (!videoDropLabel.contains(e.relatedTarget)) {
        if (!videoDropLabel._selectedFile) {
          videoDropLabel.style.borderColor = '';
          videoDropLabel.style.background  = '';
        }
      }
    });
    videoDropLabel.addEventListener('drop', e => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      setVideoFile(f);
    });
    videoDropLabel.addEventListener('click', () => videoInput?.click());
  }

  // ── HELPER: show result after any generation ───────────────
  function showResult(track, lyrics, timestamps, stats) {
    if (trackCont) trackCont.classList.remove('hidden');
    const preview = document.getElementById('prompt-preview');
    if (preview) preview.textContent = track.promptPreview || track.title;

    // Video download link
    const vidLink = document.getElementById('video-download-link');
    if (vidLink) {
      if (track.videoUrl) {
        vidLink.href = track.videoUrl;
        vidLink.style.display = 'inline';
      } else {
        vidLink.style.display = 'none';
      }
    }

    // Show karaoke if lyrics provided
    const kContainer = document.getElementById('karaoke-container');
    const kWords     = document.getElementById('karaoke-words');
    const fullBox    = document.getElementById('full-lyrics-box');
    if (lyrics && kContainer && kWords) {
      kContainer.classList.remove('hidden');
      if (fullBox) fullBox.textContent = lyrics;
      karaokeTimestamps = timestamps || [];
      kWords.innerHTML = '';
      karaokeTimestamps.forEach((w, i) => {
        const span = document.createElement('span');
        span.id = `kw-${i}`;
        span.textContent = w.word;
        span.style.cssText = 'transition:all 0.25s;opacity:0.3;color:#555;padding:2px;border-radius:4px;';
        kWords.appendChild(span);
      });
    } else if (kContainer) {
      kContainer.classList.add('hidden');
    }

    // Toggle full lyrics
    const toggleBtn = document.getElementById('toggle-full-lyrics');
    if (toggleBtn && fullBox) {
      toggleBtn.onclick = () => {
        const shown = fullBox.style.display !== 'none';
        fullBox.style.display = shown ? 'none' : 'block';
        toggleBtn.textContent = shown ? 'Show All Lyrics' : 'Hide Lyrics';
      };
    }

    // Waveform
    let waveContainer = document.getElementById('waveform-output');
    if (!waveContainer) {
      waveContainer = document.createElement('div');
      waveContainer.id = 'waveform-output';
      waveContainer.style.cssText = 'margin:16px 0;';
      waveContainer.innerHTML = `
        <div id="waveform-box"></div>
        <div style="display:flex;justify-content:space-between;font-size:.8rem;color:#888;margin-top:4px;">
          <span id="waveform-box-current">0:00</span>
          <span id="waveform-box-duration">--:--</span>
        </div>`;
      const actionBtns = trackCont.querySelector('.action-buttons');
      if (actionBtns) trackCont.insertBefore(waveContainer, actionBtns);
      else trackCont.appendChild(waveContainer);
    }

    karaokeWS = createWaveform('waveform-box', track.audioUrl, track.id);

    // Karaoke sync on audio play
    if (karaokeTimestamps.length > 0) {
      let lastIdx = -1;
      karaokeWS.on('audioprocess', () => {
        const t = karaokeWS.getCurrentTime();
        for (let i = karaokeTimestamps.length - 1; i >= 0; i--) {
          if (t >= karaokeTimestamps[i].time) {
            if (i !== lastIdx) {
              if (lastIdx >= 0) {
                const prev = document.getElementById(`kw-${lastIdx}`);
                if (prev) { prev.style.opacity='0.35'; prev.style.color='#666'; prev.style.transform='scale(1)'; prev.style.fontWeight=''; }
              }
              const cur = document.getElementById(`kw-${i}`);
              if (cur) {
                cur.style.opacity='1'; cur.style.color='#a78bfa';
                cur.style.transform='scale(1.18)'; cur.style.fontWeight='700';
                cur.scrollIntoView({block:'nearest', behavior:'smooth'});
              }
              lastIdx = i;
            }
            break;
          }
        }
      });
    }

    // Play button — audioPlayer is the only audio engine
    const playBtn = trackCont.querySelector('.play-btn');
    if (playBtn) {
      const trackFile = track.audioUrl.split('/').pop();
      playBtn.onclick = () => {
        if (!audioPlayer.paused && audioPlayer.src.includes(trackFile)) {
          audioPlayer.pause();
        } else {
          playTrack(track.audioUrl, track.title, track.artist, track.id);
        }
      };
      const syncIcon = () => {
        const playing = !audioPlayer.paused && audioPlayer.src.includes(trackFile);
        playBtn.innerHTML = playing ? '<i class="fa-solid fa-pause"></i> Pause' : '<i class="fa-solid fa-play"></i> Play';
      };
      audioPlayer.addEventListener('play',  syncIcon);
      audioPlayer.addEventListener('pause', syncIcon);
      audioPlayer.addEventListener('ended', syncIcon);
    }

    // Download button
    const dlBtn = trackCont.querySelector('.download-btn');
    if (dlBtn) dlBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = track.audioUrl; a.download = track.filename || 'track.wav'; a.click();
    };

    // Stats
    if (stats) showGenStats(stats);

    // Add to ref selector
    if (refSelect && track.filename) {
      const opt = new Option(track.title, track.filename);
      refSelect.appendChild(opt);
    }
  }

  // ── REMIX BUTTON — handled by fmStartMix() in index.html ──
  // (The flashmob mixer manages its own file list and playback)



  // ── VIDEO MODE TOGGLE ──────────────────────────────────────
  window.switchVideoMode = function(mode) {
    const aiPanel      = document.getElementById('video-mode-ai');
    const suggestPanel = document.getElementById('video-mode-suggest');
    const aiBtn        = document.getElementById('mode-ai-btn');
    const suggestBtn2  = document.getElementById('mode-suggest-btn');
    if (!aiPanel || !suggestPanel) return;
    if (mode === 'ai') {
      aiPanel.style.display      = '';
      suggestPanel.style.display = 'none';
      if (aiBtn)       { aiBtn.style.background = '#7c3aed'; aiBtn.style.color = '#fff'; }
      if (suggestBtn2) { suggestBtn2.style.background = '#f9fafb'; suggestBtn2.style.color = '#555'; }
    } else {
      aiPanel.style.display      = 'none';
      suggestPanel.style.display = '';
      if (suggestBtn2) { suggestBtn2.style.background = '#10b981'; suggestBtn2.style.color = '#fff'; }
      if (aiBtn)       { aiBtn.style.background = '#f9fafb'; aiBtn.style.color = '#555'; }
    }
  };

  // ── OCCASION CHIPS (suggest mode) ─────────────────────────
  const occasionChips = document.getElementById('occasion-chips');
  const occasionInput = document.getElementById('video-occasion-input');
  if (occasionChips) {
    occasionChips.querySelectorAll('.occasion-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const wasActive = chip.dataset.selected === 'true';
        occasionChips.querySelectorAll('.occasion-chip').forEach(c => {
          c.style.background = ''; c.style.color = ''; c.style.borderColor = '';
          c.dataset.selected = 'false';
        });
        if (!wasActive) {
          chip.style.background  = '#10b981';
          chip.style.color       = '#fff';
          chip.style.borderColor = '#10b981';
          chip.dataset.selected  = 'true';
          if (occasionInput) occasionInput.value = chip.dataset.val;
        } else {
          if (occasionInput) occasionInput.value = '';
        }
      });
    });
  }

  // ── AI BGM MOOD CHIPS ──────────────────────────────────────
  const moodInput = document.getElementById('video-mood-input');
  document.querySelectorAll('#video-mode-ai .occasion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const wasActive = chip.dataset.selected === 'true';
      document.querySelectorAll('#video-mode-ai .occasion-chip').forEach(c => {
        c.style.background = ''; c.style.color = ''; c.style.borderColor = '';
        c.dataset.selected = 'false';
      });
      if (!wasActive) {
        chip.style.background  = '#7c3aed';
        chip.style.color       = '#fff';
        chip.style.borderColor = '#7c3aed';
        chip.dataset.selected  = 'true';
        if (moodInput) moodInput.value = chip.dataset.val;
      } else {
        if (moodInput) moodInput.value = '';
      }
    });
  });

  // ── VIDEO PROMPT ENHANCE BUTTON ────────────────────────────
  const videoEnhanceBtn   = document.getElementById('video-enhance-btn');
  const videoPromptInput  = document.getElementById('video-prompt-input');
  if (videoEnhanceBtn && videoPromptInput) {
    videoEnhanceBtn.addEventListener('click', async () => {
      const txt = videoPromptInput.value.trim();
      if (!txt) return showToast('Type a music description first', 'error');
      setLoading(videoEnhanceBtn, true, '<i class="fa-solid fa-wand-sparkles"></i> Enhancing...');
      try {
        const res  = await fetch('/api/enhance-prompt', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ prompt: txt })
        });
        const data = await res.json();
        setLoading(videoEnhanceBtn, false, '<i class="fa-solid fa-wand-sparkles"></i> Enhance Prompt');
        if (data.success) { videoPromptInput.value = data.enhanced_prompt; showToast('Prompt enhanced!','success'); }
        else showToast(data.message || 'Enhancement failed', 'error');
      } catch(e) {
        setLoading(videoEnhanceBtn, false, '<i class="fa-solid fa-wand-sparkles"></i> Enhance Prompt');
        showToast('Error: ' + e.message, 'error');
      }
    });
  }

  // ── SUGGEST SONGS BUTTON ───────────────────────────────────
  const suggestBtn = document.getElementById('suggest-songs-btn');
  if (suggestBtn) {
    suggestBtn.addEventListener('click', async () => {
      const occasion     = document.getElementById('video-occasion-input')?.value.trim() || '';
      const customPrompt = document.getElementById('video-prompt-input')?.value.trim() || '';
      const context = occasion || customPrompt || 'general background music';

      // Show loading state inside the panel immediately
      const panel = document.getElementById('song-suggestions-panel');
      const list  = document.getElementById('song-suggestions-list');
      const badge = document.getElementById('suggest-count-badge');
      if (panel && list) {
        panel.style.display = 'block';
        list.innerHTML = `<div style="text-align:center;padding:24px;color:#888;">
          <i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;color:#10b981;margin-bottom:10px;display:block;"></i>
          Finding the best songs for your video…
        </div>`;
        if (badge) badge.textContent = '';
      }

      setLoading(suggestBtn, true, '<i class="fa-solid fa-spinner fa-spin"></i> Finding songs...');
      try {
        const res  = await fetch('/api/video-suggest-songs', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ occasion, mood: customPrompt, custom_prompt: context })
        });
        const data = await res.json();
        setLoading(suggestBtn, false, '<i class="fa-solid fa-magnifying-glass"></i> Suggest Songs for My Video');
        if (!data.success) {
          if (list) list.innerHTML = `<div style="text-align:center;padding:20px;color:#e55;">${data.message || 'Could not get suggestions'}</div>`;
          return;
        }

        if (badge) badge.textContent = `${data.songs.length} songs found`;

        const vibeColor = {
          emotional:'#7c3aed', energetic:'#ef4444', celebratory:'#f59e0b',
          romantic:'#ec4899', peaceful:'#10b981', upbeat:'#3b82f6', default:'#6b7280'
        };

        list.innerHTML = data.songs.map(s => {
          const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(s.youtube_search || s.title + ' ' + s.artist)}`;
          const spUrl = `https://open.spotify.com/search/${encodeURIComponent(s.title + ' ' + s.artist)}`;
          const color = vibeColor[s.vibe?.toLowerCase()] || vibeColor.default;
          return `
            <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;
                        border:1px solid #e5e7eb;border-radius:12px;margin-bottom:8px;background:#fafafa;">
              <div style="width:44px;height:44px;min-width:44px;border-radius:10px;
                          background:linear-gradient(135deg,${color}33,${color}66);
                          display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🎵</div>
              <div style="flex:1;min-width:0;">
                <strong style="display:block;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.title}</strong>
                <span style="font-size:0.78rem;color:#888;">${s.artist}</span>
                <span style="display:block;font-size:0.73rem;color:#aaa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.why}</span>
              </div>
              <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0;align-items:flex-end;">
                <span style="font-size:0.68rem;padding:2px 8px;border-radius:20px;
                             background:${color}22;color:${color};font-weight:600;">${s.vibe || 'fit'}</span>
                <div style="display:flex;gap:5px;">
                  <a href="${ytUrl}" target="_blank"
                     style="display:flex;align-items:center;gap:3px;padding:5px 9px;
                            background:#FF0000;color:#fff;border-radius:7px;
                            font-size:0.72rem;font-weight:600;text-decoration:none;">
                    <i class="fa-brands fa-youtube"></i> YT
                  </a>
                  <a href="${spUrl}" target="_blank"
                     style="display:flex;align-items:center;gap:3px;padding:5px 9px;
                            background:#1DB954;color:#fff;border-radius:7px;
                            font-size:0.72rem;font-weight:600;text-decoration:none;">
                    <i class="fa-brands fa-spotify"></i> SP
                  </a>
                </div>
              </div>
            </div>`;
        }).join('');
        showToast(`${data.songs.length} song suggestions ready!`, 'success');
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch(e) {
        setLoading(suggestBtn, false, '<i class="fa-solid fa-magnifying-glass"></i> Suggest Songs for My Video');
        if (list) list.innerHTML = `<div style="text-align:center;padding:20px;color:#e55;">Error: ${e.message}</div>`;
        showToast('Suggestion error: ' + e.message, 'error');
      }
    });
  }

  // ── VIDEO BGM BUTTON ───────────────────────────────────────
  const videoBgmBtn = document.getElementById('video-bgm-btn');
  if (videoBgmBtn) {
    videoBgmBtn.addEventListener('click', async () => {
      const file = videoDropLabel?._selectedFile || videoInput?.files[0];
      if (!file) return showToast('Please select a video first', 'error');
      // Build richer mood from mood chips + manual input
      const moodChip     = document.querySelector('#video-mode-ai .occasion-chip[data-selected="true"]');
      const moodChipVal  = moodChip ? moodChip.dataset.val : '';
      const moodManual   = document.getElementById('video-mood-input')?.value.trim() || '';
      const mood         = [moodManual, moodChipVal].filter(Boolean).join(', ') || 'cinematic background music';
      const fd = new FormData();
      fd.append('video', file, file.name);
      fd.append('mood', mood);
      setLoading(videoBgmBtn, true, '<i class="fa-solid fa-wand-magic-sparkles"></i> Generating AI BGM...');
      showLoadingScreen();
      try {
        const res  = await fetch('/api/video-bgm-replace', { method: 'POST', body: fd });
        const data = await res.json();
        hideLoadingScreen();
        setLoading(videoBgmBtn, false, '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate AI BGM');
        if (data.success) { showToast('Video BGM generated!', 'success'); showResult(data.track, null, null, null); }
        else showToast(data.message || 'Video BGM failed', 'error');
      } catch(e) {
        hideLoadingScreen();
        setLoading(videoBgmBtn, false, '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate AI BGM');
        showToast('Error: ' + e.message, 'error');
      }
    });
  }

  // ── LOAD MODEL INFO ON STARTUP ─────────────────────────────
  async function loadModelInfo() {
    try {
      const res  = await fetch('/api/model-info');
      const data = await res.json();
      if (!data.success) return;
      const m = data.model;
      const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
      set('mi-name',    m.name);
      set('mi-creator', m.creator);
      set('mi-params',  m.parameters);
      set('mi-arch',    m.architecture);
      set('mi-train',   m.training_data);
      set('mi-fad',     m.fad_score);
      set('mi-mos',     m.mos_score);
      set('mi-device',  m.device);
      set('mi-status',  m.status);
      const statusEl = document.getElementById('mi-status');
      if (statusEl) statusEl.style.color = m.status === 'Loaded' ? '#10b981' : '#ef4444';
    } catch(e) { console.log('Model info load failed', e); }
  }
  loadModelInfo();

  // ── SHOW GENERATION STATS ──────────────────────────────────
  function showGenStats(stats) {
    if (!stats) return;
    const card = document.getElementById('gen-stats-card');
    if (card) card.classList.remove('hidden');
    const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    set('gs-time',     stats.generation_time + 's');
    set('gs-device',   stats.device);
    set('gs-duration', stats.duration + 's');
    set('gs-model',    stats.model);
    set('quality-score',    stats.quality_score + '%');
    set('quality-feedback', stats.quality_feedback);
    const bar = document.getElementById('quality-bar');
    if (bar) setTimeout(() => bar.style.width = stats.quality_score + '%', 100);
  }

  // ── GENRE CHIPS (inject into DOM) ──────────────────────────
  const instrCard = document.querySelector('.instrument-list')?.parentElement;
  if (instrCard) {
    const genreSection = document.createElement('div');
    genreSection.className = 'input-card';
    genreSection.innerHTML = `
      <h3>Genre</h3>
      <div class="genre-list">
        ${Object.keys(GENRES).map(g =>
          `<button class="genre-chip" data-genre="${g}">${g}</button>`
        ).join('')}
      </div>`;
    instrCard.parentElement.insertBefore(genreSection, instrCard);

    $$('.genre-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        // Read active state BEFORE any DOM mutation
        const wasActive = chip.dataset.selected === 'true';

        // Clear all chips
        $$('.genre-chip').forEach(c => {
          c.classList.remove('active');
          c.dataset.selected = 'false';
        });

        if (wasActive) {
          // Toggle OFF — deselect
          if (promptInput) promptInput.value = '';
          showToast('Genre deselected', 'info');
        } else {
          // Toggle ON — select this chip
          chip.classList.add('active');
          chip.dataset.selected = 'true';
          if (promptInput) promptInput.value = GENRES[chip.dataset.genre];
          showToast(`${chip.dataset.genre} genre selected`, 'success');
        }
      });
    });
  }

  // ── MOOD BOARD (inject into DOM) ───────────────────────────
  const workspace = document.querySelector('.workspace');
  if (workspace) {
    const moodSection = document.createElement('section');
    moodSection.className = 'mood-board input-card';
    moodSection.innerHTML = `
      <h3>Quick Mood</h3>
      <div class="mood-grid">
        ${Object.entries({
          Happy:'😊', Sad:'😢', Epic:'⚡', Chill:'🌊', EDM:'🎛️', Romantic:'💜'
        }).map(([m, emoji]) =>
          `<button class="mood-card" data-mood="${m}">
            <span class="mood-emoji">${emoji}</span>
            <span>${m}</span>
          </button>`
        ).join('')}
      </div>`;
    workspace.insertBefore(moodSection, workspace.firstChild);

    $$('.mood-card').forEach(card => {
      card.addEventListener('click', () => {
        $$('.mood-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const preset = MOODS[card.dataset.mood];
        if (!preset) return;
        if (promptInput) promptInput.value = preset.prompt;
        // Set fader values
        faders.forEach((f, i) => {
          const key = faderKeys[i];
          if (preset[key] !== undefined) f.value = preset[key];
        });
        showToast(`${card.dataset.mood} mood applied!`, 'success');
      });
    });
  }

  // ── ENHANCE PROMPT ─────────────────────────────────────────
  const enhanceBtn = document.querySelector('.prompt-tools button:first-child');
  if (enhanceBtn && promptInput) {
    enhanceBtn.addEventListener('click', async () => {
      const txt = promptInput.value.trim();
      if (!txt) return showToast('Type a prompt first', 'error');
      setLoading(enhanceBtn, true, '<i class="fa-solid fa-wand-sparkles"></i> Enhance Prompt');
      const res  = await fetch('/api/enhance-prompt', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ prompt: txt })
      });
      const data = await res.json();
      setLoading(enhanceBtn, false, '<i class="fa-solid fa-wand-sparkles"></i> Enhance Prompt');
      if (data.success) { promptInput.value = data.enhanced_prompt; showToast('Prompt enhanced!','success'); }
      else showToast(data.message || 'Enhancement failed', 'error');
    });
  }

  // ── VOICE INPUT ────────────────────────────────────────────
  const voiceBtn = document.querySelector('.prompt-tools button:last-child');
  if (voiceBtn && promptInput) {
    voiceBtn.addEventListener('click', async () => {
      if (!isRecording) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaRecorder = new MediaRecorder(stream);
          audioChunks   = [];
          mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
          mediaRecorder.onstop = async () => {
            const blob = new Blob(audioChunks, { type:'audio/wav' });
            const fd   = new FormData(); fd.append('audio', blob, 'voice.wav');
            setLoading(voiceBtn, true, '');
            const res  = await fetch('/api/voice-input', { method:'POST', body: fd });
            const data = await res.json();
            setLoading(voiceBtn, false, '<i class="fa-solid fa-microphone"></i> Voice Input');
            if (data.success) { promptInput.value = data.transcript; showToast('Voice captured!','success'); }
            else showToast(data.message || 'Not understood', 'error');
          };
          mediaRecorder.start(); isRecording = true;
          voiceBtn.innerHTML = '<i class="fa-solid fa-stop" style="color:red"></i> Stop';
        } catch { showToast('Microphone access denied', 'error'); }
      } else {
        mediaRecorder.stop(); isRecording = false;
      }
    });
  }

  // ── GENERATE ───────────────────────────────────────────────
  genBtn.addEventListener('click', async () => {
    const prompt      = promptInput?.value.trim() || '';
    const duration    = parseInt(durationSlider?.value || 20);
    const instruments = $$('.instrument-chip.active').map(c => c.textContent.trim());
    const levels      = {};
    faders.forEach((f, i) => levels[faderKeys[i]] = parseInt(f.value));
    const refFilename = refSelect?.value || '';

    if (!prompt) return showToast('Describe your music first', 'error');

    showLoadingScreen();
    let res, data;

    try {
      if (activeFeature === 'lyrics') {
        // Music + Karaoke Lyrics
        const language = document.getElementById('lyrics-language')?.value || 'English';
        const style    = document.getElementById('lyrics-style')?.value || '';
        res  = await fetch('/api/generate-with-lyrics', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ prompt, duration, instruments, ...levels, language, style })
        });
        data = await res.json();
        hideLoadingScreen();
        if (data.success) {
          showToast('Music + Lyrics generated!', 'success');
          showResult(data.track, data.lyrics, data.word_timestamps, data.stats);
        } else showToast(data.message || 'Generation failed', 'error');

      } else if (refFilename) {
        // Refine existing track
        const audioRes = await fetch(`/static/generated/${refFilename}`);
        const blob     = await audioRes.blob();
        const fd       = new FormData();
        fd.append('file', blob, refFilename);
        fd.append('prompt', prompt);
        fd.append('duration', duration);
        instruments.forEach(i => fd.append('instruments', i));
        Object.entries(levels).forEach(([k,v]) => fd.append(k, v));
        res  = await fetch('/api/generate-music', { method:'POST', body: fd });
        data = await res.json();
        hideLoadingScreen();
        if (data.success) { showToast('Music generated!', 'success'); showResult(data.track, null, null, data.stats); }
        else showToast(data.message || 'Generation failed', 'error');

      } else {
        // Standard music generation
        res  = await fetch('/api/generate-music', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ prompt, duration, instruments, ...levels })
        });
        data = await res.json();
        hideLoadingScreen();
        if (data.success) { showToast('Music generated!', 'success'); showResult(data.track, null, null, data.stats); }
        else showToast(data.message || 'Generation failed', 'error');
      }
    } catch(e) {
      hideLoadingScreen();
      showToast('Error: ' + e.message, 'error');
    }
  });

  // Refresh track list
  const refreshBtn = document.getElementById('refresh-tracks-btn');
  if (refreshBtn && refSelect) {
    refreshBtn.addEventListener('click', async () => {
      const res  = await fetch('/api/profile/history');
      const data = await res.json();
      if (data.success) {
        while (refSelect.options.length > 1) refSelect.remove(1);
        data.tracks.forEach(t => refSelect.appendChild(new Option(t.title, t.filename)));
        showToast('Track list refreshed', 'success');
      }
    });
  }
   
// ── VIDEO BGM ─────────────────────────────────────────────────
(function initVideoBGM() {
  const dropZone  = document.getElementById('video-drop-zone');
  const fileInput = document.getElementById('video-upload');
  const moodInput = document.getElementById('bgm-mood-input');
  const genBtn    = document.getElementById('bgm-generate-btn');
  const result    = document.getElementById('bgm-result');
  const fileLabel = document.getElementById('video-filename');
  if (!dropZone || !genBtn) return;

  let selectedFile = null;

  // Drag & drop events
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.style.borderColor = '#7c3aed';
    dropZone.style.background  = '#f5f3ff';
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.style.borderColor = '';
    dropZone.style.background  = '';
  });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.style.borderColor = '';
    dropZone.style.background  = '';
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
      selectedFile = file;
      if (fileLabel) fileLabel.textContent = `✓ ${file.name}`;
    } else {
      showToast('Please drop a video file', 'error');
    }
  });

  // Browse file
  fileInput.addEventListener('change', () => {
    selectedFile = fileInput.files[0];
    if (selectedFile && fileLabel) fileLabel.textContent = `✓ ${selectedFile.name}`;
  });

  // Generate BGM
  genBtn.addEventListener('click', async () => {
    if (!selectedFile) return showToast('Please upload a video first', 'error');
    const mood = moodInput?.value.trim() || 'calm background music';

    const fd = new FormData();
    fd.append('video', selectedFile, selectedFile.name);
    fd.append('mood', mood);

    showLoadingScreen();
    const res  = await fetch('/api/video-bgm', { method: 'POST', body: fd });
    const data = await res.json();
    hideLoadingScreen();

    if (data.success) {
      const track = data.track;
      showToast('BGM generated!', 'success');
      result.classList.remove('hidden');

      const moodPreview = document.getElementById('bgm-mood-preview');
      const durPreview  = document.getElementById('bgm-duration-preview');
      if (moodPreview) moodPreview.textContent = mood;
      if (durPreview)  durPreview.textContent  =
        `${Math.floor(track.duration/60)}:${String(track.duration%60).padStart(2,'0')}`;

      // Waveform
      const ws = createWaveform('bgm-waveform', track.audioUrl, track.id);

      const playBtn = document.getElementById('bgm-play-btn');
      const dlBtn   = document.getElementById('bgm-download-btn');
      if (playBtn) playBtn.onclick = () => ws.playPause();
      if (dlBtn)   dlBtn.onclick   = () => {
        const a = document.createElement('a');
        a.href = track.audioUrl; a.download = track.filename; a.click();
      };
    } else {
      showToast(data.message || 'BGM generation failed', 'error');
    }
  });
})();


// ── LYRICS GENERATOR ──────────────────────────────────────────
(function initLyricsGenerator() {
  const descInput = document.getElementById('lyrics-description');
  const genBtn    = document.getElementById('lyrics-generate-btn');
  const result    = document.getElementById('lyrics-result');
  const output    = document.getElementById('lyrics-output');
  const copyBtn   = document.getElementById('copy-lyrics-btn');
  const useBtn    = document.getElementById('use-music-prompt-btn');
  if (!genBtn) return;

  let selectedLang    = 'English';
  let savedMusicPrompt = '';

  // Language chip selection
  $$('.lang-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $$('.lang-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedLang = chip.dataset.lang;
    });
  });

  // Generate lyrics
  genBtn.addEventListener('click', async () => {
    const description = descInput?.value.trim() || '';
    if (!description) return showToast('Describe your song first', 'error');

    setLoading(genBtn, true, '<i class="fa-solid fa-pen-nib"></i> Generate Lyrics');

    const res  = await fetch('/api/generate-lyrics', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, language: selectedLang })
    });
    const data = await res.json();
    setLoading(genBtn, false, '<i class="fa-solid fa-pen-nib"></i> Generate Lyrics');

    if (data.success) {
      result.classList.remove('hidden');
      if (output) output.textContent = data.lyrics;
      savedMusicPrompt = data.music_prompt || description;
      showToast(`Lyrics generated in ${data.language}!`, 'success');

      // Scroll to result
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      showToast(data.message || 'Lyrics generation failed', 'error');
    }
  });

  // Copy lyrics
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const text = output?.textContent || '';
      navigator.clipboard.writeText(text).then(() => {
        showToast('Lyrics copied!', 'success');
      });
    });
  }

  // Send music prompt to studio and scroll up
  if (useBtn) {
    useBtn.addEventListener('click', () => {
      const promptInput = document.getElementById('prompt-input');
      if (promptInput && savedMusicPrompt) {
        promptInput.value = savedMusicPrompt;
        promptInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        promptInput.style.border = '2px solid #7c3aed';
        setTimeout(() => promptInput.style.border = '', 2000);
        showToast('Prompt filled! Click Generate Music to make the instrumental.', 'success');
      }
    });
  }
})();

}

// ═══════════════════════════════════════════════════════════════
//  DISCOVERY PAGE
// ═══════════════════════════════════════════════════════════════
function initDiscoveryPage() {
  if (!document.querySelector('.discovery-grid')) return;

  const startMsg    = document.getElementById('start-searching-msg');
  const resultsList = document.getElementById('results-list');

  function showResults(tracks, heard = null) {
    if (startMsg)    startMsg.classList.add('hidden');
    if (resultsList) resultsList.classList.remove('hidden');
    $$('.track-item', resultsList).forEach(el => el.remove());
    const heardEl = document.getElementById('heard-text');
    if (heardEl) heardEl.remove();

    if (heard) {
      const p = document.createElement('p');
      p.id = 'heard-text';
      p.style.cssText = 'color:#888;font-size:.85rem;margin:0 0 12px;';
      p.textContent = `You said: "${heard}"`;
      resultsList.appendChild(p);
    }

    if (!tracks?.length) {
      resultsList.innerHTML += '<p style="color:#888;padding:10px">No results found</p>';
      return;
    }

    tracks.forEach((t, i) => {
      const div = document.createElement('div');
      div.className = 'track-item';
      div.style.cssText = 'display:flex;align-items:center;padding:14px 16px;gap:14px;border:1px solid var(--border-gray);border-radius:14px;margin-bottom:10px;';
      div.innerHTML = `
        <div class="track-art" style="width:52px;height:52px;min-width:52px;background:linear-gradient(135deg,#00d9ff,#00ff8c);border-radius:10px;display:flex;align-items:center;justify-content:center;color:white;font-size:1.1rem;">
          <i class="fa-solid fa-music"></i>
        </div>
        <div class="track-details" style="flex:1;min-width:0;overflow:hidden;">
          <strong style="display:block;font-size:0.95rem;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.title || 'Unknown'}</strong>
          <span style="display:block;font-size:0.8rem;color:#888;margin-bottom:2px;">${t.artist || 'Unknown'} ${t.genre ? '• ' + t.genre : ''}</span>
          ${t.description ? `<span style="display:block;font-size:0.75rem;color:#aaa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.description}</span>` : ''}
        </div>
        <div class="track-actions" style="display:flex;gap:8px;flex-shrink:0;">
          <button class="track-action-btn" title="Search on YouTube" onclick="window.open('https://www.youtube.com/results?search_query=${encodeURIComponent((t.title||'') + ' ' + (t.artist||''))}','_blank')" style="width:44px;height:44px;border:1.5px solid #FF0000;border-radius:8px;background:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#FF0000;font-size:1.1rem;transition:all 0.2s;">
            <i class="fa-brands fa-youtube"></i>
          </button>
          <button class="track-action-btn" title="Search on Spotify" onclick="window.open('https://open.spotify.com/search/${encodeURIComponent((t.title||'') + ' ' + (t.artist||''))}','_blank')" style="width:44px;height:44px;border:1.5px solid #1DB954;border-radius:8px;background:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#1DB954;font-size:1.1rem;transition:all 0.2s;">
            <i class="fa-brands fa-spotify"></i>
          </button>
        </div>`;
      resultsList.appendChild(div);
    });
  }

  // ── VOICE SEARCH (replaces hum) ────────────────────────────
  const recordCircle = document.querySelector('.record-circle');
  const humStatus    = document.querySelector('.hum-action p');
  if (recordCircle) {
    // Update label
    const h3 = recordCircle.closest('section')?.querySelector('h3');
    if (h3) h3.textContent = 'Voice Search';
    if (humStatus) humStatus.textContent = 'Tap and say a song name or description';

    recordCircle.addEventListener('click', async () => {
      if (!isRecording) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaRecorder = new MediaRecorder(stream);
          audioChunks   = [];
          mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
          mediaRecorder.onstop = async () => {
            if (humStatus) humStatus.textContent = 'Identifying...';
            recordCircle.style.background = '';
            const blob = new Blob(audioChunks, { type:'audio/wav' });
            const fd   = new FormData(); fd.append('audio', blob, 'search.wav');
            const res  = await fetch('/api/discovery/voice-search', { method:'POST', body: fd });
            const data = await res.json();
            if (data.success) {
              showResults(data.results, data.heard);
              if (humStatus) humStatus.textContent = 'Tap and say a song name or description';
            } else {
              showToast(data.message || 'Not understood', 'error');
              if (humStatus) humStatus.textContent = 'Tap to try again';
            }
          };
          mediaRecorder.start(); isRecording = true;
          recordCircle.style.background = '#e74c3c';
          if (humStatus) humStatus.textContent = 'Listening... tap to stop';
        } catch { showToast('Microphone access denied', 'error'); }
      } else {
        mediaRecorder.stop();
        mediaRecorder.stream?.getTracks().forEach(t => t.stop());
        isRecording = false;
      }
    });
  }

  // ── LYRIC SEARCH ───────────────────────────────────────────
  const lyricInput = document.getElementById('lyric-input');
  const searchBtn  = document.querySelector('.btn-search');
  async function doLyricSearch() {
    const lyric = lyricInput?.value.trim() || '';
    if (!lyric) return showToast('Enter some lyrics first', 'error');
    setLoading(searchBtn, true, '<i class="fa-solid fa-magnifying-glass"></i> Search');
    const activeLangBtn = document.querySelector('.lang-filter-btn.active');
    const searchLang = activeLangBtn?.dataset?.lang || 'any';
    const res  = await fetch('/api/discovery/lyric-search', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ lyric, language: searchLang })
    });
    const data = await res.json();
    setLoading(searchBtn, false, '<i class="fa-solid fa-magnifying-glass"></i> Search');
    if (data.success) showResults(data.results);
    else showToast(data.message || 'Search failed', 'error');
  }
  if (searchBtn)  searchBtn.addEventListener('click', doLyricSearch);
  if (lyricInput) lyricInput.addEventListener('keydown', e => { if (e.key==='Enter') doLyricSearch(); });

  // Language filter buttons
  $$('.lang-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.lang-filter-btn').forEach(b => {
        b.style.background   = 'transparent';
        b.style.color        = '';
        b.style.borderColor  = '#e5e7eb';
      });
      btn.style.background  = '#7c3aed';
      btn.style.color       = '#fff';
      btn.style.borderColor = '#7c3aed';
      btn.classList.add('active');
    });
  });
}

// ═══════════════════════════════════════════════════════════════
//  PROFILE PAGE
// ═══════════════════════════════════════════════════════════════
function initProfilePage() {
  if (!document.querySelector('.user-card')) return;

  // Load stats
  fetch('/api/profile/stats').then(r => r.json()).then(data => {
    if (!data.success) return;
    const s = data.stats;
    const items = $$('.stat-item h3');
    if (items[0]) items[0].textContent = s.songs_created;
    if (items[1]) items[1].textContent = s.total_plays.toLocaleString();
    if (items[2]) items[2].textContent = s.downloads.toLocaleString();
    if (items[3]) items[3].textContent = s.followers.toLocaleString();
  });

  // Load history
  fetch('/api/profile/history').then(r => r.json()).then(data => {
    if (!data.success || !data.tracks.length) return;
    const tbody = document.querySelector('.history-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    data.tracks.forEach(t => {
      const dur = t.duration
        ? `${Math.floor(t.duration/60)}:${String(t.duration%60).padStart(2,'0')}` : '—';
      tbody.innerHTML += `
        <tr>
          <td class="table-track">
            <div class="track-icon"><i class="fa-solid fa-music"></i></div>
            <div class="track-text">
              <strong>${t.title}</strong><span>Generated by You</span>
            </div>
          </td>
          <td>${t.created_at || '—'}</td>
          <td>${dur}</td>
          <td>${t.plays || 0}</td>
          <td class="table-actions">
            <button title="Play"
              onclick="playTrack('${t.audio_url}','${t.title}','${t.artist}',${t.id})">
              <i class="fa-solid fa-play"></i>
            </button>
            <button title="Download" onclick="downloadTrack('${t.audio_url}','${t.filename}')">
              <i class="fa-solid fa-download"></i>
            </button>
          </td>
        </tr>`;
    });
  });

  // Edit profile
  const allModals = $$('#edit-modal');
  if (allModals.length > 1) allModals[1].remove();

  const editBtn   = document.querySelector('.profile-actions .sec-btn:first-child');
  const editModal = document.getElementById('edit-modal');
  const closeEdit = document.getElementById('close-edit');
  const saveBtn   = document.getElementById('save-profile');
  const nameInput = document.getElementById('edit-name-input');

  if (editBtn && editModal) editBtn.addEventListener('click', () => editModal.classList.remove('hidden'));
  if (closeEdit)            closeEdit.addEventListener('click', () => editModal.classList.add('hidden'));

  // Avatar preview + store selected image
  let selectedAvatarDataUrl = null;
  const uploadDp = document.getElementById('upload-dp');
  if (uploadDp) uploadDp.addEventListener('change', () => {
    const file = uploadDp.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      selectedAvatarDataUrl = e.target.result;
      const preview = document.getElementById('edit-avatar-preview');
      if (preview) {
        preview.style.backgroundImage = `url(${e.target.result})`;
        preview.style.backgroundSize  = 'cover';
        preview.style.backgroundPosition = 'center';
        preview.textContent = '';
      }
    };
    reader.readAsDataURL(file);
  });

  if (saveBtn && nameInput) {
    saveBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) return showToast('Name cannot be empty', 'error');
      const res  = await fetch('/api/auth/update-profile', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (data.success) {
        // Update display name
        const displayName = document.getElementById('display-name');
        const userInitials = document.getElementById('user-initials');
        if (displayName) displayName.textContent = name;

        // Update main avatar — photo if selected, else initial
        const mainAvatar = document.querySelector('.user-card .profile-avatar');
        if (selectedAvatarDataUrl && mainAvatar) {
          mainAvatar.style.backgroundImage = `url(${selectedAvatarDataUrl})`;
          mainAvatar.style.backgroundSize  = 'cover';
          mainAvatar.style.backgroundPosition = 'center';
          if (userInitials) userInitials.textContent = '';
          // Save to localStorage so it persists on refresh
          localStorage.setItem('profilePhoto', selectedAvatarDataUrl);
        } else if (userInitials) {
          userInitials.textContent = name[0].toUpperCase();
        }

        editModal.classList.add('hidden');
        showToast('Profile updated!', 'success');
      }
    });
  }

  // Restore saved profile photo on page load
  const savedPhoto = localStorage.getItem('profilePhoto');
  if (savedPhoto) {
    const mainAvatar = document.querySelector('.user-card .profile-avatar');
    const userInitials = document.getElementById('user-initials');
    if (mainAvatar) {
      mainAvatar.style.backgroundImage = `url(${savedPhoto})`;
      mainAvatar.style.backgroundSize  = 'cover';
      mainAvatar.style.backgroundPosition = 'center';
      if (userInitials) userInitials.textContent = '';
    }
    // Also set in edit modal preview
    const editPreview = document.getElementById('edit-avatar-preview');
    if (editPreview) {
      editPreview.style.backgroundImage = `url(${savedPhoto})`;
      editPreview.style.backgroundSize  = 'cover';
      editPreview.style.backgroundPosition = 'center';
      editPreview.textContent = '';
    }
  }

  // Settings
  const settingsBtn   = document.querySelector('.profile-actions .sec-btn:last-child');
  const settingsModal = document.getElementById('settings-modal');
  const closeSettings = document.getElementById('close-settings');
  if (settingsBtn && settingsModal) settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
  if (closeSettings)               closeSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));

  // Delete account
  const deleteBtn = document.getElementById('delete-account-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('Permanently delete your account?')) return;
    const res = await fetch('/api/auth/delete-account', { method:'POST' });
    if ((await res.json()).success) location.href = '/';
  });
}

// ═══════════════════════════════════════════════════════════════
//  GALLERY PAGE
// ═══════════════════════════════════════════════════════════════
function initGalleryPage() {
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;

  fetch('/api/gallery').then(r => r.json()).then(data => {
    if (!data.success || !data.tracks.length) {
      grid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:60px;color:#888">
          <i class="fa-solid fa-music" style="font-size:3rem;margin-bottom:16px;display:block"></i>
          <h3>No tracks yet</h3>
          <p>Be the first to generate music!</p>
        </div>`;
      return;
    }

    data.tracks.forEach((t, idx) => {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      card.innerHTML = `
        <div class="gallery-art">
          <i class="fa-solid fa-music"></i>
        </div>
        <div class="gallery-info">
          <strong>${t.title}</strong>
          <span>${t.user_name || t.artist}</span>
          <span style="font-size:.75rem;color:#aaa">${t.created_at || ''}</span>
        </div>
        <div id="gallery-wave-${idx}" style="margin:10px 0;min-height:64px;"></div>
        <div style="display:flex;justify-content:space-between;font-size:.75rem;color:#888;margin-bottom:8px;">
          <span id="gallery-wave-${idx}-current">0:00</span>
          <span><i class="fa-solid fa-play" style="font-size:.7rem"></i> ${t.plays || 0} plays</span>
          <span id="gallery-wave-${idx}-duration">--:--</span>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="sec-btn" style="flex:1" onclick="galleryWaves['${idx}']?.playPause()">
            <i class="fa-solid fa-play"></i> Play
          </button>
          <button class="sec-btn" onclick="downloadTrack('${t.audio_url}','${t.filename}')">
            <i class="fa-solid fa-download"></i>
          </button>
        </div>`;
      grid.appendChild(card);

      // Lazy-load waveform
      const observer = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) {
          if (!window.galleryWaves) window.galleryWaves = {};
          window.galleryWaves[idx] = createWaveform(`gallery-wave-${idx}`, t.audio_url, t.id);
          observer.disconnect();
        }
      });
      observer.observe(card);
    });
  });
}

// ═══════════════════════════════════════════════════════════════
//  DOWNLOAD HELPER
// ═══════════════════════════════════════════════════════════════
function downloadTrack(url, filename) {
  const a = document.createElement('a');
  a.href = url; a.download = filename || 'track.wav'; a.click();
}

// ═══════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initPlayerControls();
  initSidebar();
  initLoginPage();
  initStudioPage();
  initDiscoveryPage();
  initProfilePage();
  initGalleryPage();
});