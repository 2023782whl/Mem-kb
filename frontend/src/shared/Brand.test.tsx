import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Brand } from "./Brand";

describe("Brand", () => {
  it("uses the product logo", () => {
    const { container } = render(<Brand compact />);

    const logo = container.querySelector("img");
    expect(logo).not.toBeNull();
    expect(logo).toHaveClass("product-logo");
    expect(logo?.getAttribute("src")).toContain("product_logo.png");
  });
});
