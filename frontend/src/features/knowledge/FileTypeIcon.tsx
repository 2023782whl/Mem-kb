import fileDocIcon from "../../assets/icons/file-doc.png";
import fileGifIcon from "../../assets/icons/file-gif.png";
import fileJpgIcon from "../../assets/icons/file-jpg.png";
import fileMarkdownIcon from "../../assets/icons/file-markdown.png";
import filePdfIcon from "../../assets/icons/file-pdf.png";
import filePngIcon from "../../assets/icons/file-png.png";
import fileBmpIcon from "../../assets/icons/file-bmp.png";
import fileXmindIcon from "../../assets/icons/file-xmind.png";

const formats = {
  pdf: { src: filePdfIcon, tone: "pdf", label: "PDF 文件" },
  doc: { src: fileDocIcon, tone: "word", label: "Word 文件" },
  docx: { src: fileDocIcon, tone: "word", label: "Word 文件" },
  xlsx: { src: "/file-icons/xlsx.svg", tone: "excel", label: "Excel 文件" },
  xls: { src: "/file-icons/xlsx.svg", tone: "excel", label: "Excel 文件" },
  csv: { src: "/file-icons/xlsx.svg", tone: "excel", label: "CSV 文件" },
  ppt: { src: "/file-icons/pptx.svg", tone: "powerpoint", label: "PowerPoint 文件" },
  pptx: { src: "/file-icons/pptx.svg", tone: "powerpoint", label: "PowerPoint 文件" },
  xmind: { src: fileXmindIcon, tone: "xmind", label: "XMind 文件" },
  md: { src: fileMarkdownIcon, tone: "markdown", label: "Markdown 文件" },
  markdown: { src: fileMarkdownIcon, tone: "markdown", label: "Markdown 文件" },
  txt: { src: "/file-icons/txt.svg", tone: "text", label: "文本文件" },
  jpg: { src: fileJpgIcon, tone: "image", label: "JPG 图片" },
  jpeg: { src: fileJpgIcon, tone: "image", label: "JPEG 图片" },
  png: { src: filePngIcon, tone: "image", label: "PNG 图片" },
  gif: { src: fileGifIcon, tone: "image", label: "GIF 图片" },
  bmp: { src: fileBmpIcon, tone: "image", label: "BMP 图片" },
  webp: { src: filePngIcon, tone: "image", label: "WebP 图片" },
  tif: { src: filePngIcon, tone: "image", label: "TIFF 图片" },
  tiff: { src: filePngIcon, tone: "image", label: "TIFF 图片" },
  heic: { src: fileJpgIcon, tone: "image", label: "HEIC 图片" },
  heif: { src: fileJpgIcon, tone: "image", label: "HEIF 图片" },
  folder: { src: "/file-icons/folder.svg", tone: "folder", label: "文件夹" }
} as const;

export function resolveFileFormat(format?: string | null, title?: string | null) {
  const extension = title?.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
  return extension && extension in formats ? extension : (format || "").toLowerCase();
}

export function FileTypeIcon({ format, title, compact = false }: { format?: string | null; title?: string | null; compact?: boolean }) {
  const definition = formats[resolveFileFormat(format, title) as keyof typeof formats] || {
    src: "/file-icons/genericfile.svg",
    tone: "unknown",
    label: "文件"
  };
  return (
    <span className={`file-type-icon ${definition.tone} ${compact ? "compact" : ""}`} title={definition.label}>
      <img src={definition.src} alt="" aria-hidden="true" />
    </span>
  );
}
