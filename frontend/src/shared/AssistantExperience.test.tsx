import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ASSISTANT_TIMEOUT_MINUTES, AssistantGenerationStatus, formatAssistantError } from "./AssistantExperience";

describe("AssistantExperience", () => {
  it("turns browser timeout errors into actionable Chinese copy", () => {
    expect(formatAssistantError(new Error("The operation was aborted due to timeout"))).toContain(`${ASSISTANT_TIMEOUT_MINUTES} 分钟`);
    expect(formatAssistantError(new Error("The operation was aborted due to timeout"))).not.toContain("aborted");
  });

  it("shows elapsed time and the maximum wait while generating", () => {
    render(<AssistantGenerationStatus startedAt={Date.now() - 12_000} />);
    expect(screen.getByRole("status")).toHaveTextContent("最长等待 15 分钟");
    expect(screen.getByRole("status")).toHaveTextContent(/已用 00:1[12]/);
  });
});
