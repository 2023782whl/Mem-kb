import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TopbarPanelTrigger, TOPBAR_PANEL_SLOT_ID } from "./TopbarPanelTrigger";

describe("TopbarPanelTrigger", () => {
  it("renders into the page title slot", async () => {
    const onOpen = vi.fn();
    const slot = document.createElement("div");
    slot.id = TOPBAR_PANEL_SLOT_ID;
    document.body.append(slot);

    render(<TopbarPanelTrigger label="展开知识空间" expanded={false} onToggle={onOpen} />);
    const button = await screen.findByRole("button", { name: "展开知识空间" });

    expect(button.parentElement).toBe(slot);
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();

    slot.remove();
  });
});
