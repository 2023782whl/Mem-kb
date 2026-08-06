import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePersistentBoolean, usePersistentNumber } from "./usePersistentState";

describe("persistent UI state", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists a collapsed sidebar preference", () => {
    const { result, unmount } = renderHook(() => usePersistentBoolean("sidebar", true));
    act(() => result.current[1](false));
    expect(window.localStorage.getItem("sidebar")).toBe("0");
    unmount();
    const restored = renderHook(() => usePersistentBoolean("sidebar", true));
    expect(restored.result.current[0]).toBe(false);
  });

  it("clamps persisted pane widths", () => {
    const { result } = renderHook(() => usePersistentNumber("pane", 300, 200, 500));
    act(() => result.current[1](900));
    expect(result.current[0]).toBe(500);
    expect(window.localStorage.getItem("pane")).toBe("500");
  });
});
