import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResizeHandle } from "./ResizeHandle";

describe("ResizeHandle", () => {
  it("supports keyboard resizing and reset", () => {
    const onDelta = vi.fn();
    const onReset = vi.fn();
    render(<ResizeHandle label="调整图谱宽度" onDelta={onDelta} onReset={onReset} />);
    const handle = screen.getByRole("separator", { name: "调整图谱宽度" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.doubleClick(handle);
    expect(onDelta).toHaveBeenNthCalledWith(1, 16);
    expect(onDelta).toHaveBeenNthCalledWith(2, -16);
    expect(onReset).toHaveBeenCalledOnce();
  });
});
