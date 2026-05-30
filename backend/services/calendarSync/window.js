const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function getSyncWindow(now = new Date()) {
  const today = startOfUtcDay(now);
  const start = new Date(today.getTime() - 30 * DAY_MS);
  const endBase = new Date(today.getTime() + 180 * DAY_MS);
  const end = endOfUtcDay(endBase);

  return {
    startDate: dateOnly(start),
    endDate: dateOnly(end),
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
  };
}

module.exports = {
  getSyncWindow,
};
