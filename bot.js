(async () => {
  const log  = (...a)=>console.log("[HiBob ExactFlow]", ...a);
  const warn = (...a)=>console.warn("[HiBob ExactFlow]", ...a);
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const tzOff = -new Date().getTimezoneOffset() || TZ_DEFAULT;

  const user = await (await fetch("/api/user",{credentials:"include"})).json().catch(()=>null);
  const empId = user?.id;
  if (!empId) return warn("Could not read /api/user");

  let fixedCount = 0;   // <== counter

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
      fixedCount++;   // <== increment on success

      await fetch(`/api/attendance/employees/${empId}/timesheets/0/summary`, {
        credentials:"include",
        headers: { "accept":"application/json, text/plain, */*", "x-requested-with":"XMLHttpRequest", "bob-timezoneoffset": String(tzOff) }
      }).catch(()=>{});
      await sleep(2000);
    }
  }

  log("Done. If grid doesn't update, switch month and back or reload.");
  alert(`✅ Fixed ${fixedCount} attendance entr${fixedCount === 1 ? "y" : "ies"}.`);
})();
