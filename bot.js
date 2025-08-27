// ==== HiBob ExactFlow: Fix ONLY missing entries based on timesheet /summary ====
// Reads the current timesheet summary, finds working days with 0h logged, and fills those only.
// - No popups (tiny in-page modal with Close)
// - All POSTs run in parallel
// - Single GET /summary at the end to refresh UI

const START_TIME = "08:00";
const END_TIME   = "20:00";      // adjust if needed
const TZ_DEFAULT = -180;         // Asia/Jerusalem in minutes

// Optional weekday skip on top of what /summary already encodes via "potentialHours"
// (strings "Sun".."Sat" or numbers 0..6; 0=Sun, 6=Sat)
const SKIP_WEEKDAYS = ["Fri", "Sat"];

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

function toIsoDate(x) {
  if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
  const d = (x instanceof Date) ? x : new Date(x);
  if (!isNaN(d)) return d.toISOString().slice(0,10);
  throw new Error("Unparseable date: " + x);
}

// ===== Modal lifecycle utils (drop-in replacement) =====

// IDs for modal + style so we can cleanly remove them
const HIBOB_MODAL_ID = "hibob-exactflow-modal";
const HIBOB_STYLE_ID = "hibob-exactflow-style";

// Remove any previous modal + style (even if hidden)
function destroyModal() {
  const oldModal = document.getElementById(HIBOB_MODAL_ID);
  if (oldModal && oldModal.parentNode) oldModal.parentNode.removeChild(oldModal);
  const oldStyle = document.getElementById(HIBOB_STYLE_ID);
  if (oldStyle && oldStyle.parentNode) oldStyle.parentNode.removeChild(oldStyle);
}

// Create a fresh modal and return the element
function createModal() {
  // style
  const style = document.createElement("style");
  style.id = HIBOB_STYLE_ID;
  style.textContent = `
  #${HIBOB_MODAL_ID}{position:fixed;inset:auto 16px 16px auto;max-width:560px;z-index:2147483647;
    font:14px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
  #${HIBOB_MODAL_ID} .card{background:#fff;border:1px solid #d0d7de;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.12);
    padding:16px 16px 12px}
  #${HIBOB_MODAL_ID} .row{display:flex;gap:12px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
  #${HIBOB_MODAL_ID} .badge{font-weight:700}
  #${HIBOB_MODAL_ID} .ok{color:#0a7}
  #${HIBOB_MODAL_ID} .warn{color:#b00}
  #${HIBOB_MODAL_ID} .muted{color:#555;white-space:pre-wrap;max-height:200px;overflow:auto;border-top:1px solid #eee;padding-top:8px}
  #${HIBOB_MODAL_ID} button{margin-top:8px;padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;background:#fafafa}
  #${HIBOB_MODAL_ID} .progress{height:6px;background:#eee;border-radius:999px;overflow:hidden;margin-top:8px}
  #${HIBOB_MODAL_ID} .bar{height:100%;width:0%}
  `;
  document.head.appendChild(style);

  // modal
  const modal = document.createElement("div");
  modal.id = HIBOB_MODAL_ID;
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

  // Close only hides; next run will recreate fresh
  modal.querySelector("#hef-close").addEventListener("click", () => {
    modal.style.display = "none";
  });

  return modal;
}

// Always start with a brand-new modal.
// If an old one exists (even hidden), it will be destroyed first.
function ensureFreshModal() {
  destroyModal();
  return createModal();
}

// Call this at the top of your main IIFE before you query elements:
(function attachFreshOnce() {
  const boot = () => ensureFreshModal();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();

// --- main ---
(async () => {
  const log  = (...a)=>console.log("[HiBob ExactFlow]", ...a);
  const warn = (...a)=>console.warn("[HiBob ExactFlow]", ...a);

  const modal = ensureFreshModal();
  const elOk   = modal.querySelector("#hef-ok");
  const elFail = modal.querySelector("#hef-fail");
  const elTot  = modal.querySelector("#hef-total");
  const elBar  = modal.querySelector("#hef-bar");
  const elLog  = modal.querySelector("#hef-log");
  const addLine = (s)=>{ elLog.textContent += (elLog.textContent ? "\n" : "") + s; elLog.scrollTop = elLog.scrollHeight; };

  const tzOff = -new Date().getTimezoneOffset() || TZ_DEFAULT;

  // who am I?
  const user = await (await fetch("/api/user",{credentials:"include"})).json().catch(()=>null);
  const empId = user?.id;
  if (!empId) { addLine("Could not read /api/user"); return; }

  // read current timesheet summary
  const summaryRes = await fetch(`/api/attendance/employees/${empId}/timesheets/0/summary`, {
    credentials:"include",
    headers: {
      "accept":"application/json, text/plain, */*",
      "x-requested-with":"XMLHttpRequest",
      "bob-timezoneoffset": String(tzOff)
    }
  }).catch(()=>null);

  if (!summaryRes || !summaryRes.ok) {
    addLine("Failed to GET timesheet summary.");
    return;
  }

  /** summary example shape:
   *  { dailyBreakdown: { categories: ["YYYY-MM-DD", ...],
   *      graphData: [
   *        {id:"potentialHours", target:[{value:8|9|0|null}, ...]},
   *        {id:"hoursWorked", data:[{value:number|null}, ...]},
   *        ...
   *      ]
   *    },
   *    hasMissingEntries: true|false, ...
   *  }
   */
  const summary = await summaryRes.json().catch(()=>null);
  if (!summary?.dailyBreakdown?.categories?.length) {
    addLine("Summary is missing daily breakdown.");
    return;
  }

  // extract arrays we need
  const cats = summary.dailyBreakdown.categories; // ISO dates
  const g = (id)=> summary.dailyBreakdown.graphData?.find(s=>s.id===id);
  const potential = g("potentialHours")?.target ?? [];
  const worked    = g("hoursWorked")?.data ?? [];

  const skipSet = normalizeSkipSet(SKIP_WEEKDAYS);
  const weekday = (iso)=> new Date(`${iso}T00:00:00`).getDay();

  // Build candidate list:
  // - potentialHours > 0 (i.e., a payable workday)
  // - hoursWorked is 0 or null/undefined
  // - not in SKIP_WEEKDAYS (explicit override)
  // - only past or today (ignore future dates where potential may be null)
  const todayIso = new Date().toISOString().slice(0,10);
  const isPastOrToday = (iso)=> iso <= todayIso;

  const candidates = [];
  for (let i=0;i<cats.length;i++){
    const iso = cats[i];
    const pot = potential[i]?.value ?? 0;
    const wrk = worked[i]?.value ?? 0;
    if (!iso || !isPastOrToday(iso)) continue;        // ignore future
    if (skipSet.has(weekday(iso))) continue;          // user override
    if (!pot || pot <= 0) continue;                   // weekends/holidays
    if (wrk && wrk > 0) continue;                     // already filled
    candidates.push(iso);
  }

  elTot.textContent = String(candidates.length);
  if (!candidates.length) {
    addLine("No missing payable days to fix. ✅");
    return;
  }

  addLine(`Will fill ${candidates.length} day(s) ${START_TIME}–${END_TIME}.`);
  addLine(`Skipped weekdays: ${Array.from(skipSet).sort().map(n => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][n]).join(", ") || "—"}`);

  // POST helper
  const postOne = async (iso) => {
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
  };

  // Fire all in parallel with progress
  let ok=0, fail=0, done=0;
  const updateBar = ()=> { 
    done++; 
    elOk.textContent = String(ok);
    elFail.textContent = String(fail);
    elBar.style.width = `${Math.round((done/candidates.length)*100)}%`;
  };

  const tasks = candidates.map(iso =>
    postOne(iso)
      .then(()=>{ ok++; addLine(`✓ ${iso}`); })
      .catch(err=>{ fail++; addLine(`✗ ${iso} — ${err.message}`); })
      .finally(updateBar)
  );

  await Promise.all(tasks);

  // Single summary touch to refresh UI
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
