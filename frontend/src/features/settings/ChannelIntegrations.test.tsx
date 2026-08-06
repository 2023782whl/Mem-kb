import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { ChannelBinding, User, Workspace } from "../../types/domain";
import { ChannelIntegrations } from "./ChannelIntegrations";

const binding: ChannelBinding = {
  id: "channel-expired",
  tenant_id: "tenant-demo",
  created_by: "user-admin",
  channel: "wechat",
  workspace_ids: ["workspace-demo"],
  workspace_names: ["运营知识库"],
  status: "expired",
  connected: false,
  config: {},
  last_connected_at: null,
  created_at: "2026-08-05T00:00:00.000Z",
  updated_at: "2026-08-05T00:00:00.000Z"
};

const workspace = {
  id: "workspace-demo",
  name: "运营知识库",
  scope: "team",
  status: "active",
  kind: "document",
  asset_count: 2
} as Workspace;

const user = {
  id: "user-admin",
  name: "管理员",
  status: "active",
  role: "admin"
} as User;

afterEach(() => vi.restoreAllMocks());

describe("ChannelIntegrations", () => {
  it("deletes an expired channel after explicit confirmation", async () => {
    vi.spyOn(api, "channels")
      .mockResolvedValueOnce({ bindings: [binding] })
      .mockResolvedValue({ bindings: [] });
    vi.spyOn(api, "workspaces").mockResolvedValue({ workspaces: [workspace] });
    vi.spyOn(api, "users").mockResolvedValue({ users: [user] });
    const remove = vi.spyOn(api, "deleteChannel").mockResolvedValue({ ok: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ChannelIntegrations />);

    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(binding.id));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("无法恢复"));
    expect(await screen.findByText("尚未接入渠道")).toBeVisible();
  });
});
