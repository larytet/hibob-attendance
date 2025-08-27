# HiBob ExactFlow Attendance Script

## Goal
This script automates the process of creating **attendance entries** in HiBob for a list of given dates.  
It simulates the same flow the HiBob UI uses:
1. **POST** attendance entries for each date.
2. **Trigger a summary refresh** (`GET /summary`) so the UI grid updates.

At the end of the run, it shows a **pop-up window** with the total number of modified entries, the dates affected, and any failures or skipped inputs.

---

## ⚙️ How It Works

- Accepts different **date formats** (ISO, `Aug 07, 2025`, `Wed, Aug/06/2025`) and normalizes them to ISO (`YYYY-MM-DD`).
- For each date:
  - Posts a work-time entry with a configurable **start** and **end** time.
  - Uses the employee’s ID (fetched from `/api/user`) and the correct timezone offset.
  - Refreshes the timesheet summary to keep the grid in sync.
- Tracks:
  - Successful modifications  
  - Failed requests  
  - Skipped invalid dates
- At the end, opens a **centered popup window** with the results. If pop-ups are blocked, it falls back to an `alert`.

---

## 📝 Configuration

- **DATES** – list of dates to process. Supports ISO, English, and display-ish formats.
- **START_TIME** / **END_TIME** – working hours for the created entry.
- **TZ_DEFAULT** – timezone offset (default set for Asia/Jerusalem `-180` minutes).
- The script auto-detects your local timezone offset unless overridden.

---

## 🔧 Usage
1. Copy the script into the browser console while logged into HiBob.
2. Adjust:
   - The `DATES` array.
   - `START_TIME` / `END_TIME` if needed.
   - `TZ_DEFAULT` if you are in a different timezone.
3. Run it.
4. A pop-up will summarize:
   - Modified entries count.
   - Affected dates.
   - Failures/skipped dates (if any).

---

## Notes
- If the UI grid does not refresh automatically, **switch month and back or reload** the page.
- Pop-ups may be blocked by browser settings; in that case, an `alert()` will show the summary.
- Designed for **manual/admin scripting** purposes; use responsibly.


