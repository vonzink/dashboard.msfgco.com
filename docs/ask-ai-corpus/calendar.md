# Company Calendar / Schedule

Dashboard section: (none — top nav "Schedule" menu → "Company Calendar")

## What it is
The Company Calendar is a team schedule tool that opens in its own popout window. Its core job is letting people log their own availability status — Out, Remote, Traveling, Meeting/Event, Busy, B-Day, or Other — over a date range, and letting the team see everyone's schedule together in one place. The backend also has a separate calendar-events API supporting one-off or recurring company events (daily/weekly/biweekly/monthly/yearly, with a title, color, and notes), though the current dashboard UI doesn't expose a form for creating those directly.

## How to find it
Click the "Schedule" item in the top navigation bar, then "Company Calendar" in the dropdown. It opens as a separate popout window (not a section on the main dashboard page).

## Common tasks

### Switch how you view the schedule
Use the view tabs at the top of the calendar window to switch between Day, Week, Month, 2 Months, Year, People, and All. "Today" and the prev/next arrows move the visible range.

### Add a schedule entry for yourself
Click "Add Schedule" (in the toolbar, or on a specific day when viewing Day view). Pick a status — Out, Remote, Traveling, Meeting/Event, Busy, B-Day, or Other — a start and end date (and optional start/end time), and an optional note, then save.

### Filter what you see
Use the status filter chips to hide or show entries by status (e.g. hide everyone's "Busy" entries to reduce clutter).

### Browse by person
Switch to the "People" view to see the schedule laid out by team member instead of by date.

## FAQ
**Q: How do I mark myself out of office or remote for a few days?**
A: Open Company Calendar from the Schedule menu, click "Add Schedule," pick the "Out" or "Remote" status, set your date range, and save.

**Q: Can I create a recurring team event, like a weekly meeting?**
A: The backend supports recurring calendar events (daily, weekly, biweekly, monthly, yearly) with an end date for the series, but there's currently no button in the dashboard UI to create one — this exists at the API level only.

**Q: Where does the calendar open?**
A: In its own popout window, launched from Schedule → Company Calendar in the top nav — it isn't embedded in the main dashboard page.
