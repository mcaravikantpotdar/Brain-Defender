/* ============================================================================
   BRAIN DEFENDER: CASTLE OF CURIOSITY — STAGE 2 COMPLETE ENGINE
   ============================================================================ */

const BACKEND_CONFIG = {
  enabled: true,
  url: "https://script.google.com/macros/s/AKfycbxJ3rbuFzYgVzMjSanjrIJY2Vh8Vw2uVQUIu1tKvMz0mE_W3KoBi_6QwEcWWE2C89OwhA/exec"
};

const TARGET_VICTORY_WAVE = 6;
const BLITZ_WAVE_SECONDS = 90;

const TOWER_SPECS = {
  maths:   { label: "Maths Cannon",   cost: 40, range: 148, rate: 1.05, dmg: 12, color: "#fbbf24" },
  science: { label: "Science Tesla",  cost: 45, range: 138, rate: 0.85, dmg: 11, color: "#38bdf8" },
  grammar: { label: "Grammar Gale",   cost: 35, range: 142, rate: 0.95, dmg: 10, color: "#22c55e" },
  gk:      { label: "GK Prism Laser", cost: 50, range: 205, rate: 1.40, dmg: 16, color: "#e879f9" }
};

const BUILD_SPOTS = [
  { x: 155, y: 125 }, { x: 310, y: 125 }, { x: 465, y: 125 }, { x: 620, y: 125 },
  { x: 225, y: 315 }, { x: 380, y: 315 }, { x: 535, y: 315 }, { x: 690, y: 315 }
];

const ROUTE = [
  { x: 0, y: 220 },
  { x: 205, y: 220 },
  { x: 205, y: 68 },
  { x: 560, y: 68 },
  { x: 560, y: 382 },
  { x: 315, y: 382 },
  { x: 315, y: 220 },
  { x: 815, y: 220 }
];

const game = {
  user: null,
  mode: "siege", // "siege" | "test90"
  lang: "dual", // "dual" | "en" | "hi"
  endless: false,
  badAttempts: 0,
  lockUntil: 0,
  bank: [],
  hp: 100,
  gold: 120,
  mana: 50,
  wave: 1,
  score: 0,
  clockLeft: BLITZ_WAVE_SECONDS,
  inWave: false,
  locked: false,
  chosenTower: "maths",
  hoverSpot: -1,
  towers: [],
  foes: [],
  bolts: [],
  bursts: [],
  floaters: [],
  queue: [],
  nextSpawn: 0,
  elapsed: 0,
  streakWrong: 0,
  tierShift: 0,
  accuracy: {
    maths: { ok: 0, n: 0 },
    science: { ok: 0, n: 0 },
    grammar: { ok: 0, n: 0 },
    gk: { ok: 0, n: 0 },
    moral: { ok: 0, n: 0 }
  },
  activeQ: null,
  tickHandle: null
};

/* ============================================================================
   1. AUDIO CUES
   ============================================================================ */
const SoundBoard = (() => {
  let ctx = null;
  function pulse(freq, kind = "sine", len = 0.12, amp = 0.07) {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(amp, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + len);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + len);
    } catch (_) {}
  }
  return {
    fire: () => pulse(560, "triangle", 0.06, 0.03),
    impact: () => pulse(245, "sine", 0.05, 0.025),
    chimeGood: () => { pulse(587.33, "sine", 0.11, 0.08); setTimeout(() => pulse(880, "sine", 0.17, 0.08), 85); },
    chimeBad: () => pulse(185, "sawtooth", 0.24, 0.07),
    buildOk: () => pulse(440, "square", 0.09, 0.045)
  };
})();

/* ============================================================================
   2. DIFFICULTY & PROGRESSIVE TIMERS (SUPER EASY -> UPWARDS)
   ============================================================================ */
function currentTier() {
  let tier = 1;
  if (game.wave === 2) tier = 2;
  else if (game.wave === 3 || game.wave === 4) tier = 3;
  else if (game.wave >= 5) tier = 4;

  return Math.max(1, Math.min(4, tier + game.tierShift));
}

function tierName(t) {
  const labels = {
    1: "Tier 1: Super Easy",
    2: "Tier 2: Foundation",
    3: "Tier 3: Challenge",
    4: "Tier 4: Master / Boss"
  };
  return labels[t] || "Tier 1: Super Easy";
}

function questionSeconds(q) {
  const tier = q.difficulty || currentTier();
  let sec = 10 + (tier - 1) * 4 + (game.wave - 1) * 1.5;
  if (game.wave % 3 === 0) sec += 5;
  if (game.lang === "dual" && !q.isLanguageSpecific) sec += 3;
  return Math.min(34, Math.round(sec * 10) / 10);
}

/* ============================================================================
   3. QUESTION BANK, COOLDOWN & SYNCHRONIZED OPTION SHUFFLER
   ============================================================================ */
async function fetchBank() {
  try {
    const r = await fetch("questions.json", { cache: "no-store" });
    if (!r.ok) throw new Error("Could not load questions.json");
    const payload = await r.json();
    game.bank = Array.isArray(payload.questions) ? payload.questions : [];
  } catch (e) {
    console.warn("Question bank warning:", e);
    game.bank = [];
  }
}

function historyKey() {
  const tag = game.user?.isDemo ? "demo" : (game.user?.pen || "guest");
  return `bd_q_hist_${tag}`;
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(historyKey()) || "[]");
  } catch (_) {
    return [];
  }
}

function saveHistory(id) {
  if (!id || String(id).startsWith("GEN-")) return;
  const next = getHistory().filter(x => x !== id);
  next.push(id);
  localStorage.setItem(historyKey(), JSON.stringify(next.slice(-40)));
}

function makeFallbackMath(cls, tier) {
  const a = Math.floor(Math.random() * 5) + 2;
  const x = Math.floor(Math.random() * 7) + 2;
  const b = Math.floor(Math.random() * 8) + 1;

  if (tier === 1) {
    const sum = a + x;
    const choices = [String(sum), String(sum + 1), String(Math.max(1, sum - 1)), String(sum + 2)];
    return {
      id: `GEN-M1-${Date.now()}`,
      class: cls,
      subject: "maths",
      difficulty: 1,
      isLanguageSpecific: false,
      prompt: {
        en: `Super Easy Warm-Up: What is ${a} + ${x}?`,
        hi: `आसान अभ्यास: ${a} + ${x} कितना होता है?`
      },
      options: { en: choices, hi: [...choices] },
      answerIndex: 0,
      explanation: {
        en: `${a} + ${x} = ${sum}.`,
        hi: `${a} + ${x} = ${sum} होता है।`
      }
    };
  }

  const rhs = a * x + b;
  const choices = [String(x), String(x + 1), String(Math.max(1, x - 1)), String(x + 3)];
  return {
    id: `GEN-M-${Date.now()}`,
    class: cls,
    subject: "maths",
    difficulty: tier,
    isLanguageSpecific: false,
    prompt: {
      en: `Class ${cls}: Solve for x if ${a}x + ${b} = ${rhs}.`,
      hi: `कक्षा ${cls}: यदि ${a}x + ${b} = ${rhs}, तो x का मान क्या है?`
    },
    options: { en: choices, hi: [...choices] },
    answerIndex: 0,
    explanation: {
      en: `${a}x = ${rhs - b}, so x = ${x}.`,
      hi: `${a}x = ${rhs - b}, इसलिए x = ${x}।`
    }
  };
}

function pickQuestion(subject) {
  const cls = Number(game.user?.classNum || 8);
  const wantTier = currentTier();
  const seen = new Set(getHistory());

  let pool = game.bank.filter(q => q.subject === subject);
  const sameCls = pool.filter(q => Number(q.class) === cls);
  const adjCls = pool.filter(q => Math.abs(Number(q.class) - cls) === 1);

  if (sameCls.length > 0) {
    pool = adjCls.length > 0 && game.wave >= 3 ? [...sameCls, ...adjCls] : sameCls;
  }

  let unseen = pool.filter(q => !seen.has(q.id));
  if (unseen.length === 0) unseen = pool;

  let matched = unseen.filter(q => Number(q.difficulty || 1) === wantTier);
  if (matched.length === 0) matched = unseen.filter(q => Number(q.difficulty || 1) <= wantTier);
  if (matched.length === 0) matched = unseen;

  const chosen = matched[Math.floor(Math.random() * matched.length)] || makeFallbackMath(cls, wantTier);
  saveHistory(chosen.id);
  return shuffleSynced(chosen);
}

function shuffleSynced(raw) {
  const count = raw.options.en.length;
  const perm = Array.from({ length: count }, (_, i) => i);

  if (!raw.lockOrder) {
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
  }

  return {
    ...raw,
    optEn: perm.map(i => raw.options.en[i]),
    optHi: perm.map(i => (raw.options.hi ? raw.options.hi[i] : raw.options.en[i])),
    ansIdx: perm.indexOf(raw.answerIndex),
    peeking: false
  };
}

/* ============================================================================
   4. AUTHENTICATION & DEMO MODE (DEMO NEVER SAVES TO LEADERBOARD)
   ============================================================================ */
function maskNumber(raw) {
  const s = String(raw || "");
  if (s.length <= 4) return "****";
  return `${"*".repeat(s.length - 4)}${s.slice(-4)}`;
}

function setAuthNotice(msg, isFail) {
  const el = document.getElementById("authMsg");
  el.textContent = msg;
  el.className = isFail ? "auth-feedback fail" : "auth-feedback";
}

async function verifyAndEnter() {
  const now = Date.now();
  if (now < game.lockUntil) {
    const left = Math.ceil((game.lockUntil - now) / 1000);
    setAuthNotice(`Too many attempts. Please wait ${left}s.`, true);
    return;
  }

  const field = document.getElementById("idField");
  const digits = field.value.replace(/\D/g, "");
  field.value = digits;

  if (digits.length < 10 || digits.length > 12) {
    game.badAttempts++;
    if (game.badAttempts >= 3) { game.lockUntil = Date.now() + 30000; game.badAttempts = 0; }
    setAuthNotice("Please enter a valid Student ID.", true);
    return;
  }

  const btn = document.getElementById("enterBtn");
  btn.disabled = true;
  setAuthNotice("Verifying Student ID...", false);

  try {
    const endpoint = `${BACKEND_CONFIG.url}?action=verifyPen&pen=${encodeURIComponent(digits)}`;
    const res = await fetch(endpoint, { method: "GET", redirect: "follow" });
    const data = await res.json();

    if (data.ok && data.student) {
      game.badAttempts = 0;
      const cls = Number(document.getElementById("classField").value) || 8;
      game.user = {
        pen: data.student.pen,
        name: data.student.name,
        school: data.student.school || "",
        classNum: cls,
        isDemo: false
      };
      openArena();
    } else {
      game.badAttempts++;
      if (game.badAttempts >= 3) { game.lockUntil = Date.now() + 30000; game.badAttempts = 0; }
      setAuthNotice(data.message || "Student ID not found.", true);
    }
  } catch (_) {
    setAuthNotice("Unable to connect right now. Please try again.", true);
  } finally {
    btn.disabled = false;
  }
}

function enterAsDemo() {
  const cls = Number(document.getElementById("classField").value) || 8;
  game.user = {
    pen: "DEMO",
    name: "Demo Player",
    school: "",
    classNum: cls,
    isDemo: true
  };
  openArena();
}

function openArena() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("gameScreen").style.display = "flex";
  document.getElementById("arenaLangSelect").value = game.lang;

  const demo = Boolean(game.user.isDemo);
  document.getElementById("playerNameLabel").textContent = game.user.name;
  document.getElementById("classModeLabel").textContent =
    `CLASS ${game.user.classNum} • ${game.mode === "test90" ? "90S TEST MODE" : "SIEGE MODE"}`;

  const badge = document.getElementById("statusBadge");
  if (demo) {
    badge.textContent = "Demo • Not Saved";
    badge.className = "tag demo";
  } else {
    badge.textContent = game.user.school ? `Verified • ${game.user.school}` : "Verified";
    badge.className = "tag verified";
  }

  document.getElementById("waveClockPill").style.display = game.mode === "test90" ? "flex" : "none";

  resetArena(false);
  refreshLeaderboard();
  requestAnimationFrame(frameLoop);
}

function resetArena(toEndless) {
  game.hp = 100;
  game.gold = 120;
  game.mana = 50;
  game.wave = toEndless ? (TARGET_VICTORY_WAVE + 1) : 1;
  game.endless = Boolean(toEndless);
  game.score = 0;
  game.clockLeft = BLITZ_WAVE_SECONDS;
  game.inWave = false;
  game.locked = false;
  game.streakWrong = 0;
  game.tierShift = 0;
  game.towers = [];
  game.foes = [];
  game.bolts = [];
  game.bursts = [];
  game.floaters = [];
  game.queue = [];
  game.accuracy = {
    maths: { ok: 0, n: 0 },
    science: { ok: 0, n: 0 },
    grammar: { ok: 0, n: 0 },
    gk: { ok: 0, n: 0 },
    moral: { ok: 0, n: 0 }
  };

  const wBtn = document.getElementById("waveTriggerBtn");
  wBtn.disabled = false;
  wBtn.textContent = `Start Wave ${game.wave}`;
  syncHud();
  syncMastery();
}

async function persistScore(bonus = 0) {
  if (!game.user || game.user.isDemo) {
    return { saved: false, text: "Demo mode: scores are not saved to the leaderboard." };
  }

  const totalScore = Math.max(0, game.score + bonus);
  if (totalScore <= 0) {
    return { saved: false, text: "No points earned yet to record." };
  }

  const okSum = Object.values(game.accuracy).reduce((a, b) => a + b.ok, 0);
  const nSum = Object.values(game.accuracy).reduce((a, b) => a + b.n, 0);

  const payload = {
    pen: game.user.pen,
    maskedPen: maskNumber(game.user.pen),
    name: game.user.name,
    school: game.user.school || "",
    classNum: game.user.classNum,
    mode: game.mode,
    score: totalScore,
    wave: game.wave,
    correct: okSum,
    total: nSum,
    isDemo: false
  };

  try {
    const res = await fetch(BACKEND_CONFIG.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "submitScore", payload })
    });
    const out = await res.json();
    await refreshLeaderboard();
    return { saved: Boolean(out.ok), best: out.bestScore || totalScore };
  } catch (_) {
    return { saved: false, text: "Could not update leaderboard right now." };
  }
}

async function refreshLeaderboard() {
  const listEl = document.getElementById("boardList");
  try {
    const res = await fetch(`${BACKEND_CONFIG.url}?action=getLeaderboard`, { redirect: "follow" });
    const out = await res.json();
    const rows = (out.ok && Array.isArray(out.leaderboard)) ? out.leaderboard : [];

    listEl.innerHTML = "";
    if (rows.length === 0) {
      listEl.innerHTML = `<li class="rank-item"><span>No scores yet. Play a match to claim #1!</span></li>`;
      return;
    }

    rows.slice(0, 10).forEach((row, i) => {
      const isSelf = game.user && !game.user.isDemo && String(row.pen) === String(game.user.pen);
      const li = document.createElement("li");
      li.className = `rank-item${isSelf ? " self" : ""}`;
      li.innerHTML = `
        <div>
          <strong>#${i + 1} ${row.name}</strong>
          <div style="font-size:0.72rem; color:var(--ink-dim);">
            Class ${row.classNum || "-"} • ${row.school || "Defender"} • Wave ${row.wave}
          </div>
        </div>
        <strong style="color:var(--amber); font-size:0.94rem;">${row.score}</strong>
      `;
      listEl.appendChild(li);
    });
  } catch (_) {
    listEl.innerHTML = `<li class="rank-item"><span>Leaderboard temporarily unavailable.</span></li>`;
  }
}

/* ============================================================================
   5. QUESTION CHALLENGE MODAL
   ============================================================================ */
function askChallenge({ subject, title, onWin, onLoss }) {
  const q = pickQuestion(subject);
  const limit = questionSeconds(q);

  game.locked = true;
  game.activeQ = { q, limit, left: limit, resolved: false, onWin, onLoss };

  document.getElementById("qCategoryTag").textContent = title || `${subject.toUpperCase()} • WAVE ${game.wave}`;
  document.getElementById("qLevelTag").textContent = tierName(q.difficulty || currentTier());
  document.getElementById("qExplainBox").style.display = "none";

  const peek = document.getElementById("translatePeekBtn");
  peek.style.display = (game.lang === "dual" || q.isLanguageSpecific) ? "none" : "inline-block";

  renderQuestionCard();
  document.getElementById("questionModal").classList.add("open");

  clearInterval(game.tickHandle);
  updateQuestionClock();

  game.tickHandle = setInterval(() => {
    const ch = game.activeQ;
    if (!ch || ch.resolved) return;
    ch.left -= 0.1;
    if (ch.left <= 0) {
      ch.left = 0;
      updateQuestionClock();
      answerChallenge(-1);
    } else {
      updateQuestionClock();
    }
  }, 100);
}

function updateQuestionClock() {
  const ch = game.activeQ;
  if (!ch) return;
  const ratio = Math.max(0, (ch.left / ch.limit) * 100);
  const bar = document.getElementById("qClockBar");
  bar.style.width = `${ratio}%`;
  bar.style.background = ratio > 45 ? "#22c55e" : (ratio > 20 ? "#fbbf24" : "#fb7185");
  document.getElementById("qClockTag").textContent = `${ch.left.toFixed(1)}s`;
}

function renderQuestionCard() {
  const ch = game.activeQ;
  const q = ch.q;
  const dualView = (game.lang === "dual" || q.peeking) && !q.isLanguageSpecific;
  const mainLang = q.isLanguageSpecific ? (q.nativeLang || "en") : (game.lang === "hi" ? "hi" : "en");

  const textBox = document.getElementById("qTextBox");
  if (dualView) {
    textBox.innerHTML = `
      <div class="q-main">${q.prompt.en}</div>
      <div class="q-alt">${q.prompt.hi || ""}</div>
    `;
  } else {
    textBox.innerHTML = `<div class="q-main">${q.prompt[mainLang] || q.prompt.en}</div>`;
  }

  const choicesBox = document.getElementById("qChoicesBox");
  choicesBox.innerHTML = "";

  q.optEn.forEach((enTxt, idx) => {
    const hiTxt = q.optHi[idx] || enTxt;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "answer-btn";
    if (dualView && hiTxt !== enTxt) {
      btn.innerHTML = `<strong>${String.fromCharCode(65 + idx)}.</strong> ${enTxt} <span style="color:var(--ink-dim);">/ ${hiTxt}</span>`;
    } else {
      btn.innerHTML = `<strong>${String.fromCharCode(65 + idx)}.</strong> ${mainLang === "hi" ? hiTxt : enTxt}`;
    }
    btn.onclick = () => answerChallenge(idx);
    choicesBox.appendChild(btn);
  });
}

function answerChallenge(pickedIdx) {
  const ch = game.activeQ;
  if (!ch || ch.resolved) return;
  ch.resolved = true;
  clearInterval(game.tickHandle);

  const q = ch.q;
  const correct = pickedIdx === q.ansIdx;
  const swift = correct && (ch.left / ch.limit) >= 0.5;

  if (game.accuracy[q.subject]) {
    game.accuracy[q.subject].n++;
    if (correct) game.accuracy[q.subject].ok++;
    syncMastery();
  }

  const btns = document.querySelectorAll("#qChoicesBox .answer-btn");
  btns.forEach((b, i) => {
    b.disabled = true;
    if (i === q.ansIdx) b.classList.add("right");
    else if (i === pickedIdx) b.classList.add("wrong");
  });

  const expBox = document.getElementById("qExplainBox");
  expBox.style.display = "block";
  const note = game.lang === "hi" && q.explanation?.hi ? q.explanation.hi : (q.explanation?.en || "");

  if (correct) {
    SoundBoard.chimeGood();
    game.streakWrong = 0;
    if (game.tierShift > 0 && Math.random() < 0.4) game.tierShift--;
    const pts = swift ? 40 : 25;
    game.score += pts;
    game.gold += swift ? 15 : 10;
    game.mana = Math.min(100, game.mana + (swift ? 18 : 12));
    expBox.innerHTML = `<strong style="color:#86efac;">${swift ? "Quick Genius! +" + pts + " pts" : "Correct! +" + pts + " pts"}</strong> ${note}`;
  } else {
    SoundBoard.chimeBad();
    game.streakWrong++;
    if (game.streakWrong >= 2) {
      game.tierShift = Math.max(-1, game.tierShift - 1);
      game.streakWrong = 0;
    }
    expBox.innerHTML = `<strong style="color:#fda4af;">${pickedIdx === -1 ? "Time's Up!" : "Not Quite!"}</strong> ${note}`;
  }

  syncHud();

  setTimeout(() => {
    document.getElementById("questionModal").classList.remove("open");
    game.locked = false;
    game.activeQ = null;
    if (correct && ch.onWin) ch.onWin(swift);
    if (!correct && ch.onLoss) ch.onLoss();
  }, 1400);
}

/* ============================================================================
   6. BATTLE SIMULATION (SIEGE MODE, 90S TEST MODE & WAVE 6 VICTORY)
   ============================================================================ */
const canvas = document.getElementById("battleCanvas");
const ctx = canvas.getContext("2d");
let lastStamp = performance.now();

function addBurst(x, y, color, count = 10) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 35 + Math.random() * 110;
    game.bursts.push({
      x, y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      life: 0.35 + Math.random() * 0.2,
      maxLife: 0.55,
      color,
      r: 2 + Math.random() * 2.5
    });
  }
}

function addFloater(x, y, text, color = "#fde047") {
  game.floaters.push({ x, y, text, color, life: 0.9 });
}

function startWaveRun() {
  if (game.inWave || game.locked) return;
  game.inWave = true;
  game.clockLeft = BLITZ_WAVE_SECONDS;
  document.getElementById("waveTriggerBtn").disabled = true;
  game.queue = [];

  if (game.mode === "siege" && game.wave === 1 && !game.endless) {
    // Slow ~90s scout along ~815px route (~9.05 px/s), 20 HP -> defeated in 2 basic 12-dmg shots
    game.queue.push({
      hp: 20,
      maxHp: 20,
      speed: 9.05,
      gold: 25,
      pts: 30,
      breachDmg: 12,
      boss: false,
      scout: true
    });
    game.nextSpawn = 0.2;
  } else {
    const isBoss = game.wave % 3 === 0;
    const totalFoes = isBoss ? (4 + game.wave) : (5 + game.wave * 2);
    const scale = Math.max(1, game.wave - (game.mode === "siege" ? 1 : 0));

    for (let i = 0; i < totalFoes; i++) {
      const boss = isBoss && i === totalFoes - 1;
      const hp = boss ? (85 + scale * 34) : (24 + scale * 14);
      const speed = boss ? (24 + scale * 2.5) : (32 + scale * 5.5);

      game.queue.push({
        hp,
        maxHp: hp,
        speed: Math.min(95, speed),
        gold: boss ? 35 : (10 + scale * 2),
        pts: boss ? 120 : (20 + scale * 5),
        breachDmg: boss ? 25 : (10 + Math.min(15, scale * 2)),
        boss,
        scout: false
      });
    }
    game.nextSpawn = 0.25;
  }

  syncHud();
}

function runBoostQuiz() {
  if (game.locked) return;
  const pool = ["maths", "science", "grammar", "gk"];
  const sub = pool[Math.floor(Math.random() * pool.length)];
  askChallenge({
    subject: sub,
    title: `KNOWLEDGE BOOST • ${sub.toUpperCase()}`,
    onWin: (swift) => {
      if (game.foes.length > 0) {
        const lead = game.foes[0];
        const hit = swift ? 24 : 15;
        lead.hp -= hit;
        addBurst(lead.x, lead.y, "#38bdf8", 12);
        addFloater(lead.x, lead.y - 18, `-${hit} ARCANE!`, "#38bdf8");
      }
    }
  });
}

function castStorm() {
  if (game.mana < 60 || game.locked) return;
  game.mana -= 60;
  syncHud();

  const pool = ["maths", "science", "gk", "grammar"];
  const sub = pool[Math.floor(Math.random() * pool.length)];
  askChallenge({
    subject: sub,
    title: "⚡ ULTIMATE KNOWLEDGE STORM ⚡",
    onWin: () => {
      game.foes.forEach(f => {
        f.hp -= 65;
        addBurst(f.x, f.y, "#e879f9", 14);
      });
      game.score += 50;
      addFloater(440, 200, "STORM STRIKE!", "#e879f9");
      syncHud();
    }
  });
}

function onCanvasClick(evt) {
  if (game.locked) return;
  const rect = canvas.getBoundingClientRect();
  const cx = (evt.clientX - rect.left) * (canvas.width / rect.width);
  const cy = (evt.clientY - rect.top) * (canvas.height / rect.height);

  for (let i = 0; i < BUILD_SPOTS.length; i++) {
    const spot = BUILD_SPOTS[i];
    if (Math.hypot(cx - spot.x, cy - spot.y) <= 28) {
      const built = game.towers.find(t => t.spotIdx === i);
      if (built) {
        if (built.level >= 3) {
          addFloater(built.x, built.y - 20, "MAX LEVEL", built.color);
          return;
        }
        askChallenge({
          subject: built.kind,
          title: `SUPERCHARGE ${TOWER_SPECS[built.kind].label.toUpperCase()} → LV.${built.level + 1}`,
          onWin: (swift) => {
            built.level++;
            built.dmg += swift ? 12 : 8;
            built.range += 16;
            built.rate = Math.max(0.38, built.rate * 0.88);
            addBurst(built.x, built.y, built.color, 18);
            addFloater(built.x, built.y - 24, `SUPERCHARGED LV.${built.level}!`, built.color);
          }
        });
      } else {
        const spec = TOWER_SPECS[game.chosenTower];
        if (game.gold >= spec.cost) {
          game.gold -= spec.cost;
          game.towers.push({
            spotIdx: i,
            x: spot.x,
            y: spot.y,
            kind: game.chosenTower,
            level: 1,
            cd: 0,
            aim: 0,
            ...spec
          });
          SoundBoard.buildOk();
          addBurst(spot.x, spot.y, spec.color, 14);
          addFloater(spot.x, spot.y - 20, `-${spec.cost}g`, "#fde047");
          syncHud();
        } else {
          addFloater(spot.x, spot.y - 18, "Need Gold!", "#fb7185");
        }
      }
      return;
    }
  }
}

function advanceSimulation(dt) {
  game.elapsed += dt;
  if (game.locked) return;

  if (game.mode === "test90" && game.inWave) {
    game.clockLeft = Math.max(0, game.clockLeft - dt);
    syncHud();
    if (game.clockLeft <= 0) {
      const loss = Math.min(game.hp, 15 + game.foes.length * 8);
      game.hp = Math.max(0, game.hp - loss);
      game.foes = [];
      game.queue = [];
      game.inWave = false;
      addFloater(790, 185, `TIME UP! -${loss} HP`, "#fb7185");
      syncHud();
      if (game.hp <= 0) {
        finishMatch(false);
        return;
      }
      progressWave();
      return;
    }
  }

  if (game.inWave && game.queue.length > 0) {
    game.nextSpawn -= dt;
    if (game.nextSpawn <= 0) {
      const nextFoe = game.queue.shift();
      game.foes.push({
        ...nextFoe,
        x: ROUTE[0].x,
        y: ROUTE[0].y,
        pt: 1,
        slowed: 0
      });
      game.nextSpawn = game.wave === 1 ? 1.5 : Math.max(0.45, 1.15 - game.wave * 0.08);
    }
  }

  for (let i = game.foes.length - 1; i >= 0; i--) {
    const f = game.foes[i];
    if (f.hp <= 0) {
      game.gold += f.gold;
      game.score += f.pts;
      addBurst(f.x, f.y, f.boss ? "#fb7185" : "#fb923c", f.boss ? 24 : 12);
      addFloater(f.x, f.y - 14, `+${f.gold}g`, "#fde047");
      game.foes.splice(i, 1);
      syncHud();
      continue;
    }

    if (f.slowed > 0) f.slowed -= dt;
    const spd = f.slowed > 0 ? f.speed * 0.55 : f.speed;
    const dest = ROUTE[f.pt];
    const dx = dest.x - f.x;
    const dy = dest.y - f.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 3.5) {
      f.pt++;
      if (f.pt >= ROUTE.length) {
        game.hp = Math.max(0, game.hp - f.breachDmg);
        addBurst(805, 220, "#fb7185", 18);
        addFloater(785, 185, `-${f.breachDmg} HP!`, "#fb7185");
        game.foes.splice(i, 1);
        syncHud();
        if (game.hp <= 0) {
          finishMatch(false);
          return;
        }
      }
    } else {
      f.x += (dx / dist) * spd * dt;
      f.y += (dy / dist) * spd * dt;
    }
  }

  game.towers.forEach(t => {
    t.cd -= dt;
    const target = game.foes.find(f => Math.hypot(f.x - t.x, f.y - t.y) <= t.range);
    if (target) {
      t.aim = Math.atan2(target.y - t.y, target.x - t.x);
      if (t.cd <= 0) {
        t.cd = t.rate;
        SoundBoard.fire();
        game.bolts.push({
          x: t.x, y: t.y, target,
          speed: 370, dmg: t.dmg, color: t.color, kind: t.kind
        });
      }
    }
  });

  for (let i = game.bolts.length - 1; i >= 0; i--) {
    const b = game.bolts[i];
    if (!game.foes.includes(b.target)) {
      game.bolts.splice(i, 1);
      continue;
    }
    const dx = b.target.x - b.x;
    const dy = b.target.y - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 10) {
      SoundBoard.impact();
      b.target.hp -= b.dmg;
      addBurst(b.target.x, b.target.y, b.color, 6);
      if (b.kind === "grammar") b.target.slowed = 2.8;
      if (b.kind === "maths") {
        game.foes.forEach(other => {
          if (other !== b.target && Math.hypot(other.x - b.target.x, other.y - b.target.y) < 58) {
            other.hp -= Math.round(b.dmg * 0.5);
          }
        });
      }
      game.bolts.splice(i, 1);
    } else {
      b.x += (dx / dist) * b.speed * dt;
      b.y += (dy / dist) * b.speed * dt;
    }
  }

  for (let i = game.bursts.length - 1; i >= 0; i--) {
    const p = game.bursts[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) game.bursts.splice(i, 1);
  }

  for (let i = game.floaters.length - 1; i >= 0; i--) {
    const fl = game.floaters[i];
    fl.y -= 25 * dt;
    fl.life -= dt;
    if (fl.life <= 0) game.floaters.splice(i, 1);
  }

  if (game.inWave && game.queue.length === 0 && game.foes.length === 0) {
    game.inWave = false;
    if (game.mode === "test90") {
      const timePts = Math.round(game.clockLeft * 2);
      game.score += timePts;
      addFloater(440, 140, `WAVE CLEAR! +${timePts} SPEED PTS`, "#86efac");
    }
    syncHud();
    progressWave();
  }
}

function progressWave() {
  if (!game.endless && game.wave === TARGET_VICTORY_WAVE) {
    finishMatch(true);
    return;
  }

  game.wave++;
  const btn = document.getElementById("waveTriggerBtn");
  btn.disabled = false;
  btn.textContent = `Start Wave ${game.wave}${game.wave % 3 === 0 ? " (BOSS)" : ""}`;
  syncHud();

  askChallenge({
    subject: "moral",
    title: "⚖️ MORAL VALUES • CARAVAN CHOICE",
    onWin: () => {
      game.hp = Math.min(100, game.hp + 15);
      game.gold += 20;
      addFloater(790, 175, "+15 HP & +20g", "#22c55e");
      syncHud();
    }
  });
}

async function finishMatch(won) {
  game.locked = true;
  game.inWave = false;
  const bonus = won ? 150 + game.hp : 0;
  const saved = await persistScore(bonus);

  const emblem = document.getElementById("resultEmblem");
  const heading = document.getElementById("resultHeading");
  const body = document.getElementById("resultBody");
  const banner = document.getElementById("resultSaveBanner");
  const endlessBtn = document.getElementById("goEndlessBtn");

  if (won) {
    emblem.textContent = "👑";
    heading.textContent = "Castle Saved — Campaign Victory!";
    heading.style.color = "#fde047";
    body.textContent = `You defended the Castle through Wave ${TARGET_VICTORY_WAVE} with ${game.hp} HP left! Bonus: +${bonus} pts (Total: ${game.score + bonus}).`;
    endlessBtn.style.display = "inline-block";
  } else {
    emblem.textContent = "🛡️";
    heading.textContent = "Castle Breached!";
    heading.style.color = "#fda4af";
    body.textContent = `Your defense held through Wave ${game.wave} with ${game.score} points.`;
    endlessBtn.style.display = "none";
  }

  if (game.user.isDemo) {
    banner.style.color = "#fda4af";
    banner.textContent = "Demo mode: scores are not saved to the leaderboard.";
  } else if (saved.saved) {
    banner.style.color = "#86efac";
    banner.textContent = `Score Recorded! Personal Best: ${saved.best}`;
  } else {
    banner.style.color = "#fde047";
    banner.textContent = saved.text || "Session complete.";
  }

  document.getElementById("resultModal").classList.add("open");
}

/* ============================================================================
   7. CANVAS RENDERING
   ============================================================================ */
function renderCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Twinkling ambient stars
  for (let i = 0; i < 24; i++) {
    const sx = ((i * 173) % canvas.width);
    const sy = ((i * 97) % canvas.height);
    const alpha = 0.18 + 0.16 * Math.sin(game.elapsed * 2.4 + i);
    ctx.fillStyle = `rgba(186, 230, 253, ${alpha.toFixed(2)})`;
    ctx.fillRect(sx, sy, 2, 2);
  }

  // Subtle tactical grid
  ctx.strokeStyle = "rgba(56, 189, 248, 0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 44) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 45) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }

  // Path & animated energy stream
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#142042";
  ctx.lineWidth = 42;
  ctx.beginPath();
  ROUTE.forEach((pt, idx) => idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
  ctx.stroke();

  ctx.strokeStyle = "#243769";
  ctx.lineWidth = 30;
  ctx.stroke();

  ctx.setLineDash([12, 18]);
  ctx.lineDashOffset = -game.elapsed * 32;
  ctx.strokeStyle = "rgba(56, 189, 248, 0.36)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.setLineDash([]);

  // Castle Keep
  ctx.save();
  ctx.shadowColor = "rgba(251, 191, 36, 0.45)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#162242";
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

  // Build pads + range preview
  BUILD_SPOTS.forEach((spot, idx) => {
    const built = game.towers.find(t => t.spotIdx === idx);
    const hovered = game.hoverSpot === idx;

    if (hovered) {
      const ref = built || TOWER_SPECS[game.chosenTower];
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, ref.range, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(56, 189, 248, 0.08)";
      ctx.fill();
      ctx.strokeStyle = "rgba(125, 211, 252, 0.45)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    if (!built) {
      const rad = 20 + Math.sin(game.elapsed * 4 + idx) * 2;
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, rad, 0, Math.PI * 2);
      ctx.fillStyle = hovered ? "rgba(56, 189, 248, 0.24)" : "rgba(56, 189, 248, 0.1)";
      ctx.fill();
      ctx.strokeStyle = hovered ? "#fde047" : "#38bdf8";
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.fillStyle = "#cbd5e1";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("+", spot.x, spot.y + 5);
    }
  });

  // Towers
  game.towers.forEach(t => {
    ctx.save();
    ctx.shadowColor = t.color;
    ctx.shadowBlur = 14;

    ctx.beginPath();
    ctx.arc(t.x, t.y, 21, 0, Math.PI * 2);
    ctx.fillStyle = "#091126";
    ctx.fill();
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.aim);
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

  // Foes
  game.foes.forEach(f => {
    const bob = Math.sin(game.elapsed * 8 + f.x * 0.05) * 2;
    const r = f.boss ? 20 : (f.scout ? 14 : 13);

    ctx.save();
    ctx.shadowColor = f.boss ? "#fb7185" : "#fb923c";
    ctx.shadowBlur = f.boss ? 16 : 8;
    ctx.beginPath();
    ctx.arc(f.x, f.y + bob, r, 0, Math.PI * 2);
    ctx.fillStyle = f.boss ? "#e11d48" : (f.slowed > 0 ? "#22c55e" : (f.scout ? "#f59e0b" : "#f97316"));
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(f.x - 5, f.y + bob - 3, 3, 3);
    ctx.fillRect(f.x + 2, f.y + bob - 3, 3, 3);
    ctx.restore();

    const w = f.boss ? 40 : 26;
    ctx.fillStyle = "#060b18";
    ctx.fillRect(f.x - w / 2, f.y - r - 10, w, 5);
    ctx.fillStyle = f.boss ? "#fb7185" : "#22c55e";
    ctx.fillRect(f.x - w / 2, f.y - r - 10, w * Math.max(0, f.hp / f.maxHp), 5);
  });

  // Bolts
  game.bolts.forEach(b => {
    ctx.save();
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = b.color;
    ctx.fill();
    ctx.restore();
  });

  // Bursts
  game.bursts.forEach(p => {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // Floaters
  game.floaters.forEach(fl => {
    ctx.globalAlpha = Math.min(1, fl.life);
    ctx.fillStyle = fl.color;
    ctx.font = "800 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(fl.text, fl.x, fl.y);
  });
  ctx.globalAlpha = 1;
}

function frameLoop(now) {
  const dt = Math.min(0.05, (now - lastStamp) / 1000);
  lastStamp = now;
  if (game.user) {
    advanceSimulation(dt);
    renderCanvas();
  }
  requestAnimationFrame(frameLoop);
}

function syncHud() {
  document.getElementById("hpVal").textContent = game.hp;
  document.getElementById("goldVal").textContent = game.gold;
  document.getElementById("manaVal").textContent = game.mana;
  document.getElementById("waveVal").textContent = game.endless ? `${game.wave} (∞)` : `${game.wave}/${TARGET_VICTORY_WAVE}`;
  document.getElementById("scoreVal").textContent = game.score;
  document.getElementById("waveClockVal").textContent = `${game.clockLeft.toFixed(1)}s`;
  document.getElementById("tierLabel").textContent = tierName(currentTier());
  document.getElementById("stormCastBtn").disabled = game.mana < 60;
}

function syncMastery() {
  const names = {
    maths: "Maths",
    science: "Science",
    grammar: "Grammar",
    gk: "General Knowledge",
    moral: "Moral Education"
  };
  document.getElementById("subjectSummary").innerHTML = Object.entries(game.accuracy)
    .map(([k, v]) => `<div class="stat-line"><span>${names[k]}</span><strong>${v.ok} / ${v.n}</strong></div>`)
    .join("");
}

/* ============================================================================
   8. UI BINDINGS
   ============================================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  await fetchBank();

  document.getElementById("idField").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\D/g, "");
  });

  document.querySelectorAll("#modeSelector .choice-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#modeSelector .choice-btn").forEach(x => x.classList.remove("selected"));
      b.classList.add("selected");
      game.mode = b.dataset.mode;
    });
  });

  document.querySelectorAll("#langSelector .choice-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#langSelector .choice-btn").forEach(x => x.classList.remove("selected"));
      b.classList.add("selected");
      game.lang = b.dataset.lang;
    });
  });

  document.getElementById("enterBtn").addEventListener("click", verifyAndEnter);
  document.getElementById("demoLaunchBtn").addEventListener("click", enterAsDemo);

  document.getElementById("arenaLangSelect").addEventListener("change", e => {
    game.lang = e.target.value;
  });

  document.querySelectorAll("#towerDeck .tower-slot").forEach(slot => {
    slot.addEventListener("click", () => {
      document.querySelectorAll("#towerDeck .tower-slot").forEach(x => x.classList.remove("active"));
      slot.classList.add("active");
      game.chosenTower = slot.dataset.kind;
    });
  });

  document.addEventListener("keydown", e => {
    if (!game.user || game.locked) return;
    const map = { "1": "maths", "2": "science", "3": "grammar", "4": "gk" };
    if (map[e.key]) {
      game.chosenTower = map[e.key];
      document.querySelectorAll("#towerDeck .tower-slot").forEach(x => {
        x.classList.toggle("active", x.dataset.kind === map[e.key]);
      });
    }
  });

  canvas.addEventListener("mousemove", evt => {
    const rect = canvas.getBoundingClientRect();
    const cx = (evt.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (evt.clientY - rect.top) * (canvas.height / rect.height);
    game.hoverSpot = BUILD_SPOTS.findIndex(s => Math.hypot(cx - s.x, cy - s.y) <= 28);
  });

  canvas.addEventListener("click", onCanvasClick);
  document.getElementById("waveTriggerBtn").addEventListener("click", startWaveRun);
  document.getElementById("boostQuizBtn").addEventListener("click", runBoostQuiz);
  document.getElementById("stormCastBtn").addEventListener("click", castStorm);
  document.getElementById("syncBoardBtn").addEventListener("click", refreshLeaderboard);

  document.getElementById("translatePeekBtn").addEventListener("click", () => {
    if (!game.activeQ) return;
    game.activeQ.q.peeking = !game.activeQ.q.peeking;
    renderQuestionCard();
  });

  document.getElementById("goEndlessBtn").addEventListener("click", () => {
    document.getElementById("resultModal").classList.remove("open");
    resetArena(true);
  });

  document.getElementById("replayBtn").addEventListener("click", () => {
    document.getElementById("resultModal").classList.remove("open");
    resetArena(false);
  });

  document.getElementById("quitBtn").addEventListener("click", async () => {
    if (game.user && !game.user.isDemo && game.score > 0) {
      await persistScore(0);
    }
    game.user = null;
    document.getElementById("gameScreen").style.display = "none";
    document.getElementById("loginScreen").style.display = "flex";
  });
});
