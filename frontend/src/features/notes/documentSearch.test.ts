import { describe, expect, it } from "vitest";
import { findTextMatches } from "./documentSearch";
import { placeSelectionAction } from "./selectionPosition";

describe("document search", () => {
  it("supports literal, case and whole-word matching", () => {
    expect(findTextMatches("Mem mem memory", { query: "mem", caseSensitive: false, wholeWord: true, regex: false })).toHaveLength(2);
    expect(findTextMatches("Mem mem", { query: "Mem", caseSensitive: true, wholeWord: false, regex: false })).toEqual([
      { index: 0, length: 3, text: "Mem" }
    ]);
  });

  it("supports regular expressions and rejects invalid expressions", () => {
    expect(findTextMatches("A12 B34", { query: "[A-Z]\\d+", caseSensitive: true, wholeWord: false, regex: true })).toHaveLength(2);
    expect(findTextMatches("anything", { query: "[", caseSensitive: false, wholeWord: false, regex: true })).toEqual([]);
  });
});

describe("selection action placement", () => {
  it("anchors above a selection and clamps inside the viewport", () => {
    expect(placeSelectionAction(
      { left: 4, right: 18, top: 100, bottom: 120 },
      { left: 80, right: 110, top: 100, bottom: 120 },
      { width: 320, height: 240 }
    )).toEqual({ left: 10, top: 55 });
  });

  it("moves below a selection near the top edge", () => {
    expect(placeSelectionAction(
      { left: 140, right: 160, top: 8, bottom: 28 },
      { left: 160, right: 180, top: 8, bottom: 28 },
      { width: 320, height: 240 }
    ).top).toBe(37);
  });
});
