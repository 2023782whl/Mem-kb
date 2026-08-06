import { BookMarked, Bot, Check, ChevronDown, Copy, FileImage, FileText, GitBranch, Globe2, Search, ThumbsDown, ThumbsUp } from "lucide-react";
import { MarkdownContent } from "../../shared/MarkdownContent";
import { AssistantGenerationStatus } from "../../shared/AssistantExperience";
import type { Citation, ConversationMessage } from "../../types/domain";

export function MessageThread({ messages, modelName, workspaceName, onFeedback, onBranch, onCapture, onRetry }: {
  messages: ConversationMessage[];
  modelName: (id: string | null) => string;
  workspaceName: string;
  onFeedback: (messageId: string, value: "up" | "down") => void;
  onBranch: (index: number) => void;
  onCapture: (message: ConversationMessage) => void;
  onRetry: (index: number) => void;
}) {
  return (
    <div className="message-thread">
      {messages.map((message, index) => message.role === "user"
        ? <div className="user-message" key={message.id}><div>{message.content}</div></div>
        : <article className="assistant-message" key={message.id}>
          <header><span className="assistant-avatar"><Bot size={17} /></span><strong>Mem-kb</strong>{message.status === "streaming" ? <em>生成中</em> : message.status === "stopped" ? <em>已停止</em> : message.status === "error" ? <em className="error">未完成</em> : null}</header>
          <SourceList message={message} />
          {message.status === "streaming" ? <AssistantGenerationStatus startedAt={Date.parse(message.created_at) || Date.now()} compact={Boolean(message.content)} /> : null}
          {message.content
            ? <MarkdownContent source={message.content} className="message-markdown" citationCount={message.citations.length} citationPrefix={`${message.id}-citation`} />
            : null}
          {message.error ? <div className="message-error"><span>{message.error}</span><button onClick={() => onRetry(index)}>重试</button></div> : null}
          {message.content ? <footer className="message-actions">
            <span>{modelName(message.model_id)} · {workspaceName}</span>
            <div>
              <button title="复制回答" onClick={() => navigator.clipboard.writeText(message.content)}><Copy size={15} /></button>
              <button title="赞" disabled={!message.id || message.id.startsWith("local-")} onClick={() => onFeedback(message.id, "up")}><ThumbsUp size={15} /></button>
              <button title="踩" disabled={!message.id || message.id.startsWith("local-")} onClick={() => onFeedback(message.id, "down")}><ThumbsDown size={15} /></button>
              <button title="创建分支" onClick={() => onBranch(index)}><GitBranch size={15} /></button>
              <button title="沉淀到 Workspace" disabled={!message.id || message.id.startsWith("local-")} onClick={() => onCapture(message)}><BookMarked size={15} /></button>
            </div>
          </footer> : null}
        </article>)}
    </div>
  );
}

function SourceList({ message }: { message: ConversationMessage }) {
  if (!message.citations.length) return null;
  return (
    <details className="message-sources" open>
      <summary><span><Search size={15} />已检索 {message.citations.length} 个来源</span><ChevronDown size={15} /></summary>
      <div className="source-cards">
        {message.citations.map((citation, index) => {
          const href = sourceHref(citation);
          const external = Boolean(citation.url);
          const content = <>
            <span>{citation.kind === "web" ? <Globe2 size={16} /> : citation.kind === "image" ? <FileImage size={16} /> : <FileText size={16} />}</span>
            <div><strong>{citation.title}</strong><p>{citation.snippet || "查看来源详情"}</p></div>
            <b>{index + 1}</b>
          </>;
          const key = `${citation.id || citation.url || citation.slug || citation.title}-${index}`;
          const id = `${message.id}-citation-${index + 1}`;
          return href
            ? <a className="source-card" id={id} key={key} href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>{content}</a>
            : <div className="source-card" id={id} key={key}>{content}</div>;
        })}
      </div>
    </details>
  );
}

function sourceHref(citation: Citation) {
  if (citation.url) return citation.url;
  if (!citation.assetId) return null;
  return `${citation.kind === "image" ? "/knowledge/images" : "/knowledge/documents"}?asset=${encodeURIComponent(citation.assetId)}`;
}
