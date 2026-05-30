const DAY_MS = 24 * 60 * 60 * 1000;
const MOUNTAIN_TIME_ZONE = 'America/Denver';
const OFFSET_MS = 60 * 1000;

const mountainDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: MOUNTAIN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const mountainOffsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: MOUNTAIN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'shortOffset',
});

function pad(value) {
  return String(value).padStart(2, '0');
}

function dateOnly(parts) {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function formatterPartsToDate(parts) {
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function mountainDateParts(date) {
  return formatterPartsToDate(mountainDateFormatter.formatToParts(date));
}

function addLocalDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + days * DAY_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function mountainOffsetMinutes(date) {
  const parts = mountainOffsetFormatter.formatToParts(date);
  const offsetName = parts.find((part) => part.type === 'timeZoneName')?.value;

  if (!offsetName || offsetName === 'GMT') return 0;

  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(offsetName);
  if (!match) throw new Error(`Unable to parse ${MOUNTAIN_TIME_ZONE} offset: ${offsetName}`);

  const sign = match[1] === '+' ? 1 : -1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || 0);
  return sign * (hours * 60 + minutes);
}

function mountainWallClockToUtc(parts, hour, minute, second, millisecond) {
  const wallClockAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, second, millisecond);
  const initialOffset = mountainOffsetMinutes(new Date(wallClockAsUtc));
  let utcTime = wallClockAsUtc - initialOffset * OFFSET_MS;
  const correctedOffset = mountainOffsetMinutes(new Date(utcTime));

  if (correctedOffset !== initialOffset) {
    utcTime = wallClockAsUtc - correctedOffset * OFFSET_MS;
  }

  return new Date(utcTime);
}

function getSyncWindow(now = new Date()) {
  const today = mountainDateParts(now);
  const startParts = addLocalDays(today, -30);
  const endParts = addLocalDays(today, 180);
  const start = mountainWallClockToUtc(startParts, 0, 0, 0, 0);
  const end = mountainWallClockToUtc(endParts, 23, 59, 59, 999);

  return {
    startDate: dateOnly(startParts),
    endDate: dateOnly(endParts),
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
  };
}

module.exports = {
  getSyncWindow,
};
