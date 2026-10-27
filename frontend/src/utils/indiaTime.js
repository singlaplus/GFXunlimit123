export const INDIA_TIME_ZONE = "Asia/Kolkata";

const getIndiaDateParts = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIME_ZONE,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
};

export const getIndiaDateKey = (value = new Date()) => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parts = getIndiaDateParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
};

export const formatIndiaDate = (value, options = { dateStyle: "medium" }) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: INDIA_TIME_ZONE }).format(date);
};

export const formatIndiaTime = (value, options = { hour: "numeric", minute: "2-digit" }) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: INDIA_TIME_ZONE }).format(date);
};

export const formatIndiaDateTime = (value, options = { dateStyle: "medium", timeStyle: "short" }) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: INDIA_TIME_ZONE }).format(date);
};

export const formatIndiaDateTimeLocal = (value) => {
  const parts = getIndiaDateParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` : "";
};

export const indiaDateTimeLocalToISOString = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const [, yearValue, monthValue, dayValue, hourValue, minuteValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const utcMilliseconds = Date.UTC(year, month - 1, day, hour, minute) - (5 * 60 + 30) * 60 * 1000;
  const date = new Date(utcMilliseconds);
  const parts = getIndiaDateParts(date);
  if (!parts
    || Number(parts.year) !== year
    || Number(parts.month) !== month
    || Number(parts.day) !== day
    || Number(parts.hour) !== hour
    || Number(parts.minute) !== minute) {
    return null;
  }
  return date.toISOString();
};
