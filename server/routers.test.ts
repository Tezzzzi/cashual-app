import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createMockUser(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 1,
    openId: "test-user-123",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    telegramId: "12345",
    telegramUsername: "testuser",
    telegramFirstName: "Test",
    telegramLastName: "User",
    telegramPhotoUrl: null,
    preferredLanguage: "ru",
    preferredCurrency: "AZN",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
}

function createAuthContext(
  userOverrides?: Partial<AuthenticatedUser>
): { ctx: TrpcContext; clearedCookies: any[] } {
  const clearedCookies: any[] = [];
  const user = createMockUser(userOverrides);

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as TrpcContext["res"],
  };
}

describe("auth.me", () => {
  it("returns null for unauthenticated user", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("returns user data for authenticated user", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).not.toBeNull();
    expect(result?.openId).toBe("test-user-123");
    expect(result?.name).toBe("Test User");
  });
});

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({
      maxAge: -1,
    });
  });
});

describe("categories", () => {
  it("rejects unauthenticated access to categories.list", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.categories.list()).rejects.toThrow();
  });

  it("rejects unauthenticated access to categories.create", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.categories.create({ name: "Test", icon: "🧪", color: "#fff", type: "both" })
    ).rejects.toThrow();
  });
});

describe("transactions", () => {
  it("rejects unauthenticated access to transactions.list", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.transactions.list()).rejects.toThrow();
  });

  it("rejects unauthenticated access to transactions.create", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.transactions.create({
        categoryId: 1,
        type: "expense",
        amount: "100",
        date: Date.now(),
      })
    ).rejects.toThrow();
  });

  it("validates transaction type enum", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.transactions.create({
        categoryId: 1,
        type: "invalid" as any,
        amount: "100",
        date: Date.now(),
      })
    ).rejects.toThrow();
  });
});

describe("family", () => {
  it("rejects unauthenticated access to family.myGroups", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.family.myGroups()).rejects.toThrow();
  });

  it("rejects unauthenticated access to family.create", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.family.create({ name: "Test Family" })).rejects.toThrow();
  });

  it("validates family group name is non-empty", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.family.create({ name: "" })).rejects.toThrow();
  });
});

describe("reports", () => {
  it("rejects unauthenticated access to reports.summary", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.reports.summary()).rejects.toThrow();
  });

  it("rejects unauthenticated access to reports.byCategory", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.reports.byCategory()).rejects.toThrow();
  });

  it("rejects unauthenticated access to reports.exportCsv", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.reports.exportCsv()).rejects.toThrow();
  });
});

describe("voice", () => {
  it("rejects unauthenticated access to voice.uploadAudio", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.voice.uploadAudio({ audioBase64: "dGVzdA==", mimeType: "audio/webm" })
    ).rejects.toThrow();
  });

  it("rejects unauthenticated access to voice.transcribeAndParse", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.voice.transcribeAndParse({ audioUrl: "https://example.com/audio.webm" })
    ).rejects.toThrow();
  });
});

describe("settings", () => {
  it("rejects unauthenticated access to settings.update", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.settings.update({ preferredLanguage: "en" })
    ).rejects.toThrow();
  });
});
