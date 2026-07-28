const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

/**
 * Long date from an ISO string. No Date object, so no timezone can shift it.
 *
 * A game's date is a calendar date, not an instant: `new Date("2026-07-27")`
 * parses as midnight UTC and renders as the 26th anywhere west of Greenwich,
 * which is where this team plays.
 */
export function longDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day} ${MONTHS[month! - 1]} ${year}`;
}

/**
 * The same date, short enough for a log row.
 *
 * ONE FORMAT PER SECTION. The next-fixture banner set "27 July 2026" over a
 * game log that set the same fixture as "2026-07-27" three hundred pixels
 * below it, so the banner read as a different system from the log it summarises.
 * The machine value stays on the `datetime` attribute, where it belongs.
 */
export function shortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day} ${MONTHS[month! - 1]?.slice(0, 3)} ${year}`;
}
