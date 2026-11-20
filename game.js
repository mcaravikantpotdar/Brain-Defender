/* ============================================================================
   BRAIN DEFENDER: CASTLE OF CURIOSITY — PRODUCTION ENGINE
   ============================================================================ */

const API_CONFIG = {
  enabled: true, // Set to true after deploying Code.gs Web App
  endpoint: "https://script.google.com/macros/s/AKfycbxJ3rbuFzYgVzMjSanjrIJY2Vh8Vw2uVQUIu1tKvMz0mE_W3KoBi_6QwEcWWE2C89OwhA/exec",
  allowOfflineFallback: true
};

const DEMO_ROSTER = {
  "21045890123": { pen: "21045890123", name: "Aarav Sharma", classNum: 7, wing: "junior" },
  "21045890456": { pen: "21045890456", name: "Priya Thakur", classNum: 10, wing: "senior" }
};

const TURRET_SPECS = {
  maths:   { label: "Maths Cannon",       cost: 40, range: 135, rate: 1.1, damage: 28, color: "#facc15" },
  science: { label: "Science Tesla",      cost: 45, range: 125, rate: 0.9, damage: 22, color: "#38bdf8" },
  grammar: { label: "Grammar Gale",       cost: 35, range: 130, rate: 1.0, damage: 14, color: "#22c55e", slow: 0.55 },
  gk:      { label: "GK Prism Laser",     cost: 50, range: 185, rate: 1.5, damage: 42, color: "#a855f7" }
};

const BUILD_PADS = [
  { x: 170, y: 120 }, { x: 320, y: 120 }, { x: 470, y: 120 }, { x: 620, y: 120 },
  { x: 240, y: 310 }, { x: 390, y: 310 }, { x: 540, y: 310 }, { x: 690, y: 310 }
];

const PATH_POINTS = [
  { x: 0, y: 215 }, { x: 210, y: 215 }, { x: 210, y: 65 }, { x: 560, y: 65 },
  { x: 560, y: 375 }, { x: 320, y: 375 }, { x: 320, y: 215 }, { x: 810, y: 215 }
];

// Global App State
const state = {
  student: null,
  wing: "junior",
  langMode: "dual", // "dual" | "en" | "hi"
  loginAttempts: 0,
  lockoutUntil: 0,
  questionBank: [],
  runId: "",
  hp: 100,
  coins: 120,
  mana: 50,
  wave: 1,
  score: 0,
  waveActive: false,
  paused: false,
  selectedTurretType: "maths",
  turrets: [],
  enemies: [],
  projectiles: [],
  spawnQueue: [],
  spawnTimer: 0,
  mastery: {
    maths: { ok: 0, total: 0 },
    science: { ok: 0, total: 0 },
    grammar: { ok: 0, total: 0 },
    gk: { ok: 0, total: 0 },
    moral: { ok: 0, total: 0 }
  },
  activeChallenge: null,
  timerInterval: null
};

/* ============================================================================
   1. AUDIO SYNTHESIZER (WEB AUDIO API)
   ============================================================================ */
const AudioFX = (() => {
  let ctx = null;
  function tone(freq, type = "sine", duration = 0.12, gainVal = 0.08) {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (_) {}
  }
  return {
    shoot: () => tone(520, "triangle", 0.07, 0.04),
    correct: () => { tone(587, "sine", 0.12, 0.09); setTimeout(() => tone(880, "sine", 0.18, 0.09), 90); },
    wrong: () => tone(190, "sawtooth", 0.25, 0.08),
    build: () => tone(420, "square", 0.1, 0.06)
  };
})();

/* ============================================================================
   2. QUESTION BANK LOADER, COOLDOWN QUEUE & SYNCHRONIZED OPTION SHUFFLER
   ============================================================================ */
async function loadQuestionBank() {
  try {
    const res = await fetch("questions.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load questions.json");
    const data = await res.json();
    state.questionBank = Array.isArray(data.questions) ? data.questions : [];
  } catch (err) {
    console.warn("Using built-in emergency fallback bank:", err);
    state.questionBank = [];
  }
}

function getCooldownKey() {
  return `bd_seen_${state.student?.pen || "guest"}`;
}

function getSeenIds() {
  try {
    return JSON.parse(localStorage.getItem(getCooldownKey()) || "[]");
  } catch (_) {
    return [];
  }
}

function markQuestionSeen(id) {
  if (!id || id.startsWith("GEN-")) return;
  const seen = getSeenIds().filter(x => x !== id);
  seen.push(id);
  // Remember last 35 questions per PEN to eliminate back-to-back repeats
  const trimmed = seen.slice(-35);
  localStorage.setItem(getCooldownKey(), JSON.stringify(trimmed));
}

// Parametric Maths Generator for infinite non-repeating practice
function generateParametricMath(wing) {
  const isSenior = wing === "senior";
  const a = Math.floor(Math.random() * 8) + 2;
  const x = Math.floor(Math.random() * 11) + 2;
  const b = Math.floor(Math.random() * 15) + 1;

  if (!isSenior) {
    const rhs = a * x + b;
    const opts = [String(x), String(x + 2), String(Math.max(1, x - 1)), String(x + 4)];
    return {
      id: `GEN-M-${Date.now()}`,
      wing: "junior",
      subject: "maths",
      difficulty: state.wave >= 3 ? 2 : 1,
      isLanguageSpecific: false,
      prompt: {
        en: `Solve for x: ${a}x + ${b} = ${rhs}`,
        hi: `x का मान ज्ञात कीजिए: ${a}x + ${b} = ${rhs}`
      },
      options: { en: opts, hi: [...opts] },
      answerIndex: 0,
      explanation: {
        en: `${a}x = ${rhs - b}, so x = ${x}.`,
        hi: `${a}x = ${rhs - b}, इसलिए x = ${x}।`
      }
    };
  } else {
    // Senior: Arithmetic progression nth term or quadratic root
    const d = Math.floor(Math.random() * 5) + 2;
    const n = Math.floor(Math.random() * 5) + 5;
    const ans = a + (n - 1) * d;
    const opts = [String(ans), String(ans + d), String(ans - d), String(a + n * d)];
    return {
      id: `GEN-M-${Date.now()}`,
      wing: "senior",
      subject: "maths",
      difficulty: state.wave >= 4 ? 3 : 2,
      isLanguageSpecific: false,
      prompt: {
        en: `Find the ${n}th term of the AP: ${a}, ${a + d}, ${a + 2 * d}, ...`,
        hi: `समांतर श्रेणी (AP) ${a}, ${a + d}, ${a + 2 * d}, ... का ${n}वाँ पद ज्ञात कीजिए।`
      },
      options: { en: opts, hi: [...opts] },
      answerIndex: 0,
      explanation: {
        en: `aₙ = a + (n - 1)d = ${a} + (${n - 1})×${d} = ${ans}.`,
        hi: `aₙ = a + (n - 1)d = ${a} + (${n - 1})×${d} = ${ans}।`
      }
    };
  }
}

function pickQuestionForSubject(subject) {
  const seen = new Set(getSeenIds());
  const targetDiff = state.wave <= 2 ? 1 : (state.wave <= 4 ? 2 : 3);

  // 30% chance on Maths to inject a fresh parametric problem
  if (subject === "maths" && Math.random() < 0.3) {
    return prepareRenderedQuestion(generateParametricMath(state.wing));
  }

  let pool = state.questionBank.filter(q => q.subject === subject && q.wing === state.wing);
  if (pool.length === 0) {
    pool = state.questionBank.filter(q => q.subject === subject);
  }

  // Filter out recently seen IDs first
  let unseen = pool.filter(q => !seen.has(q.id));
  if (unseen.length === 0) unseen = pool;

  // Prefer matching difficulty tier
  let diffMatched = unseen.filter(q => q.difficulty === targetDiff);
  if (diffMatched.length === 0) diffMatched = unseen;

  const chosen = diffMatched[Math.floor(Math.random() * diffMatched.length)] || generateParametricMath(state.wing);
  markQuestionSeen(chosen.id);
  return prepareRenderedQuestion(chosen);
}

// Synchronized Bilingual Option Randomizer
function prepareRenderedQuestion(rawQ) {
  const count = rawQ.options.en.length;
  const indices = Array.from({ length: count }, (_, i) => i);

  if (!rawQ.lockOrder) {
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
  }

  const shuffledEn = indices.map(i => rawQ.options.en[i]);
  const shuffledHi = indices.map(i => (rawQ.options.hi ? rawQ.options.hi[i] : rawQ.options.en[i]));
  const newAnswerIndex = indices.indexOf(rawQ.answerIndex);

  return {
    ...rawQ,
    renderedOptions: { en: shuffledEn, hi: shuffledHi },
    renderedAnswerIndex: newAnswerIndex,
    peekTranslation: false
  };
}

// Progressive Timer Calculation (Warm-Up -> Boss + Bilingual Buffer)
function computeQuestionTimeSeconds(q) {
  const isBossWave = state.wave % 3 === 0;
  let base = 10;
  if (isBossWave) base = 22;
  else if (state.wave >= 5) base = 16;
  else if (state.wave >= 3) base = 14;

  const diffBonus = (q.difficulty || 1) * 2;
  const dualBuffer = (state.langMode === "dual" && !q.isLanguageSpecific) ? 3 : 0;
  return base + diffBonus + dualBuffer;
}

/* ============================================================================
   3. PEN AUTHENTICATION & LEADERBOARD SYNC
   ============================================================================ */
function maskPen(pen) {
  const s = String(pen || "");
  if (s.length <= 4) return "****";
  return `${"*".repeat(s.length - 4)}${s.slice(-4)}`;
}

async function verifyPenAndStart() {
  const now = Date.now();
  if (now < state.lockoutUntil) {
    const secs = Math.ceil((state.lockoutUntil - now) / 1000);
    setLoginStatus(`Too many invalid attempts. Try again in ${secs}s.`, true);
    return;
  }

  const pen = document.getElementById("penInput").value.replace(/\D/g, "");
  document.getElementById("penInput").value = pen;

  if (pen.length < 11 || pen.length > 12) {
    state.loginAttempts++;
    checkLockout();
    setLoginStatus("Please enter a valid 11 or 12-digit numeric PEN.", true);
    return;
  }

  setLoginStatus("Verifying PEN with school roster...", false);
  let studentRecord = null;

  if (API_CONFIG.enabled && API_CONFIG.endpoint.startsWith("http")) {
    try {
      const url = `${API_CONFIG.endpoint}?action=verifyPen&pen=${encodeURIComponent(pen)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.ok && data.student) {
        studentRecord = data.student;
        document.getElementById("hudSyncBadge").textContent = "Live Sheet Sync";
      } else {
        state.loginAttempts++;
        checkLockout();
        setLoginStatus(data.message || "PEN not found in school roster.", true);
        return;
      }
    } catch (err) {
      if (!API_CONFIG.allowOfflineFallback) {
        setLoginStatus("Network error contacting school server.", true);
        return;
      }
    }
  }

  if (!studentRecord) {
    studentRecord = DEMO_ROSTER[pen] || {
      pen,
      name: `Student (${maskPen(pen)})`,
      classNum: 8,
      wing: "junior"
    };
    document.getElementById("hudSyncBadge").textContent = API_CONFIG.enabled ? "Offline Fallback" : "Local Roster";
  }

  state.loginAttempts = 0;
  state.student = studentRecord;

  const selectedWing = document.getElementById("wingSelect").value;
  state.wing = selectedWing === "auto"
    ? (Number(studentRecord.classNum) >= 9 ? "senior" : "junior")
    : selectedWing;

  enterGameArena();
}

function checkLockout() {
  if (state.loginAttempts >= 3) {
    state.lockoutUntil = Date.now() + 30000;
    state.loginAttempts = 0;
  }
}

function setLoginStatus(msg, isError) {
  const el = document.getElementById("loginStatus");
  el.textContent = msg;
  el.className = isError ? "status-msg error" : "status-msg";
}

function enterGameArena() {
  document.getElementById("loginGate").style.display = "none";
  document.getElementById("gameApp").style.display = "flex";
  document.getElementById("inGameLangSelect").value = state.langMode;

  document.getElementById("hudStudentName").textContent = state.student.name;
  document.getElementById("hudStudentMeta").textContent =
    `Class ${state.student.classNum} • ${state.wing.toUpperCase()} WING • PEN ${maskPen(state.student.pen)}`;

  resetGameRun();
  loadLeaderboard();
  requestAnimationFrame(gameLoop);
}

function resetGameRun() {
  state.runId = `RUN-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  state.hp = 100;
  state.coins = 120;
  state.mana = 50;
  state.wave = 1;
  state.score = 0;
  state.waveActive = false;
  state.turrets = [];
  state.enemies = [];
  state.projectiles = [];
  state.spawnQueue = [];
  state.mastery = {
    maths: { ok: 0, total: 0 },
    science: { ok: 0, total: 0 },
    grammar: { ok: 0, total: 0 },
    gk: { ok: 0, total: 0 },
    moral: { ok: 0, total: 0 }
  };
  updateHud();
  renderMastery();
}

async function submitScoreToLeaderboard() {
  const totalCorrect = Object.values(state.mastery).reduce((s, m) => s + m.ok, 0);
  const totalAnswered = Object.values(state.mastery).reduce((s, m) => s + m.total, 0);

  const entry = {
    runId: state.runId,
    pen: state.student.pen,
    maskedPen: maskPen(state.student.pen),
    name: state.student.name,
    classNum: state.student.classNum,
    wing: state.wing,
    score: state.score,
    wave: state.wave,
    correct: totalCorrect,
    total: totalAnswered,
    timestamp: new Date().toISOString()
  };

  // Always update local personal best immediately
  const localKey = "bd_leaderboard_v1";
  const list = JSON.parse(localStorage.getItem(localKey) || "[]");
  const idx = list.findIndex(item => item.pen === entry.pen);
  if (idx === -1 || entry.score > list[idx].score) {
    if (idx === -1) list.push(entry);
    else list[idx] = entry;
    localStorage.setItem(localKey, JSON.stringify(list));
  }

  if (API_CONFIG.enabled && API_CONFIG.endpoint.startsWith("http")) {
    try {
      await fetch(API_CONFIG.endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "submitScore", payload: entry })
      });
    } catch (err) {
      console.warn("Score queued locally; remote sync failed:", err);
    }
  }
  loadLeaderboard();
}

async function loadLeaderboard() {
  let rows = [];
  if (API_CONFIG.enabled && API_CONFIG.endpoint.startsWith("http")) {
    try {
      const res = await fetch(`${API_CONFIG.endpoint}?action=getLeaderboard`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.leaderboard)) {
        rows = data.leaderboard;
      }
    } catch (_) {}
  }

  if (rows.length === 0) {
    rows = JSON.parse(localStorage.getItem("bd_leaderboard_v1") || "[]");
  }

  rows.sort((a, b) => b.score - a.score);
  const ul = document.getElementById("leaderboardList");
  ul.innerHTML = "";

  if (rows.length === 0) {
    ul.innerHTML = `<li class="lb-item"><span>No scores recorded yet. Be the first!</span></li>`;
    return;
  }

  rows.slice(0, 10).forEach((r, i) => {
    const isMe = state.student && String(r.pen) === String(state.student.pen);
    const li = document.createElement("li");
    li.className = `lb-item${isMe ? " me" : ""}`;
    li.innerHTML = `
      <div>
        <strong>#${i + 1} ${r.name}</strong>
        <div style="font-size:0.73rem; color:var(--muted);">Class ${r.classNum} • Wave ${r.wave} • ${maskPen(r.pen)}</div>
      </div>
      <strong style="color:var(--gold);">${r.score}</strong>
    `;
    ul.appendChild(li);
  });
}

/* ============================================================================
   4. CHALLENGE MODAL (BILINGUAL RENDERING + PROGRESSIVE TIMER)
   ============================================================================ */
function openChallengeModal({ subject, titleOverride, onSuccess, onFail }) {
  const q = pickQuestionForSubject(subject);
  const allowedSecs = computeQuestionTimeSeconds(q);

  state.paused = true;
  state.activeChallenge = {
    q,
    allowedSecs,
    remainingSecs: allowedSecs,
    answered: false,
    onSuccess,
    onFail
  };

  document.getElementById("modalSubjectBadge").textContent =
    titleOverride || `${subject.toUpperCase()} • WAVE ${state.wave}`;
  document.getElementById("modalFeedback").style.display = "none";

  const peekBtn = document.getElementById("peekLangBtn");
  peekBtn.style.display = (state.langMode === "dual" || q.isLanguageSpecific) ? "none" : "inline-block";

  renderModalQuestionContent();

  const modal = document.getElementById("challengeModal");
  modal.classList.add("open");

  clearInterval(state.timerInterval);
  updateModalTimerUI();

  state.timerInterval = setInterval(() => {
    if (!state.activeChallenge || state.activeChallenge.answered) return;
    state.activeChallenge.remainingSecs -= 0.1;
    if (state.activeChallenge.remainingSecs <= 0) {
      state.activeChallenge.remainingSecs = 0;
      updateModalTimerUI();
      resolveChallengeAnswer(-1); // Timeout
    } else {
      updateModalTimerUI();
    }
  }, 100);
}

function updateModalTimerUI() {
  const ch = state.activeChallenge;
  if (!ch) return;
  const pct = Math.max(0, (ch.remainingSecs / ch.allowedSecs) * 100);
  const bar = document.getElementById("modalTimerBar");
  bar.style.width = `${pct}%`;
  bar.style.background = pct > 45 ? "var(--green)" : (pct > 20 ? "var(--gold)" : "var(--red)");
  document.getElementById("modalTimerBadge").textContent = `${ch.remainingSecs.toFixed(1)}s`;
}

function renderModalQuestionContent() {
  const ch = state.activeChallenge;
  const q = ch.q;
  const showDual = (state.langMode === "dual" || q.peekTranslation) && !q.isLanguageSpecific;
  const primaryLang = q.isLanguageSpecific ? (q.nativeLang || "en") : (state.langMode === "hi" ? "hi" : "en");

  const promptWrap = document.getElementById("modalPromptWrap");
  if (showDual) {
    promptWrap.innerHTML = `
      <div class="q-prompt-en">${q.prompt.en}</div>
      <div class="q-prompt-hi">${q.prompt.hi || ""}</div>
    `;
  } else {
    promptWrap.innerHTML = `<div class="q-prompt-en">${q.prompt[primaryLang] || q.prompt.en}</div>`;
  }

  const optsContainer = document.getElementById("modalOptions");
  optsContainer.innerHTML = "";

  q.renderedOptions.en.forEach((enText, idx) => {
    const hiText = q.renderedOptions.hi[idx] || enText;
    const btn = document.createElement("button");
    btn.className = "opt-btn";
    if (showDual && hiText !== enText) {
      btn.innerHTML = `<strong>${String.fromCharCode(65 + idx)}.</strong> ${enText} <span style="color:var(--muted);">/ ${hiText}</span>`;
    } else {
      const txt = primaryLang === "hi" ? hiText : enText;
      btn.innerHTML = `<strong>${String.fromCharCode(65 + idx)}.</strong> ${txt}`;
    }
    btn.onclick = () => resolveChallengeAnswer(idx);
    optsContainer.appendChild(btn);
  });
}

function resolveChallengeAnswer(selectedIndex) {
  const ch = state.activeChallenge;
  if (!ch || ch.answered) return;
  ch.answered = true;
  clearInterval(state.timerInterval);

  const q = ch.q;
  const isCorrect = selectedIndex === q.renderedAnswerIndex;
  const isQuickBonus = isCorrect && (ch.remainingSecs / ch.allowedSecs) >= 0.5;

  // Track mastery
  if (state.mastery[q.subject]) {
    state.mastery[q.subject].total++;
    if (isCorrect) state.mastery[q.subject].ok++;
    renderMastery();
  }

  const buttons = document.querySelectorAll("#modalOptions .opt-btn");
  buttons.forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.renderedAnswerIndex) btn.classList.add("correct");
    else if (i === selectedIndex) btn.classList.add("wrong");
  });

  const fb = document.getElementById("modalFeedback");
  fb.style.display = "block";
  const expText = state.langMode === "hi" && q.explanation?.hi ? q.explanation.hi : (q.explanation?.en || "");

  if (isCorrect) {
    AudioFX.correct();
    state.score += isQuickBonus ? 40 : 25;
    state.mana = Math.min(100, state.mana + (isQuickBonus ? 18 : 12));
    fb.innerHTML = `<strong style="color:var(--green);">${isQuickBonus ? "Quick Genius Bonus! (+25% Power)" : "Correct!"}</strong> ${expText}`;
  } else {
    AudioFX.wrong();
    fb.innerHTML = `<strong style="color:var(--red);">${selectedIndex === -1 ? "Time's Up!" : "Not Quite!"}</strong> ${expText}`;
  }

  updateHud();

  setTimeout(() => {
    document.getElementById("challengeModal").classList.remove("open");
    state.paused = false;
    state.activeChallenge = null;
    if (isCorrect && ch.onSuccess) ch.onSuccess(isQuickBonus);
    if (!isCorrect && ch.onFail) ch.onFail();
  }, 1500);
}

/* ============================================================================
   5. TOWER DEFENSE CANVAS ENGINE
   ============================================================================ */
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
let lastFrameTime = performance.now();

function startWave() {
  if (state.waveActive) return;
  state.waveActive = true;
  document.getElementById("startWaveBtn").disabled = true;

  const isBoss = state.wave % 3 === 0;
  const count = isBoss ? 5 + state.wave : 6 + state.wave * 2;
  state.spawnQueue = [];

  for (let i = 0; i < count; i++) {
    const bossUnit = isBoss && i === count - 1;
    state.spawnQueue.push({
      hp: bossUnit ? (180 + state.wave * 55) : (45 + state.wave * 16),
      maxHp: bossUnit ? (180 + state.wave * 55) : (45 + state.wave * 16),
      speed: bossUnit ? 38 : (54 + Math.min(30, state.wave * 2)),
      reward: bossUnit ? 35 : 10,
      isBoss: bossUnit
    });
  }
  state.spawnTimer = 0.2;
}

function handleCanvasClick(evt) {
  if (state.paused) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx = (evt.clientX - rect.left) * scaleX;
  const my = (evt.clientY - rect.top) * scaleY;

  for (let i = 0; i < BUILD_PADS.length; i++) {
    const pad = BUILD_PADS[i];
    if (Math.hypot(mx - pad.x, my - pad.y) <= 26) {
      const existing = state.turrets.find(t => t.padIndex === i);
      if (existing) {
        // Supercharge existing turret via subject question
        if (existing.level >= 3) return;
        openChallengeModal({
          subject: existing.type,
          titleOverride: `SUPERCHARGE ${TURRET_SPECS[existing.type].label.toUpperCase()} (Lv.${existing.level + 1})`,
          onSuccess: (quick) => {
            existing.level++;
            existing.damage = Math.round(existing.damage * (quick ? 1.45 : 1.3));
            existing.range += 15;
          }
        });
      } else {
        const spec = TURRET_SPECS[state.selectedTurretType];
        if (state.coins >= spec.cost) {
          state.coins -= spec.cost;
          state.turrets.push({
            padIndex: i,
            x: pad.x,
            y: pad.y,
            type: state.selectedTurretType,
            level: 1,
            cooldown: 0,
            ...spec
          });
          AudioFX.build();
          updateHud();
        }
      }
      return;
    }
  }
}

function triggerUltimateStorm() {
  if (state.mana < 60 || state.paused) return;
  state.mana -= 60;
  updateHud();

  const subjects = ["maths", "science", "gk"];
  const chosen = subjects[Math.floor(Math.random() * subjects.length)];
  openChallengeModal({
    subject: chosen,
    titleOverride: "ULTIMATE KNOWLEDGE STORM",
    onSuccess: () => {
      state.enemies.forEach(e => { e.hp -= 120; });
      state.score += 60;
      updateHud();
    }
  });
}

function updateSimulation(dt) {
  if (state.paused) return;

  // Spawn enemies
  if (state.waveActive && state.spawnQueue.length > 0) {
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      const next = state.spawnQueue.shift();
      state.enemies.push({
        ...next,
        x: PATH_POINTS[0].x,
        y: PATH_POINTS[0].y,
        waypoint: 1,
        slowTimer: 0
      });
      state.spawnTimer = 1.05;
    }
  }

  // Move enemies
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];
    if (e.hp <= 0) {
      state.coins += e.reward;
      state.score += e.isBoss ? 100 : 15;
      state.enemies.splice(i, 1);
      updateHud();
      continue;
    }

    if (e.slowTimer > 0) e.slowTimer -= dt;
    const effSpeed = e.slowTimer > 0 ? e.speed * 0.55 : e.speed;
    const target = PATH_POINTS[e.waypoint];
    const dx = target.x - e.x;
    const dy = target.y - e.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 4) {
      e.waypoint++;
      if (e.waypoint >= PATH_POINTS.length) {
        state.hp = Math.max(0, state.hp - (e.isBoss ? 25 : 12));
        state.enemies.splice(i, 1);
        updateHud();
        if (state.hp <= 0) {
          endGame();
          return;
        }
      }
    } else {
      e.x += (dx / dist) * effSpeed * dt;
      e.y += (dy / dist) * effSpeed * dt;
    }
  }

  // Turrets fire
  state.turrets.forEach(t => {
    t.cooldown -= dt;
    if (t.cooldown > 0) return;
    const target = state.enemies.find(e => Math.hypot(e.x - t.x, e.y - t.y) <= t.range);
    if (target) {
      t.cooldown = t.rate;
      AudioFX.shoot();
      state.projectiles.push({
        x: t.x, y: t.y, target, speed: 340,
        damage: t.damage, color: t.color, type: t.type
      });
    }
  });

  // Update projectiles
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    if (!state.enemies.includes(p.target)) {
      state.projectiles.splice(i, 1);
      continue;
    }
    const dx = p.target.x - p.x;
    const dy = p.target.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 10) {
      p.target.hp -= p.damage;
      if (p.type === "grammar") p.target.slowTimer = 2.5;
      if (p.type === "maths") {
        // Splash damage
        state.enemies.forEach(other => {
          if (other !== p.target && Math.hypot(other.x - p.target.x, other.y - p.target.y) < 55) {
            other.hp -= Math.round(p.damage * 0.5);
          }
        });
      }
      state.projectiles.splice(i, 1);
    } else {
      p.x += (dx / dist) * p.speed * dt;
      p.y += (dy / dist) * p.speed * dt;
    }
  }

  // Wave cleared -> Moral Education Traveler's Dilemma between waves
  if (state.waveActive && state.spawnQueue.length === 0 && state.enemies.length === 0) {
    state.waveActive = false;
    state.wave++;
    const btn = document.getElementById("startWaveBtn");
    btn.disabled = false;
    btn.textContent = `Start Wave ${state.wave}${state.wave % 3 === 0 ? " (BOSS)" : ""}`;
    updateHud();

    openChallengeModal({
      subject: "moral",
      titleOverride: "TRAVELER'S DILEMMA • MORAL EDUCATION",
      onSuccess: () => {
        state.hp = Math.min(100, state.hp + 15);
        state.coins += 20;
        updateHud();
      }
    });
  }
}

function drawScene() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Path
  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 34;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  PATH_POINTS.forEach((pt, idx) => idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
  ctx.stroke();

  // Castle Gate
  ctx.fillStyle = "#facc15";
  ctx.fillRect(792, 178, 36, 74);
  ctx.fillStyle = "#0b1020";
  ctx.font = "bold 11px sans-serif";
  ctx.fillText("GATE", 796, 219);

  // Build Pads
  BUILD_PADS.forEach((pad, idx) => {
    const occupied = state.turrets.some(t => t.padIndex === idx);
    if (!occupied) {
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, 20, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(56, 189, 248, 0.14)";
      ctx.fill();
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  });

  // Turrets
  state.turrets.forEach(t => {
    ctx.beginPath();
    ctx.arc(t.x, t.y, 19, 0, Math.PI * 2);
    ctx.fillStyle = t.color;
    ctx.fill();
    ctx.fillStyle = "#06101f";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`L${t.level}`, t.x, t.y + 4);
  });

  // Enemies
  state.enemies.forEach(e => {
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.isBoss ? 18 : 12, 0, Math.PI * 2);
    ctx.fillStyle = e.isBoss ? "#f43f5e" : (e.slowTimer > 0 ? "#4ade80" : "#fb923c");
    ctx.fill();

    const w = e.isBoss ? 36 : 24;
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(e.x - w / 2, e.y - 22, w, 4);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(e.x - w / 2, e.y - 22, w * Math.max(0, e.hp / e.maxHp), 4);
  });

  // Projectiles
  state.projectiles.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
  });
}

function gameLoop(now) {
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  if (state.student) {
    updateSimulation(dt);
    drawScene();
  }
  requestAnimationFrame(gameLoop);
}

function endGame() {
  state.paused = true;
  submitScoreToLeaderboard();
  alert(`Castle Breached on Wave ${state.wave}! Final Score: ${state.score}. Your score has been recorded on the leaderboard.`);
  resetGameRun();
  state.paused = false;
  document.getElementById("startWaveBtn").disabled = false;
  document.getElementById("startWaveBtn").textContent = "Start Wave 1";
}

function updateHud() {
  document.getElementById("hudHp").textContent = state.hp;
  document.getElementById("hudCoins").textContent = state.coins;
  document.getElementById("hudMana").textContent = state.mana;
  document.getElementById("hudWave").textContent = state.wave;
  document.getElementById("hudScore").textContent = state.score;
  document.getElementById("ultimateBtn").disabled = state.mana < 60;
}

function renderMastery() {
  const names = { maths: "Maths", science: "Science", grammar: "Grammar", gk: "GK", moral: "Moral Ed" };
  const html = Object.entries(state.mastery)
    .map(([k, v]) => `<div><strong>${names[k]}:</strong> ${v.ok}/${v.total} correct</div>`)
    .join("");
  document.getElementById("masteryStats").innerHTML = html;
}

/* ============================================================================
   6. EVENT WIRING
   ============================================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  await loadQuestionBank();

  document.getElementById("penInput").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\D/g, "");
  });

  document.querySelectorAll("#loginLangPills .lang-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#loginLangPills .lang-pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.langMode = btn.dataset.lang;
    });
  });

  document.querySelectorAll(".demo-fill").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("penInput").value = btn.dataset.pen;
    });
  });

  document.getElementById("loginBtn").addEventListener("click", verifyPenAndStart);
  document.getElementById("inGameLangSelect").addEventListener("change", e => {
    state.langMode = e.target.value;
  });

  document.querySelectorAll(".turret-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".turret-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      state.selectedTurretType = btn.dataset.type;
    });
  });

  canvas.addEventListener("click", handleCanvasClick);
  document.getElementById("startWaveBtn").addEventListener("click", startWave);
  document.getElementById("ultimateBtn").addEventListener("click", triggerUltimateStorm);
  document.getElementById("refreshLbBtn").addEventListener("click", loadLeaderboard);

  document.getElementById("peekLangBtn").addEventListener("click", () => {
    if (!state.activeChallenge) return;
    state.activeChallenge.q.peekTranslation = !state.activeChallenge.q.peekTranslation;
    renderModalQuestionContent();
  });

  document.getElementById("logoutBtn").addEventListener("click", () => {
    if (state.score > 0) submitScoreToLeaderboard();
    state.student = null;
    document.getElementById("gameApp").style.display = "none";
    document.getElementById("loginGate").style.display = "flex";
  });
});
