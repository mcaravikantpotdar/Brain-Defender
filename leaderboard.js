/* ============================================================================
   BRAIN DEFENDER — LEADERBOARD.JS
   Handles Student ID verification, lockout cooldown, score submission,
   and Top-10 + Latest-50 leaderboard rendering.
   ============================================================================ */

export const BACKEND_URL =
  "https://script.google.com/macros/s/AKfycbxJ3rbuFzYgVzMjSanjrIJY2Vh8Vw2uVQUIu1tKvMz0mE_W3KoBi_6QwEcWWE2C89OwhA/exec";

export function maskId(val) {
  const s = String(val || "");
  if (s.length <= 4) return "****";
  return `${"*".repeat(s.length - 4)}${s.slice(-4)}`;
}

export async function verifyStudentIdRemote(digits) {
  const url = `${BACKEND_URL}?action=verifyPen&pen=${encodeURIComponent(digits)}`;
  const res = await fetch(url, { method: "GET", redirect: "follow" });
  return res.json();
}

export async function submitScoreRemote({ user, mode, score, wave, stats }) {
  if (!user || user.isDemo) {
    return { saved: false, msg: "Demo mode: scores are never saved to the leaderboard." };
  }

  const finalScore = Math.max(0, Number(score) || 0);
  if (finalScore <= 0) {
    return { saved: false, msg: "No points scored yet to submit." };
  }

  const rightTotal = Object.values(stats || {}).reduce((acc, s) => acc + (s?.right || 0), 0);
  const askedTotal = Object.values(stats || {}).reduce((acc, s) => acc + (s?.asked || 0), 0);

  const payload = {
    pen: user.pen,
    maskedPen: maskId(user.pen),
    name: user.name,
    school: user.school || "",
    classNum: user.classNum,
    mode,
    score: finalScore,
    wave,
    correct: rightTotal,
    total: askedTotal,
    submittedAt: new Date().toISOString(),
    isDemo: false
  };

  try {
    const res = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "submitScore", payload })
    });
    const out = await res.json();
    return { saved: Boolean(out.ok), bestScore: out.bestScore || finalScore };
  } catch (_) {
    return { saved: false, msg: "Could not sync score right now." };
  }
}

function parseEntryTimestampMs(entry) {
  const raw = entry?.submittedAt || entry?.timestamp || entry?.createdAt || entry?.time || "";
  if (!raw) return null;
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : null;
}

export function sortLatestFirst(rawRows) {
  const rows = Array.isArray(rawRows) ? [...rawRows] : [];
  const withIdx = rows.map((item, idx) => ({ item, idx, ts: parseEntryTimestampMs(item) }));
  const anyTimestamps = withIdx.some(x => x.ts !== null);

  if (anyTimestamps) {
    withIdx.sort((a, b) => {
      if (a.ts !== null && b.ts !== null && b.ts !== a.ts) return b.ts - a.ts;
      return b.idx - a.idx;
    });
    return withIdx.map(x => x.item).slice(0, 50);
  }

  return rows.reverse().slice(0, 50);
}

function formatEntryTime(entry) {
  const ms = parseEntryTimestampMs(entry);
  if (!ms) return "Recent entry";
  try {
    return new Date(ms).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (_) {
    return String(entry.submittedAt || entry.timestamp || "Recent entry");
  }
}

export function renderLatest50List(rows, currentUser) {
  const list = document.getElementById("latest50List");
  if (!list) return;
  const latestRows = sortLatestFirst(rows);

  list.innerHTML = "";
  if (!latestRows.length) {
    list.innerHTML = `<li class="board-row"><span>No recent submissions found.</span></li>`;
    return;
  }

  latestRows.forEach((entry, idx) => {
    const isSelf = currentUser && !currentUser.isDemo && String(entry.pen) === String(currentUser.pen);
    const li = document.createElement("li");
    li.className = `board-row${isSelf ? " me" : ""}`;
    li.innerHTML = `
      <div>
        <strong>#${idx + 1} ${entry.name || "Defender"}</strong>
        <div style="font-size:0.72rem; color:var(--muted);">
          Class ${entry.classNum || "-"} • ${entry.school || "Defender"} • Wave ${entry.wave || 1} • ${formatEntryTime(entry)}
        </div>
      </div>
      <strong style="color:var(--gold); font-size:0.95rem;">${entry.score ?? 0}</strong>
    `;
    list.appendChild(li);
  });
}

export async function refreshLeaderboardUI(currentUser) {
  const list = document.getElementById("leaderboardList");
  try {
    const res = await fetch(`${BACKEND_URL}?action=getLeaderboard`, { redirect: "follow" });
    const out = await res.json();
    const rows = (out.ok && Array.isArray(out.leaderboard)) ? out.leaderboard : [];
    const latestSource = Array.isArray(out.latest) && out.latest.length > 0 ? out.latest : rows;

    list.innerHTML = "";
    if (!rows.length) {
      list.innerHTML = `<li class="board-row"><span>No leaderboard entries yet.</span></li>`;
    } else {
      rows.slice(0, 10).forEach((entry, idx) => {
        const isSelf = currentUser && !currentUser.isDemo && String(entry.pen) === String(currentUser.pen);
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
    }

    renderLatest50List(latestSource, currentUser);
  } catch (_) {
    list.innerHTML = `<li class="board-row"><span>Leaderboard temporarily offline.</span></li>`;
    renderLatest50List([], currentUser);
  }
}
