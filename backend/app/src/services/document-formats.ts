import path from "node:path";

export const IMAGE_FORMATS = new Set([
  "jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "tif", "heic", "heif"
]);

export const DOCUMENT_FORMATS = new Set([
  "md", "markdown", "txt", "pdf", "docx", "doc", "xlsx", "xls", "csv", "xmind", "pptx", "ppt"
]);

const zipFormats = new Set(["docx", "xlsx", "xmind", "pptx"]);
const oleFormats = new Set(["doc", "xls", "ppt"]);

const allowedMimeByFormat: Record<string, Set<string>> = {
  md: new Set(["text/markdown", "text/plain", "application/octet-stream"]),
  markdown: new Set(["text/markdown", "text/plain", "application/octet-stream"]),
  txt: new Set(["text/plain", "application/octet-stream"]),
  csv: new Set(["text/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream"]),
  pdf: new Set(["application/pdf", "application/octet-stream"]),
  docx: new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/octet-stream"]),
  doc: new Set(["application/msword", "application/octet-stream"]),
  xlsx: new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", "application/octet-stream"]),
  xls: new Set(["application/vnd.ms-excel", "application/octet-stream"]),
  xmind: new Set(["application/x-xmind", "application/vnd.xmind.workbook", "application/zip", "application/octet-stream"]),
  pptx: new Set(["application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/zip", "application/octet-stream"]),
  ppt: new Set(["application/vnd.ms-powerpoint", "application/octet-stream"]),
  png: new Set(["image/png"]),
  jpg: new Set(["image/jpeg"]),
  jpeg: new Set(["image/jpeg"]),
  gif: new Set(["image/gif"]),
  bmp: new Set(["image/bmp", "image/x-ms-bmp"]),
  webp: new Set(["image/webp"]),
  tiff: new Set(["image/tiff"]),
  tif: new Set(["image/tiff"]),
  heic: new Set(["image/heic", "image/heif", "application/octet-stream"]),
  heif: new Set(["image/heif", "image/heic", "application/octet-stream"])
};

export function fileFormat(filename: string) {
  return path.extname(filename).slice(1).toLowerCase();
}

export function classifyUpload(mimeType: string, filename: string) {
  const format = fileFormat(filename);
  const normalizedMime = mimeType.toLowerCase().split(";")[0].trim();
  if (!allowedMimeByFormat[format]?.has(normalizedMime)) return null;
  if (IMAGE_FORMATS.has(format)) return "image" as const;
  if (DOCUMENT_FORMATS.has(format)) return "document" as const;
  return null;
}

export function matchesFileSignature(bytes: Buffer, format: string) {
  const normalized = format.toLowerCase();
  if (["md", "markdown", "txt", "csv"].includes(normalized)) return !bytes.includes(0);
  if (normalized === "pdf") return bytes.subarray(0, 5).toString() === "%PDF-";
  if (zipFormats.has(normalized)) return isZip(bytes);
  if (oleFormats.has(normalized)) return bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (normalized === "png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (["jpg", "jpeg"].includes(normalized)) return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (normalized === "gif") return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString());
  if (normalized === "bmp") return bytes.subarray(0, 2).toString() === "BM";
  if (normalized === "webp") return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (["tiff", "tif"].includes(normalized)) return ["49492a00", "4d4d002a"].includes(bytes.subarray(0, 4).toString("hex"));
  if (["heic", "heif"].includes(normalized)) return isHeif(bytes);
  return false;
}

function isZip(bytes: Buffer) {
  return new Set(["504b0304", "504b0506", "504b0708"]).has(bytes.subarray(0, 4).toString("hex"));
}

function isHeif(bytes: Buffer) {
  if (bytes.subarray(4, 8).toString() !== "ftyp") return false;
  return new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]).has(bytes.subarray(8, 12).toString());
}

export function supportedFormatsDescription() {
  return "支持 PDF、DOCX、DOC、MD、XLSX、XLS、CSV、XMind、PPTX、PPT 及 JPG、PNG、GIF、BMP、WebP、TIFF、HEIC/HEIF";
}
