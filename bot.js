// ==== HiBob ExactFlow: POST entries like the UI, then GET /summary ====
// Give it any date strings; it will normalize to ISO and post.

const DATES = [
  "2025-08-04",         // already ISO
  "Wed, Aug/06/2025",   // display-ish
  "Aug 07, 2025"        // common English format
];

const START_TIME = "08:00";
const END_TIME   = "20:00";     // your capture used 20:00; change if needed
const TZ_DEFAULT = -180;        // Asia/Jerusalem in minutes

function toIsoDate(x) {
  if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)) return x;

  let m = (typeof x === "string") && x.match(/^\w{3},\s*([A-Za-z]{3})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const mon = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12}[m[1]];
    return `${m[3]}-${String(mon).padStart(2,"0")}-${m[2]}`;
  }
  m = (typeof x === "string") && x.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/);
  if (m) {
    const mon = {January:1,February:2,March:3,April:4,May:5,June:6,July:7,August:8,September:9,October:10,November:11,December:12,
                 Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12}[m[1]];
    return `${m[3]}-${String(mon).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`;
  }
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

  // --- tracking counters ---
  let modifiedCount = 0;
  const modifiedDates = [];
  let failedCount = 0;
  let skippedCount = 0;

  for (const raw of DATES) {
    let iso;
    try { 
      iso = toIsoDate(raw); 
    } catch (e) { 
      warn("Skip (bad date):", raw, e.message); 
      skippedCount++;
      continue; 
    }

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

      // UI does this: touch summary to refresh local state
      await fetch(`/api/attendance/employees/${empId}/timesheets/0/summary`, {
        credentials:"include",
        headers: { "accept":"application/json, text/plain, */*", "x-requested-with":"XMLHttpRequest", "bob-timezoneoffset": String(tzOff) }
      }).catch(()=>{});
      await sleep(2000); // small cooldown so the grid catches up
    } else {
      failedCount++;
    }
  }

  // --- pop window with results ---
  const msg = [
    `Modified entries: ${modifiedCount}`,
    modifiedDates.length ? `Dates: ${modifiedDates.join(", ")}` : null,
    failedCount ? `Failed: ${failedCount}` : null,
    skippedCount ? `Skipped (bad date): ${skippedCount}` : null
  ].filter(Boolean).join("\n");

  // Try a small centered popup; fall back to alert if blocked.
  const w = 420, h = 240;
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
            .count { font-size: 32px; font-weight: 700; margin-bottom: 12px; }
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
