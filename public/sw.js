const NOTIFICATION_TITLE = "마감 알림";

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = {
      title: NOTIFICATION_TITLE,
      body: event.data ? event.data.text() : "마감 시간이 다가왔어요.",
    };
  }

  const title = payload.title || NOTIFICATION_TITLE;
  const options = {
    body: payload.body || "마감 시간이 다가왔어요.",
    tag: payload.tag || `hello-eomji-${Date.now()}`,
    renotify: true,
    data: {
      url: payload.url || "/",
      taskId: payload.taskId || "",
      deadlineAt: payload.deadlineAt || 0,
    },
    icon: "/app-icon-192.png",
    badge: "/app-icon-128.png",
    vibrate: [120, 60, 120],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.notification.close();
  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({
      includeUncontrolled: true,
      type: "window",
    });

    for (const client of windowClients) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) {
          await client.navigate(targetUrl);
        }
        return;
      }
    }

    if (clients.openWindow) {
      await clients.openWindow(targetUrl);
    }
  })());
});
