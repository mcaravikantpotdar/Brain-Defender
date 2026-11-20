/* ============================================================================
   BRAIN DEFENDER: CASTLE OF CURIOSITY — COMPLETE GAME ENGINE
   ============================================================================ */

const API_CONFIG = {
  enabled: true,
  endpoint: "https://script.google.com/macros/s/AKfycbxJ3rbuFzYgVzMjSanjrIJY2Vh8Vw2uVQUIu1tKvMz0mE_W3KoBi_6QwEcWWE2C89OwhA/exec"
};

const CAMPAIGN_WIN_WAVE = 6;
const TEST_MODE_WAVE_SECONDS = 90;

const TURRET_DATA = {
  maths:   { label: "Maths Cannon",   cost: 40, range: 145, cooldownMax: 1.05, dmg: 12, color: "#fbbf24" },
  science: { label: "Science Tesla",  cost: 45, range: 135, cooldownMax: 0.85, dmg: 11, color: "#38bdf8" },
  grammar: { label: "Grammar Gale",   cost: 35, range: 140, cooldownMax: 0.95, dmg: 10, color: "#22c55e" },
  gk:      { label: "GK Prism Laser", cost: 50, range: 200, cooldownMax: 1.40, dmg: 16, color: "#c084fc" }
};

const PADS = [
  { x: 155, y: 125 }, { x: 310, y: 125 }, { x: 465, y: 125 }, { x: 620, y: 125 },
  { x: 225, y: 315 }, { x: 380, y: 315 }, { x: 535, y: 315 }, { x: 690, y: 315 }
];

const WAYPOINTS = [
  { x: 0, y: 220 },
  { x: 205, y: 220 },
  { x: 205, y: 68 },
  { x: 560, y: 68 },
  { x: 560, y: 382 },
  { x: 315, y: 382 },
  { x: 315, y: 220 },
  { x: 815, y: 220 }
];

const state = {
  player: null,
  mode: "siege",
  lang: "dual",
  endlessMode: false,
  loginFails: 0,
  lockoutUntil: 0,
  questions: [],
  hp: 100,
  gold: 120,
  mana: 50,
  wave: 1,
  score: 0,
  waveClock: TEST_MODE_WAVE_SECONDS,
  waveRunning: false,
  paused: false,
  selectedTurret: "maths",
  hoveredPad: -1,
  turrets: [],
  demons: [],
  shots: [],
  sparks: [],
  popups: [],
  spawnQueue: [],
  spawnDelay: 0,
  clock: 0,
  consecutiveWrong: 0,
  difficultyOffset: 0,
  mastery: {
    maths: { ok: 0, total: 0 },
    science: { ok: 0, total: 0 },
    grammar: { ok: 0, total: 0 },
    gk: { ok: 0, total: 0 },
    moral: { ok: 0, total: 0 }
  },
  challenge: null,
  countdownId: null
};

/* ============================================================================
   1. SYNTHESIZED AUDIO
   ============================================================================ */
const SFX = (() => {
  let ctx = null;
  function play(freq, type = "sine", dur = 0.12, vol = 0.07) {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch (_) {}
  }
  return {
    shot: () => play(560, "triangle", 0.06, 0.03),
    hit: () => play(250, "sine", 0.05, 0.025),
    winQ: () => { play(587.33, "sine", 0.11, 0.08); setTimeout(() => play(880, "sine", 0.17, 0.08), 85); },
    loseQ: () => play(185, "sawtooth", 0.24, 0.07),
    place: () => play(440, "square", 0.09, 0.045)
  };
})();

/* ============================================================================
   2. DIFFICULTY CURVE (SUPER EASY -> ADVANCING UPWARDS)
   ============================================================================ */
function getCurrentDifficultyTier() {
  let baseTier = 1;
  if (state.wave === 2) baseTier = 2;
  else if (state.wave >= 3 && state.wave <= 4) baseTier = 3;
  else if (state.wave >= 5) baseTier = 4;

  const adjusted = baseTier + state.difficultyOffset;
  return Math.max(1, Math.min(4, adjusted));
}

function getTierLabel(tier) {
  const map = {
    1: "Tier 1: Super Easy",
    2: "Tier 2: Foundation",
    3: "Tier 3: Challenge",
    4: "Tier 4: Master / Boss"
  };
  return map[tier] || "Tier 1: Super Easy";
}

function getQuestionDurationSeconds(q) {
  const tier = q.difficulty || getCurrentDifficultyTier();
  let secs = 10 + (tier - 1) * 4 + (state.wave - 1) * 1.5;
  if (state.wave % 3 === 0) secs += 5;
  if (state.lang === "dual" && !q.isLanguageSpecific) secs += 3;
  return Math.min(34, Math.round(secs * 10) / 10);
}

/* ============================================================================
   3. QUESTION BANK, COOLDOWN & SYNCHRONIZED OPTION SHUFFLER
   ============================================================================ */
async function loadQuestions() {
  try {
    const res = await fetch("questions.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed loading questions.json");
    const json = await res.json();
    state.questions = Array.isArray(json.questions) ? json.questions : [];
  } catch (err) {
    console.warn("Question bank fetch failed:", err);
    state.questions = [];
  }
}

function seenStorageKey() {
  const id = state.player?.isDemo ? "demo" : (state.player?.pen || "anon");
  return `bd_seen_q_${id}`;
}

function readSeenIds() {
  try {
    return JSON.parse(localStorage.getItem(seenStorageKey()) || "[]");
  } catch (_) {
    return [];
  }
}

function recordSeenId(id) {
  if (!id || String(id).startsWith("AUTO-")) return;
  const arr = readSeenIds().filter(x => x !== id);
  arr.push(id);
  localStorage.setItem(seenStorageKey(), JSON.stringify(arr.slice(-40)));
}

function buildAutoMathQuestion(classNum, tier) {
  const a = Math.floor(Math.random() * 5) + 2;
  const x = Math.floor(Math.random() * 8) + 2;
  const b = Math.floor(Math.random() * 9) + 1;

  if (tier === 1) {
    const sum = a + x;
    const opts = [String(sum), String(sum + 1), String(Math.max(1, sum - 1)), String(sum + 2)];
    return {
      id: `AUTO-M1-${Date.now()}`,
      class: classNum,
      subject: "maths",
      difficulty: 1,
      isLanguageSpecific: false,
      prompt: {
        en: `Super Easy Warm-Up: What is ${a} + ${x}?`,
        hi: `आसान अभ्यास: ${a} + ${x} कितना होता है?`
      },
      options: { en: opts, hi: [...opts] },
      answerIndex: 0,
      explanation: {
        en: `${a} + ${x} = ${sum}.`,
        hi: `${a} + ${x} = ${sum} होता है।`
      }
    };
  }

  const rhs = a * x + b;
  const opts = [String(x), String(x + 1), String(Math.max(1, x - 1)), String(x + 3)];
  return {
    id: `AUTO-M-${Date.now()}`,
    class: classNum,
    subject: "maths",
    difficulty: tier,
    isLanguageSpecific: false,
    prompt: {
      en: `Class ${classNum} Challenge: Solve for x if ${a}x + ${b} = ${rhs}.`,
      hi: `कक्षा ${classNum} प्रश्न: यदि ${a}x + ${b} = ${rhs}, तो x का मान क्या है?`
    },
    options: { en: opts, hi: [...opts] },
    answerIndex: 0,
    explanation: {
      en: `${a}x = ${rhs - b}, so x = ${x}.`,
      hi: `${a}x = ${rhs - b}, इसलिए x = ${x}।`
    }
  };
}

function selectQuestion(subject) {
  const classNum = Number(state.player?.classNum || 8);
  const desiredTier = getCurrentDifficultyTier();
  const seenSet = new Set(readSeenIds());

  let pool = state.questions.filter(q => q.subject === subject);

  const exactClass = pool.filter(q => Number(q.class) === classNum);
  const nearClass = pool.filter(q => Math.abs(Number(q.class) - classNum) === 1);
  if (exactClass.length > 0) {
    pool = nearClass.length > 0 && state.wave >= 3 ? [...exactClass, ...nearClass] : exactClass;
  }

  let fresh = pool.filter(q => !seenSet.has(q.id));
  if (fresh.length === 0) fresh = pool;

  let tierMatches = fresh.filter(q => Number(q.difficulty || 1) === desiredTier);
  if (tierMatches.length === 0) {
    tierMatches = fresh.filter(q => Number(q.difficulty || 1) <= desiredTier);
  }
  if (tierMatches.length === 0) tierMatches = fresh;

  const picked = tierMatches[Math.floor(Math.random() * tierMatches.length)] || buildAutoMathQuestion(classNum, desiredTier);
  recordSeenId(picked.id);
  return randomizeQuestionOptions(picked);
}

function randomizeQuestionOptions(raw) {
  const len = raw.options.en.length;
  const order = Array.from({ length: len }, (_, i) => i);

  if (!raw.lockOrder) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }

  return {
    ...raw,
    shuffledEn: order.map(i => raw.options.en[i]),
    shuffledHi: order.map(i => (raw.options.hi ? raw.options.hi[i] : raw.options.en[i])),
    shuffledAnswerIndex: order.indexOf(raw.answerIndex),
    peekActive: false
  };
}

/* ============================================================================
   4. AUTHENTICATION (SHEET2) & DEMO MODE (STRICTLY NO LEADERBOARD SAVE)
   ============================================================================ */
function maskId(val) {
  const s = String(val || "");
  if (s.length <= 4) return "****";
  return `${"*".repeat(s.length - 4)}${s.slice(-4)}`;
}

function showLoginMessage(msg, isErr) {
  const el = document.getElementById("loginStatus");
  el.textContent = msg;
  el.className = isErr ? "login-msg err" : "login-msg";
}

async function handleVerifyLogin() {
  const now = Date.now();
  if (now < state.lockoutUntil) {
    const wait = Math.ceil((state.lockoutUntil - now) / 1000);
    showLoginMessage(`Too many attempts. Please wait ${wait}s.`, true);
    return;
  }

  const inputEl = document.getElementById("studentIdInput");
  const cleanId = inputEl.value.replace(/\D/g, "");
  inputEl.value = cleanId;

  if (cleanId.length < 11 || cleanId.length > 12) {
    state.loginFails++;
    if (state.loginFails >= 3) { state.lockoutUntil = Date.now() + 30000; state.loginFails = 0; }
    showLoginMessage("Enter a valid 11 or 12-digit Student ID / PEN.", true);
    return;
  }

  if (!API_CONFIG.enabled || !API_CONFIG.endpoint.startsWith("http")) {
    showLoginMessage("Apps Script endpoint not configured in game.js.", true);
    return;
  }

  const btn = document.getElementById("verifyEnterBtn");
  btn.disabled = true;
  showLoginMessage("Checking Student ID in Sheet2...", false);

  try {
    const url = `${API_CONFIG.endpoint}?action=verifyPen&pen=${encodeURIComponent(cleanId)}`;
    const resp = await fetch(url, { method: "GET", redirect: "follow" });
    const data = await resp.json();

    if (data.ok && data.student) {
      state.loginFails = 0;
      const chosenClass = Number(document.getElementById("classSelect").value) || 8;
      state.player = {
        pen: data.student.pen,
        name: data.student.name,
        school: data.student.school || "",
        classNum: chosenClass,
        isDemo: false
      };
      launchArena();
    } else {
      state.loginFails++;
      if (state.loginFails >= 3) { state.lockoutUntil = Date.now() + 30000; state.loginFails = 0; }
      showLoginMessage(data.message || "Student ID not found in Sheet2.", true);
    }
  } catch (_) {
    showLoginMessage("Could not verify against Sheet2. Check Web App deployment permissions.", true);
  } finally {
    btn.disabled = false;
  }
}

function handleDemoLaunch() {
  const chosenClass = Number(document.getElementById("classSelect").value) || 8;
  state.player = {
    pen: "DEMO",
    name: "Demo Player",
    school: "Practice",
    classNum: chosenClass,
    isDemo: true
  };
  launchArena();
}

function launchArena() {
  document.getElementById("loginGate").style.display = "none";
  document.getElementById("arenaApp").style.display = "flex";
  document.getElementById("liveLangSelect").value = state.lang;

  const isDemo = Boolean(state.player.isDemo);
  document.getElementById("hudName").textContent = state.player.name;
  document.getElementById("hudClassMode").textContent =
    `CLASS ${state.player.classNum} • ${state.mode === "test90" ? "90S TEST MODE" : "SIEGE MODE"}`;

  const badge = document.getElementById("hudAuthBadge");
  if (isDemo) {
    badge.textContent = "Demo • No Leaderboard Save";
    badge.className = "pill demo";
  } else {
    badge.textContent = `Verified • ${state.player.school || "Sheet2"}`;
    badge.className = "pill live";
  }

  document.getElementById("testTimerChip").style.display = state.mode === "test90" ? "flex" : "none";

  resetSession(false);
  fetchLeaderboard();
  requestAnimationFrame(loop);
}

function resetSession(keepEndless) {
  state.hp = 100;
  state.gold = 120;
  state.mana = 50;
  state.wave = keepEndless ? (CAMPAIGN_WIN_WAVE + 1) : 1;
  state.endlessMode = Boolean(keepEndless);
  state.score = 0;
  state.waveClock = TEST_MODE_WAVE_SECONDS;
  state.waveRunning = false;
  state.paused = false;
  state.consecutiveWrong = 0;
  state.difficultyOffset = 0;
  state.turrets = [];
  state.demons = [];
  state.shots = [];
  state.sparks = [];
  state.popups = [];
  state.spawnQueue = [];
  state.mastery = {
    maths: { ok: 0, total: 0 },
    science: { ok: 0, total: 0 },
    grammar: { ok: 0, total: 0 },
    gk: { ok: 0, total: 0 },
    moral: { ok: 0, total: 0 }
  };

  const wBtn = document.getElementById("startWaveBtn");
  wBtn.disabled = false;
  wBtn.textContent = `Start Wave ${state.wave}`;
  refreshHud();
  refreshMastery();
}

async function saveScoreIfEligible(bonusPoints = 0) {
  if (!state.player || state.player.isDemo) {
    return { saved: false, msg: "Demo Mode: Scores are never saved to the leaderboard." };
  }

  const finalScore = Math.max(0, state.score + bonusPoints);
  if (finalScore <= 0) {
    return { saved: false, msg: "Score is 0; nothing recorded." };
  }

  const okTotal = Object.values(state.mastery).reduce((s, x) => s + x.ok, 0);
  const ansTotal = Object.values(state.mastery).reduce((s, x) => s + x.total, 0);

  const payload = {
    pen: state.player.pen,
    maskedPen: maskId(state.player.pen),
    name: state.player.name,
    school: state.player.school || "",
    classNum: state.player.classNum,
    mode: state.mode,
    score: finalScore,
    wave: state.wave,
    correct: okTotal,
    total: ansTotal,
    isDemo: false
  };

  if (!API_CONFIG.enabled || !API_CONFIG.endpoint.startsWith("http")) {
    return { saved: false, msg: "Server endpoint not configured." };
  }

  try {
    const resp = await fetch(API_CONFIG.endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "submitScore", payload })
    });
    const data = await resp.json();
    await fetchLeaderboard();
    return { saved: Boolean(data.ok), best: data.bestScore || finalScore };
  } catch (_) {
    return { saved: false, msg: "Network error while saving score to Google Sheet." };
  }
}

async function fetchLeaderboard() {
  const ul = document.getElementById("leaderboardList");
  if (!API_CONFIG.enabled || !API_CONFIG.endpoint.startsWith("http")) {
    ul.innerHTML = `<li class="lb-row"><span>Connect Apps Script URL for live school leaderboard.</span></li>`;
    return;
  }

  try {
    const resp = await fetch(`${API_CONFIG.endpoint}?action=getLeaderboard`, { redirect: "follow" });
    const data = await resp.json();
    const rows = (data.ok && Array.isArray(data.leaderboard)) ? data.leaderboard : [];

    ul.innerHTML = "";
    if (rows.length === 0) {
      ul.innerHTML = `<li class="lb-row"><span>No scores recorded yet.</span></li>`;
      return;
    }

    rows.slice(0, 10).forEach((r, idx) => {
      const mine = state.player && !state.player.isDemo && String(r.pen) === String(state.player.pen);
      const li = document.createElement("li");
      li.className = `lb-row${mine ? " highlight" : ""}`;
      li.innerHTML = `
        <div>
          <strong>#${idx + 1} ${r.name}</strong>
          <div style="font-size:0.72rem; color:var(--muted);">
            Class ${r.classNum || "-"} • ${r.school || "School"} • Wave ${r.wave}
          </div>
        </div>
        <strong style="color:var(--gold); font-size:0.94rem;">${r.score}</strong>
      `;
      ul.appendChild(li);
    });
  } catch (_) {
    ul.innerHTML = `<li class="lb-row"><span>Unable to load leaderboard.</span></li>`;
  }
}

/* ============================================================================
   5. QUESTION CHALLENGE MODAL
   ============================================================================ */
function openQuestion({ subject, heading, onPass, onFail }) {
  const q = selectQuestion(subject);
  const totalSecs = getQuestionDurationSeconds(q);

  state.paused = true;
  state.challenge = { q, totalSecs, leftSecs: totalSecs, done: false, onPass, onFail };

  document.getElementById("qTagBadge").textContent = heading || `${subject.toUpperCase()} • WAVE ${state.wave}`;
  document.getElementById("qTierBadge").textContent = getTierLabel(q.difficulty || getCurrentDifficultyTier());
  document.getElementById("qFeedbackArea").style.display = "none";

  const peekBtn = document.getElementById("peekBtn");
  peekBtn.style.display = (state.lang === "dual" || q.isLanguageSpecific) ? "none" : "inline-block";

  drawQuestionBody();
  document.getElementById("challengeOverlay").classList.add("open");

  clearInterval(state.countdownId);
  paintQuestionTimer();

  state.countdownId = setInterval(() => {
    const ch = state.challenge;
    if (!ch || ch.done) return;
    ch.leftSecs -= 0.1;
    if (ch.leftSecs <= 0) {
      ch.leftSecs = 0;
      paintQuestionTimer();
      submitAnswer(-1);
    } else {
      paintQuestionTimer();
    }
  }, 100);
}

function paintQuestionTimer() {
  const ch = state.challenge;
  if (!ch) return;
  const pct = Math.max(0, (ch.leftSecs / ch.totalSecs) * 100);
  const bar = document.getElementById("qTimerBar");
  bar.style.width = `${pct}%`;
  bar.style.background = pct > 45 ? "#22c55e" : (pct > 20 ? "#fbbf24" : "#fb7185");
  document.getElementById("qTimerBadge").textContent = `${ch.leftSecs.toFixed(1)}s`;
}

function drawQuestionBody() {
  const ch = state.challenge;
  const q = ch.q;
  const showBoth = (state.lang === "dual" || q.peekActive) && !q.isLanguageSpecific;
  const primary = q.isLanguageSpecific ? (q.nativeLang || "en") : (state.lang === "hi" ? "hi" : "en");

  const promptEl = document.getElementById("qPromptArea");
  if (showBoth) {
    promptEl.innerHTML = `
      <div class="prompt-primary">${q.prompt.en}</div>
      <div class="prompt-secondary">${q.prompt.hi || ""}</div>
    `;
  } else {
    promptEl.innerHTML = `<div class="prompt-primary">${q.prompt[primary] || q.prompt.en}</div>`;
  }

  const optsEl = document.getElementById("qOptionsArea");
  optsEl.innerHTML = "";

  q.shuffledEn.forEach((enOpt, i) => {
    const hiOpt = q.shuffledHi[i] || enOpt;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "opt-choice";
    if (showBoth && hiOpt !== enOpt) {
      b.innerHTML = `<strong>${String.fromCharCode(65 + i)}.</strong> ${enOpt} <span style="color:var(--muted);">/ ${hiOpt}</span>`;
    } else {
      b.innerHTML = `<strong>${String.fromCharCode(65 + i)}.</strong> ${primary === "hi" ? hiOpt : enOpt}`;
    }
    b.onclick = () => submitAnswer(i);
    optsEl.appendChild(b);
  });
}

function submitAnswer(choiceIdx) {
  const ch = state.challenge;
  if (!ch || ch.done) return;
  ch.done = true;
  clearInterval(state.countdownId);

  const q = ch.q;
  const right = choiceIdx === q.shuffledAnswerIndex;
  const fast = right && (ch.leftSecs / ch.totalSecs) >= 0.5;

  if (state.mastery[q.subject]) {
    state.mastery[q.subject].total++;
    if (right) state.mastery[q.subject].ok++;
    refreshMastery();
  }

  const btns = document.querySelectorAll("#qOptionsArea .opt-choice");
  btns.forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === q.shuffledAnswerIndex) btn.classList.add("correct");
    else if (idx === choiceIdx) btn.classList.add("wrong");
  });

  const fb = document.getElementById("qFeedbackArea");
  fb.style.display = "block";
  const note = state.lang === "hi" && q.explanation?.hi ? q.explanation.hi : (q.explanation?.en || "");

  if (right) {
    SFX.winQ();
    state.consecutiveWrong = 0;
    if (state.difficultyOffset > 0 && Math.random() < 0.4) state.difficultyOffset--;
    const pts = fast ? 40 : 25;
    state.score += pts;
    state.gold += fast ? 15 : 10;
    state.mana = Math.min(100, state.mana + (fast ? 18 : 12));
    fb.innerHTML = `<strong style="color:#86efac;">${fast ? "Swift Genius! +" + pts + " pts" : "Correct! +" + pts + " pts"}</strong> ${note}`;
  } else {
    SFX.loseQ();
    state.consecutiveWrong++;
    if (state.consecutiveWrong >= 2) {
      state.difficultyOffset = Math.max(-1, state.difficultyOffset - 1);
      state.consecutiveWrong = 0;
    }
    fb.innerHTML = `<strong style="color:#fda4af;">${choiceIdx === -1 ? "Time Expired!" : "Incorrect!"}</strong> ${note}`;
  }

  refreshHud();

  setTimeout(() => {
    document.getElementById("challengeOverlay").classList.remove("open");
    state.paused = false;
    state.challenge = null;
    if (right && ch.onPass) ch.onPass(fast);
    if (!right && ch.onFail) ch.onFail();
  }, 1400);
}

/* ============================================================================
   6. WAVE & DEMON SIMULATION (SIEGE MODE + 90S TEST MODE + WAVE 6 VICTORY)
   ============================================================================ */
const canvas = document.getElementById("arenaCanvas");
const ctx = canvas.getContext("2d");
let prevTime = performance.now();

function addSparks(x, y, color, count = 10) {
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 35 + Math.random() * 110;
    state.sparks.push({
      x, y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      life: 0.35 + Math.random() * 0.2,
      maxLife: 0.55,
      color,
      r: 2 + Math.random() * 2.5
    });
  }
}

function addPopup(x, y, text, color = "#fde047") {
  state.popups.push({ x, y, text, color, life: 0.9 });
}

function beginWave() {
  if (state.waveRunning || state.paused) return;
  state.waveRunning = true;
  state.waveClock = TEST_MODE_WAVE_SECONDS;
  document.getElementById("startWaveBtn").disabled = true;

  state.spawnQueue = [];

  if (state.mode === "siege" && state.wave === 1 && !state.endlessMode) {
    state.spawnQueue.push({
      hp: 20,
      maxHp: 20,
      speed: 9.05,
      goldReward: 25,
      scoreReward: 30,
      gateDamage: 12,
      isBoss: false,
      isScout: true
    });
    state.spawnDelay = 0.2;
  } else {
    const isBoss = state.wave % 3 === 0;
    const totalCount = isBoss ? (4 + state.wave) : (5 + state.wave * 2);
    const waveScale = Math.max(1, state.wave - (state.mode === "siege" ? 1 : 0));

    for (let i = 0; i < totalCount; i++) {
      const bossUnit = isBoss && i === totalCount - 1;
      const baseHp = bossUnit ? (85 + waveScale * 34) : (24 + waveScale * 14);
      const baseSpeed = bossUnit ? (24 + waveScale * 2.5) : (32 + waveScale * 5.5);

      state.spawnQueue.push({
        hp: baseHp,
        maxHp: baseHp,
        speed: Math.min(95, baseSpeed),
        goldReward: bossUnit ? 35 : (10 + waveScale * 2),
        scoreReward: bossUnit ? 120 : (20 + waveScale * 5),
        gateDamage: bossUnit ? 25 : (10 + Math.min(15, waveScale * 2)),
        isBoss: bossUnit,
        isScout: false
      });
    }
    state.spawnDelay = 0.25;
  }

  refreshHud();
}

function triggerManualQuiz() {
  if (state.paused) return;
  const subjects = ["maths", "science", "grammar", "gk"];
  const sub = subjects[Math.floor(Math.random() * subjects.length)];
  openQuestion({
    subject: sub,
    heading: `KNOWLEDGE BOOST • ${sub.toUpperCase()}`,
    onPass: (fast) => {
      if (state.demons.length > 0) {
        const front = state.demons[0];
        front.hp -= fast ? 24 : 15;
        addSparks(front.x, front.y, "#38bdf8", 12);
        addPopup(front.x, front.y - 18, fast ? "-24 ARCANE!" : "-15 ARCANE!", "#38bdf8");
      }
    }
  });
}

function triggerUltimateStorm() {
  if (state.mana < 60 || state.paused) return;
  state.mana -= 60;
  refreshHud();

  const subjects = ["maths", "science", "gk", "grammar"];
  const chosen = subjects[Math.floor(Math.random() * subjects.length)];
  openQuestion({
    subject: chosen,
    heading: "⚡ ULTIMATE KNOWLEDGE STORM ⚡",
    onPass: () => {
      state.demons.forEach(d => {
        d.hp -= 65;
        addSparks(d.x, d.y, "#d8b4fe", 14);
      });
      state.score += 50;
      addPopup(440, 200, "STORM STRIKE!", "#e879f9");
      refreshHud();
    }
  });
}

function handleBoardClick(evt) {
  if (state.paused) return;
  const rect = canvas.getBoundingClientRect();
  const mx = (evt.clientX - rect.left) * (canvas.width / rect.width);
  const my = (evt.clientY - rect.top) * (canvas.height / rect.height);

  for (let i = 0; i < PADS.length; i++) {
    const pad = PADS[i];
    if (Math.hypot(mx - pad.x, my - pad.y) <= 28) {
      const turret = state.turrets.find(t => t.padIdx === i);
      if (turret) {
        if (turret.level >= 3) {
          addPopup(turret.x, turret.y - 20, "MAX LEVEL", turret.color);
          return;
        }
        openQuestion({
          subject: turret.type,
          heading: `SUPERCHARGE ${TURRET_DATA[turret.type].label.toUpperCase()} → LV.${turret.level + 1}`,
          onPass: (fast) => {
            turret.level++;
            turret.dmg += fast ? 12 : 8;
            turret.range += 16;
            turret.cooldownMax = Math.max(0.38, turret.cooldownMax * 0.88);
            addSparks(turret.x, turret.y, turret.color, 18);
            addPopup(turret.x, turret.y - 24, `SUPERCHARGED LV.${turret.level}!`, turret.color);
          }
        });
      } else {
        const spec = TURRET_DATA[state.selectedTurret];
        if (state.gold >= spec.cost) {
          state.gold -= spec.cost;
          state.turrets.push({
            padIdx: i,
            x: pad.x,
            y: pad.y,
            type: state.selectedTurret,
            level: 1,
            cooldown: 0,
            angle: 0,
            ...spec
          });
          SFX.place();
          addSparks(pad.x, pad.y, spec.color, 14);
          addPopup(pad.x, pad.y - 20, `-${spec.cost}g`, "#fde047");
          refreshHud();
        } else {
          addPopup(pad.x, pad.y - 18, "Need More Gold!", "#fb7185");
        }
      }
      return;
    }
  }
}

function stepSimulation(dt) {
  state.clock += dt;
  if (state.paused) return;

  if (state.mode === "test90" && state.waveRunning) {
    state.waveClock = Math.max(0, state.waveClock - dt);
    refreshHud();
    if (state.waveClock <= 0) {
      const remainingPenalty = Math.min(state.hp, 15 + state.demons.length * 8);
      state.hp = Math.max(0, state.hp - remainingPenalty);
      state.demons = [];
      state.spawnQueue = [];
      state.waveRunning = false;
      addPopup(790, 185, `TIME UP! -${remainingPenalty} HP`, "#fb7185");
      refreshHud();
      if (state.hp <= 0) {
        concludeRun(false);
        return;
      }
      advanceWaveOrVictory();
      return;
    }
  }

  if (state.waveRunning && state.spawnQueue.length > 0) {
    state.spawnDelay -= dt;
    if (state.spawnDelay <= 0) {
      const item = state.spawnQueue.shift();
      state.demons.push({
        ...item,
        x: WAYPOINTS[0].x,
        y: WAYPOINTS[0].y,
        wpIndex: 1,
        chillTimer: 0
      });
      state.spawnDelay = state.wave === 1 ? 1.5 : Math.max(0.45, 1.15 - state.wave * 0.08);
    }
  }

  for (let i = state.demons.length - 1; i >= 0; i--) {
    const d = state.demons[i];
    if (d.hp <= 0) {
      state.gold += d.goldReward;
      state.score += d.scoreReward;
      addSparks(d.x, d.y, d.isBoss ? "#fb7185" : "#fb923c", d.isBoss ? 24 : 12);
      addPopup(d.x, d.y - 14, `+${d.goldReward}g`, "#fde047");
      state.demons.splice(i, 1);
      refreshHud();
      continue;
    }

    if (d.chillTimer > 0) d.chillTimer -= dt;
    const speedNow = d.chillTimer > 0 ? d.speed * 0.55 : d.speed;
    const wp = WAYPOINTS[d.wpIndex];
    const dx = wp.x - d.x;
    const dy = wp.y - d.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 3.5) {
      d.wpIndex++;
      if (d.wpIndex >= WAYPOINTS.length) {
        state.hp = Math.max(0, state.hp - d.gateDamage);
        addSparks(805, 220, "#fb7185", 18);
        addPopup(785, 185, `BREACH -${d.gateDamage} HP!`, "#fb7185");
        state.demons.splice(i, 1);
        refreshHud();
        if (state.hp <= 0) {
          concludeRun(false);
          return;
        }
      }
    } else {
      d.x += (dx / dist) * speedNow * dt;
      d.y += (dy / dist) * speedNow * dt;
    }
  }

  state.turrets.forEach(t => {
    t.cooldown -= dt;
    const target = state.demons.find(d => Math.hypot(d.x - t.x, d.y - t.y) <= t.range);
    if (target) {
      t.angle = Math.atan2(target.y - t.y, target.x - t.x);
      if (t.cooldown <= 0) {
        t.cooldown = t.cooldownMax;
        SFX.shot();
        state.shots.push({
          x: t.x, y: t.y, target,
          speed: 370, dmg: t.dmg, color: t.color, type: t.type
        });
      }
    }
  });

  for (let i = state.shots.length - 1; i >= 0; i--) {
    const s = state.shots[i];
    if (!state.demons.includes(s.target)) {
      state.shots.splice(i, 1);
      continue;
    }
    const dx = s.target.x - s.x;
    const dy = s.target.y - s.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 10) {
      SFX.hit();
      s.target.hp -= s.dmg;
      addSparks(s.target.x, s.target.y, s.color, 6);
      if (s.type === "grammar") s.target.chillTimer = 2.8;
      if (s.type === "maths") {
        state.demons.forEach(other => {
          if (other !== s.target && Math.hypot(other.x - s.target.x, other.y - s.target.y) < 58) {
            other.hp -= Math.round(s.dmg * 0.5);
          }
        });
      }
      state.shots.splice(i, 1);
    } else {
      s.x += (dx / dist) * s.speed * dt;
      s.y += (dy / dist) * s.speed * dt;
    }
  }

  for (let i = state.sparks.length - 1; i >= 0; i--) {
    const sp = state.sparks[i];
    sp.x += sp.vx * dt;
    sp.y += sp.vy * dt;
    sp.life -= dt;
    if (sp.life <= 0) state.sparks.splice(i, 1);
  }

  for (let i = state.popups.length - 1; i >= 0; i--) {
    const pop = state.popups[i];
    pop.y -= 25 * dt;
    pop.life -= dt;
    if (pop.life <= 0) state.popups.splice(i, 1);
  }

  if (state.waveRunning && state.spawnQueue.length === 0 && state.demons.length === 0) {
    state.waveRunning = false;
    if (state.mode === "test90") {
      const timeBonus = Math.round(state.waveClock * 2);
      state.score += timeBonus;
      addPopup(440, 140, `WAVE CLEAR! +${timeBonus} SPEED PTS`, "#86efac");
    }
    refreshHud();
    advanceWaveOrVictory();
  }
}

function advanceWaveOrVictory() {
  if (!state.endlessMode && state.wave === CAMPAIGN_WIN_WAVE) {
    concludeRun(true);
    return;
  }

  state.wave++;
  const btn = document.getElementById("startWaveBtn");
  btn.disabled = false;
  btn.textContent = `Start Wave ${state.wave}${state.wave % 3 === 0 ? " (BOSS)" : ""}`;
  refreshHud();

  openQuestion({
    subject: "moral",
    heading: "⚖️ MORAL VALUES • CARAVAN CHOICE",
    onPass: () => {
      state.hp = Math.min(100, state.hp + 15);
      state.gold += 20;
      addPopup(790, 175, "+15 HP & +20g", "#22c55e");
      refreshHud();
    }
  });
}

async function concludeRun(isVictory) {
  state.paused = true;
  state.waveRunning = false;
  const winBonus = isVictory ? 150 + state.hp : 0;
  const saveRes = await saveScoreIfEligible(winBonus);

  const iconEl = document.getElementById("outcomeIcon");
  const titleEl = document.getElementById("outcomeTitle");
  const textEl = document.getElementById("outcomeText");
  const saveEl = document.getElementById("outcomeSaveNote");
  const endlessBtn = document.getElementById("endlessBtn");

  if (isVictory) {
    iconEl.textContent = "👑";
    titleEl.textContent = "Castle Saved — Campaign Victory!";
    titleEl.style.color = "#fde047";
    textEl.textContent = `You cleared all ${CAMPAIGN_WIN_WAVE} waves with ${state.hp} HP remaining! Victory bonus: +${winBonus} pts (Total: ${state.score + winBonus}).`;
    endlessBtn.style.display = "inline-block";
  } else {
    iconEl.textContent = "🛡️";
    titleEl.textContent = "Castle Breached!";
    titleEl.style.color = "#fda4af";
    textEl.textContent = `Your defense held through Wave ${state.wave} with ${state.score} points.`;
    endlessBtn.style.display = "none";
  }

  if (state.player.isDemo) {
    saveEl.style.color = "#fda4af";
    saveEl.textContent = "Demo Mode: Score was not saved to the school leaderboard.";
  } else if (saveRes.saved) {
    saveEl.style.color = "#86efac";
    saveEl.textContent = `Score Recorded! Personal Best: ${saveRes.best}`;
  } else {
    saveEl.style.color = "#fde047";
    saveEl.textContent = saveRes.msg || "Session finished.";
  }

  document.getElementById("outcomeOverlay").classList.add("open");
}

/* ============================================================================
   7. CANVAS RENDERING
   ============================================================================ */
function renderBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(56, 189, 248, 0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 44) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 45) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#162140";
  ctx.lineWidth = 42;
  ctx.beginPath();
  WAYPOINTS.forEach((pt, idx) => idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
  ctx.stroke();

  ctx.strokeStyle = "#25386b";
  ctx.lineWidth = 30;
  ctx.stroke();

  ctx.setLineDash([12, 18]);
  ctx.lineDashOffset = -state.clock * 32;
  ctx.strokeStyle = "rgba(56, 189, 248, 0.34)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.save();
  ctx.shadowColor = "rgba(251, 191, 36, 0.45)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#172342";
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(800, 165, 58, 110, 10);
  ctx.fill();
  ctx.stroke();
  for (let y = 172; y <= 252; y += 26) {
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(794, y, 8, 14);
  }
  ctx.fillStyle = "#fde047";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("CASTLE", 829, 224);
  ctx.restore();

  PADS.forEach((pad, idx) => {
    const occupied = state.turrets.some(t => t.padIdx === idx);
    const hover = state.hoveredPad === idx;

    if (hover) {
      const spec = occupied ? state.turrets.find(t => t.padIdx === idx) : TURRET_DATA[state.selectedTurret];
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, spec.range, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(56, 189, 248, 0.08)";
      ctx.fill();
      ctx.strokeStyle = "rgba(125, 211, 252, 0.45)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    if (!occupied) {
      const pulse = 20 + Math.sin(state.clock * 4 + idx) * 2;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, pulse, 0, Math.PI * 2);
      ctx.fillStyle = hover ? "rgba(56, 189, 248, 0.24)" : "rgba(56, 189, 248, 0.1)";
      ctx.fill();
      ctx.strokeStyle = hover ? "#fde047" : "#38bdf8";
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.fillStyle = "#cbd5e1";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("+", pad.x, pad.y + 5);
    }
  });

  state.turrets.forEach(t => {
    ctx.save();
    ctx.shadowColor = t.color;
    ctx.shadowBlur = 14;

    ctx.beginPath();
    ctx.arc(t.x, t.y, 21, 0, Math.PI * 2);
    ctx.fillStyle = "#0b132b";
    ctx.fill();
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.angle);
    ctx.fillStyle = t.color;
    ctx.fillRect(4, -4, 18, 8);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(t.x, t.y, 12, 0, Math.PI * 2);
    ctx.fillStyle = t.color;
    ctx.fill();

    ctx.fillStyle = "#040914";
    ctx.font = "900 10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`L${t.level}`, t.x, t.y + 3.5);
    ctx.restore();
  });

  state.demons.forEach(d => {
    const bob = Math.sin(state.clock * 8 + d.x * 0.05) * 2;
    const rad = d.isBoss ? 20 : (d.isScout ? 14 : 13);

    ctx.save();
    ctx.shadowColor = d.isBoss ? "#fb7185" : "#fb923c";
    ctx.shadowBlur = d.isBoss ? 16 : 8;
    ctx.beginPath();
    ctx.arc(d.x, d.y + bob, rad, 0, Math.PI * 2);
    ctx.fillStyle = d.isBoss ? "#e11d48" : (d.chillTimer > 0 ? "#22c55e" : (d.isScout ? "#f59e0b" : "#f97316"));
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(d.x - 5, d.y + bob - 3, 3, 3);
    ctx.fillRect(d.x + 2, d.y + bob - 3, 3, 3);
    ctx.restore();

    const barW = d.isBoss ? 40 : 26;
    ctx.fillStyle = "#070c1a";
    ctx.fillRect(d.x - barW / 2, d.y - rad - 10, barW, 5);
    ctx.fillStyle = d.isBoss ? "#fb7185" : "#22c55e";
    ctx.fillRect(d.x - barW / 2, d.y - rad - 10, barW * Math.max(0, d.hp / d.maxHp), 5);
  });

  state.shots.forEach(s => {
    ctx.save();
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.restore();
  });

  state.sparks.forEach(sp => {
    ctx.globalAlpha = Math.max(0, sp.life / sp.maxLife);
    ctx.fillStyle = sp.color;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  state.popups.forEach(pop => {
    ctx.globalAlpha = Math.min(1, pop.life);
    ctx.fillStyle = pop.color;
    ctx.font = "800 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(pop.text, pop.x, pop.y);
  });
  ctx.globalAlpha = 1;
}

function loop(now) {
  const dt = Math.min(0.05, (now - prevTime) / 1000);
  prevTime = now;
  if (state.player) {
    stepSimulation(dt);
    renderBoard();
  }
  requestAnimationFrame(loop);
}

function refreshHud() {
  document.getElementById("hudHp").textContent = state.hp;
  document.getElementById("hudGold").textContent = state.gold;
  document.getElementById("hudMana").textContent = state.mana;
  document.getElementById("hudWave").textContent = state.endlessMode ? `${state.wave} (∞)` : `${state.wave}/${CAMPAIGN_WIN_WAVE}`;
  document.getElementById("hudScore").textContent = state.score;
  document.getElementById("hudWaveClock").textContent = `${state.waveClock.toFixed(1)}s`;
  document.getElementById("hudDiffLevel").textContent = getTierLabel(getCurrentDifficultyTier());
  document.getElementById("stormBtn").disabled = state.mana < 60;
}

function refreshMastery() {
  const labels = { maths: "Maths", science: "Science", grammar: "Grammar", gk: "General Knowledge", moral: "Moral Education" };
  document.getElementById("masteryBox").innerHTML = Object.entries(state.mastery)
    .map(([k, v]) => `<div class="mastery-item"><span>${labels[k]}</span><strong>${v.ok} / ${v.total}</strong></div>`)
    .join("");
}

/* ============================================================================
   8. UI EVENT BINDINGS
   ============================================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  await loadQuestions();

  document.getElementById("studentIdInput").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\D/g, "");
  });

  document.querySelectorAll("#modeGroup .seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#modeGroup .seg-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.mode = btn.dataset.mode;
    });
  });

  document.querySelectorAll("#langGroup .seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#langGroup .seg-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.lang = btn.dataset.lang;
    });
  });

  document.getElementById("verifyEnterBtn").addEventListener("click", handleVerifyLogin);
  document.getElementById("demoBtn").addEventListener("click", handleDemoLaunch);

  document.getElementById("liveLangSelect").addEventListener("change", e => {
    state.lang = e.target.value;
  });

  document.querySelectorAll(".turret-card").forEach(card => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".turret-card").forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      state.selectedTurret = card.dataset.turret;
    });
  });

  document.addEventListener("keydown", e => {
    if (!state.player || state.paused) return;
    const hotkeys = { "1": "maths", "2": "science", "3": "grammar", "4": "gk" };
    if (hotkeys[e.key]) {
      state.selectedTurret = hotkeys[e.key];
      document.querySelectorAll(".turret-card").forEach(c => {
        c.classList.toggle("active", c.dataset.turret === hotkeys[e.key]);
      });
    }
  });

  canvas.addEventListener("mousemove", evt => {
    const rect = canvas.getBoundingClientRect();
    const mx = (evt.clientX - rect.left) * (canvas.width / rect.width);
    const my = (evt.clientY - rect.top) * (canvas.height / rect.height);
    state.hoveredPad = PADS.findIndex(p => Math.hypot(mx - p.x, my - p.y) <= 28);
  });

  canvas.addEventListener("click", handleBoardClick);
  document.getElementById("startWaveBtn").addEventListener("click", beginWave);
  document.getElementById("quizChargeBtn").addEventListener("click", triggerManualQuiz);
  document.getElementById("stormBtn").addEventListener("click", triggerUltimateStorm);
  document.getElementById("refreshLbBtn").addEventListener("click", fetchLeaderboard);

  document.getElementById("peekBtn").addEventListener("click", () => {
    if (!state.challenge) return;
    state.challenge.q.peekActive = !state.challenge.q.peekActive;
    drawQuestionBody();
  });

  document.getElementById("endlessBtn").addEventListener("click", () => {
    document.getElementById("outcomeOverlay").classList.remove("open");
    resetSession(true);
  });

  document.getElementById("restartRunBtn").addEventListener("click", () => {
    document.getElementById("outcomeOverlay").classList.remove("open");
    resetSession(false);
  });

  document.getElementById("exitBtn").addEventListener("click", async () => {
    if (state.player && !state.player.isDemo && state.score > 0) {
      await saveScoreIfEligible(0);
    }
    state.player = null;
    document.getElementById("arenaApp").style.display = "none";
    document.getElementById("loginGate").style.display = "flex";
  });
});
