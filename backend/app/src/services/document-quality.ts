import fs from "node:fs/promises";
import JSZip from "jszip";
import { countDataImages, countProtectedMedia } from "./document-media.js";

export interface DocumentQuality {
  sourceMediaCount: number | null;
  parsedImageReferences: number;
  outputImageReferences: number;
  uniqueMediaCount: number;
  missingMediaCount: number;
  base64ImageCount: number;
  passed: boolean;
  warnings: string[];
}

export async function inspectSourceMedia(filePath: string, format: string) {
  const prefix = ({ docx: "word/media/", xlsx: "xl/media/", pptx: "ppt/media/" } as Record<string, string>)[format.toLowerCase()];
  if (!prefix && format.toLowerCase() !== "xmind") return null;
  try {
    const zip = await JSZip.loadAsync(await fs.readFile(filePath));
    return Object.keys(zip.files).filter((name) => {
      if (zip.files[name].dir) return false;
      if (prefix) return name.startsWith(prefix);
      return /^(resources|attachments)\//i.test(name) && /\.(png|jpe?g|gif|bmp|webp|tiff?|heic|heif)$/i.test(name);
    }).length;
  } catch {
    return null;
  }
}

export function evaluateDocumentQuality(input: {
  sourceMediaCount: number | null;
  rawMarkdown: string;
  displayMarkdown: string;
  assetId: string;
  uniqueMediaCount: number;
}): DocumentQuality {
  const parsedImageReferences = (input.rawMarkdown.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length;
  const outputImageReferences = countProtectedMedia(input.displayMarkdown, input.assetId);
  const base64ImageCount = countDataImages(input.displayMarkdown);
  const missingMediaCount = input.sourceMediaCount === null ? 0 : Math.max(0, input.sourceMediaCount - outputImageReferences);
  const warnings: string[] = [];
  if (base64ImageCount) warnings.push(`仍有 ${base64ImageCount} 张 Base64 图片未落盘`);
  if (missingMediaCount) warnings.push(`有 ${missingMediaCount} 张原文图片未进入 Markdown`);
  if (parsedImageReferences > outputImageReferences) warnings.push(`有 ${parsedImageReferences - outputImageReferences} 个图片引用未本地化`);
  return {
    sourceMediaCount: input.sourceMediaCount,
    parsedImageReferences,
    outputImageReferences,
    uniqueMediaCount: input.uniqueMediaCount,
    missingMediaCount,
    base64ImageCount,
    passed: warnings.length === 0,
    warnings
  };
}
