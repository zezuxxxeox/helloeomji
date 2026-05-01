export const APPROACH_DURATION_MS = 6000;

function isBlankText(text) {
  return typeof text !== "string" || text.trim().length === 0;
}

function isValidFutureDeadline(deadlineAt, now) {
  return Number.isFinite(deadlineAt) && deadlineAt > now;
}

function getNextTaskId(tasks) {
  const nextNumber =
    tasks.reduce((largestNumber, task) => {
      const match = /^task-(\d+)$/.exec(task.id);
      const taskNumber = match ? Number(match[1]) : 0;
      return Math.max(largestNumber, taskNumber);
    }, 0) + 1;

  return `task-${nextNumber}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getDayStart(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getTaskActiveStart(task) {
  return Math.max(task.createdAt, getDayStart(task.deadlineAt));
}

export function addTask(tasks, text, deadlineAt, now) {
  if (isBlankText(text) || !isValidFutureDeadline(deadlineAt, now)) {
    return tasks;
  }

  return [
    ...tasks,
    {
      id: getNextTaskId(tasks),
      text: text.trim(),
      createdAt: now,
      deadlineAt,
      status: "active",
      completedAt: null,
      failedAt: null,
      pettedAt: null,
    },
  ];
}

export function completeTask(tasks, id, now) {
  let changed = false;

  const nextTasks = tasks.map((task) => {
    if (task.id !== id || task.status !== "active" || now > task.deadlineAt) {
      return task;
    }

    changed = true;

    return {
      ...task,
      status: "completed",
      completedAt: now,
    };
  });

  return changed ? nextTasks : tasks;
}

export function failOverdueTasks(tasks, now) {
  let changed = false;

  const nextTasks = tasks.map((task) => {
    if (task.status !== "active" || task.deadlineAt >= now) {
      return task;
    }

    changed = true;

    return {
      ...task,
      status: "failed",
      failedAt: now,
    };
  });

  return changed ? nextTasks : tasks;
}

export function deleteTask(tasks, id) {
  return tasks.filter((task) => task.id !== id);
}

export function calculateCatApproach(task, now, durationMs = APPROACH_DURATION_MS) {
  if (task.status === "petted") {
    return 1;
  }

  if (task.status === "failed") {
    return 0;
  }

  const activeStart = getTaskActiveStart(task);
  const travelDuration = task.deadlineAt - activeStart;

  if (travelDuration <= 0) {
    return 0;
  }

  return clamp((now - activeStart) / travelDuration, 0, 1);
}

export function canPetCat(task, now, durationMs = APPROACH_DURATION_MS) {
  return (
    task.status === "completed" &&
    task.pettedAt === null &&
    calculateCatApproach(task, now, durationMs) === 1
  );
}

export function petCat(tasks, id, now, durationMs = APPROACH_DURATION_MS) {
  let changed = false;

  const nextTasks = tasks.map((task) => {
    if (task.id !== id || !canPetCat(task, now, durationMs)) {
      return task;
    }

    changed = true;

    return {
      ...task,
      status: "petted",
      pettedAt: now,
    };
  });

  return changed ? nextTasks : tasks;
}

export function calculateCatPerspective(task, now, durationMs = APPROACH_DURATION_MS) {
  const approachRatio = calculateCatApproach(task, now, durationMs);

  if (task.status === "failed") {
    return {
      approachRatio,
      scale: 0.28,
      translateY: -42,
      opacity: 0.34,
      zIndex: 5,
      shadowStrength: 0.08,
    };
  }

  return {
    approachRatio,
    scale: 0.48 + approachRatio * 1.72,
    translateY: approachRatio * 172,
    opacity: 0.72 + approachRatio * 0.28,
    zIndex: Math.round(10 + approachRatio * 90),
    shadowStrength: 0.18 + approachRatio * 0.72,
  };
}

export function calculateStats(tasks) {
  return tasks.reduce(
    (stats, task) => ({
      activeCount: stats.activeCount + (task.status === "active" ? 1 : 0),
      completedCount:
        stats.completedCount + (task.status === "completed" || task.status === "petted" ? 1 : 0),
      pettedCount: stats.pettedCount + (task.status === "petted" || task.pettedAt !== null ? 1 : 0),
      returnedCatCount: stats.returnedCatCount + (task.status === "failed" ? 1 : 0),
    }),
    {
      activeCount: 0,
      completedCount: 0,
      pettedCount: 0,
      returnedCatCount: 0,
    },
  );
}
