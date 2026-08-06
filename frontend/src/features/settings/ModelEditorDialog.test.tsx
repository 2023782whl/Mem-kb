import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelEditorDialog } from "./ModelEditorDialog";

describe("ModelEditorDialog", () => {
  it("requires the core fields and surfaces verification failures", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("网关连接失败"));
    render(<ModelEditorDialog open config={null} onCancel={vi.fn()} onSave={onSave} onComplete={vi.fn()} />);

    const submit = screen.getByRole("button", { name: "保存并验证" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("显示名称"), { target: { value: "企业模型" } });
    fireEvent.change(screen.getByLabelText("模型标识"), { target: { value: "model-enterprise" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "test-key" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(onSave).toHaveBeenCalledOnce();
    expect(await screen.findByText("网关连接失败")).toBeInTheDocument();
  });
});
