const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  TIME_ZONE,
  createSitemapScheduleSettings,
  createSitemapScheduler,
  isScheduleDue,
} = require("../services/sitemapSchedule");

function createFakeCron() {
  const tasks = [];
  return {
    tasks,
    schedule(expression, callback, options) {
      const task = {
        expression,
        callback,
        options,
        stopped: false,
        stop() {
          this.stopped = true;
        },
      };
      tasks.push(task);
      return task;
    },
  };
}

test("persists validated daily, weekly, and monthly sitemap schedule settings", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sitemap-schedule-settings-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const settings = createSitemapScheduleSettings(path.join(directory, "schedule.json"));

  assert.deepEqual(settings.get(), { enabled: false, frequency: "daily", time: "02:00" });
  assert.deepEqual(settings.set({
    enabled: true,
    frequency: "weekly",
    time: "21:30",
    weekday: "Wednesday",
  }), {
    enabled: true,
    frequency: "weekly",
    time: "21:30",
    weekday: "wednesday",
  });
  assert.deepEqual(settings.set({
    enabled: true,
    frequency: "monthly",
    time: "03:05",
    monthDay: 31,
  }), {
    enabled: true,
    frequency: "monthly",
    time: "03:05",
    monthDay: 31,
  });
});

test("rejects incomplete and invalid sitemap schedule choices", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sitemap-invalid-schedule-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const settings = createSitemapScheduleSettings(path.join(directory, "schedule.json"));

  assert.throws(() => settings.set({ enabled: true, frequency: "weekly", time: "09:00" }), /valid weekday/);
  assert.throws(() => settings.set({ enabled: true, frequency: "monthly", time: "09:00", monthDay: 32 }), /between 1 and 31/);
  assert.throws(() => settings.set({ enabled: true, frequency: "daily", time: "25:00" }), /HH:MM/);
});

test("evaluates the selected schedule in IST and runs monthly dates on month-end when needed", () => {
  const wednesdayAt2130Ist = new Date("2026-10-28T16:00:00.000Z");
  const sundayAt2130Ist = new Date("2026-11-01T16:00:00.000Z");
  const octoberEndAt2130Ist = new Date("2026-10-31T16:00:00.000Z");

  assert.equal(TIME_ZONE, "Asia/Kolkata");
  assert.equal(isScheduleDue({ frequency: "daily", time: "21:30" }, wednesdayAt2130Ist), true);
  assert.equal(isScheduleDue({
    frequency: "weekly",
    time: "21:30",
    weekday: "wednesday",
  }, wednesdayAt2130Ist), true);
  assert.equal(isScheduleDue({
    frequency: "weekly",
    time: "21:30",
    weekday: "monday",
  }, wednesdayAt2130Ist), false);
  assert.equal(isScheduleDue({
    frequency: "monthly",
    time: "21:30",
    monthDay: 31,
  }, octoberEndAt2130Ist), true);
  assert.equal(isScheduleDue({
    frequency: "monthly",
    time: "21:30",
    monthDay: 31,
  }, sundayAt2130Ist), false);
  assert.equal(isScheduleDue({ frequency: "daily", time: "21:31" }, wednesdayAt2130Ist), false);
});

test("installs, reschedules, disables, and invokes the automatic sitemap job in IST", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sitemap-schedule-runtime-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const settings = createSitemapScheduleSettings(path.join(directory, "schedule.json"));
  const fakeCron = createFakeCron();
  const startedJobs = [];
  const warnings = [];
  const errors = [];
  const scheduler = createSitemapScheduler({
    settings,
    generator: {
      start() {
        startedJobs.push(true);
        return { id: "scheduled-job" };
      },
    },
    cronScheduler: fakeCron,
    clock: () => new Date("2026-10-28T16:00:00.000Z"),
    logger: {
      warn: (message) => warnings.push(message),
      error: (message, error) => errors.push({ message, error }),
    },
  });

  scheduler.start();
  assert.equal(fakeCron.tasks.length, 0);

  scheduler.save({
    enabled: true,
    frequency: "weekly",
    time: "21:30",
    weekday: "wednesday",
  });
  assert.equal(fakeCron.tasks.length, 1);
  assert.equal(fakeCron.tasks[0].expression, "30 21 * * *");
  assert.deepEqual(fakeCron.tasks[0].options, { timezone: TIME_ZONE });
  await fakeCron.tasks[0].callback();
  assert.equal(startedJobs.length, 1);

  scheduler.save({
    enabled: true,
    frequency: "weekly",
    time: "21:30",
    weekday: "monday",
  });
  assert.equal(fakeCron.tasks[0].stopped, true);
  await fakeCron.tasks[1].callback();
  assert.equal(startedJobs.length, 1);

  scheduler.save({ enabled: false, frequency: "daily", time: "21:30" });
  assert.equal(fakeCron.tasks[1].stopped, true);
  assert.equal(fakeCron.tasks.length, 2);

  scheduler.save({
    enabled: true,
    frequency: "daily",
    time: "21:30",
  });
  const currentTask = fakeCron.tasks.at(-1);
  await currentTask.callback();
  assert.equal(startedJobs.length, 2);
  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 0);
  scheduler.stop();
  assert.equal(currentTask.stopped, true);
});

test("reports a busy generator when an automatic schedule fires during another run", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sitemap-schedule-busy-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fakeCron = createFakeCron();
  const warnings = [];
  const scheduler = createSitemapScheduler({
    settings: createSitemapScheduleSettings(path.join(directory, "schedule.json")),
    generator: {
      start() {
        const error = new Error("Already running");
        error.statusCode = 409;
        throw error;
      },
    },
    cronScheduler: fakeCron,
    clock: () => new Date("2026-10-28T16:00:00.000Z"),
    logger: { warn: (message) => warnings.push(message), error: () => assert.fail("Unexpected scheduler error") },
  });
  scheduler.save({ enabled: true, frequency: "daily", time: "21:30" });

  await fakeCron.tasks[0].callback();
  assert.equal(warnings.length, 1);
  scheduler.stop();
});
