import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import webPush from "web-push";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_PATH = path.join(__dirname, "push-data.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const REMINDER_LEAD_MS = 10 * 60 * 1000;
const CHECK_INTERVAL_MS = 15 * 1000;
const DEFAULT_VAPID_SUBJECT = "mailto:hello-eomji@example.local";

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
]);

function getEnvVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    };
  }

  return null;
}

let store = await loadStore();
webPush.setVapidDetails(
  process.env.VAPID_SUBJECT || store.vapidSubject || DEFAULT_VAPID_SUBJECT,
  store.vapidKeys.publicKey,
  store.vapidKeys.privateKey,
);

function createEmptyStore() {
  return {
    vapidSubject: process.env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT,
    vapidKeys: webPush.generateVAPIDKeys(),
    subscriptions: [],
    reminders: [],
  };
}

async function loadStore() {
  const envVapidKeys = getEnvVapidKeys();

  try {
    const saved = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
    if ((envVapidKeys || saved?.vapidKeys?.publicKey) && (envVapidKeys || saved?.vapidKeys?.privateKey)) {
      return {
        vapidSubject: saved.vapidSubject || DEFAULT_VAPID_SUBJECT,
        vapidKeys: envVapidKeys || saved.vapidKeys,
        subscriptions: Array.isArray(saved.subscriptions) ? saved.subscriptions : [],
        reminders: Array.isArray(saved.reminders) ? saved.reminders : [],
      };
    }
  } catch (_) {}

  const nextStore = createEmptyStore();
  if (envVapidKeys) {
    nextStore.vapidKeys = envVapidKeys;
  }
  await saveStore(nextStore);
  return nextStore;
}

async function saveStore(nextStore = store) {
  await fs.writeFile(DATA_PATH, `${JSON.stringify(nextStore, null, 2)}\n`, "utf8");
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function readRequestJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("request body too large"));
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function normalizeSubscription(value) {
  if (
    !value ||
    typeof value.endpoint !== "string" ||
    !value.keys ||
    typeof value.keys.p256dh !== "string" ||
    typeof value.keys.auth !== "string"
  ) {
    return null;
  }

  return {
    endpoint: value.endpoint,
    expirationTime: Number.isFinite(value.expirationTime) ? value.expirationTime : null,
    keys: {
      p256dh: value.keys.p256dh,
      auth: value.keys.auth,
    },
  };
}

function upsertSubscription(subscription) {
  const savedSubscription = {
    ...subscription,
    lastSeenAt: Date.now(),
  };
  store.subscriptions = [
    savedSubscription,
    ...store.subscriptions.filter((item) => item.endpoint !== subscription.endpoint),
  ];
  return savedSubscription;
}

function hashEndpoint(endpoint) {
  return crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 16);
}

function normalizeReminderTask(task) {
  if (
    !task ||
    typeof task.id !== "string" ||
    typeof task.text !== "string" ||
    task.status !== "active" ||
    !Number.isFinite(task.deadlineAt) ||
    task.deadlineAt <= Date.now()
  ) {
    return null;
  }

  return {
    id: task.id,
    text: task.text.trim() || "할 일",
    createdAt: Number.isFinite(task.createdAt) ? task.createdAt : Date.now(),
    deadlineAt: task.deadlineAt,
  };
}

function getReminderAt(deadlineAt) {
  return Math.max(Date.now() + 1000, deadlineAt - REMINDER_LEAD_MS);
}

async function sendPushNotification(subscription, payload, ttlSeconds = 3600) {
  await webPush.sendNotification(subscription, JSON.stringify(payload), {
    TTL: ttlSeconds,
    urgency: "high",
  });
}

function syncReminders(subscription, tasks) {
  const endpointHash = hashEndpoint(subscription.endpoint);
  const normalizedTasks = Array.isArray(tasks)
    ? tasks.map(normalizeReminderTask).filter(Boolean)
    : [];
  const activeReminderIds = new Set();
  const untouchedReminders = store.reminders.filter(
    (reminder) => reminder.subscriptionEndpoint !== subscription.endpoint,
  );
  const nextReminders = normalizedTasks.map((task) => {
    const id = `${endpointHash}:${task.id}:${task.deadlineAt}`;
    activeReminderIds.add(id);
    const existing = store.reminders.find((reminder) => reminder.id === id);

    return {
      ...existing,
      id,
      subscriptionEndpoint: subscription.endpoint,
      taskId: task.id,
      taskText: task.text,
      createdAt: task.createdAt,
      deadlineAt: task.deadlineAt,
      reminderAt: getReminderAt(task.deadlineAt),
      status: existing?.status === "sent" ? "sent" : "pending",
      tag: `today-cat-${task.id}-${task.deadlineAt}`,
      updatedAt: Date.now(),
    };
  });

  store.reminders = [
    ...untouchedReminders,
    ...nextReminders.filter((reminder) => reminder.status !== "sent" || reminder.deadlineAt > Date.now()),
  ];

  return {
    pendingCount: nextReminders.filter((reminder) => reminder.status === "pending").length,
    syncedCount: activeReminderIds.size,
  };
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/push/public-key") {
    sendJson(response, 200, {
      publicKey: store.vapidKeys.publicKey,
      leadMs: REMINDER_LEAD_MS,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/push/subscribe") {
    const body = await readRequestJson(request);
    const subscription = normalizeSubscription(body.subscription);

    if (!subscription) {
      sendJson(response, 400, { error: "invalid subscription" });
      return;
    }

    upsertSubscription(subscription);
    await saveStore();
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/push/reminders") {
    const body = await readRequestJson(request);
    const subscription = normalizeSubscription(body.subscription);

    if (!subscription) {
      sendJson(response, 400, { error: "invalid subscription" });
      return;
    }

    const savedSubscription = upsertSubscription(subscription);
    const result = syncReminders(savedSubscription, body.tasks);
    await saveStore();
    sendJson(response, 200, { ok: true, ...result });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/push/test") {
    const body = await readRequestJson(request);
    const subscription = normalizeSubscription(body.subscription);

    if (!subscription) {
      sendJson(response, 400, { error: "invalid subscription" });
      return;
    }

    upsertSubscription(subscription);
    await sendPushNotification(subscription, {
      title: "마감 알림 준비 완료",
      body: "앱을 닫아도 서버가 마감 알림을 보내줄 수 있어요.",
      tag: `hello-eomji-test-${Date.now()}`,
      url: "/",
    }, 300);
    await saveStore();
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/push/unsubscribe") {
    const body = await readRequestJson(request);
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    store.subscriptions = store.subscriptions.filter((item) => item.endpoint !== endpoint);
    store.reminders = store.reminders.filter((reminder) => reminder.subscriptionEndpoint !== endpoint);
    await saveStore();
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { error: "not found" });
}

async function findStaticFile(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const rootCandidate = path.resolve(__dirname, relativePath);
  const publicCandidate = path.resolve(PUBLIC_DIR, relativePath);

  for (const candidate of [rootCandidate, publicCandidate]) {
    if (!candidate.startsWith(__dirname) && !candidate.startsWith(PUBLIC_DIR)) {
      continue;
    }

    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch (_) {}
  }

  return path.join(__dirname, "index.html");
}

async function serveStatic(response, pathname) {
  const filePath = await findStaticFile(pathname);
  const extension = path.extname(filePath);
  const contentType = contentTypes.get(extension) || "application/octet-stream";

  response.writeHead(200, { "content-type": contentType });
  createReadStream(filePath).pipe(response);
}

function removeSubscription(endpoint) {
  store.subscriptions = store.subscriptions.filter((item) => item.endpoint !== endpoint);
  store.reminders = store.reminders.filter((reminder) => reminder.subscriptionEndpoint !== endpoint);
}

async function sendDueReminders() {
  const dueAt = Date.now();
  let changed = false;

  for (const reminder of store.reminders) {
    if (reminder.status !== "pending" || reminder.reminderAt > dueAt || reminder.deadlineAt <= dueAt) {
      continue;
    }

    const subscription = store.subscriptions.find(
      (item) => item.endpoint === reminder.subscriptionEndpoint,
    );

    if (!subscription) {
      reminder.status = "canceled";
      changed = true;
      continue;
    }

    try {
      await sendPushNotification(subscription, {
        title: "마감 알림",
        body: `${reminder.taskText} 마감시간이 10분 남았어요.`,
        tag: reminder.tag,
        taskId: reminder.taskId,
        deadlineAt: reminder.deadlineAt,
        url: "/",
      }, Math.max(60, Math.round((reminder.deadlineAt - dueAt) / 1000)));
      reminder.status = "sent";
      reminder.sentAt = Date.now();
      changed = true;
      console.log(`[push] sent reminder: ${reminder.taskText}`);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        removeSubscription(subscription.endpoint);
      } else {
        reminder.lastError = error.message;
        reminder.retryAt = Date.now() + CHECK_INTERVAL_MS;
      }
      changed = true;
      console.warn(`[push] reminder failed: ${error.message}`);
    }
  }

  store.reminders = store.reminders.filter((reminder) => (
    reminder.status === "pending" ||
    reminder.deadlineAt > Date.now() - 24 * 60 * 60 * 1000
  ));

  if (changed) {
    await saveStore();
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(response, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "server error" });
  }
});

setInterval(() => {
  sendDueReminders().catch((error) => {
    console.warn(`[push] scheduler failed: ${error.message}`);
  });
}, CHECK_INTERVAL_MS);

server.listen(PORT, HOST, () => {
  console.log(`HELLO EOMJI is running at http://${HOST}:${PORT}/`);
  console.log("Use HTTPS when installing this PWA on iOS for background Web Push.");
});
