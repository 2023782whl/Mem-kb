import crypto from "node:crypto";

export interface MarkdownChunk {
  index: number;
  heading: string;
  content: string;
  hash: string;
}

function splitLongBlock(value: string, maxChars: number) {
  const parts: string[] = [];
  for (let offset = 0; offset < value.length; offset += maxChars) {
    parts.push(value.slice(offset, offset + maxChars));
  }
  return parts;
}

export function chunkMarkdown(markdown: string, maxChars = 1800, minChars = 500) {
  const blocks = markdown
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .flatMap((block) => splitLongBlock(block.trim(), maxChars))
    .filter(Boolean);
  const chunks: MarkdownChunk[] = [];
  let heading = "";
  let chunkHeading = "";
  let buffer: string[] = [];

  const bufferLength = () => buffer.join("\n\n").length;

  const flush = () => {
    const content = buffer.join("\n\n").trim();
    if (!content) return;
    chunks.push({
      index: chunks.length,
      heading: chunkHeading,
      content,
      hash: crypto.createHash("sha256").update(`${chunkHeading}\n${content}`).digest("hex")
    });
    buffer = [];
    chunkHeading = "";
  };

  for (const block of blocks) {
    const blockHeading = block.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
    if (blockHeading) {
      if (bufferLength() >= minChars) flush();
      heading = blockHeading;
      if (buffer.length) chunkHeading = heading;
    }
    const nextLength = bufferLength() + block.length + 2;
    if (nextLength > maxChars) flush();
    if (!buffer.length) chunkHeading = heading;
    buffer.push(block);
  }
  flush();
  return chunks;
}
