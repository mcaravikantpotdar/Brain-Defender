/* ============================================================================
   BRAIN DEFENDER — FILE 2 OF 3: GAME ENGINE, PROCEDURAL MATHS & PSEUDO-3D UI
   ============================================================================ */

const BACKEND_URL =
  "https://script.google.com/macros/s/AKfycbxJ3rbuFzYgVzMjSanjrIJY2Vh8Vw2uVQUIu1tKvMz0mE_W3KoBi_6QwEcWWE2C89OwhA/exec";

const VICTORY_WAVE = 6;
const WAVE_CLOCK_SECONDS = 90;
const STORM_MANA_COST = 60;

const TOWER_CONFIG = {
  maths: {
    key: "maths",
    label: "Maths Cannon",
    cost: 40,
    range: 152,
    fireRate: 1.05,
    damage: 12,
    splashRadius: 62,
    splashRatio: 0.5,
    primary: "#fbbf24",
    accent: "#fef08a"
  },
  science: {
    key: "science",
    label: "Science Tesla",
    cost: 45,
    range: 142,
    fireRate: 0.72,
    damage: 10,
    chainCount: 2,
    primary: "#38bdf8",
    accent: "#bae6fd"
  },
  grammar: {
    key: "grammar",
    label: "Grammar Gale",
    cost: 35,
    range: 148,
    fireRate: 0.92,
    damage: 9,
    slowDuration: 3.0,
    slowFactor: 0.55, // 45% slow
    primary: "#22c55e",
    accent: "#86efac"
  },
  gk: {
    key: "gk",
    label: "GK Prism Laser",
    cost: 50,
    range: 215,
    fireRate: 1.35,
    damage: 20,
    primary: "#c084fc",
    accent: "#f3e8ff"
  }
};

const BUILD_PADS = [
  { x: 150, y: 125 }, { x: 305, y: 125 }, { x: 460, y: 125 }, { x: 615, y: 125 },
  { x: 225, y: 320 }, { x: 380, y: 320 }, { x: 535, y: 320 }, { x: 685, y: 320 }
];

// Total route length is ~815px; at 9.05 px/s, the opening Siege scout takes ~90s
const CASTLE_PATH = [
  { x: 0, y: 222 },
  { x: 205, y: 222 },
  { x: 205, y: 68 },
  { x: 560, y: 68 },
  { x: 560, y: 382 },
  { x: 315, y: 382 },
  { x: 315, y: 222 },
  { x: 812, y: 222 }
];

const state = {
  user: null,          // { pen, name, school, classNum, isDemo }
  mode: "siege",       // "siege" | "test90"
  lang: "dual",        // "dual" | "en" | "hi"
  endless: false,
  waveClearedCount: 0,
  failedAuthCount: 0,
  authCooldownUntil: 0,

  questions: [],
  recentIds: [],
  recentGenKeys: [],

  hp: 100,
  gold: 120,
  mana: 50,
  wave: 1,
  score: 0,
  waveTimeLeft: WAVE_CLOCK_SECONDS,
  waveActive: false,
  modalOpen: false,

  selectedSubject: "maths",
  hoveredPad: -1,
  towers: [],
  demons: [],
  projectiles: [],
  zapArcs: [],
  particles: [],
  popups: [],
  spawnQueue: [],
  spawnDelay: 0,
  worldTime: 0,

  wrongStreak: 0,
  tierOffset: 0,
  stats: {
    maths: { right: 0, asked: 0 },
    science: { right: 0, asked: 0 },
    grammar: { right: 0, asked: 0 },
    gk: { right: 0, asked: 0 },
    moral: { right: 0, asked: 0 }
  },

  currentChallenge: null,
  questionTicker: null
};

/* ============================================================================
   1. LIGHTWEIGHT SOUND SYNTHESIS
   ============================================================================ */
const AudioCue = (() => {
  let ctx = null;
  function tone(freq, type = "sine", dur = 0.11, vol = 0.06) {
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
    shoot: () => tone(540, "triangle", 0.055, 0.025),
    hit: () => tone(235, "sine", 0.05, 0.02),
    build: () => tone(440, "square", 0.09, 0.04),
    win: () => {
      tone(587.33, "sine", 0.11, 0.075);
      setTimeout(() => tone(880, "sine", 0.17, 0.075), 85);
    },
    lose: () => tone(180, "sawtooth", 0.22, 0.065)
  };
})();

/* ============================================================================
   2. DIFFICULTY TIER SCALING (ALWAYS STARTS SUPER EASY -> ADVANCES UPWARD)
   ============================================================================ */
function computeTier() {
  let base = 1;
  if (state.wave === 2) base = 2;
  else if (state.wave === 3 || state.wave === 4) base = 3;
  else if (state.wave >= 5) base = 4;

  // Wave 1 always opens on Tier 1 (Super Easy)
  if (state.wave === 1 && !state.endless) return 1;
  return Math.max(1, Math.min(4, base + state.tierOffset));
}

function tierLabel(t) {
  const map = {
    1: "Tier 1: Super Easy",
    2: "Tier 2: Foundation",
    3: "Tier 3: Challenge",
    4: "Tier 4: Master / Boss"
  };
  return map[t] || "Tier 1: Super Easy";
}

function questionDuration(q, isUntimed) {
  if (isUntimed) return null;
  const t = Number(q.difficulty || computeTier());
  let secs = 11 + (t - 1) * 4 + (state.wave - 1) * 1.5;
  if (state.wave % 3 === 0) secs += 5;
  if (state.lang === "dual") secs += 3;
  return Math.min(35, Math.round(secs * 10) / 10);
}

/* ============================================================================
   3. QUESTION BANK LOADER, GUARDED PROCEDURAL MATHS & SMART SELECTION
   ============================================================================ */
async function loadQuestionBank() {
  try {
    const resp = await fetch("questions.json", { cache: "no-store" });
    if (!resp.ok) throw new Error("Failed to load questions.json");
    const data = await resp.json();
    const list = Array.isArray(data.questions) ? data.questions : [];
    state.questions = list.filter(
      item =>
        item &&
        item.subject &&
        item.prompt &&
        item.prompt.en &&
        item.options &&
        Array.isArray(item.options.en) &&
        item.options.en.length >= 2 &&
        typeof item.answerIndex === "number"
    );
  } catch (err) {
    console.warn("Question JSON load issue:", err);
    state.questions = [];
  }
}

function randInt(min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function uniqueFourOptions(correctVal, candidateDistractors, minBound = 0) {
  const set = new Set([String(correctVal)]);
  for (const cand of candidateDistractors) {
    if (set.size >= 4) break;
    const n = Number(cand);
    if (!Number.isFinite(n)) continue;
    if (n < minBound) continue;
    const formatted = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
    set.add(formatted);
  }
  let step = 1;
  while (set.size < 4) {
    const plus = Number(correctVal) + step;
    const minus = Number(correctVal) - step;
    if (Number.isFinite(plus) && plus >= minBound) set.add(String(plus));
    if (set.size < 4 && Number.isFinite(minus) && minus >= minBound) set.add(String(minus));
    step++;
  }
  return Array.from(set).slice(0, 4);
}

function generateProceduralMath(cls, tier) {
  const grade = Math.max(6, Math.min(10, Number(cls) || 8));
  const diff = Math.max(1, Math.min(4, Number(tier) || 1));

  for (let attempt = 0; attempt < 8; attempt++) {
    let item = null;
    let sig = "";

    if (diff === 1) {
      if (grade <= 7) {
        const a = randInt(3, 18);
        const b = randInt(2, 15);
        const ans = a + b;
        sig = `m1-add-${a}-${b}`;
        const opts = uniqueFourOptions(ans, [ans + 1, ans - 1, ans + 2, Math.abs(a - b)], 0);
        item = {
          id: `PROC-M1-${Date.now()}-${attempt}`,
          class: grade,
          subject: "maths",
          difficulty: 1,
          prompt: {
            en: `Quick Warm-Up: What is ${a} + ${b}?`,
            hi: `त्वरित अभ्यास: ${a} + ${b} कितना होता है?`
          },
          options: { en: opts, hi: [...opts] },
          answerIndex: 0,
          explanation: {
            en: `${a} + ${b} = ${ans}.`,
            hi: `${a} + ${b} = ${ans} होता है।`
          }
        };
      } else {
        const base = randInt(2, 12);
        const sq = base * base;
        sig = `m1-sq-${base}`;
        const opts = uniqueFourOptions(sq, [base * 2, sq + base, Math.max(1, sq - base), sq + 4], 1);
        item = {
          id: `PROC-M1S-${Date.now()}-${attempt}`,
          class: grade,
          subject: "maths",
          difficulty: 1,
          prompt: {
            en: `Quick Warm-Up: What is ${base}²?`,
            hi: `त्वरित अभ्यास: ${base}² का मान क्या है?`
          },
          options: { en: opts, hi: [...opts] },
          answerIndex: 0,
          explanation: {
            en: `${base} × ${base} = ${sq}.`,
            hi: `${base} × ${base} = ${sq}।`
          }
        };
      }
    } else if (diff === 2) {
      const a = randInt(2, 6);
      const x = randInt(2, 9);
      const b = randInt(2, 12);
      const total = a * x + b;
      sig = `m2-lin-${a}-${x}-${b}`;
      const opts = uniqueFourOptions(
        x,
        [x + 1, Math.max(1, x - 1), total - b, x + 2],
        1
      );
      item = {
        id: `PROC-M2-${Date.now()}-${attempt}`,
        class: grade,
        subject: "maths",
        difficulty: 2,
        prompt: {
          en: `Class ${grade}: Find x if ${a}x + ${b} = ${total}.`,
          hi: `कक्षा ${grade}: यदि ${a}x + ${b} = ${total}, तो x का मान क्या है?`
        },
        options: { en: opts, hi: [...opts] },
        answerIndex: 0,
        explanation: {
          en: `${a}x = ${total} - ${b} = ${total - b}, so x = ${x}.`,
          hi: `${a}x = ${total} - ${b} = ${total - b}, इसलिए x = ${x}।`
        }
      };
    } else if (diff === 3) {
      const pctChoices = [10, 20, 25, 50];
      const pct = pctChoices[randInt(0, pctChoices.length - 1)];
      const mult = randInt(2, 8);
      const whole = (100 / pct) * mult;
      const ans = Math.round((pct * whole) / 100);
      sig = `m3-pct-${pct}-${whole}`;
      const opts = uniqueFourOptions(ans, [ans + mult, Math.max(1, ans - mult), whole, ans * 2], 1);
      item = {
        id: `PROC-M3-${Date.now()}-${attempt}`,
        class: grade,
        subject: "maths",
        difficulty: 3,
        prompt: {
          en: `Class ${grade}: What is ${pct}% of ${whole}?`,
          hi: `कक्षा ${grade}: ${whole} का ${pct}% कितना होगा?`
        },
        options: { en: opts, hi: [...opts] },
        answerIndex: 0,
        explanation: {
          en: `(${pct} ÷ 100) × ${whole} = ${ans}.`,
          hi: `(${pct} ÷ 100) × ${whole} = ${ans}।`
        }
      };
    } else {
      const a1 = randInt(2, 10);
      const d = randInt(2, 6);
      const n = randInt(4, 7);
      const nth = a1 + (n - 1) * d;
      sig = `m4-ap-${a1}-${d}-${n}`;
      const opts = uniqueFourOptions(nth, [a1 + n * d, nth - d, nth + d, a1 + d], 1);
      item = {
        id: `PROC-M4-${Date.now()}-${attempt}`,
        class: grade,
        subject: "maths",
        difficulty: 4,
        prompt: {
          en: `Boss Challenge: Find the ${n}th term of progression ${a1}, ${a1 + d}, ${a1 + 2 * d}, ...`,
          hi: `बॉस चुनौती: श्रेणी ${a1}, ${a1 + d}, ${a1 + 2 * d}, ... का ${n}वाँ पद क्या है?`
        },
        options: { en: opts, hi: [...opts] },
        answerIndex: 0,
        explanation: {
          en: `Term ${n} = ${a1} + (${n} - 1) × ${d} = ${nth}.`,
          hi: `${n}वाँ पद = ${a1} + (${n} - 1) × ${d} = ${nth}।`
        }
      };
    }

    if (!state.recentGenKeys.includes(sig)) {
      state.recentGenKeys.push(sig);
      if (state.recentGenKeys.length > 25) state.recentGenKeys.shift();
      return item;
    }
  }

  return generateProceduralMath(grade, 1);
}

function selectQuestion(subject) {
  const cls = Number(state.user?.classNum || 8);
  const tier = computeTier();

  // For Maths, blend procedural generation ~50% of the time for fresh variety
  if (subject === "maths" && Math.random() < 0.5) {
    return prepareShuffledQuestion(generateProceduralMath(cls, tier));
  }

  const subPool = state.questions.filter(q => q.subject === subject);
  if (subPool.length === 0) {
    return prepareShuffledQuestion(generateProceduralMath(cls, tier));
  }

  const notRecent = subPool.filter(q => !state.recentIds.includes(q.id));
  const working = notRecent.length > 0 ? notRecent : subPool;

  // Cascade from exact class + tier to broader matches so a bucket never dead-ends
  const candidates = [
    working.filter(q => Number(q.class) === cls && Number(q.difficulty || 1) === tier),
    working.filter(q => Number(q.class) === cls && Math.abs(Number(q.difficulty || 1) - tier) === 1),
    working.filter(q => Number(q.class) === cls),
    working.filter(q => Math.abs(Number(q.class) - cls) === 1 && Number(q.difficulty || 1) === tier),
    working.filter(q => Math.abs(Number(q.class) - cls) === 1),
    working
  ].find(bucket => bucket.length > 0);

  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  state.recentIds.push(picked.id);
  if (state.recentIds.length > 35) state.recentIds.shift();

  return prepareShuffledQuestion(picked);
}

function prepareShuffledQuestion(raw) {
  const len = raw.options.en.length;
  const order = Array.from({ length: len }, (_, idx) => idx);

  if (!raw.lockOrder) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }

  const hiOpts = Array.isArray(raw.options.hi) && raw.options.hi.length === len
    ? raw.options.hi
    : raw.options.en;

  return {
    ...raw,
    shuffledEn: order.map(i => raw.options.en[i]),
    shuffledHi: order.map(i => hiOpts[i]),
    shuffledAnswer: order.indexOf(raw.answerIndex),
    peekActive: false
  };
}

/* ============================================================================
   4. STUDENT ID VERIFICATION, DEMO ISOLATION & LEADERBOARD SYNC
   ============================================================================ */
function maskId(val) {
  const s = String(val || "");
  if (s.length <= 4) return "****";
  return `${"*".repeat(s.length - 4)}${s.slice(-4)}`;
}

function showEntryMessage(msg, isError = false) {
  const el = document.getElementById("entryNotice");
  el.textContent = msg;
  el.className = isError ? "auth-status err" : "auth-status";
}

async function handleVerifyLogin() {
  const now = Date.now();
  if (now < state.authCooldownUntil) {
    const secs = Math.ceil((state.authCooldownUntil - now) / 1000);
    showEntryMessage(`Too many tries. Please wait ${secs}s.`, true);
    return;
  }

  const input = document.getElementById("studentIdInput");
  const digits = input.value.replace(/\D/g, "");
  input.value = digits;

  if (digits.length < 10 || digits.length > 12) {
    state.failedAuthCount++;
    if (state.failedAuthCount >= 3) {
      state.authCooldownUntil = Date.now() + 30000;
      state.failedAuthCount = 0;
    }
    showEntryMessage("Please enter a valid Student ID.", true);
    return;
  }

  const btn = document.getElementById("verifyEnterBtn");
  btn.disabled = true;
  showEntryMessage("Checking Student ID...", false);

  try {
    const url = `${BACKEND_URL}?action=verifyPen&pen=${encodeURIComponent(digits)}`;
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    const data = await res.json();

    if (data.ok && data.student) {
      state.failedAuthCount = 0;
      const cls = Number(document.getElementById("classSelect").value) || 8;
      state.user = {
        pen: String(data.student.pen),
        name: String(data.student.name || "Defender"),
        school: String(data.student.school || ""),
        classNum: cls,
        isDemo: false
      };
      enterArena();
    } else {
      state.failedAuthCount++;
      if (state.failedAuthCount >= 3) {
        state.authCooldownUntil = Date.now() + 30000;
        state.failedAuthCount = 0;
      }
      showEntryMessage(data.message || "Student ID not found.", true);
    }
  } catch (_) {
    showEntryMessage("Unable to reach server right now. Please try again.", true);
  } finally {
    btn.disabled = false;
  }
}

function handleDemoLogin() {
  const cls = Number(document.getElementById("classSelect").value) || 8;
  state.user = {
    pen: "DEMO",
    name: "Demo Explorer",
    school: "",
    classNum: cls,
    isDemo: true
  };
  enterArena();
}

function enterArena() {
  document.getElementById("entryScreen").style.display = "none";
  document.getElementById("arenaScreen").style.display = "flex";
  document.getElementById("liveLangSelect").value = state.lang;

  document.getElementById("hudPlayerName").textContent = state.user.name;
  document.getElementById("hudClassMode").textContent =
    `CLASS ${state.user.classNum} • ${state.mode === "test90" ? "90S TEST" : "SIEGE"}`;

  const statusBadge = document.getElementById("hudModeStatus");
  if (state.user.isDemo) {
    statusBadge.textContent = "Demo • Not Saved";
    statusBadge.className = "badge demo";
  } else {
    statusBadge.textContent = state.user.school ? `Verified • ${state.user.school}` : "Verified";
    statusBadge.className = "badge ok";
  }

  document.getElementById("hudTimerChip").style.display = state.mode === "test90" ? "flex" : "none";

  resetMatch(false);
  loadLeaderboard();
  requestAnimationFrame(renderLoop);
}

function resetMatch(startEndless) {
  state.hp = 100;
  state.gold = 120;
  state.mana = 50;
  state.wave = startEndless ? VICTORY_WAVE + 1 : 1;
  state.endless = Boolean(startEndless);
  state.waveClearedCount = 0;
  state.score = 0;
  state.waveTimeLeft = WAVE_CLOCK_SECONDS;
  state.waveActive = false;
  state.modalOpen = false;
  state.wrongStreak = 0;
  state.tierOffset = 0;

  state.towers = [];
  state.demons = [];
  state.projectiles = [];
  state.zapArcs = [];
  state.particles = [];
  state.popups = [];
  state.spawnQueue = [];

  state.stats = {
    maths: { right: 0, asked: 0 },
    science: { right: 0, asked: 0 },
    grammar: { right: 0, asked: 0 },
    gk: { right: 0, asked: 0 },
    moral: { right: 0, asked: 0 }
  };

  const waveBtn = document.getElementById("startWaveBtn");
  waveBtn.disabled = false;
  waveBtn.textContent = `Start Wave ${state.wave}${state.wave % 3 === 0 ? " (Boss)" : ""}`;

  refreshHud();
  refreshMastery();
}

async function submitMatchScore(bonusPoints = 0) {
  // Demo mode is strictly excluded from leaderboard submission
  if (!state.user || state.user.isDemo) {
    return { saved: false, msg: "Demo mode: scores are never saved to the leaderboard." };
  }

  const finalScore = Math.max(0, state.score + bonusPoints);
  if (finalScore <= 0) {
    return { saved: false, msg: "No points scored yet to submit." };
  }

  const rightTotal = Object.values(state.stats).reduce((acc, s) => acc + s.right, 0);
  const askedTotal = Object.values(state.stats).reduce((acc, s) => acc + s.asked, 0);

  const payload = {
    pen: state.user.pen,
    maskedPen: maskId(state.user.pen),
    name: state.user.name,
    school: state.user.school || "",
    classNum: state.user.classNum,
    mode: state.mode,
    score: finalScore,
    wave: state.wave,
    correct: rightTotal,
    total: askedTotal,
    isDemo: false
  };

  try {
    const res = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "submitScore", payload })
    });
    const out = await res.json();
    await loadLeaderboard();
    return { saved: Boolean(out.ok), bestScore: out.bestScore || finalScore };
  } catch (_) {
    return { saved: false, msg: "Could not sync score right now." };
  }
}

async function loadLeaderboard() {
  const list = document.getElementById("leaderboardList");
  try {
    const res = await fetch(`${BACKEND_URL}?action=getLeaderboard`, { redirect: "follow" });
    const out = await res.json();
    const rows = (out.ok && Array.isArray(out.leaderboard)) ? out.leaderboard : [];

    list.innerHTML = "";
    if (!rows.length) {
      list.innerHTML = `<li class="board-row"><span>No leaderboard entries yet.</span></li>`;
      return;
    }

    rows.slice(0, 10).forEach((entry, idx) => {
      const isSelf = state.user && !state.user.isDemo && String(entry.pen) === String(state.user.pen);
      const li = document.createElement("li");
      li.className = `board-row${isSelf ? " me" : ""}`;
      li.innerHTML = `
        <div>
          <strong>#${idx + 1} ${entry.name}</strong>
          <div style="font-size:0.72rem; color:var(--muted);">
            Class ${entry.classNum || "-"} • ${entry.school || "Defender"} • Wave ${entry.wave}
          </div>
        </div>
        <strong style="color:var(--gold); font-size:0.95rem;">${entry.score}</strong>
      `;
      list.appendChild(li);
    });
  } catch (_) {
    list.innerHTML = `<li class="board-row"><span>Leaderboard temporarily offline.</span></li>`;
  }
}

/* ============================================================================
   5. QUESTION & UNTIMED MORAL EDUCATION MODAL
   ============================================================================ */
function openQuestionPrompt({ subject, headerText, untimed = false, onSuccess, onFail }) {
  const q = selectQuestion(subject);
  const seconds = questionDuration(q, untimed);

  state.modalOpen = true;
  state.currentChallenge = {
    q,
    untimed,
    totalSec: seconds || 1,
    leftSec: seconds || 1,
    done: false,
    onSuccess,
    onFail
  };

  document.getElementById("qSubjectBadge").textContent = headerText || `${subject.toUpperCase()}`;
  document.getElementById("qTierBadge").textContent =
    subject === "moral" ? "Moral Values • Untimed" : tierLabel(q.difficulty || computeTier());

  const meterWrap = document.getElementById("qMeterWrap");
  const timerBadge = document.getElementById("qTimerBadge");
  if (untimed) {
    meterWrap.style.display = "none";
    timerBadge.textContent = "No Timer";
  } else {
    meterWrap.style.display = "block";
    timerBadge.textContent = `${seconds.toFixed(1)}s`;
  }

  document.getElementById("qFeedbackArea").style.display = "none";
  document.getElementById("peekLangBtn").style.display = state.lang === "dual" ? "none" : "inline-block";

  renderPromptBody();
  document.getElementById("questionModal").classList.add("open");

  clearInterval(state.questionTicker);
  if (!untimed) {
    updateQuestionTimerBar();
    state.questionTicker = setInterval(() => {
      const ch = state.currentChallenge;
      if (!ch || ch.done) return;
      ch.leftSec -= 0.1;
      if (ch.leftSec <= 0) {
        ch.leftSec = 0;
        updateQuestionTimerBar();
        resolveQuestion(-1);
      } else {
        updateQuestionTimerBar();
      }
    }, 100);
  }
}

function updateQuestionTimerBar() {
  const ch = state.currentChallenge;
  if (!ch || ch.untimed) return;
  const pct = Math.max(0, (ch.leftSec / ch.totalSec) * 100);
  const fill = document.getElementById("qMeterFill");
  fill.style.width = `${pct}%`;
  fill.style.background = pct > 45 ? "#22c55e" : (pct > 20 ? "#fbbf24" : "#fb7185");
  document.getElementById("qTimerBadge").textContent = `${ch.leftSec.toFixed(1)}s`;
}

function renderPromptBody() {
  const ch = state.currentChallenge;
  if (!ch) return;
  const q = ch.q;
  const showBoth = state.lang === "dual" || q.peekActive;
  const primaryLang = state.lang === "hi" ? "hi" : "en";

  const promptBox = document.getElementById("qPromptArea");
  if (showBoth) {
    promptBox.innerHTML = `
      <div class="q-stem-main">${q.prompt.en}</div>
      <div class="q-stem-sub">${q.prompt.hi || ""}</div>
    `;
  } else {
    promptBox.innerHTML = `<div class="q-stem-main">${q.prompt[primaryLang] || q.prompt.en}</div>`;
  }

  const choicesBox = document.getElementById("qChoicesArea");
  choicesBox.innerHTML = "";

  q.shuffledEn.forEach((enOpt, idx) => {
    const hiOpt = q.shuffledHi[idx] || enOpt;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice-opt";

    if (showBoth && hiOpt !== enOpt) {
      btn.innerHTML = `<strong>${String.fromCharCode(65 + idx)}.</strong> ${enOpt} <span style="color:var(--muted);">/ ${hiOpt}</span>`;
    } else {
      btn.innerHTML = `<strong>${String.fromCharCode(65 + idx)}.</strong> ${primaryLang === "hi" ? hiOpt : enOpt}`;
    }
    btn.onclick = () => resolveQuestion(idx);
    choicesBox.appendChild(btn);
  });
}

function resolveQuestion(choiceIdx) {
  const ch = state.currentChallenge;
  if (!ch || ch.done) return;
  ch.done = true;
  clearInterval(state.questionTicker);

  const q = ch.q;
  const isRight = choiceIdx === q.shuffledAnswer;
  const fastAnswer = isRight && !ch.untimed && (ch.leftSec / ch.totalSec) >= 0.5;

  if (state.stats[q.subject]) {
    state.stats[q.subject].asked++;
    if (isRight) state.stats[q.subject].right++;
    refreshMastery();
  }

  const optionButtons = document.querySelectorAll("#qChoicesArea .choice-opt");
  optionButtons.forEach((b, i) => {
    b.disabled = true;
    if (i === q.shuffledAnswer) b.classList.add("correct");
    else if (i === choiceIdx) b.classList.add("wrong");
  });

  const fb = document.getElementById("qFeedbackArea");
  fb.style.display = "block";
  const expText = state.lang === "hi" && q.explanation?.hi ? q.explanation.hi : (q.explanation?.en || "");

  if (isRight) {
    AudioCue.win();
    state.wrongStreak = 0;
    if (state.tierOffset > 0 && Math.random() < 0.4) state.tierOffset--;

    const pts = fastAnswer ? 40 : 25;
    state.score += pts;
    state.mana = Math.min(100, state.mana + (fastAnswer ? 20 : 12));

    // In 90s Test Mode, a right answer also sends a direct arcane strike at the leading demon
    if (state.mode === "test90" && state.demons.length > 0) {
      const lead = state.demons[0];
      const strike = fastAnswer ? 26 : 16;
      lead.hp -= strike;
      spawnBurst(lead.x, lead.y, "#38bdf8", 12);
      spawnPopup(lead.x, lead.y - 18, `-${strike} STRIKE!`, "#38bdf8");
    }

    fb.innerHTML = `<strong style="color:#86efac;">${fastAnswer ? "Swift & Right! +" + pts + " pts" : "Correct! +" + pts + " pts"}</strong> ${expText}`;
  } else {
    AudioCue.lose();
    state.wrongStreak++;
    if (state.wrongStreak >= 2) {
      state.tierOffset = Math.max(-1, state.tierOffset - 1);
      state.wrongStreak = 0;
    }
    fb.innerHTML = `<strong style="color:#fda4af;">${choiceIdx === -1 ? "Time's Up!" : "Not Quite!"}</strong> ${expText}`;
  }

  refreshHud();

  setTimeout(() => {
    document.getElementById("questionModal").classList.remove("open");
    state.modalOpen = false;
    state.currentChallenge = null;
    if (isRight && ch.onSuccess) ch.onSuccess(fastAnswer);
    if (!isRight && ch.onFail) ch.onFail();
  }, 1350);
}

/* ============================================================================
   6. WAVE SPAWNING, TOWER PLACEMENT/UPGRADE, STORM & VICTORY FLOW
   ============================================================================ */
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
let prevFrame = performance.now();

function spawnBurst(x, y, color, count = 10) {
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 35 + Math.random() * 115;
    state.particles.push({
      x, y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      life: 0.35 + Math.random() * 0.2,
      maxLife: 0.55,
      color,
      size: 2.2 + Math.random() * 2.5
    });
  }
}

function spawnPopup(x, y, text, color = "#fde047") {
  state.popups.push({ x, y, text, color, life: 0.95 });
}

function beginWave() {
  if (state.waveActive || state.modalOpen) return;
  state.waveActive = true;
  state.waveTimeLeft = WAVE_CLOCK_SECONDS;
  document.getElementById("startWaveBtn").disabled = true;
  state.spawnQueue = [];

  if (state.mode === "siege" && state.wave === 1 && !state.endless) {
    // Slow ~90s scout (~9.05 px/s along ~815px route), 20 HP -> defeated in 2 basic 12-dmg shots
    state.spawnQueue.push({
      hp: 20,
      maxHp: 20,
      speed: 9.05,
      goldReward: 25,
      scoreReward: 30,
      castleDamage: 12,
      isBoss: false,
      isScout: true
    });
    state.spawnDelay = 0.25;
  } else {
    const isBossWave = state.wave % 3 === 0;
    const count = isBossWave ? 4 + state.wave : 5 + state.wave * 2;
    const powerScale = Math.max(1, state.wave - (state.mode === "siege" ? 1 : 0));

    for (let i = 0; i < count; i++) {
      const boss = isBossWave && i === count - 1;
      const hp = boss ? 95 + powerScale * 35 : 24 + powerScale * 14;
      const speed = boss ? 25 + powerScale * 2.5 : 34 + powerScale * 5.5;

      state.spawnQueue.push({
        hp,
        maxHp: hp,
        speed: Math.min(98, speed),
        goldReward: boss ? 35 : 10 + powerScale * 2,
        scoreReward: boss ? 120 : 20 + powerScale * 5,
        castleDamage: boss ? 25 : 10 + Math.min(15, powerScale * 2),
        isBoss: boss,
        isScout: false
      });
    }
    state.spawnDelay = 0.25;
  }

  refreshHud();
}

function triggerUltimateStorm() {
  if (state.mana < STORM_MANA_COST || state.modalOpen) return;
  state.mana -= STORM_MANA_COST;
  refreshHud();

  const subjects = ["maths", "science", "grammar", "gk"];
  const pickedSub = subjects[Math.floor(Math.random() * subjects.length)];

  openQuestionPrompt({
    subject: pickedSub,
    headerText: "⚡ ULTIMATE STORM • ANSWER TO UNLEASH",
    onSuccess: () => {
      state.demons.forEach(d => {
        d.hp -= 60;
        spawnBurst(d.x, d.y, "#e879f9", 14);
      });
      state.score += 50;
      spawnPopup(440, 195, "ARCANE STORM!", "#e879f9");
      refreshHud();
    }
  });
}

function handleBoardClick(evt) {
  if (state.modalOpen) return;
  const rect = canvas.getBoundingClientRect();
  const px = (evt.clientX - rect.left) * (canvas.width / rect.width);
  const py = (evt.clientY - rect.top) * (canvas.height / rect.height);

  for (let idx = 0; idx < BUILD_PADS.length; idx++) {
    const pad = BUILD_PADS[idx];
    if (Math.hypot(px - pad.x, py - pad.y) <= 28) {
      const existing = state.towers.find(t => t.padIndex === idx);

      // Upgrade an existing tower via its subject question
      if (existing) {
        if (existing.level >= 3) {
          spawnPopup(existing.x, existing.y - 22, "MAX LEVEL", existing.primary);
          return;
        }
        const cfg = TOWER_CONFIG[existing.subject];
        openQuestionPrompt({
          subject: existing.subject,
          headerText: `UPGRADE ${cfg.label.toUpperCase()} → LV.${existing.level + 1}`,
          onSuccess: (swift) => {
            existing.level++;
            existing.damage += swift ? 12 : 8;
            existing.range += 16;
            existing.fireRate = Math.max(0.36, existing.fireRate * 0.88);
            AudioCue.build();
            spawnBurst(existing.x, existing.y, existing.primary, 18);
            spawnPopup(existing.x, existing.y - 24, `LEVEL ${existing.level}!`, existing.primary);
          }
        });
        return;
      }

      // Build a new tower: check Gold first, ask 1 subject question, spend Gold on right answer
      const cfg = TOWER_CONFIG[state.selectedSubject];
      if (state.gold < cfg.cost) {
        spawnPopup(pad.x, pad.y - 20, `Need ${cfg.cost}g!`, "#fb7185");
        return;
      }

      openQuestionPrompt({
        subject: cfg.key,
        headerText: `BUILD ${cfg.label.toUpperCase()} (${cfg.cost}g)`,
        onSuccess: (swift) => {
          if (state.gold < cfg.cost) return;
          state.gold -= cfg.cost;
          state.towers.push({
            padIndex: idx,
            x: pad.x,
            y: pad.y,
            subject: cfg.key,
            level: 1,
            cooldown: 0,
            angle: 0,
            damage: cfg.damage + (swift ? 4 : 0),
            range: cfg.range,
            fireRate: cfg.fireRate,
            primary: cfg.primary,
            accent: cfg.accent
          });
          AudioCue.build();
          spawnBurst(pad.x, pad.y, cfg.primary, 15);
          spawnPopup(pad.x, pad.y - 22, `-${cfg.cost}g BUILT!`, "#fde047");
          refreshHud();
        },
        onFail: () => {
          spawnPopup(pad.x, pad.y - 20, "Gold Kept — Try Again", "#cbd5e1");
        }
      });
      return;
    }
  }
}

function stepSimulation(dt) {
  state.worldTime += dt;
  if (state.modalOpen) return;

  // 90s Test Mode wave countdown
  if (state.mode === "test90" && state.waveActive) {
    state.waveTimeLeft = Math.max(0, state.waveTimeLeft - dt);
    refreshHud();
    if (state.waveTimeLeft <= 0) {
      const breachLoss = Math.min(state.hp, 15 + state.demons.length * 8);
      state.hp = Math.max(0, state.hp - breachLoss);
      state.demons = [];
      state.spawnQueue = [];
      state.waveActive = false;
      spawnPopup(795, 190, `TIME UP! -${breachLoss} HP`, "#fb7185");
      refreshHud();
      if (state.hp <= 0) {
        concludeMatch(false);
        return;
      }
      completeWaveStep();
      return;
    }
  }

  // Spawn demons from queue
  if (state.waveActive && state.spawnQueue.length > 0) {
    state.spawnDelay -= dt;
    if (state.spawnDelay <= 0) {
      const next = state.spawnQueue.shift();
      state.demons.push({
        ...next,
        x: CASTLE_PATH[0].x,
        y: CASTLE_PATH[0].y,
        wpIndex: 1,
        slowTimer: 0,
        hitFlash: 0
      });
      state.spawnDelay = state.wave === 1 ? 1.5 : Math.max(0.45, 1.15 - state.wave * 0.08);
    }
  }

  // Move & check demons
  for (let i = state.demons.length - 1; i >= 0; i--) {
    const d = state.demons[i];
    if (d.hitFlash > 0) d.hitFlash -= dt;

    if (d.hp <= 0) {
      state.gold += d.goldReward;
      state.score += d.scoreReward;
      spawnBurst(d.x, d.y, d.isBoss ? "#fb7185" : "#fb923c", d.isBoss ? 22 : 12);
      spawnPopup(d.x, d.y - 16, `+${d.goldReward}g`, "#fde047");
      state.demons.splice(i, 1);
      refreshHud();
      continue;
    }

    if (d.slowTimer > 0) d.slowTimer -= dt;
    const cfg = d.slowTimer > 0 ? d.speed * TOWER_CONFIG.grammar.slowFactor : d.speed;
    const targetPt = CASTLE_PATH[d.wpIndex];
    const dx = targetPt.x - d.x;
    const dy = targetPt.y - d.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 3.5) {
      d.wpIndex++;
      if (d.wpIndex >= CASTLE_PATH.length) {
        state.hp = Math.max(0, state.hp - d.castleDamage);
        AudioCue.lose();
        spawnBurst(805, 222, "#fb7185", 18);
        spawnPopup(785, 185, `-${d.castleDamage} CASTLE HP!`, "#fb7185");
        state.demons.splice(i, 1);
        refreshHud();
        if (state.hp <= 0) {
          concludeMatch(false);
          return;
        }
      }
    } else {
      d.x += (dx / dist) * cfg * dt;
      d.y += (dy / dist) * cfg * dt;
    }
  }

  // Towers acquire & fire
  state.towers.forEach(t => {
    t.cooldown -= dt;
    const foe = state.demons.find(d => Math.hypot(d.x - t.x, d.y - t.y) <= t.range);
    if (foe) {
      t.angle = Math.atan2(foe.y - t.y, foe.x - t.x);
      if (t.cooldown <= 0) {
        t.cooldown = t.fireRate;
        AudioCue.shoot();

        if (t.subject === "science") {
          // Science Tesla: rapid direct spark + chain jump to 1 nearby demon
          foe.hp -= t.damage;
          foe.hitFlash = 0.12;
          spawnBurst(foe.x, foe.y, t.primary, 6);
          state.zapArcs.push({ x1: t.x, y1: t.y, x2: foe.x, y2: foe.y, color: t.primary, life: 0.14 });

          const neighbor = state.demons.find(
            other => other !== foe && Math.hypot(other.x - foe.x, other.y - foe.y) <= 85
          );
          if (neighbor) {
            const chainDmg = Math.round(t.damage * 0.6);
            neighbor.hp -= chainDmg;
            neighbor.hitFlash = 0.12;
            state.zapArcs.push({
              x1: foe.x, y1: foe.y, x2: neighbor.x, y2: neighbor.y, color: t.accent, life: 0.14
            });
          }
        } else {
          state.projectiles.push({
            x: t.x,
            y: t.y,
            target: foe,
            speed: t.subject === "gk" ? 520 : 370,
            damage: t.damage,
            subject: t.subject,
            color: t.primary
          });
        }
      }
    }
  });

  // Projectiles
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    if (!state.demons.includes(p.target)) {
      state.projectiles.splice(i, 1);
      continue;
    }
    const dx = p.target.x - p.x;
    const dy = p.target.y - p.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 10) {
      AudioCue.hit();
      p.target.hp -= p.damage;
      p.target.hitFlash = 0.12;
      spawnBurst(p.target.x, p.target.y, p.color, 7);

      if (p.subject === "maths") {
        const splashDmg = Math.round(p.damage * TOWER_CONFIG.maths.splashRatio);
        state.demons.forEach(other => {
          if (other !== p.target && Math.hypot(other.x - p.target.x, other.y - p.target.y) <= TOWER_CONFIG.maths.splashRadius) {
            other.hp -= splashDmg;
            other.hitFlash = 0.1;
          }
        });
      } else if (p.subject === "grammar") {
        p.target.slowTimer = TOWER_CONFIG.grammar.slowDuration;
        spawnPopup(p.target.x, p.target.y - 24, "SLOWED", "#86efac");
      }

      state.projectiles.splice(i, 1);
    } else {
      p.x += (dx / dist) * p.speed * dt;
      p.y += (dy / dist) * p.speed * dt;
    }
  }

  for (let i = state.zapArcs.length - 1; i >= 0; i--) {
    state.zapArcs[i].life -= dt;
    if (state.zapArcs[i].life <= 0) state.zapArcs.splice(i, 1);
  }

  for (let i = state.particles.length - 1; i >= 0; i--) {
    const pt = state.particles[i];
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
    if (pt.life <= 0) state.particles.splice(i, 1);
  }

  for (let i = state.popups.length - 1; i >= 0; i--) {
    const pop = state.popups[i];
    pop.y -= 24 * dt;
    pop.life -= dt;
    if (pop.life <= 0) state.popups.splice(i, 1);
  }

  // Wave cleared check
  if (state.waveActive && state.spawnQueue.length === 0 && state.demons.length === 0) {
    state.waveActive = false;
    if (state.mode === "test90") {
      const bonus = Math.round(state.waveTimeLeft * 2);
      state.score += bonus;
      spawnPopup(440, 145, `WAVE CLEAR! +${bonus} SPEED PTS`, "#86efac");
    }
    refreshHud();
    completeWaveStep();
  }
}

function completeWaveStep() {
  const finishedWave = state.wave;
  state.waveClearedCount++;

  // Untimed Moral Education bonus event after clearing a wave (prior to Wave 6 victory screen if wave 6 just finished)
  openQuestionPrompt({
    subject: "moral",
    headerText: "⚖️ MORAL EDUCATION • UNTIMED BONUS",
    untimed: true,
    onSuccess: () => {
      const healCastle = state.hp <= 75;
      if (healCastle) {
        state.hp = Math.min(100, state.hp + 18);
        spawnPopup(795, 175, "+18 CASTLE HP!", "#22c55e");
      } else {
        state.gold += 25;
        spawnPopup(795, 175, "+25 BONUS GOLD!", "#fde047");
      }
      refreshHud();
      afterWaveMoralStep(finishedWave);
    },
    onFail: () => {
      afterWaveMoralStep(finishedWave);
    }
  });
}

function afterWaveMoralStep(finishedWave) {
  if (!state.endless && finishedWave === VICTORY_WAVE) {
    concludeMatch(true);
    return;
  }

  state.wave = finishedWave + 1;
  const waveBtn = document.getElementById("startWaveBtn");
  waveBtn.disabled = false;
  waveBtn.textContent = `Start Wave ${state.wave}${state.wave % 3 === 0 ? " (Boss)" : ""}`;
  refreshHud();
}

async function concludeMatch(victory) {
  state.modalOpen = true;
  state.waveActive = false;

  const bonus = victory ? 150 + state.hp : 0;
  const saveResult = await submitMatchScore(bonus);

  document.getElementById("endIcon").textContent = victory ? "👑" : "🛡️";
  const titleEl = document.getElementById("endTitle");
  const summaryEl = document.getElementById("endSummary");
  const saveEl = document.getElementById("endSaveStatus");
  const endlessBtn = document.getElementById("endlessBtn");

  if (victory) {
    titleEl.textContent = "Castle Saved — Wave 6 Victory!";
    titleEl.style.color = "#fde047";
    summaryEl.textContent =
      `Outstanding defense! Castle HP: ${state.hp} • Victory Bonus: +${bonus} pts • Final Score: ${state.score + bonus}.`;
    endlessBtn.style.display = "inline-block";
  } else {
    titleEl.textContent = "Castle Fallen!";
    titleEl.style.color = "#fda4af";
    summaryEl.textContent = `You reached Wave ${state.wave} with ${state.score} points.`;
    endlessBtn.style.display = "none";
  }

  if (state.user.isDemo) {
    saveEl.style.color = "#fda4af";
    saveEl.textContent = "Demo mode: scores are not saved to the leaderboard.";
  } else if (saveResult.saved) {
    saveEl.style.color = "#86efac";
    saveEl.textContent = `Score Saved! Personal Best: ${saveResult.bestScore}`;
  } else {
    saveEl.style.color = "#fde047";
    saveEl.textContent = saveResult.msg || "Match complete.";
  }

  document.getElementById("endModal").classList.add("open");
}

/* ============================================================================
   7. PSEUDO-3D CANVAS RENDERING (DEMONS, TOWERS & CASTLE)
   ============================================================================ */
function renderLoop(now) {
  const dt = Math.min(0.05, (now - prevFrame) / 1000);
  prevFrame = now;

  if (state.user) {
    stepSimulation(dt);
    drawScene();
  }
  requestAnimationFrame(renderLoop);
}

function drawScene() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Night sky stars & subtle depth grid
  for (let i = 0; i < 26; i++) {
    const sx = (i * 179) % canvas.width;
    const sy = (i * 101) % canvas.height;
    const tw = 0.16 + 0.15 * Math.sin(state.worldTime * 2.2 + i);
    ctx.fillStyle = `rgba(186, 230, 253, ${tw.toFixed(2)})`;
    ctx.fillRect(sx, sy, 2, 2);
  }

  ctx.strokeStyle = "rgba(56, 189, 248, 0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += 44) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 45) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }

  // Elevated 3D-styled path
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#0e1730";
  ctx.lineWidth = 46;
  ctx.beginPath();
  CASTLE_PATH.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();

  ctx.strokeStyle = "#223566";
  ctx.lineWidth = 32;
  ctx.stroke();

  ctx.setLineDash([12, 18]);
  ctx.lineDashOffset = -state.worldTime * 34;
  ctx.strokeStyle = "rgba(56, 189, 248, 0.36)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.setLineDash([]);

  drawCastle3D(802, 162, 58, 118);

  // Build pads & hover range ring
  BUILD_PADS.forEach((pad, idx) => {
    const built = state.towers.find(t => t.padIndex === idx);
    const hovered = state.hoveredPad === idx;

    if (hovered) {
      const ref = built || TOWER_CONFIG[state.selectedSubject];
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, ref.range, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(56, 189, 248, 0.08)";
      ctx.fill();
      ctx.strokeStyle = "rgba(125, 211, 252, 0.45)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    if (!built) {
      const pulse = 20 + Math.sin(state.worldTime * 3.8 + idx) * 2;
      ctx.fillStyle = "rgba(2, 6, 16, 0.55)";
      ctx.beginPath();
      ctx.ellipse(pad.x, pad.y + 8, pulse, pulse * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(pad.x, pad.y, pulse, 0, Math.PI * 2);
      ctx.fillStyle = hovered ? "rgba(56, 189, 248, 0.24)" : "rgba(56, 189, 248, 0.1)";
      ctx.fill();
      ctx.strokeStyle = hovered ? "#fde047" : "#38bdf8";
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.fillStyle = "#cbd5e1";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("+", pad.x, pad.y + 5);
    }
  });

  // Pseudo-3D Towers
  state.towers.forEach(t => drawTower3D(t));

  // Pseudo-3D Demons
  state.demons.forEach(d => drawDemon3D(d));

  // Lightning arcs (Science Tesla)
  state.zapArcs.forEach(z => {
    ctx.save();
    ctx.strokeStyle = z.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(z.x1, z.y1);
    const midX = (z.x1 + z.x2) / 2 + (Math.random() - 0.5) * 16;
    const midY = (z.y1 + z.y2) / 2 + (Math.random() - 0.5) * 16;
    ctx.lineTo(midX, midY);
    ctx.lineTo(z.x2, z.y2);
    ctx.stroke();
    ctx.restore();
  });

  // Projectiles
  state.projectiles.forEach(p => {
    ctx.save();
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.restore();
  });

  // Particles
  state.particles.forEach(pt => {
    ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // Floating popups
  state.popups.forEach(pop => {
    ctx.globalAlpha = Math.min(1, pop.life);
    ctx.fillStyle = pop.color;
    ctx.font = "800 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(pop.text, pop.x, pop.y);
  });
  ctx.globalAlpha = 1;
}

function drawCastle3D(x, y, w, h) {
  ctx.save();
  // Ground shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.beginPath();
  ctx.ellipse(x + w * 0.5, y + h + 6, w * 0.75, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Shaded side extrusion
  ctx.fillStyle = "#0b1329";
  ctx.fillRect(x + w - 8, y + 8, 12, h - 8);

  // Main keep body with vertical gradient
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, "#273b70");
  grad.addColorStop(1, "#111c3a");
  ctx.fillStyle = grad;
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();
  ctx.stroke();

  // Battlements
  for (let by = y + 6; by <= y + h - 20; by += 26) {
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(x - 6, by, 8, 13);
  }

  // Glowing castle windows
  const glow = 0.7 + 0.3 * Math.sin(state.worldTime * 3.5);
  ctx.fillStyle = `rgba(253, 224, 71, ${glow.toFixed(2)})`;
  ctx.fillRect(x + 16, y + 22, 10, 14);
  ctx.fillRect(x + 34, y + 22, 10, 14);

  ctx.fillStyle = "#fde047";
  ctx.font = "900 10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("CASTLE", x + w * 0.52, y + h * 0.62);
  ctx.restore();
}

function drawTower3D(t) {
  ctx.save();
  // Ground shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.beginPath();
  ctx.ellipse(t.x + 3, t.y + 16, 20, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  // 3D Stone base cylinder
  const baseGrad = ctx.createLinearGradient(t.x - 18, t.y - 18, t.x + 18, t.y + 18);
  baseGrad.addColorStop(0, "#24355e");
  baseGrad.addColorStop(1, "#090f21");
  ctx.beginPath();
  ctx.arc(t.x, t.y, 20, 0, Math.PI * 2);
  ctx.fillStyle = baseGrad;
  ctx.fill();
  ctx.strokeStyle = t.primary;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Rotating turret barrel / emitter
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(t.angle);
  ctx.fillStyle = t.accent;
  ctx.fillRect(4, -4, 18, 8);
  ctx.restore();

  // Raised 3D cap
  ctx.beginPath();
  ctx.arc(t.x - 1, t.y - 2, 12, 0, Math.PI * 2);
  ctx.fillStyle = t.primary;
  ctx.fill();

  ctx.fillStyle = "#040914";
  ctx.font = "900 10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`L${t.level}`, t.x - 1, t.y + 1.5);
  ctx.restore();
}

function drawDemon3D(d) {
  const bob = Math.sin(state.worldTime * 8 + d.x * 0.04) * 2.5;
  const radius = d.isBoss ? 21 : (d.isScout ? 14 : 13);
  const cy = d.y + bob;

  ctx.save();
  // Ground shadow on path
  ctx.fillStyle = "rgba(0, 0, 0, 0.48)";
  ctx.beginPath();
  ctx.ellipse(d.x, d.y + radius + 3, radius * 0.95, radius * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();

  // Horns
  ctx.fillStyle = "#fca5a5";
  ctx.beginPath();
  ctx.moveTo(d.x - 7, cy - radius + 3);
  ctx.lineTo(d.x - 11, cy - radius - 7);
  ctx.lineTo(d.x - 2, cy - radius + 1);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(d.x + 7, cy - radius + 3);
  ctx.lineTo(d.x + 11, cy - radius - 7);
  ctx.lineTo(d.x + 2, cy - radius + 1);
  ctx.fill();

  // Shaded 3D body
  const bodyGrad = ctx.createRadialGradient(d.x - radius * 0.35, cy - radius * 0.35, 2, d.x, cy, radius);
  if (d.hitFlash > 0) {
    bodyGrad.addColorStop(0, "#ffffff");
    bodyGrad.addColorStop(1, "#fda4af");
  } else if (d.slowTimer > 0) {
    bodyGrad.addColorStop(0, "#86efac");
    bodyGrad.addColorStop(1, "#15803d");
  } else if (d.isBoss) {
    bodyGrad.addColorStop(0, "#fda4af");
    bodyGrad.addColorStop(1, "#9f1239");
  } else if (d.isScout) {
    bodyGrad.addColorStop(0, "#fde047");
    bodyGrad.addColorStop(1, "#b45309");
  } else {
    bodyGrad.addColorStop(0, "#fdba74");
    bodyGrad.addColorStop(1, "#c2410c");
  }

  ctx.beginPath();
  ctx.arc(d.x, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Eyes
  ctx.fillStyle = "#090d16";
  ctx.fillRect(d.x - 5, cy - 3, 3, 3);
  ctx.fillRect(d.x + 2, cy - 3, 3, 3);

  // Health bar above demon
  const barW = d.isBoss ? 42 : 26;
  const barX = d.x - barW / 2;
  const barY = cy - radius - 11;
  ctx.fillStyle = "#050914";
  ctx.fillRect(barX, barY, barW, 5);
  ctx.fillStyle = d.isBoss ? "#fb7185" : "#22c55e";
  ctx.fillRect(barX, barY, barW * Math.max(0, d.hp / d.maxHp), 5);
  ctx.restore();
}

function refreshHud() {
  document.getElementById("hudHp").textContent = state.hp;
  document.getElementById("hudGold").textContent = state.gold;
  document.getElementById("hudMana").textContent = state.mana;
  document.getElementById("hudWave").textContent = state.endless
    ? `${state.wave} (∞)`
    : `${Math.min(state.wave, VICTORY_WAVE)}/${VICTORY_WAVE}`;
  document.getElementById("hudScore").textContent = state.score;
  document.getElementById("hudTimer").textContent = `${state.waveTimeLeft.toFixed(1)}s`;
  document.getElementById("hudTierBadge").textContent = tierLabel(computeTier());
  document.getElementById("stormBtn").disabled = state.mana < STORM_MANA_COST;
}

function refreshMastery() {
  const labels = {
    maths: "Maths",
    science: "Science",
    grammar: "Grammar",
    gk: "General Knowledge",
    moral: "Moral Education"
  };
  document.getElementById("masteryList").innerHTML = Object.entries(state.stats)
    .map(([k, v]) => `<div class="mastery-row"><span>${labels[k]}</span><strong>${v.right} / ${v.asked}</strong></div>`)
    .join("");
}

/* ============================================================================
   8. EVENT WIRING
   ============================================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  await loadQuestionBank();

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
  document.getElementById("demoEnterBtn").addEventListener("click", handleDemoLogin);

  document.getElementById("liveLangSelect").addEventListener("change", e => {
    state.lang = e.target.value;
    if (state.currentChallenge) renderPromptBody();
  });

  document.querySelectorAll("#towerPicker .tower-card").forEach(card => {
    card.addEventListener("click", () => {
      document.querySelectorAll("#towerPicker .tower-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      state.selectedSubject = card.dataset.subject;
    });
  });

  document.addEventListener("keydown", e => {
    if (!state.user || state.modalOpen) return;
    const hotkeys = { "1": "maths", "2": "science", "3": "grammar", "4": "gk" };
    if (hotkeys[e.key]) {
      state.selectedSubject = hotkeys[e.key];
      document.querySelectorAll("#towerPicker .tower-card").forEach(c => {
        c.classList.toggle("selected", c.dataset.subject === hotkeys[e.key]);
      });
    }
  });

  canvas.addEventListener("mousemove", evt => {
    const rect = canvas.getBoundingClientRect();
    const px = (evt.clientX - rect.left) * (canvas.width / rect.width);
    const py = (evt.clientY - rect.top) * (canvas.height / rect.height);
    state.hoveredPad = BUILD_PADS.findIndex(p => Math.hypot(px - p.x, py - p.y) <= 28);
  });

  canvas.addEventListener("click", handleBoardClick);
  document.getElementById("startWaveBtn").addEventListener("click", beginWave);
  document.getElementById("stormBtn").addEventListener("click", triggerUltimateStorm);
  document.getElementById("refreshBoardBtn").addEventListener("click", loadLeaderboard);

  document.getElementById("peekLangBtn").addEventListener("click", () => {
    if (!state.currentChallenge) return;
    state.currentChallenge.q.peekActive = !state.currentChallenge.q.peekActive;
    renderPromptBody();
  });

  document.getElementById("endlessBtn").addEventListener("click", () => {
    document.getElementById("endModal").classList.remove("open");
    resetMatch(true);
  });

  document.getElementById("replayMatchBtn").addEventListener("click", () => {
    document.getElementById("endModal").classList.remove("open");
    resetMatch(false);
  });

  document.getElementById("exitArenaBtn").addEventListener("click", async () => {
    if (state.user && !state.user.isDemo && state.score > 0) {
      await submitMatchScore(0);
    }
    state.user = null;
    document.getElementById("arenaScreen").style.display = "none";
    document.getElementById("entryScreen").style.display = "flex";
  });
});
