/* ============================================================================
   BRAIN DEFENDER — QUESTION-LOADER.JS
   Reads manifest.json + chapter JSONs via raw.githubusercontent.com first to
   avoid burning the 60/hour unauthenticated GitHub REST API rate limit.
   ============================================================================ */

export const REPO_OWNER = "mcaravikantpotdar";
export const REPO_NAME = "Brain-Defender";
export const REPO_BRANCH = "main";
export const REPO_CACHE_KEY = "brain_defender_class_repo_cache_v2";
export const REPO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export function canonicalSubject(rawVal) {
  const s = String(rawVal || "").toLowerCase().trim();
  if (!s) return null;

  // 1. Computer Science / SQL / PL-SQL / IT first
  if (
    /\b(pl\/?sql|sql|dbms|rdbms|database|cursor|trigger|stored\s*procedure|function|package|exception|sqlplus|oracle|python|java|c\+\+|html|css|javascript|algorithm|flowchart|network|cyber|comp\.?\s*sc\.?|computer|it)\b/i.test(s) ||
    s === "cs"
  ) {
    return "cs";
  }

  // 2. Mathematics
  if (/\b(math|maths|mathematics|algebra|geometry|trigonometry|calculus|arithmetic|गणित)\b/i.test(s)) {
    return "maths";
  }

  // 3. Science
  if (/\b(sci|science|physics|chemistry|biology|विज्ञान|भौतिक|रसायन|जीव)\b/i.test(s)) {
    return "science";
  }

  // 4. Moral Education
  if (/\b(moral|value|ethics|civics|नैतिक)\b/i.test(s)) {
    return "moral";
  }

  // 5. General Knowledge / Social Studies
  if (/\b(gk|general\s*knowledge|social|sst|history|geography|सामान्य\s*ज्ञान)\b/i.test(s)) {
    return "gk";
  }

  // 6. Grammar / Languages
  if (
    /\b(gram|grammar|english|hindi|sanskrit|व्याकरण|अंग्रेजी|हिन्दी|हिंदी)\b/i.test(s) ||
    /\b(language\s*(arts|paper|subject)|lang)\b/i.test(s)
  ) {
    return "grammar";
  }

  return null;
}

export function inferClassFromText(text) {
  const m =
    String(text || "").match(/class[\s\-_]*([6-9]|1[0-2])\b/i) ||
    String(text || "").match(/\b(1[0-2]|[6-9])(?:th)?\b/i);
  if (!m) return null;
  const n = Number(m[1] || m[0]);
  return (n >= 6 && n <= 12) ? n : null;
}

function inferDifficultyFromIndex(idx, total, explicit) {
  if (typeof explicit === "number" && explicit >= 1 && explicit <= 4) return explicit;
  const ratio = total > 0 ? idx / total : 0;
  if (ratio < 0.25) return 1;
  if (ratio < 0.55) return 2;
  if (ratio < 0.8) return 3;
  return 4;
}

function stripLocatorPrefix(txt) {
  return String(txt || "").replace(/^\[[^\]]+\]\s*/g, "").trim();
}

export function normalizeRepoPayload(data, path) {
  const items = Array.isArray(data) ? data : (Array.isArray(data?.questions) ? data.questions : []);
  if (!items.length) return [];

  const parts = String(path || "").split("/");
  const meta = data?.metadata || {};
  const metaNote = `${meta.note || ""} ${meta.chapter_title || ""} ${meta.topic || ""}`;
  const inferredClass =
    inferClassFromText(parts[0] || "") ||
    inferClassFromText(path) ||
    inferClassFromText(metaNote) ||
    Number(meta.class) ||
    10;

  const chapterName =
    meta.topic ||
    meta.chapter_title ||
    parts[parts.length - 1]?.replace(/\.json$/i, "") ||
    "Chapter";

  const inferredSubject =
    canonicalSubject(meta.subject) ||
    parts.slice(0, -1).map(canonicalSubject).find(Boolean) ||
    canonicalSubject(chapterName) ||
    "cs";

  const letterOrder = ["a", "b", "c", "d"];
  const out = [];

  items.forEach((raw, idx) => {
    if (!raw || typeof raw !== "object") return;

    const qObj = typeof raw.question === "object" && raw.question !== null
      ? raw.question
      : (typeof raw.prompt === "object" && raw.prompt !== null ? raw.prompt : null);

    const enPrompt = stripLocatorPrefix(qObj?.en || raw.prompt?.en || raw.question || "");
    const hiPrompt = stripLocatorPrefix(qObj?.hi || raw.prompt?.hi || enPrompt);
    if (!enPrompt && !hiPrompt) return;

    let enOpts = [];
    let hiOpts = [];
    let ansIdx = 0;

    if (raw.options && typeof raw.options === "object" && !Array.isArray(raw.options)) {
      if (Array.isArray(raw.options.en)) {
        enOpts = raw.options.en.map(String);
        hiOpts = Array.isArray(raw.options.hi) && raw.options.hi.length === enOpts.length
          ? raw.options.hi.map(String)
          : [...enOpts];
        const rawAns = raw.answerIndex ?? raw.correctIndex ?? raw.correct_index ?? 0;
        ansIdx = typeof rawAns === "number" ? rawAns : 0;
      } else {
        const keys = letterOrder.filter(k => raw.options[k]);
        if (keys.length >= 2) {
          enOpts = keys.map(k => String(raw.options[k]?.en ?? raw.options[k] ?? "").trim());
          hiOpts = keys.map((k, i) => String(raw.options[k]?.hi ?? enOpts[i] ?? "").trim());
          const corrKey = String(raw.correct_option || "").toLowerCase().trim();
          const found = keys.indexOf(corrKey);
          ansIdx = found >= 0 ? found : 0;
        }
      }
    }

    if (enOpts.length < 2) return;

    out.push({
      id: `GH-${inferredClass}-${inferredSubject}-${raw.question_id || raw.id || idx + 1}-${idx}`,
      class: inferredClass,
      subject: inferredSubject,
      chapter: chapterName,
      sourceType: "repo",
      difficulty: inferDifficultyFromIndex(idx, items.length, raw.difficulty),
      prompt: {
        en: enPrompt || hiPrompt,
        hi: hiPrompt || enPrompt
      },
      options: {
        en: enOpts,
        hi: hiOpts
      },
      answerIndex: Math.max(0, Math.min(enOpts.length - 1, ansIdx)),
      explanation: {
        en: raw.explanation?.en || raw.key_takeaway?.en || "Well answered!",
        hi: raw.explanation?.hi || raw.key_takeaway?.hi || raw.explanation?.en || "सही उत्तर!"
      }
    });
  });

  return out;
}

async function readManifestFilePaths() {
  const stamp = Date.now();
  try {
    const localResp = await fetch(`./manifest.json?t=${stamp}`, { cache: "no-store" });
    if (localResp.ok) {
      const data = await localResp.json();
      if (Array.isArray(data?.files)) {
        return data.files.map(String).filter(p => /\.json$/i.test(p));
      }
    }
  } catch (_) {}

  try {
    const rawManifestUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/manifest.json?t=${stamp}`;
    const remoteResp = await fetch(rawManifestUrl, { cache: "no-store" });
    if (remoteResp.ok) {
      const data = await remoteResp.json();
      if (Array.isArray(data?.files)) {
        return data.files.map(String).filter(p => /\.json$/i.test(p));
      }
    }
  } catch (_) {}

  return [];
}

async function listClassSubjectJsonPathsViaApi(classFolder, subject) {
  const folderPath = `${classFolder}/${subject}`;
  const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(folderPath)}?ref=${REPO_BRANCH}`;
  const resp = await fetch(apiUrl);
  if (resp.status === 404) return [];
  if (resp.status === 403 || resp.status === 429) {
    throw new Error(`RATE_LIMITED_${resp.status}`);
  }
  if (!resp.ok) throw new Error(`GitHub folder HTTP ${resp.status}`);
  const entries = await resp.json();
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(item => item.type === "file" && /\.json$/i.test(item.name))
    .map(item => item.path);
}

export async function fetchGitHubClassQuestions(forceRefresh = false) {
  let staleCachedItems = [];
  try {
    const cachedRaw = localStorage.getItem(REPO_CACHE_KEY);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (cached && Array.isArray(cached.items)) {
        staleCachedItems = cached.items;
        if (!forceRefresh && (Date.now() - cached.savedAt) < REPO_CACHE_TTL_MS) {
          return cached.items;
        }
      }
    }
  } catch (_) {}

  let jsonPaths = await readManifestFilePaths();

  if (jsonPaths.length === 0) {
    const classFolders = [6, 7, 8, 9, 10, 11, 12].map(n => `class-${n}`);
    const subjects = ["maths", "science", "grammar", "gk", "cs", "moral"];
    const targetFolders = classFolders.flatMap(cf => subjects.map(sub => ({ cf, sub })));

    try {
      const pathBatches = await Promise.all(
        targetFolders.map(({ cf, sub }) => listClassSubjectJsonPathsViaApi(cf, sub))
      );
      jsonPaths = Array.from(new Set(pathBatches.flat()));
    } catch (err) {
      if (String(err?.message || "").startsWith("RATE_LIMITED_") && staleCachedItems.length > 0) {
        return staleCachedItems;
      }
      return staleCachedItems;
    }
  }

  const stamp = Date.now();
  const fetchedLists = await Promise.all(
    jsonPaths.map(async p => {
      const cleanPath = String(p).replace(/^\/+/, "");
      try {
        const localResp = await fetch(`./${encodeURI(cleanPath)}?t=${stamp}`, { cache: "no-store" });
        if (localResp.ok) {
          const json = await localResp.json();
          return normalizeRepoPayload(json, cleanPath);
        }
      } catch (_) {}

      try {
        const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/${encodeURI(cleanPath)}?t=${stamp}`;
        const rawResp = await fetch(rawUrl, { cache: "no-store" });
        if (!rawResp.ok) return [];
        const json = await rawResp.json();
        return normalizeRepoPayload(json, cleanPath);
      } catch (_) {
        return [];
      }
    })
  );

  const merged = fetchedLists.flat();
  if (merged.length > 0) {
    try {
      localStorage.setItem(REPO_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items: merged }));
    } catch (_) {}
    return merged;
  }

  return staleCachedItems;
}

export async function loadCombinedQuestionBank(forceRefresh = false, isDemo = false) {
  let baseItems = [];
  try {
    const resp = await fetch("./questions.json", { cache: "no-store" });
    if (resp.ok) {
      const data = await resp.json();
      baseItems = (Array.isArray(data.questions) ? data.questions : [])
        .filter(
          item =>
            item &&
            item.subject &&
            item.prompt &&
            item.prompt.en &&
            item.options &&
            Array.isArray(item.options.en) &&
            item.options.en.length >= 2 &&
            typeof item.answerIndex === "number"
        )
        .map(item => ({
          ...item,
          subject: canonicalSubject(item.subject) || item.subject,
          sourceType: "base"
        }));
    }
  } catch (err) {
    console.warn("Base questions.json load issue:", err);
  }

  if (isDemo) {
    return {
      questions: baseItems,
      repoLoadedCount: 0,
      repoSyncLabel: "Demo Bank: Root JSON + Math"
    };
  }

  let repoItems = [];
  try {
    repoItems = await fetchGitHubClassQuestions(forceRefresh);
  } catch (_) {
    repoItems = [];
  }

  const combined = [...repoItems, ...baseItems];
  window.__BD_DEBUG__ = {
    questions: combined,
    repoItems,
    baseItems
  };

  return {
    questions: combined,
    repoLoadedCount: repoItems.length,
    repoSyncLabel: repoItems.length > 0 ? `Class JSONs: ${repoItems.length} Qs` : "Bank: Base + Math"
  };
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
    if (!Number.isFinite(n) || n < minBound) continue;
    set.add(Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
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

export function generateProceduralMath(cls, tier, recentGenKeys = []) {
  const grade = Math.max(6, Math.min(12, Number(cls) || 10));
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
          prompt: { en: `Quick Warm-Up: What is ${a} + ${b}?`, hi: `त्वरित अभ्यास: ${a} + ${b} कितना होता है?` },
          options: { en: opts, hi: [...opts] },
          answerIndex: 0,
          explanation: { en: `${a} + ${b} = ${ans}.`, hi: `${a} + ${b} = ${ans} होता है।` }
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
          prompt: { en: `Quick Warm-Up: What is ${base}²?`, hi: `त्वरित अभ्यास: ${base}² का मान क्या है?` },
          options: { en: opts, hi: [...opts] },
          answerIndex: 0,
          explanation: { en: `${base} × ${base} = ${sq}.`, hi: `${base} × ${base} = ${sq}।` }
        };
      }
    } else if (diff === 2) {
      const a = randInt(2, 6);
      const x = randInt(2, 9);
      const b = randInt(2, 12);
      const total = a * x + b;
      sig = `m2-lin-${a}-${x}-${b}`;
      const opts = uniqueFourOptions(x, [x + 1, Math.max(1, x - 1), total - b, x + 2], 1);
      item = {
        id: `PROC-M2-${Date.now()}-${attempt}`,
        class: grade,
        subject: "maths",
        difficulty: 2,
        prompt: { en: `Class ${grade}: Find x if ${a}x + ${b} = ${total}.`, hi: `कक्षा ${grade}: यदि ${a}x + ${b} = ${total}, तो x का मान क्या है?` },
        options: { en: opts, hi: [...opts] },
        answerIndex: 0,
        explanation: { en: `${a}x = ${total} - ${b} = ${total - b}, so x = ${x}.`, hi: `${a}x = ${total} - ${b} = ${total - b}, इसलिए x = ${x}।` }
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
        prompt: { en: `Class ${grade}: What is ${pct}% of ${whole}?`, hi: `कक्षा ${grade}: ${whole} का ${pct}% कितना होगा?` },
        options: { en: opts, hi: [...opts] },
        answerIndex: 0,
        explanation: { en: `(${pct} ÷ 100) × ${whole} = ${ans}.`, hi: `(${pct} ÷ 100) × ${whole} = ${ans}।` }
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

    if (!recentGenKeys.includes(sig)) {
      recentGenKeys.push(sig);
      if (recentGenKeys.length > 25) recentGenKeys.shift();
      return item;
    }
  }

  return generateProceduralMath(grade, 1, recentGenKeys);
}
