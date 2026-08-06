import { useEffect, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api/client";
import { MermaidDiagram } from "./MermaidDiagram";

const mediaPathPattern = /^\/api\/assets\/([^/]+)\/media\/([^/?#]+)$/;

function ProtectedDocumentImage({ src, alt }: { src: string; alt: string }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const match = src.match(mediaPathPattern);

  useEffect(() => {
    if (!match) return;
    const controller = new AbortController();
    let active = true;
    let objectUrl = "";
    setUrl("");
    setFailed(false);
    api.assetMediaBlob(decodeURIComponent(match[1]), decodeURIComponent(match[2]), controller.signal)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (!match) return <img src={src} alt={alt} loading="lazy" />;
  if (failed) return <span className="markdown-image-error" role="img" aria-label={alt}>图片加载失败</span>;
  return url ? <img src={url} alt={alt} loading="lazy" /> : <span className="markdown-image-loading" aria-label="图片加载中" />;
}

const components: Components = {
  a: ({ href, children, ...props }) => {
    const external = Boolean(href && /^https?:\/\//i.test(href));
    return <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} {...props}>{children}</a>;
  },
  img: ({ src, alt }) => src ? <ProtectedDocumentImage src={src} alt={alt || ""} /> : null,
  pre: ({ node, children }) => {
    const codeNode = node?.children?.[0] as { properties?: { className?: string[] }; children?: Array<{ value?: string }> } | undefined;
    const classes = codeNode?.properties?.className || [];
    if (classes.includes("language-mermaid")) {
      return <MermaidDiagram source={codeNode?.children?.[0]?.value || ""} />;
    }
    return <pre>{children}</pre>;
  }
};

function linkCitationMarkers(source: string, citationCount: number, citationPrefix: string) {
  if (!citationCount) return source;
  return source.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g).map((part, index) => {
    if (index % 2) return part;
    return part.replace(/(?<!!)\[(\d+)\](?!\s*(?:\(|:))/g, (marker, value: string) => {
      const number = Number(value);
      return number > 0 && number <= citationCount ? `[${number}](#${citationPrefix}-${number})` : marker;
    });
  }).join("");
}

export function MarkdownContent({ source, className = "", citationCount = 0, citationPrefix = "citation" }: {
  source: string;
  className?: string;
  citationCount?: number;
  citationPrefix?: string;
}) {
  return (
    <div className={`markdown-content ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{linkCitationMarkers(source, citationCount, citationPrefix)}</ReactMarkdown>
    </div>
  );
}
