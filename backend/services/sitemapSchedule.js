const fs = require("node:fs");
const path = require("node:path");
const cron = require("node-cron");

const SETTINGS_FILE = path.join(__dirname, "..", "settings", "sitemap-schedule.json");
const TIME_ZONE = "Asia/Kolkata";
const FREQUENCIES = new Set(["daily", "weekly", "monthly"]);
const WEEKDAYS = new Set([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);

function normalizeSitemapSchedule(schedule) {
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
    throw new TypeError("A sitemap schedule configuration is required.");
  }
  const { enabled, frequency, time, weekday, monthDay } = schedule;
  if (typeof enabled !== "boolean") {
    throw new TypeError("Sitemap schedule enabled must be a boolean.");
  }
  if (!FREQUENCIES.has(frequency)) {
    throw new TypeError("Sitemap frequency must be daily, weekly, or monthly.");
  }
  if (typeof time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new TypeError("Sitemap time must be a valid 24-hour HH:MM time.");
  }

  const normalized = { enabled, frequency, time };
  if (frequency === "weekly") {
    if (typeof weekday !== "string" || !WEEKDAYS.has(weekday.toLowerCase())) {
      throw new TypeError("Choose a valid weekday for weekly sitemap generation.");
    }
    normalized.weekday = weekday.toLowerCase();
  }
  if (frequency === "monthly") {
    const parsedMonthDay = Number(monthDay);
    if (!Number.isInteger(parsedMonthDay) || parsedMonthDay < 1 || parsedMonthDay > 31) {
      throw new TypeError("Choose a monthly sitemap date between 1 and 31.");
    }
    normalized.monthDay = parsedMonthDay;
  }
  return normalized;
}

function createSitemapScheduleSettings(filePath = SETTINGS_FILE) {
  return {
    get() {
      try {
        return normalizeSitemapSchedule(JSON.parse(fs.readFileSync(filePath, "utf8")));
      } catch (error) {
        if (error.code === "ENOENT") {
          return { enabled: false, frequency: "daily", time: "02:00" };
        }
        throw error;
      }
    },
    set(schedule) {
      const normalizedSchedule = normalizeSitemapSchedule(schedule);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(temporaryPath, `${JSON.stringify(normalizedSchedule, null, 2)}\n`, {
          flag: "w",
          mode: 0o600,
        });
        fs.renameSync(temporaryPath, filePath);
      } catch (error) {
        fs.rmSync(temporaryPath, { force: true });
        throw error;
      }
      return normalizedSchedule;
    },
  };
}

function getTimeZoneParts(date, timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "long",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function isScheduleDue(schedule, date = new Date()) {
  const parts = getTimeZoneParts(date);
  const [scheduleHour, scheduleMinute] = schedule.time.split(":").map(Number);
  if (Number(parts.hour) !== scheduleHour || Number(parts.minute) !== scheduleMinute) return false;
  if (schedule.frequency === "daily") return true;
  if (schedule.frequency === "weekly") return parts.weekday.toLowerCase() === schedule.weekday;
  const selectedDay = schedule.monthDay;
  const currentDay = Number(parts.day);
  if (currentDay === selectedDay) return true;
  const daysInMonth = new Date(Date.UTC(Number(parts.year), Number(parts.month), 0)).getUTCDate();
  return selectedDay > daysInMonth && currentDay === daysInMonth;
}

function createSitemapScheduler({
  settings,
  generator,
  cronScheduler = cron,
  clock = () => new Date(),
  logger = console,
}) {
  let scheduledTask = null;

  const configureSchedule = (schedule) => {
    if (scheduledTask) {
      scheduledTask.stop();
      scheduledTask = null;
    }
    if (!schedule.enabled) return;

    const [hour, minute] = schedule.time.split(":").map(Number);
    scheduledTask = cronScheduler.schedule(`${minute} ${hour} * * *`, async () => {
      if (!isScheduleDue(schedule, clock())) return;
      try {
        generator.start();
      } catch (error) {
        if (error.statusCode === 409) {
          logger.warn("Scheduled sitemap generation skipped because another generation is already in progress.");
          return;
        }
        logger.error("Unable to start scheduled sitemap generation", error);
      }
    }, { timezone: TIME_ZONE });
  };

  return {
    start() {
      const schedule = settings.get();
      configureSchedule(schedule);
      return schedule;
    },
    getSettings() {
      return settings.get();
    },
    save(schedule) {
      const savedSchedule = settings.set(schedule);
      configureSchedule(savedSchedule);
      return savedSchedule;
    },
    stop() {
      if (!scheduledTask) return;
      scheduledTask.stop();
      scheduledTask = null;
    },
  };
}

module.exports = {
  TIME_ZONE,
  createSitemapScheduleSettings,
  createSitemapScheduler,
  getTimeZoneParts,
  isScheduleDue,
  normalizeSitemapSchedule,
};
