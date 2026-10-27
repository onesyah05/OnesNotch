import { beforeEach, describe, expect, it } from "vitest";
import { useNotificationStore } from "./useNotificationStore";

describe("useNotificationStore", () => {
  beforeEach(() => {
    useNotificationStore.setState({
      notifications: [],
      activePopup: null,
      settings: {
        enabled: true,
        dndEnabled: false,
        autoDismissSeconds: 5,
        allowedApps: ["WhatsApp", "Telegram", "Discord"],
      },
    });
  });

  it("stores and displays incoming notifications", async () => {
    await useNotificationStore.getState().simulateNotification("WhatsApp", "John", "Hello there");
    const state = useNotificationStore.getState();
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]!.appName).toBe("WhatsApp");
    expect(state.notifications[0]!.title).toBe("John");
    expect(state.activePopup).not.toBeNull();
    expect(state.activePopup?.title).toBe("John");
  });

  it("dismisses popup and notification", async () => {
    await useNotificationStore.getState().simulateNotification("Telegram", "Group", "New message");
    const notifId = useNotificationStore.getState().notifications[0]!.id;

    useNotificationStore.getState().dismissPopup();
    expect(useNotificationStore.getState().activePopup).toBeNull();
    expect(useNotificationStore.getState().notifications).toHaveLength(1);

    await useNotificationStore.getState().dismissNotification(notifId);
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it("respects DND mode and only triggers popup for allowed apps", async () => {
    await useNotificationStore.getState().toggleDnd();
    expect(useNotificationStore.getState().settings.dndEnabled).toBe(true);

    // Slack is not in allowedApps -> no popup, but recorded in list
    await useNotificationStore.getState().simulateNotification("Slack", "Channel", "Work alert");
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    expect(useNotificationStore.getState().activePopup).toBeNull();

    // WhatsApp is in allowedApps -> triggers popup even under DND
    await useNotificationStore.getState().simulateNotification("WhatsApp", "Mom", "Call me");
    expect(useNotificationStore.getState().notifications).toHaveLength(2);
    expect(useNotificationStore.getState().activePopup?.appName).toBe("WhatsApp");
  });

  it("clears all notifications", async () => {
    await useNotificationStore.getState().simulateNotification("Discord", "Bot", "Ping");
    expect(useNotificationStore.getState().notifications).toHaveLength(1);

    await useNotificationStore.getState().clearAll();
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
    expect(useNotificationStore.getState().activePopup).toBeNull();
  });
});
