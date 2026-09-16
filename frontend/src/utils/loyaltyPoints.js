const INDIA_TIME_ZONE = "Asia/Kolkata";
const indiaDayKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const dayNumber = (value) => {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
};

export const calculateLoyaltyPoints = (assets = [], asOf = new Date()) => {
  const uploadDays = new Set(
    assets
      .map((asset) => asset?.created_at ?? asset?.uploaded_at)
      .map(indiaDayKey)
      .filter(Boolean)
  );
  const today = new Date(asOf);
  const todayKey = indiaDayKey(today);
  if (!todayKey || uploadDays.size === 0) return 0;

  const firstUploadTime = Math.min(...[...uploadDays].map((value) => {
    return dayNumber(value);
  }));
  const cursor = new Date(firstUploadTime);
  const endKey = indiaDayKey(today);
  const end = new Date(dayNumber(endKey));
  let points = 0;

  while (cursor <= end) {
    const cursorKey = cursor.toISOString().slice(0, 10);
    points = Math.max(0, points + (uploadDays.has(cursorKey) ? 1 : -1));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return points;
};
