function getZonedDateTimeParts(date, timeZone) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError('Date must be a valid Date instance.');
  }
  if (!timeZone) {
    throw new TypeError('A time zone is required.');
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)])
  );
}

function getZonedDateKey(date, timeZone) {
  const { year, month, day } = getZonedDateTimeParts(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getZonedTimeKey(date, timeZone) {
  const { hour, minute } = getZonedDateTimeParts(date, timeZone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

module.exports = { getZonedDateKey, getZonedDateTimeParts, getZonedTimeKey };
