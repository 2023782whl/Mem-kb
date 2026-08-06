export function normalizeAssistantMarkdown(input: string) {
  const fenced = unwrapMarkdownFence(input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim());
  return collapseExcessBlankLines(fenced.split("\n").map(normalizeMarkdownLine).join("\n")).trim();
}

function unwrapMarkdownFence(value: string) {
  const match = value.match(/^```(?:markdown|md|text)?[^\n]*\n([\s\S]*?)\n```\s*$/i);
  return match ? match[1].trim() : value;
}

function normalizeMarkdownLine(line: string) {
  let next = line.replace(/\u00A0/g, " ").replace(/[\u200B-\u200D\uFEFF]/g, "");
  next = next.replace(/^(\s*)\\(#{1,6})(?=\s|\S)/, "$1$2");
  next = next.replace(/^(\s*)\\([-*+])\s+/, "$1$2 ");
  next = next.replace(/^(\s*)\\(\d+[.)、])\s+/, "$1$2 ");
  next = next.replace(/^(\s{0,3})([＃]{1,6})\s*/, (_all, indent: string, marks: string) => `${indent}${"#".repeat(marks.length)} `);
  next = next.replace(/^(\s{0,3})(#{1,6})(?!#)(?=\S)/, "$1$2 ");
  next = next.replace(/^(\s*)[•·]\s+/, "$1- ");
  return next;
}

function collapseExcessBlankLines(value: string) {
  return value.replace(/\n{4,}/g, "\n\n\n");
}
