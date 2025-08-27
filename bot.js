// ==== HiBob ExactFlow: POST entries like the UI, then GET /summary ====
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

(async () => {
  const log  = (...a)=>console.log("[HiBob ExactFlow]", ...a);
  const warn = (...a)=>console.warn("[HiBob ExactFlow]", ...a);
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const tzOff = -new Date().getTimezoneOffset() || TZ_DEFAULT;

  const user = await (await fetch("/api/user",{credentials:"include"})).json().catch(()=>null);
  const empId = user?.id;
  if (!empId) return warn("Could not read /api/user");

  let modifiedCount = 0;
  const modifiedDates = [];
  let failedCount = 0;

  for (const raw of DATES) {
    let iso;
    try { iso = toIsoDate(raw); } catch (e) { warn("Skip (bad date):", raw, e.message); continue; }

    const url = `/api/attendance/employees/${empId}/attendance/entries?forDate=${encodeURIComponent(iso)}`;
    const body = [{
      id: null,
      start: `${iso}T${START_TIME}`,
      end:   `${iso}T${END_TIME}`,
      entryType: "work",
      offset: tzOff
    }];

    log("POST", url, body);
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
    const txt = await res.text().catch(()=>"(no body)");
    log("RESP", res.status, res.statusText, txt.slice(0,300));

    if (res.ok) {
      modifiedCount++;
      modifiedDates.push(iso);
      // Touch summary to refresh UI
      await fetch(`/api/attendance/employees/${empId}/timesheets/0/summary`, {
        credentials:"include",
        headers: { "accept":"application/json, text/plain, */*", "x-requested-with":"XMLHttpRequest", "bob-timezoneoffset": String(tzOff) }
      }).catch(()=>{});
      await sleep(1000);
    } else {
      failedCount++;
    }
  }

  const msg = [
    `Modified entries: ${modifiedCount}`,
    modifiedDates.length ? `Dates: ${modifiedDates.join(", ")}` : null,
    failedCount ? `Failed: ${failedCount}` : null,
    `Skipped weekdays: ${Array.from(normalizeSkipSet(SKIP_WEEKDAYS)).sort().map(n => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][n]).join(", ")}`
  ].filter(Boolean).join("\n");

  // Pop-up summary (fallback to alert if blocked)
  const w = 460, h = 280;
  const y = Math.max(0, (window.screen.height - h) / 2);
  const x = Math.max(0, (window.screen.width  - w) / 2);
  const pop = window.open("", "HiBobExactFlowResult", `width=${w},height=${h},left=${x},top=${y},resizable=yes`);
  if (pop) {
    pop.document.write(`
      <html>
        <head>
          <title>HiBob: Entries Updated</title>
          <meta charset="utf-8" />
          <style>
            body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 20px; }
            .count { font-size: 28px; font-weight: 700; margin-bottom: 10px; }
            .muted { color: #555; white-space: pre-wrap; }
            .ok { color: #0a7; }
          </style>
        </head>
        <body>
          <div class="count">Modified entries: <span class="ok">${modifiedCount}</span></div>
          <div class="muted">${msg.replace(/\n/g,"<br>")}</div>
          <button onclick="window.close()" style="margin-top:16px;padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Close</button>
        </body>
      </html>
    `);
    pop.document.close();
  } else {
    alert(msg);
  }

  log("Done. If grid doesn't update, switch month and back or reload.");
})();
