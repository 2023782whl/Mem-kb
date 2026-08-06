import { describe, expect, it } from "vitest";
import { placeSelectionAction } from "./selectionPosition";

describe("selection action placement", () => {
  it("stays close to the selected text when there is room above", () => {
    expect(placeSelectionAction(
      { left: 300, right: 340, top: 280, bottom: 300 },
      { left: 420, right: 470, top: 320, bottom: 340 },
      { width: 900, height: 700 }
    )).toEqual({ left: 322, top: 235 });
  });

  it("moves below and clamps to a zoomed visual viewport", () => {
    const point = placeSelectionAction(
      { left: 20, right: 40, top: 12, bottom: 30 },
      { left: 40, right: 70, top: 12, bottom: 30 },
      { width: 320, height: 240, offsetLeft: 15, offsetTop: 8 }
    );
    expect(point.left).toBe(25);
    expect(point.top).toBe(39);
  });
});
