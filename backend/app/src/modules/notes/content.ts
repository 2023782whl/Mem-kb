import type { Note } from "../../db/schema.js";

function yamlString(value: string) {
  return JSON.stringify(value);
}

export function normalizeNoteTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 8);
}

export function notePageContent(note: Pick<Note, "title" | "content_markdown" | "tags" | "workspace_id" | "owner_id">) {
  const tags = normalizeNoteTags(note.tags).map(yamlString).join(", ");
  return [
    "---",
    `title: ${yamlString(note.title)}`,
    `tags: [${tags}]`,
    `workspace_id: ${yamlString(note.workspace_id)}`,
    `owner_id: ${yamlString(note.owner_id)}`,
    "source: aiteam-note",
    "---",
    "",
    `# ${note.title}`,
    "",
    note.content_markdown.trim()
  ].join("\n").trim();
}

export function noteBodyFromPage(content: string) {
  const withoutFrontmatter = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
  return withoutFrontmatter.replace(/^#\s+[^\n]+\n+/, "").trim();
}
