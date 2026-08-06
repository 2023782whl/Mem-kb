import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "../types/domain";
import { ModelPicker } from "./ModelPicker";

const models: ModelInfo[] = [
  { id: "gpt", name: "gpt-5.5", modelName: "gpt-5.5", kind: "LLM", configured: true, supportsVision: true },
  { id: "claude", name: "claude-sonnet-4.6", modelName: "claude-sonnet-4.6", kind: "LLM", configured: true, supportsVision: false }
];

describe("ModelPicker", () => {
  it("shows provider marks and selects a model from the accessible menu", async () => {
    const onChange = vi.fn();
    render(<ModelPicker models={models} value="gpt" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "选择模型" }));
    expect(screen.getByRole("listbox", { name: "选择模型" })).toBeVisible();
    expect(screen.getByRole("option", { name: /claude-sonnet-4.6/ }).querySelector(".model-provider-badge img")).toBeTruthy();
    await userEvent.click(screen.getByRole("option", { name: /claude-sonnet-4.6/ }));
    expect(onChange).toHaveBeenCalledWith("claude");
  });
});
