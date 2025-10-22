import {
  clearStoredThreadId,
  loadStoredThreadId,
  persistStoredThreadId,
} from "../chatkitThread";

const OWNER_ID = "owner-1";

describe("chatkitThread", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("garde des fils distincts par workflow", () => {
    persistStoredThreadId(OWNER_ID, "thread-global", null);
    persistStoredThreadId(OWNER_ID, "thread-weather", "weather");
    persistStoredThreadId(OWNER_ID, "thread-support", "support");

    expect(loadStoredThreadId(OWNER_ID, null)).toBe("thread-global");
    expect(loadStoredThreadId(OWNER_ID, "weather")).toBe("thread-weather");
    expect(loadStoredThreadId(OWNER_ID, "support")).toBe("thread-support");

    persistStoredThreadId(OWNER_ID, "thread-weather-v2", "weather");
    expect(loadStoredThreadId(OWNER_ID, "weather")).toBe("thread-weather-v2");
    expect(loadStoredThreadId(OWNER_ID, "support")).toBe("thread-support");

    clearStoredThreadId(OWNER_ID, "weather");
    expect(loadStoredThreadId(OWNER_ID, "weather")).toBeNull();
    expect(loadStoredThreadId(OWNER_ID, "support")).toBe("thread-support");
    expect(loadStoredThreadId(OWNER_ID, null)).toBe("thread-global");
  });

  it("migre l'ancienne clé globale vers la clé spécifique au workflow", () => {
    window.localStorage.setItem("chatkit:last-thread:owner-1", "legacy-thread");

    expect(loadStoredThreadId(OWNER_ID, "weather")).toBe("legacy-thread");
    expect(window.localStorage.getItem("chatkit:last-thread:owner-1")).toBeNull();
    expect(window.localStorage.getItem("chatkit:last-thread:owner-1:weather")).toBe(
      "legacy-thread",
    );

    expect(loadStoredThreadId(OWNER_ID, "support")).toBeNull();

    persistStoredThreadId(OWNER_ID, "thread-support", "support");
    expect(loadStoredThreadId(OWNER_ID, "support")).toBe("thread-support");
    expect(loadStoredThreadId(OWNER_ID, "weather")).toBe("legacy-thread");

    persistStoredThreadId(OWNER_ID, null, "support");
    expect(loadStoredThreadId(OWNER_ID, "support")).toBeNull();
  });
});
