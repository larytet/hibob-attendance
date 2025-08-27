// ==== HiBob ExactFlow (no popups): POST entries in parallel, then single GET /summary ====
// Auto-generates all dates for the CURRENT month, with weekday skipping

const START_TIME = "08:00";
const END_TIME   = "20:00";      // adjust if needed
const TZ_DEFAULT = -180;         // Asia/Jerusalem in minutes

// 👇 Skip these weekdays (strings "Sun".."Sat" or numbers 0..6; 0=Sun, 6=Sat)
const SKIP_WEEKDAYS = ["Fri", "Sat"]; // initial as requested

// --- helpers ---
const DAY_NAME_TO_NUM = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
function normalizeSkipSet(list) {
  const set = new Set();
  for (const v of list) {
    if (typeof v === "number" && v >= 0 && v <= 6) { set.add(v); continue; }
    if (typeof v === "string") {
      const key = v.slice(0,3).trim().replace(/^[a-z]/, c => c.toUpperCase()).replace(/[A-Z]{2,}.*/, m => m.slice(0,3));
      if (key in DAY_NAME_TO_NUM) { set.add(DAY_NAME_TO_NUM[key]); continue; }
    }
    console.warn("[HiBob ExactFlow] Ignoring invalid SKIP_WEEKDAYS entry:", v);
  }
  return set;
}

function getCurrentMonthDates() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-based
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dates = [];
  const skipSet = normalizeSkipSet(SKIP_WEEKDAYS);

  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const dow = new Date(`${iso}T00:00:00`).getDay(); // 0=Sun..6=Sat
    if (skipSet.has(dow)) continue;
    dates.push(iso);
  }
  return dates;
}

const DATES = getCurrentMonthDates();

function toIsoDate(x) {
  if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
  const d = (x instanceof Date) ? x : new Date(x);
  if (!isNaN(d)) return d.toISOString().slice(0,10);
  throw new Error("Unparseable date: " + x);
}

// --- tiny in-page modal (no popups) ---
function ensureModal() {
  let modal = document.getElementById("hibob-exactflow-modal");
  if (modal) return modal;

  const style = document.createElement("style");
  style.textContent = `
  #hibob-exactflow-modal{position:fixed;inset:auto 16px 16px auto;max-width:520px;z-index:2147483647;
    font:14px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
  #hibob-exactflow-modal .card{background:#fff;border:1px solid #d0d7de;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.12);
    padding:16px 16px 12px}
  #hibob-exactflow-modal .row{display:flex;gap:12px;align-items:center;margin-bottom:10px}
  #hibob-exactflow-modal .badge{font-weight:700}
  #hibob-exactflow-modal .ok{color:#0a7}
  #hibob-exactflow-modal .warn{color:#b00}
  #hibob-exactflow-modal .muted{color:#555;white-space:pre-wrap;max-height:180px;overflow:auto;border-top:1px solid #eee;padding-top:8px}
  #hibob-exactflow-modal button{margin-top:8px;padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;background:#fafafa}
  #hibob-exactflow-modal .progress{height:6px;background:#eee;border-radius:999px;overflow:hidden;margin-top:8px}
  #hibob-exactflow-modal .bar{height:100%;width:0%}
  `;
  document.head.appendChild(style);

  modal = document.createElement("div");
  modal.id = "hibob-exactflow-modal";
  modal.innerHTML = `
    <div class="card">
      <div class="row">
        <div class="badge">HiBob ExactFlow</div>
        <div class="muted" style="border:none;padding:0;margin:0;color:#777">Running…</div>
      </div>
      <div class="row">
        <div>Modified: <b class="ok" id="hef-ok">0</b></div>
        <div>Failed: <b class="warn" id="hef-fail">0</b></div>
        <div>Total: <b id="hef-total">0</b></div>
      </div>
      <div class="progress"><div class="bar" id="hef-bar"></div></div>
      <div class="muted" id="hef-log"></div>
      <button id="hef-close">Close</button>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector("#hef-close").addEventListener("click", () => { modal.style.display = "none"; });
  return modal;
}

(function attachOnce(){
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureModal, { once:true });
  } else {
    ensureModal();
  }
})();

// --- main ---
(async () => {
  const log  = (...a)=>console.log("[HiBob ExactFlow]", ...a);
  const warn = (...a)=>console.warn("[HiBob ExactFlow]", ...a);

  const modal = ensureModal();
  const elOk   = modal.querySelector("#hef-ok");
  const elFail = modal.querySelector("#hef-fail");
  const elTot  = modal.querySelector("#hef-total");
  const elBar  = modal.querySelector("#hef-bar");
  const elLog  = modal.querySelector("#hef-log");

  const tzOff = -new Date().getTimezoneOffset() || TZ_DEFAULT;

  const user = await (await fetch("/api/user",{credentials:"include"})).json().catch(()=>null);
  const empId = user?.id;
  if (!empId) { elLog.textContent = "Could not read /api/user"; return; }

  let ok = 0, fail = 0, done = 0;
  elTot.textContent = String(DATES.length);

  const skipList = Array.from(normalizeSkipSet(SKIP_WEEKDAYS)).sort().map(n => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][n]).join(", ");
  const addLine = (s)=>{ elLog.textContent += (elLog.textContent ? "\n" : "") + s; elLog.scrollTop = elLog.scrollHeight; };
  addLine(`Skipped weekdays: ${skipList}`);
  addLine(`Posting ${DATES.length} day(s) ${START_TIME}–${END_TIME}…`);

  const postOne = async (rawIso) => {
    let iso = rawIso;
    try { iso = toIsoDate(rawIso); } catch (e) { throw new Error("Bad date: "+rawIso); }

    const url = `/api/attendance/employees/${empId}/attendance/entries?forDate=${encodeURIComponent(iso)}`;
    const body = [{
      id: null,
      start: `${iso}T${START_TIME}`,
      end:   `${iso}T${END_TIME}`,
      entryType: "work",
      offset: tzOff
    }];

    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json;charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        "bob-timezoneoffset": String(tzOff)
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const txt = await res.text().catch(()=>"(no body)");
      throw new Error(`POST ${iso} → ${res.status} ${res.statusText} ${txt.slice(0,120)}`);
    }
    return iso;
  };

  // Fire ALL requests in parallel
  const tasks = DATES.map(d => postOne(d)
    .then(iso => { ok++; addLine(`✓ ${iso}`); })
    .catch(err => { fail++; addLine(`✗ ${err.message}`); })
    .finally(() => {
      done++;
      elOk.textContent   = String(ok);
      elFail.textContent = String(fail);
      elBar.style.width  = `${Math.round((done / DATES.length) * 100)}%`;
    })
  );

  await Promise.all(tasks);

  // Single summary touch to refresh UI (no per-day GETs)
  try {
    await fetch(`/api/attendance/employees/${empId}/timesheets/0/summary`, {
      credentials:"include",
      headers: { "accept":"application/json, text/plain, */*", "x-requested-with":"XMLHttpRequest", "bob-timezoneoffset": String(tzOff) }
    });
    addLine("Summary refreshed.");
  } catch {
    addLine("Summary refresh failed (non-fatal).");
  }

  addLine(`Done. Modified: ${ok}${fail ? ` | Failed: ${fail}` : ""}. If the grid doesn’t update, switch month and back or reload.`);
})();
