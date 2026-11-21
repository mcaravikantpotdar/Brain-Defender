/* ============================================================================
   BRAIN DEFENDER — GAME.JS
   DOS-era / retro-realistic arena simulation, max 3 cannons per subject across
   8 build pads, level-scaled range, full-screen question pause, and flying HUD
   counters for Gold, Mana, and Score.
   ============================================================================ */

import {
  canonicalSubject,
  loadCombinedQuestionBank,
  generateProceduralMath
} from "./question-loader.js";
import {
  verifyStudentIdRemote,
  submitScoreRemote,
  refreshLeaderboardUI
} from "./leaderboard.js";

const VICTORY_WAVE = 6;
const WAVE_CLOCK_SECONDS = 90;
const STORM_MANA_COST = 65;
const MAX_CANNONS_PER_SUBJECT = 3;

// Lower starting ranges at Level 1, expanding clearly on Level 2 and Level 3
const BASE_TOWER_SPECS = {
  maths: {
    key: "maths",
    label: "Maths Cannon",
    roleTag: "High Dmg + Splash",
    shortDesc: "Heavy shell • L2+ splash blast",
    cost: 40,
    range: 104,
    rangeStep: 29,
    fireRate: 1.12,
    damage: 12,
    primary: "#fbbf24",
    accent: "#fef08a",
    isBase: true
  },
  science: {
    key: "science",
    label: "Science Tesla",
    roleTag: "Chain Zap",
    shortDesc: "Arc coil • L2: 1 jump, L3: 2 jumps",
    cost: 45,
    range: 100,
    rangeStep: 28,
    fireRate: 0.78,
    damage: 10,
    primary: "#38bdf8",
    accent: "#bae6fd",
    isBase: true
  },
  grammar: {
    key: "grammar",
    label: "Grammar Gale",
    roleTag: "Slows Enemies",
    shortDesc: "Wind vortex • slows movement speed",
    cost: 35,
    range: 106,
    rangeStep: 29,
    fireRate: 0.96,
    damage: 8,
    slowDuration: 2.6,
    slowFactor: 0.72,
    primary: "#22c55e",
    accent: "#86efac",
    isBase: true
  },
  gk: {
    key: "gk",
    label: "GK Cryo-Prism",
    roleTag: "Brief Freeze",
    shortDesc: "Frost beam • freezes briefly (0.6s–1.4s)",
    cost: 50,
    range: 128,
    rangeStep: 31,
    fireRate: 1.35,
    damage: 13,
    freezeBase: 0.6,
    primary: "#c084fc",
    accent: "#f3e8ff",
    isBase: true
  },
  cs: {
    key: "cs",
    label: "Comp. Sc. Node",
    roleTag: "Multi-Chain Core",
    shortDesc: "Circuit arc • L2+ multi-target chain",
    cost: 42,
    range: 114,
    rangeStep: 29,
    fireRate: 0.74,
    damage: 11,
    primary: "#2dd4bf",
    accent: "#99f6e4",
    isBase: false
  }
};

// 8 build pads positioned safely outside pathway lanes
const BUILD_PADS = [
  { x: 150, y: 125 }, { x: 305, y: 125 }, { x: 460, y: 125 }, { x: 615, y: 125 },
  { x: 225, y: 320 }, { x: 380, y: 320 }, { x: 535, y: 320 }, { x: 685, y: 320 }
];

const PATH_SIEGE = [
  { x: 0, y: 222 },
  { x: 205, y: 222 },
  { x: 205, y: 68 },
  { x: 560, y: 68 },
  { x: 560, y: 382 },
  { x: 315, y: 382 },
  { x: 315, y: 222 },
  { x: 812, y: 222 }
];

const PATH_ASSAULT = [
  { x: 0, y: 222 },
  { x: 185, y: 222 },
  { x: 265, y: 74 },
  { x: 525, y: 74 },
  { x: 460, y: 376 },
  { x: 650, y: 376 },
  { x: 715, y: 222 },
  { x: 812, y: 222 }
];

const state = {
  user: null,
  mode: "siege",
  lang: "dual",
  endless: false,
  waveClearedCount: 0,
  failedAuthCount: 0,
  authCooldownUntil: 0,

  questions: [],
  recentIds: [],
  recentGenKeys: [],
  repoLoadedCount: 0,
  repoSyncLabel: "Bank: Syncing...",

  activeTowers: {},
  hp: 100,
  gold: 105,
  mana: 45,
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
    cs: { right: 0, asked: 0 },
    moral: { right: 0, asked: 0 }
  },

  currentChallenge: null,
  questionTicker: null
};

let lastHudValues = {
  gold: state.gold,
  mana: state.mana,
  score: state.score
};

function getActivePath() {
  if (state.mode === "test90" || state.endless || state.wave >= 5 || state.wave % 3 === 0) {
    return PATH_ASSAULT;
  }
  return PATH_SIEGE;
}

function getDeployedCountForSubject(subjectKey) {
  return state.towers.filter(t => t.subject === subjectKey).length;
}

function getTowerRangeForLevel(spec, level) {
  const lvl = Math.max(1, Math.min(3, Number(level) || 1));
  const step = spec.rangeStep || 28;
  return Math.round(spec.range + (lvl - 1) * step);
}

/* ============================================================================
1. LIGHTWEIGHT RETRO SOUND SYNTHESIS
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
    shoot: () => tone(520, "square", 0.05, 0.02),
    hit: () => tone(235, "sine", 0.05, 0.02),
    build: () => tone(440, "square", 0.09, 0.04),
    strike: () => {
      tone(740, "sawtooth", 0.09, 0.05);
      setTimeout(() => tone(1046.5, "sine", 0.14, 0.06), 60);
    },
    win: () => {
      tone(587.33, "sine", 0.11, 0.075);
      setTimeout(() => tone(880, "sine", 0.17, 0.075), 85);
    },
    lose: () => tone(180, "sawtooth", 0.22, 0.065)
  };
})();

/* ============================================================================
2. DIFFICULTY TIER SCALING
   ============================================================================ */
function computeTier() {
  let base = 1;
  if (state.wave === 2) base = 2;
  else if (state.wave === 3 || state.wave === 4) base = 3;
  else if (state.wave >= 5) base = 4;

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
  if (state.mode === "test90") secs = Math.max(8, secs - 2);
  return Math.min(35, Math.round(secs * 10) / 10);
}

/* ============================================================================
3. QUESTION BANK LOADING & SELECTION
   ============================================================================ */
function updateRepoBadge() {
  const badge = document.getElementById("hudRepoBadge");
  if (!badge) return;
  badge.textContent = state.repoSyncLabel;
  badge.className = state.repoLoadedCount > 0 ? "badge ok" : "badge";
}

async function loadQuestionBank(forceRefresh = false) {
  const isDemo = Boolean(state.user?.isDemo);
  const bank = await loadCombinedQuestionBank(forceRefresh, isDemo);
  state.questions = bank.questions;
  state.repoLoadedCount = bank.repoLoadedCount;
  state.repoSyncLabel = bank.repoSyncLabel;
  updateRepoBadge();
}

function selectQuestion(subject) {
  const normalizedSub = canonicalSubject(subject) || subject;
  const cls = Number(state.user?.classNum || 10);
  const tier = computeTier();

  if (normalizedSub === "maths" && Math.random() < 0.45) {
    return prepareShuffledQuestion(generateProceduralMath(cls, tier, state.recentGenKeys));
  }

  let subPool = state.questions.filter(q => (canonicalSubject(q.subject) || q.subject) === normalizedSub);
  if (subPool.length === 0) {
    subPool = state.questions.filter(q => {
      const s = canonicalSubject(q.subject) || q.subject;
      return s === "cs" || s === "maths";
    });
  }
  if (subPool.length === 0) {
    return prepareShuffledQuestion(generateProceduralMath(cls, tier, state.recentGenKeys));
  }

  const notRecent = subPool.filter(q => !state.recentIds.includes(q.id));
  const working = notRecent.length > 0 ? notRecent : subPool;

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
  if (state.recentIds.length > 40) state.recentIds.shift();

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
4. DYNAMIC CLASS TOWER DECK (MAX 3 PER SUBJECT ACROSS 8 PADS)
   ============================================================================ */
function buildClassTowerDeck(classNum) {
  const cls = Number(classNum) || 10;
  const deck = {};

  const classRepoSubjects = new Set(
    state.questions
      .filter(q => q.sourceType === "repo" && Number(q.class) === cls)
      .map(q => canonicalSubject(q.subject) || q.subject)
  );

  ["maths", "science", "grammar", "gk"].forEach(subj => {
    const base = BASE_TOWER_SPECS[subj];
    const hasRepoBoost = classRepoSubjects.has(subj);
    deck[subj] = {
      ...base,
      hasRepoBoost,
      cost: hasRepoBoost ? Math.max(28, base.cost - 6) : base.cost,
      damage: hasRepoBoost ? base.damage + 2 : base.damage,
      upgradeDmgBonus: hasRepoBoost ? 14 : 9
    };
  });

  classRepoSubjects.forEach(subj => {
    if (deck[subj] || subj === "moral") return;
    const spec = BASE_TOWER_SPECS[subj] || {
      key: subj,
      label: `${subj.toUpperCase()} Node`,
      roleTag: "Chain Pulse",
      shortDesc: "Class subject pulse • L2+ chain",
      cost: 42,
      range: 114,
      rangeStep: 29,
      fireRate: 0.74,
      damage: 11,
      primary: "#2dd4bf",
      accent: "#99f6e4",
      isBase: false
    };
    deck[subj] = {
      ...spec,
      hasRepoBoost: true,
      cost: Math.max(30, spec.cost - 5),
      damage: spec.damage + 2,
      upgradeDmgBonus: 15
    };
  });

  state.activeTowers = deck;
  if (!deck[state.selectedSubject]) {
    state.selectedSubject = Object.keys(deck)[0] || "maths";
  }
  renderTowerPicker();
}

function renderTowerPicker() {
  const container = document.getElementById("towerPicker");
  const entries = Object.values(state.activeTowers);
  const openPads = Math.max(0, BUILD_PADS.length - state.towers.length);

  container.innerHTML = entries.map((t, idx) => {
    const deployed = getDeployedCountForSubject(t.key);
    const isMaxed = deployed >= MAX_CANNONS_PER_SUBJECT;
    const sel = t.key === state.selectedSubject ? "selected" : "";
    const boostCls = t.hasRepoBoost ? "boosted" : "";
    const capCls = isMaxed ? "capped" : "";
    const tag = t.hasRepoBoost
      ? `<span class="tower-card-tag">Class Boost</span>`
      : `<span class="tower-card-tag" style="background:rgba(148,163,184,0.14); color:#cbd5e1;">${t.roleTag}</span>`;

    return `
      <button type="button" class="tower-card ${sel} ${boostCls} ${capCls}" data-subject="${t.key}">
        <div class="tower-card-top">
          <span class="tower-card-name">${idx + 1}. ${t.label}</span>
          <span class="tower-card-cost">${t.cost}g</span>
        </div>
        <span class="tower-card-desc"><strong>${t.roleTag}:</strong> ${t.shortDesc}</span>
        <div class="tower-card-meta">
          <span class="tower-card-count ${isMaxed ? "maxed" : ""}">${deployed}/${MAX_CANNONS_PER_SUBJECT} deployed • ${openPads} pads free</span>
          ${tag}
        </div>
      </button>
    `;
  }).join("");

  container.querySelectorAll(".tower-card").forEach(card => {
    card.addEventListener("click", () => {
      container.querySelectorAll(".tower-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      state.selectedSubject = card.dataset.subject;
    });
  });
}

/* ============================================================================
5. AUTHENTICATION & MATCH FLOW
   ============================================================================ */
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
    const data = await verifyStudentIdRemote(digits);
    if (data.ok && data.student) {
      state.failedAuthCount = 0;
      const cls = Number(document.getElementById("classSelect").value) || 10;
      state.user = {
        pen: String(data.student.pen),
        name: String(data.student.name || "Defender"),
        school: String(data.student.school || ""),
        classNum: cls,
        isDemo: false
      };
      await loadQuestionBank(false);
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

async function handleDemoLogin() {
  const cls = Number(document.getElementById("classSelect").value) || 10;
  state.user = {
    pen: "DEMO",
    name: "Demo Explorer",
    school: "",
    classNum: cls,
    isDemo: true
  };
  await loadQuestionBank(false);
  enterArena();
}

function enterArena() {
  document.getElementById("entryScreen").style.display = "none";
  document.getElementById("arenaScreen").style.display = "flex";
  document.getElementById("liveLangSelect").value = state.lang;
  updateRepoBadge();

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

  const isTest90 = state.mode === "test90";
  document.getElementById("hudTimerChip").style.display = isTest90 ? "flex" : "none";
  document.getElementById("arenaHintText").innerHTML = isTest90
    ? `<strong>90s Test Mode:</strong> Max <strong>3/subject</strong> across <strong>8 pads</strong> • Lower L1 range grows on upgrade • Right answers fire a <strong>Quiz Strike</strong>!`
    : `Max <strong>3 cannons/subject</strong> across <strong>8 pads</strong> • Lower starting range grows with upgrades • Clear <strong>Wave 6</strong> for Victory!`;

  buildClassTowerDeck(state.user.classNum);
  resetMatch(false);
  refreshLeaderboardUI(state.user);
  requestAnimationFrame(renderLoop);
}

function resetMatch(startEndless) {
  state.hp = 100;
  state.gold = 105;
  state.mana = 45;
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
    cs: { right: 0, asked: 0 },
    moral: { right: 0, asked: 0 }
  };

  lastHudValues = {
    gold: state.gold,
    mana: state.mana,
    score: state.score
  };

  const waveBtn = document.getElementById("startWaveBtn");
  waveBtn.disabled = false;
  waveBtn.textContent = `Start Wave ${state.wave}${state.wave % 3 === 0 ? " (Boss)" : ""}`;

  renderTowerPicker();
  refreshHud(false);
  refreshMastery();

  if (state.mode === "test90") {
    beginWave();
  }
}

/* ============================================================================
6. FULL-SCREEN QUESTION MODAL & PAUSE ENFORCEMENT
   ============================================================================ */
function openQuestionPrompt({ subject, headerText, untimed = false, onSuccess, onFail }) {
  const q = selectQuestion(subject);
  const seconds = questionDuration(q, untimed);

  // Pause all background simulation & timers immediately when question opens
  state.modalOpen = true;
  clearInterval(state.questionTicker);

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
  const enText = String(q.prompt?.en || "").trim();
  const hiText = String(q.prompt?.hi || "").trim();
  const hasDistinctHi = hiText && hiText !== enText;

  const isDual = state.lang === "dual";
  const showSecondary = isDual || q.peekActive;
  const primaryIsHi = state.lang === "hi";

  const promptBox = document.getElementById("qPromptArea");
  if (primaryIsHi) {
    const mainHi = hiText || enText;
    promptBox.innerHTML = `<div class="q-stem-main">${mainHi}</div>` +
      (showSecondary && enText !== mainHi ? `<div class="q-stem-sub">EN: ${enText}</div>` : "");
  } else {
    const mainEn = enText || hiText;
    promptBox.innerHTML = `<div class="q-stem-main">${mainEn}</div>` +
      (showSecondary && hasDistinctHi ? `<div class="q-stem-sub">हिन्दी: ${hiText}</div>` : "");
  }

  const choicesBox = document.getElementById("qChoicesArea");
  choicesBox.innerHTML = "";

  q.shuffledEn.forEach((enOpt, idx) => {
    const hiOpt = String(q.shuffledHi[idx] || enOpt).trim();
    const optHasDistinctHi = hiOpt && hiOpt !== enOpt;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice-opt";

    if (primaryIsHi) {
      const mainChoice = hiOpt || enOpt;
      btn.innerHTML = (showSecondary && optHasDistinctHi)
        ? `<strong>${String.fromCharCode(65 + idx)}.</strong> ${mainChoice} <span style="color:var(--muted);">(${enOpt})</span>`
        : `<strong>${String.fromCharCode(65 + idx)}.</strong> ${mainChoice}`;
    } else {
      const mainChoice = enOpt || hiOpt;
      btn.innerHTML = (showSecondary && optHasDistinctHi)
        ? `<strong>${String.fromCharCode(65 + idx)}.</strong> ${mainChoice} <span style="color:var(--muted);">/ ${hiOpt}</span>`
        : `<strong>${String.fromCharCode(65 + idx)}.</strong> ${mainChoice}`;
    }
    btn.onclick = () => resolveQuestion(idx);
    choicesBox.appendChild(btn);
  });
}

function triggerTest90QuizStrike(swift) {
  if (state.mode !== "test90" || state.demons.length === 0) return;

  const target = state.demons.reduce((best, cur) =>
    (cur.wpIndex > best.wpIndex || (cur.wpIndex === best.wpIndex && cur.hp > best.hp)) ? cur : best
  , state.demons[0]);

  const strikeDmg = swift ? 38 : 24;
  target.hp -= strikeDmg;
  target.hitFlash = 0.22;

  AudioCue.strike();
  state.zapArcs.push({
    x1: 802,
    y1: 222,
    x2: target.x,
    y2: target.y,
    color: swift ? "#fde047" : "#38bdf8",
    life: 0.35
  });
  spawnBurst(target.x, target.y, swift ? "#fde047" : "#38bdf8", 16);
  spawnPopup(target.x, target.y - 20, `⚡ QUIZ STRIKE -${strikeDmg}!`, swift ? "#fde047" : "#38bdf8");

  state.demons.forEach(other => {
    if (other !== target && Math.hypot(other.x - target.x, other.y - target.y) <= 65) {
      other.hp -= Math.round(strikeDmg * 0.45);
      other.hitFlash = 0.14;
    }
  });
}

function resolveQuestion(choiceIdx) {
  const ch = state.currentChallenge;
  if (!ch || ch.done) return;
  ch.done = true;
  clearInterval(state.questionTicker);

  const q = ch.q;
  const subKey = canonicalSubject(q.subject) || q.subject;
  const isRight = choiceIdx === q.shuffledAnswer;
  const fastAnswer = isRight && !ch.untimed && (ch.leftSec / ch.totalSec) >= 0.5;

  if (state.stats[subKey]) {
    state.stats[subKey].asked++;
    if (isRight) state.stats[subKey].right++;
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
    state.mana = Math.min(100, state.mana + (fastAnswer ? 16 : 10));

    const strikeNote = (state.mode === "test90" && state.demons.length > 0)
      ? ` • Quiz Strike fired!`
      : "";

    fb.innerHTML = `<strong style="color:#86efac;">${fastAnswer ? "Swift & Right! +" + pts + " pts" : "Correct! +" + pts + " pts"}${strikeNote}</strong> ${expText}`;
  } else {
    AudioCue.lose();
    state.wrongStreak++;
    if (state.wrongStreak >= 2) {
      state.tierOffset = Math.max(-1, state.tierOffset - 1);
      state.wrongStreak = 0;
    }
    fb.innerHTML = `<strong style="color:#fda4af;">${choiceIdx === -1 ? "Time's Up!" : "Not Quite!"}</strong> ${expText}`;
  }

  refreshHud(true);

  setTimeout(() => {
    document.getElementById("questionModal").classList.remove("open");
    state.modalOpen = false;
    state.currentChallenge = null;
    if (isRight) {
      triggerTest90QuizStrike(fastAnswer);
      if (ch.onSuccess) ch.onSuccess(fastAnswer);
    } else if (ch.onFail) {
      ch.onFail();
    }
  }, 1250);
}

/* ============================================================================
7. WAVE SPAWNING, TOWER BUILD/UPGRADE & SIMULATION LOOP
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
  const waveBtn = document.getElementById("startWaveBtn");
  waveBtn.disabled = true;
  waveBtn.textContent = state.mode === "test90" ? `Wave ${state.wave} Running (90s)...` : `Wave ${state.wave} In Progress...`;
  state.spawnQueue = [];
  const activePath = getActivePath();

  if (state.mode === "siege" && state.wave === 1 && !state.endless) {
    state.spawnQueue.push({
      hp: 24,
      maxHp: 24,
      speed: 9.05,
      goldReward: 22,
      scoreReward: 30,
      castleDamage: 12,
      isBoss: false,
      isScout: true,
      path: activePath
    });
    state.spawnDelay = 0.25;
  } else {
    const isBossWave = state.wave % 3 === 0;
    const isTest90 = state.mode === "test90";
    const powerScale = Math.max(1, state.wave - (isTest90 ? 0 : 1));
    const count = isTest90
      ? (isBossWave ? 5 + state.wave : 5 + Math.round(state.wave * 1.5))
      : (isBossWave ? 6 + state.wave : 6 + state.wave * 2);

    for (let i = 0; i < count; i++) {
      const boss = isBossWave && i === count - 1;
      const miniGuard = isBossWave && i === count - 2 && state.wave >= 6;
      const baseHp = boss
        ? 220 + powerScale * 95
        : (miniGuard ? 115 + powerScale * 35 : 36 + powerScale * 22 + Math.pow(powerScale, 2) * 5);
      const hp = isTest90 ? Math.round(baseHp * 0.88) : Math.round(baseHp);

      const speed = boss
        ? (isTest90 ? 36 + powerScale * 3.5 : 30 + powerScale * 3.5)
        : Math.min(122, (isTest90 ? 48 : 42) + powerScale * 6.5);

      state.spawnQueue.push({
        hp,
        maxHp: hp,
        speed,
        goldReward: boss ? 32 : (miniGuard ? 16 : 8 + Math.min(8, powerScale)),
        scoreReward: boss ? 150 : 25 + powerScale * 6,
        castleDamage: boss ? 32 : 12 + Math.min(18, powerScale * 2),
        isBoss: boss || miniGuard,
        isScout: false,
        path: activePath
      });
    }
    state.spawnDelay = 0.25;
  }

  refreshHud(false);
}

function triggerUltimateStorm() {
  if (state.mana < STORM_MANA_COST || state.modalOpen) return;
  const subjects = Object.keys(state.activeTowers);
  const pickedSub = subjects[Math.floor(Math.random() * subjects.length)] || "maths";

  openQuestionPrompt({
    subject: pickedSub,
    headerText: "⚡ ULTIMATE STORM • ANSWER TO UNLEASH",
    onSuccess: () => {
      if (state.mana < STORM_MANA_COST) return;
      state.mana -= STORM_MANA_COST;
      state.demons.forEach(d => {
        const dmg = d.isBoss ? 40 : 48;
        d.hp -= dmg;
        d.hitFlash = 0.16;
        spawnBurst(d.x, d.y, "#e879f9", 14);
      });
      state.score += 50;
      spawnPopup(440, 195, "ARCANE STORM!", "#e879f9");
      refreshHud(true);
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

      if (existing) {
        if (existing.level >= 3) {
          spawnPopup(existing.x, existing.y - 22, "MAX LEVEL", existing.primary);
          return;
        }
        const cfg = state.activeTowers[existing.subject] || BASE_TOWER_SPECS[existing.subject];
        openQuestionPrompt({
          subject: existing.subject,
          headerText: `UPGRADE ${cfg.label.toUpperCase()} → LV.${existing.level + 1}`,
          onSuccess: (swift) => {
            existing.level++;
            existing.range = getTowerRangeForLevel(cfg, existing.level);
            existing.damage += (cfg.upgradeDmgBonus || 9) + (swift ? 4 : 0);
            existing.fireRate = Math.max(0.34, existing.fireRate * (cfg.hasRepoBoost ? 0.82 : 0.86));
            AudioCue.build();
            spawnBurst(existing.x, existing.y, existing.primary, 18);
            spawnPopup(existing.x, existing.y - 24, `LV.${existing.level} • RANGE ${existing.range}`, existing.primary);
          }
        });
        return;
      }

      const cfg = state.activeTowers[state.selectedSubject] || BASE_TOWER_SPECS.maths;
      const deployedOfSubject = getDeployedCountForSubject(cfg.key);

      if (deployedOfSubject >= MAX_CANNONS_PER_SUBJECT) {
        spawnPopup(pad.x, pad.y - 20, `MAX ${MAX_CANNONS_PER_SUBJECT} ${cfg.label.split(" ")[0].toUpperCase()}!`, "#fb7185");
        return;
      }

      if (state.gold < cfg.cost) {
        spawnPopup(pad.x, pad.y - 20, `Need ${cfg.cost}g!`, "#fb7185");
        return;
      }

      openQuestionPrompt({
        subject: cfg.key,
        headerText: `BUILD ${cfg.label.toUpperCase()} (${cfg.cost}g • ${deployedOfSubject + 1}/${MAX_CANNONS_PER_SUBJECT})`,
        onSuccess: (swift) => {
          if (state.gold < cfg.cost || getDeployedCountForSubject(cfg.key) >= MAX_CANNONS_PER_SUBJECT) return;
          state.gold -= cfg.cost;
          const startRange = getTowerRangeForLevel(cfg, 1);
          state.towers.push({
            padIndex: idx,
            x: pad.x,
            y: pad.y,
            subject: cfg.key,
            level: 1,
            cooldown: 0,
            angle: 0,
            recoil: 0,
            damage: cfg.damage + (swift ? 4 : 0),
            range: startRange,
            fireRate: cfg.fireRate,
            primary: cfg.primary,
            accent: cfg.accent
          });
          AudioCue.build();
          spawnBurst(pad.x, pad.y, cfg.primary, 15);
          spawnPopup(pad.x, pad.y - 22, `-${cfg.cost}g BUILT!`, "#fde047");
          renderTowerPicker();
          refreshHud(true);
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
  if (state.modalOpen) return;
  state.worldTime += dt;

  if (state.mode === "test90" && state.waveActive) {
    state.waveTimeLeft = Math.max(0, state.waveTimeLeft - dt);
    refreshHud(false);
    if (state.waveTimeLeft <= 0) {
      const breachLoss = Math.min(state.hp, 15 + state.demons.length * 8);
      state.hp = Math.max(0, state.hp - breachLoss);
      state.demons = [];
      state.spawnQueue = [];
      state.waveActive = false;
      spawnPopup(795, 190, `90S TIME UP! -${breachLoss} HP`, "#fb7185");
      refreshHud(false);
      if (state.hp <= 0) {
        concludeMatch(false);
        return;
      }
      completeWaveStep();
      return;
    }
  }

  if (state.waveActive && state.spawnQueue.length > 0) {
    state.spawnDelay -= dt;
    if (state.spawnDelay <= 0) {
      const next = state.spawnQueue.shift();
      const route = next.path || getActivePath();
      state.demons.push({
        ...next,
        path: route,
        x: route[0].x,
        y: route[0].y,
        wpIndex: 1,
        slowTimer: 0,
        slowStrength: BASE_TOWER_SPECS.grammar.slowFactor,
        freezeTimer: 0,
        hitFlash: 0
      });
      state.spawnDelay = state.mode === "test90"
        ? Math.max(0.32, 0.85 - state.wave * 0.06)
        : (state.wave === 1 ? 1.35 : Math.max(0.38, 1.05 - state.wave * 0.08));
    }
  }

  for (let i = state.demons.length - 1; i >= 0; i--) {
    const d = state.demons[i];
    const route = d.path || getActivePath();
    if (d.hitFlash > 0) d.hitFlash -= dt;
    if (d.freezeTimer > 0) d.freezeTimer = Math.max(0, d.freezeTimer - dt);

    if (d.hp <= 0) {
      state.gold += d.goldReward;
      state.score += d.scoreReward;
      spawnBurst(d.x, d.y, d.isBoss ? "#fb7185" : "#fb923c", d.isBoss ? 22 : 12);
      spawnPopup(d.x, d.y - 16, `+${d.goldReward}g`, "#fde047");
      state.demons.splice(i, 1);
      refreshHud(true);
      continue;
    }

    if (d.slowTimer > 0) d.slowTimer -= dt;
    const isFrozen = d.freezeTimer > 0;
    const speedNow = isFrozen
      ? 0
      : (d.slowTimer > 0 ? d.speed * (d.slowStrength || 0.65) : d.speed);

    const targetPt = route[d.wpIndex] || route[route.length - 1];
    const dx = targetPt.x - d.x;
    const dy = targetPt.y - d.y;
    const dist = Math.hypot(dx, dy);

    if (!isFrozen && dist < 3.5) {
      d.wpIndex++;
      if (d.wpIndex >= route.length) {
        state.hp = Math.max(0, state.hp - d.castleDamage);
        AudioCue.lose();
        spawnBurst(805, 222, "#fb7185", 18);
        spawnPopup(785, 185, `-${d.castleDamage} CASTLE HP!`, "#fb7185");
        state.demons.splice(i, 1);
        refreshHud(false);
        if (state.hp <= 0) {
          concludeMatch(false);
          return;
        }
      }
    } else if (!isFrozen && dist > 0) {
      d.x += (dx / dist) * speedNow * dt;
      d.y += (dy / dist) * speedNow * dt;
    }
  }

  state.towers.forEach(t => {
    t.cooldown -= dt;
    if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - dt * 5);

    const foe = state.demons.find(d => Math.hypot(d.x - t.x, d.y - t.y) <= t.range);
    if (foe) {
      t.angle = Math.atan2(foe.y - t.y, foe.x - t.x);
      if (t.cooldown <= 0) {
        t.cooldown = t.fireRate;
        t.recoil = 1;
        AudioCue.shoot();

        if (t.subject === "science" || t.subject === "cs") {
          foe.hp -= t.damage;
          foe.hitFlash = 0.12;
          spawnBurst(foe.x, foe.y, t.primary, 6);
          state.zapArcs.push({ x1: t.x, y1: t.y, x2: foe.x, y2: foe.y, color: t.primary, life: 0.14 });

          const maxChains = t.level >= 3 ? 2 : (t.level === 2 ? 1 : 0);
          if (maxChains > 0) {
            const chainTargets = state.demons
              .filter(other => other !== foe && Math.hypot(other.x - foe.x, other.y - foe.y) <= 95)
              .slice(0, maxChains);

            let prevPt = foe;
            chainTargets.forEach(neighbor => {
              const chainDmg = Math.round(t.damage * (t.level >= 3 ? 0.72 : 0.55));
              neighbor.hp -= chainDmg;
              neighbor.hitFlash = 0.12;
              state.zapArcs.push({
                x1: prevPt.x, y1: prevPt.y, x2: neighbor.x, y2: neighbor.y, color: t.accent, life: 0.14
              });
              prevPt = neighbor;
            });
          }
        } else {
          state.projectiles.push({
            x: t.x,
            y: t.y,
            target: foe,
            speed: t.subject === "gk" ? 540 : 385,
            damage: t.damage,
            level: t.level,
            subject: t.subject,
            color: t.primary
          });
        }
      }
    }
  });

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

      if (p.subject === "maths" && p.level >= 2) {
        const splashRad = p.level >= 3 ? 76 : 56;
        const splashDmg = Math.round(p.damage * (p.level >= 3 ? 0.62 : 0.45));
        state.demons.forEach(other => {
          if (other !== p.target && Math.hypot(other.x - p.target.x, other.y - p.target.y) <= splashRad) {
            other.hp -= splashDmg;
            other.hitFlash = 0.1;
          }
        });
      } else if (p.subject === "grammar") {
        p.target.slowTimer = BASE_TOWER_SPECS.grammar.slowDuration + (p.level - 1) * 0.45;
        p.target.slowStrength = p.level >= 3 ? 0.40 : (p.level === 2 ? 0.56 : 0.72);
        spawnPopup(p.target.x, p.target.y - 24, "SLOWED", "#86efac");
      } else if (p.subject === "gk") {
        const freezeDur = p.level >= 3 ? 1.4 : (p.level === 2 ? 0.95 : 0.6);
        p.target.freezeTimer = Math.max(p.target.freezeTimer || 0, freezeDur);
        spawnPopup(p.target.x, p.target.y - 24, `FROZEN ${freezeDur.toFixed(1)}s`, "#e9d5ff");
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

  if (state.waveActive && state.spawnQueue.length === 0 && state.demons.length === 0) {
    state.waveActive = false;
    if (state.mode === "test90") {
      const bonus = Math.round(state.waveTimeLeft * 3);
      state.score += bonus;
      spawnPopup(440, 145, `90S CLEAR! +${bonus} SPEED PTS`, "#86efac");
    }
    refreshHud(true);
    completeWaveStep();
  }
}

function completeWaveStep() {
  const finishedWave = state.wave;
  state.waveClearedCount++;

  openQuestionPrompt({
    subject: "moral",
    headerText: "⚖️ MORAL EDUCATION • UNTIMED BONUS",
    untimed: true,
    onSuccess: () => {
      if (state.hp <= 75) {
        state.hp = Math.min(100, state.hp + 18);
        spawnPopup(795, 175, "+18 CASTLE HP!", "#22c55e");
      } else {
        state.gold += 22;
        spawnPopup(795, 175, "+22 BONUS GOLD!", "#fde047");
      }
      refreshHud(true);
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
  refreshHud(false);

  if (state.mode === "test90") {
    beginWave();
  }
}

async function concludeMatch(victory) {
  state.modalOpen = true;
  state.waveActive = false;
  clearInterval(state.questionTicker);

  const bonus = victory ? 150 + state.hp : 0;
  if (bonus > 0) {
    state.score += bonus;
    refreshHud(true);
  }

  const saveResult = await submitScoreRemote({
    user: state.user,
    mode: state.mode,
    score: state.score,
    wave: state.wave,
    stats: state.stats
  });

  if (saveResult.saved) {
    await refreshLeaderboardUI(state.user);
  }

  document.getElementById("endIcon").textContent = victory ? "👑" : "🛡️";
  const titleEl = document.getElementById("endTitle");
  const summaryEl = document.getElementById("endSummary");
  const saveEl = document.getElementById("endSaveStatus");
  const endlessBtn = document.getElementById("endlessBtn");

  if (victory) {
    titleEl.textContent = "Castle Saved — Wave 6 Victory!";
    titleEl.style.color = "#fde047";
    summaryEl.textContent =
      `Outstanding defense! Castle HP: ${state.hp} • Victory Bonus: +${bonus} pts • Final Score: ${state.score}.`;
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
8. DOS-ERA / RETRO-REALISTIC CANVAS RENDERING
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

  const assaultActive = getActivePath() === PATH_ASSAULT;
  const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  if (assaultActive) {
    skyGrad.addColorStop(0, "#140722");
    skyGrad.addColorStop(0.55, "#1f0e38");
    skyGrad.addColorStop(1, "#090617");
  } else {
    skyGrad.addColorStop(0, "#050c1f");
    skyGrad.addColorStop(0.55, "#0b1838");
    skyGrad.addColorStop(1, "#060e22");
  }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Retro starfield & subtle DOS scan/grid lines
  for (let i = 0; i < 32; i++) {
    const sx = (i * 179) % canvas.width;
    const sy = (i * 101) % canvas.height;
    const tw = 0.2 + 0.22 * Math.sin(state.worldTime * 2.4 + i);
    ctx.fillStyle = `rgba(224, 242, 254, ${tw.toFixed(2)})`;
    ctx.fillRect(sx, sy, 2, 2);
  }

  ctx.strokeStyle = "rgba(56, 189, 248, 0.06)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += 44) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 45) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }

  // Shaded stone/arcane path with DOS-style border & animated lane chevrons
  const activePath = getActivePath();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#060a14";
  ctx.lineWidth = 50;
  ctx.beginPath();
  activePath.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();

  ctx.strokeStyle = assaultActive ? "#4c287a" : "#283f78";
  ctx.lineWidth = 36;
  ctx.stroke();

  ctx.setLineDash([12, 18]);
  ctx.lineDashOffset = -state.worldTime * (assaultActive ? 48 : 34);
  ctx.strokeStyle = assaultActive ? "rgba(232, 121, 249, 0.55)" : "rgba(56, 189, 248, 0.45)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.setLineDash([]);

  drawCastleRetro3D(802, 162, 58, 118);

  BUILD_PADS.forEach((pad, idx) => {
    const built = state.towers.find(t => t.padIndex === idx);
    const hovered = state.hoveredPad === idx;

    if (hovered) {
      const ref = built || state.activeTowers[state.selectedSubject] || BASE_TOWER_SPECS.maths;
      const previewRange = built ? built.range : getTowerRangeForLevel(ref, 1);
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, previewRange, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(56, 189, 248, 0.09)";
      ctx.fill();
      ctx.strokeStyle = "rgba(125, 211, 252, 0.55)";
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (!built) {
      const pulse = 20 + Math.sin(state.worldTime * 3.8 + idx) * 2;
      ctx.fillStyle = "rgba(2, 6, 16, 0.65)";
      ctx.beginPath();
      ctx.ellipse(pad.x, pad.y + 8, pulse, pulse * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(pad.x, pad.y, pulse, 0, Math.PI * 2);
      ctx.fillStyle = hovered ? "rgba(56, 189, 248, 0.24)" : "rgba(56, 189, 248, 0.1)";
      ctx.fill();
      ctx.strokeStyle = hovered ? "#fde047" : "#38bdf8";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#e2e8f0";
      ctx.font = "900 14px monospace";
      ctx.textAlign = "center";
      ctx.fillText("+", pad.x, pad.y + 5);
    }
  });

  state.towers.forEach(t => drawTowerRetro3D(t));
  state.demons.forEach(d => drawDemonRetro3D(d));

  state.zapArcs.forEach(z => {
    ctx.save();
    ctx.strokeStyle = z.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(z.x1, z.y1);
    const midX = (z.x1 + z.x2) / 2 + (Math.random() - 0.5) * 16;
    const midY = (z.y1 + z.y2) / 2 + (Math.random() - 0.5) * 16;
    ctx.lineTo(midX, midY);
    ctx.lineTo(z.x2, z.y2);
    ctx.stroke();
    ctx.restore();
  });

  state.projectiles.forEach(p => {
    ctx.save();
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.strokeStyle = "#040914";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  });

  state.particles.forEach(pt => {
    ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - pt.size * 0.7, pt.y - pt.size * 0.7, pt.size * 1.4, pt.size * 1.4);
  });
  ctx.globalAlpha = 1;

  state.popups.forEach(pop => {
    ctx.globalAlpha = Math.min(1, pop.life);
    ctx.fillStyle = "#040914";
    ctx.font = "900 13px monospace";
    ctx.textAlign = "center";
    ctx.fillText(pop.text, pop.x + 1, pop.y + 1);
    ctx.fillStyle = pop.color;
    ctx.fillText(pop.text, pop.x, pop.y);
  });
  ctx.globalAlpha = 1;
}

function drawCastleRetro3D(x, y, w, h) {
  ctx.save();
  // Ground shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.56)";
  ctx.beginPath();
  ctx.ellipse(x + w * 0.5, y + h + 7, w * 0.8, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  // Side depth wall
  ctx.fillStyle = "#091022";
  ctx.fillRect(x + w - 9, y + 6, 14, h - 6);

  // Main stone keep with shaded bevel
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, "#375296");
  grad.addColorStop(0.6, "#1d2f5e");
  grad.addColorStop(1, "#0d1630");
  ctx.fillStyle = grad;
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();

  // Stone masonry courses
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  for (let rowY = y + 18; rowY < y + h - 8; rowY += 18) {
    ctx.beginPath();
    ctx.moveTo(x + 2, rowY);
    ctx.lineTo(x + w - 2, rowY);
    ctx.stroke();
  }

  // Battlement merlons
  for (let by = y + 6; by <= y + h - 20; by += 26) {
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(x - 6, by, 8, 13);
    ctx.strokeStyle = "#060b18";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x - 6, by, 8, 13);
  }

  // Animated pennant flag
  const waveOffset = Math.sin(state.worldTime * 6.5) * 3.5;
  ctx.strokeStyle = "#f1f5f9";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.5, y);
  ctx.lineTo(x + w * 0.5, y - 17);
  ctx.stroke();

  ctx.fillStyle = "#38bdf8";
  ctx.beginPath();
  ctx.moveTo(x + w * 0.5, y - 17);
  ctx.lineTo(x + w * 0.5 + 17, y - 11.5 + waveOffset);
  ctx.lineTo(x + w * 0.5, y - 6);
  ctx.closePath();
  ctx.fill();

  const glow = 0.65 + 0.35 * Math.sin(state.worldTime * 3.8);
  ctx.fillStyle = `rgba(253, 224, 71, ${glow.toFixed(2)})`;
  ctx.fillRect(x + 15, y + 22, 10, 14);
  ctx.fillRect(x + 34, y + 22, 10, 14);

  ctx.fillStyle = "#fde047";
  ctx.font = "900 10px monospace";
  ctx.textAlign = "center";
  ctx.fillText("CASTLE", x + w * 0.52, y + h * 0.65);
  ctx.restore();
}

function drawTowerRetro3D(t) {
  ctx.save();
  const recoilOffset = (t.recoil || 0) * 4.5;

  // Pedestal shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.beginPath();
  ctx.ellipse(t.x + 3, t.y + 16, 21, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  // Octagonal/circular shaded gun carriage
  const baseGrad = ctx.createLinearGradient(t.x - 19, t.y - 19, t.x + 19, t.y + 19);
  baseGrad.addColorStop(0, "#2d437a");
  baseGrad.addColorStop(1, "#090f21");
  ctx.beginPath();
  ctx.arc(t.x, t.y, 20, 0, Math.PI * 2);
  ctx.fillStyle = baseGrad;
  ctx.fill();
  ctx.strokeStyle = t.primary;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Rotating barrel / emitter with recoil kickback
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(t.angle);
  ctx.translate(-recoilOffset, 0);

  if (t.subject === "maths") {
    ctx.fillStyle = t.accent;
    ctx.fillRect(4, -5.5, 17, 11);
    ctx.strokeStyle = "#060b18";
    ctx.lineWidth = 1.4;
    ctx.strokeRect(4, -5.5, 17, 11);
    ctx.fillStyle = t.primary;
    ctx.fillRect(17, -6.8, 5, 13.6);
  } else if (t.subject === "science" || t.subject === "cs") {
    ctx.fillStyle = t.accent;
    ctx.fillRect(4, -3.5, 16, 7);
    ctx.beginPath();
    ctx.arc(14, 0, 4.8, 0, Math.PI * 2);
    ctx.fillStyle = t.primary;
    ctx.fill();
  } else if (t.subject === "grammar") {
    ctx.strokeStyle = t.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(4, -5.5);
    ctx.lineTo(21, -2);
    ctx.moveTo(4, 5.5);
    ctx.lineTo(21, 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = t.accent;
    ctx.beginPath();
    ctx.moveTo(4, -5.5);
    ctx.lineTo(23, 0);
    ctx.lineTo(4, 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#060b18";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();

  // Turret core dome + level badge
  ctx.beginPath();
  ctx.arc(t.x - 1, t.y - 1, 11.5, 0, Math.PI * 2);
  ctx.fillStyle = t.primary;
  ctx.fill();
  ctx.strokeStyle = "#060b18";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "#040914";
  ctx.font = "900 10px monospace";
  ctx.textAlign = "center";
  ctx.fillText(`L${t.level}`, t.x - 1, t.y + 2.5);
  ctx.restore();
}

function drawDemonRetro3D(d) {
  const isFrozen = (d.freezeTimer || 0) > 0;
  const bob = isFrozen ? 0 : Math.sin(state.worldTime * 8.5 + d.x * 0.04) * 2.5;
  const radius = d.isBoss ? 21 : (d.isScout ? 14 : 13);
  const cy = d.y + bob;

  ctx.save();
  // Ground shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.beginPath();
  ctx.ellipse(d.x, d.y + radius + 3, radius * 0.95, radius * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();

  // Horns
  ctx.fillStyle = isFrozen ? "#bae6fd" : "#fca5a5";
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

  // Shaded body with status tint (hit flash / frozen / slowed / boss / scout / standard)
  const bodyGrad = ctx.createRadialGradient(d.x - radius * 0.35, cy - radius * 0.35, 2, d.x, cy, radius);
  if (d.hitFlash > 0) {
    bodyGrad.addColorStop(0, "#ffffff");
    bodyGrad.addColorStop(1, "#fda4af");
  } else if (isFrozen) {
    bodyGrad.addColorStop(0, "#e0f2fe");
    bodyGrad.addColorStop(1, "#0284c7");
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
  ctx.strokeStyle = isFrozen ? "#7dd3fc" : "#ffffff";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Eyes
  ctx.fillStyle = "#090d16";
  ctx.fillRect(d.x - 5, cy - 3, 3, 3);
  ctx.fillRect(d.x + 2, cy - 3, 3, 3);

  // Health bar
  const barW = d.isBoss ? 42 : 26;
  const barX = d.x - barW / 2;
  const barY = cy - radius - 11;
  ctx.fillStyle = "#050914";
  ctx.fillRect(barX, barY, barW, 5);
  ctx.fillStyle = isFrozen ? "#38bdf8" : (d.isBoss ? "#fb7185" : "#22c55e");
  ctx.fillRect(barX, barY, barW * Math.max(0, d.hp / d.maxHp), 5);
  ctx.restore();
}

/* ============================================================================
9. FLYING HUD COUNTERS & MASTER TRACKER
   ============================================================================ */
function triggerFlyBadge(chipId, delta, suffix = "") {
  const chip = document.getElementById(chipId);
  if (!chip || !delta) return;

  const isPos = delta > 0;
  const el = document.createElement("span");
  el.className = `fly-delta ${isPos ? "pos" : "neg"}`;
  el.textContent = `${isPos ? "+" : ""}${delta}${suffix}`;
  chip.appendChild(el);

  chip.classList.remove("pulse-up", "pulse-down");
  void chip.offsetWidth;
  chip.classList.add(isPos ? "pulse-up" : "pulse-down");

  setTimeout(() => {
    el.remove();
    chip.classList.remove("pulse-up", "pulse-down");
  }, 1050);
}

function refreshHud(animateDeltas = true) {
  const dGold = state.gold - lastHudValues.gold;
  const dMana = state.mana - lastHudValues.mana;
  const dScore = state.score - lastHudValues.score;

  document.getElementById("hudHp").textContent = state.hp;
  document.getElementById("hudGold").textContent = state.gold;
  document.getElementById("hudMana").textContent = state.mana;
  document.getElementById("hudWave").textContent = state.endless
    ? `${state.wave} (∞)`
    : `${Math.min(state.wave, VICTORY_WAVE)}/${VICTORY_WAVE}`;
  document.getElementById("hudScore").textContent = state.score;

  const timerEl = document.getElementById("hudTimer");
  timerEl.textContent = `${state.waveTimeLeft.toFixed(1)}s`;
  timerEl.style.color = state.waveTimeLeft <= 20 ? "#fb7185" : "#86efac";

  document.getElementById("hudTierBadge").textContent = tierLabel(computeTier());
  document.getElementById("stormBtn").disabled = state.mana < STORM_MANA_COST;

  if (animateDeltas) {
    if (dGold !== 0) triggerFlyBadge("goldChip", dGold, "g");
    if (dMana !== 0) triggerFlyBadge("manaChip", dMana, "m");
    if (dScore !== 0) triggerFlyBadge("scoreChip", dScore, " pts");
  }

  lastHudValues = {
    gold: state.gold,
    mana: state.mana,
    score: state.score
  };
}

function refreshMastery() {
  const labels = {
    maths: "Maths",
    science: "Science",
    grammar: "Grammar",
    gk: "General Knowledge",
    cs: "Comp. Sc.",
    moral: "Moral Education"
  };
  const uniqueKeys = Array.from(new Set(Object.keys(state.activeTowers).concat("moral")));
  document.getElementById("masteryList").innerHTML = uniqueKeys
    .filter(k => state.stats[k])
    .map(k => `<div class="mastery-row"><span>${labels[k] || k.toUpperCase()}</span><strong>${state.stats[k].right} / ${state.stats[k].asked}</strong></div>`)
    .join("");
}

/* ============================================================================
10. EVENT WIRING
   ============================================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  await loadQuestionBank(false);

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

  document.addEventListener("keydown", e => {
    if (!state.user || state.modalOpen) return;
    const keys = Object.values(state.activeTowers);
    const idx = Number(e.key) - 1;
    if (idx >= 0 && idx < keys.length) {
      state.selectedSubject = keys[idx].key;
      renderTowerPicker();
    }
  });

  canvas.addEventListener("mousemove", evt => {
    if (state.modalOpen) return;
    const rect = canvas.getBoundingClientRect();
    const px = (evt.clientX - rect.left) * (canvas.width / rect.width);
    const py = (evt.clientY - rect.top) * (canvas.height / rect.height);
    state.hoveredPad = BUILD_PADS.findIndex(p => Math.hypot(px - p.x, py - p.y) <= 28);
  });

  canvas.addEventListener("click", handleBoardClick);
  document.getElementById("startWaveBtn").addEventListener("click", beginWave);
  document.getElementById("stormBtn").addEventListener("click", triggerUltimateStorm);
  document.getElementById("refreshBoardBtn").addEventListener("click", async () => {
    await loadQuestionBank(true);
    if (state.user) buildClassTowerDeck(state.user.classNum);
    refreshLeaderboardUI(state.user);
  });

  document.getElementById("openLatest50Btn").addEventListener("click", () => {
    document.getElementById("latest50Modal").classList.add("open");
    refreshLeaderboardUI(state.user);
  });
  document.getElementById("refreshLatest50Btn").addEventListener("click", () => refreshLeaderboardUI(state.user));
  document.getElementById("closeLatest50Btn").addEventListener("click", () => {
    document.getElementById("latest50Modal").classList.remove("open");
  });

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
    clearInterval(state.questionTicker);
    state.modalOpen = false;
    document.getElementById("questionModal").classList.remove("open");
    if (state.user && !state.user.isDemo && state.score > 0) {
      await submitScoreRemote({
        user: state.user,
        mode: state.mode,
        score: state.score,
        wave: state.wave,
        stats: state.stats
      });
    }
    state.user = null;
    document.getElementById("arenaScreen").style.display = "none";
    document.getElementById("entryScreen").style.display = "flex";
  });
});
