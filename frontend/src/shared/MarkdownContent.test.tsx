import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent document media", () => {
  beforeEach(() => {
    vi.spyOn(api, "assetMediaBlob").mockResolvedValue(new Blob(["image"], { type: "image/png" }));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:document-image") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  it("loads protected document images through the authenticated API", async () => {
    render(<StrictMode><MarkdownContent source="![流程图](/api/assets/asset-1/media/media-1)" /></StrictMode>);
    await waitFor(() => expect(screen.getByAltText("流程图")).toHaveAttribute("src", "blob:document-image"));
    expect(api.assetMediaBlob).toHaveBeenCalledWith("asset-1", "media-1", expect.any(AbortSignal));
  });
});
