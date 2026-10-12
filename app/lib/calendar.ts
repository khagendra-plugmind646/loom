/** Downloads an .ics calendar event (works with Apple, Google and Outlook calendars; no account needed). */
export function downloadCalendarEvent(e: { title: string; at: Date; description: string; url: string; filename: string }) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const escape = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Loom//Loan deadline//EN",
    "BEGIN:VEVENT",
    `UID:${e.filename}@loom`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(e.at)}`,
    `DTEND:${stamp(new Date(e.at.getTime() + 30 * 60_000))}`,
    `SUMMARY:${escape(e.title)}`,
    `DESCRIPTION:${escape(e.description)}`,
    `URL:${e.url}`,
    // reminders a week, three days and one day before
    ...["P7D", "P3D", "P1D"].flatMap((t) => ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escape(e.title)}`, `TRIGGER:-${t}`, "END:VALARM"]),
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = `${e.filename}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}
