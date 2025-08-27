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
      // UI does this: touch summary to refresh local state
      await fetch(`/api/attendance/employees/${empId}/timesheets/0/summary`, {
        credentials:"include",
        headers: { "accept":"application/json, text/plain, */*", "x-requested-with":"XMLHttpRequest", "bob-timezoneoffset": String(tzOff) }
      }).catch(()=>{});
      await sleep(2000); // small cooldown so the grid catches up
    }
  }

  log("Done. If grid doesn't update, switch month and back or reload.");
})();