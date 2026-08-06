import { ChevronDown, ChevronRight, ChevronUp, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  clearDocumentSearch, replaceAllDocumentMatches, replaceDocumentMatch, setActiveDocumentMatch,
  updateDocumentSearch, type DocumentSearchOptions
} from "./documentSearch";

export function DocumentFindBar({ editor, open, onClose }: { editor: Editor | null; open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const options = useMemo<DocumentSearchOptions>(() => ({ query, caseSensitive, wholeWord, regex }), [query, caseSensitive, wholeWord, regex]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0);
  }, [open]);

  useEffect(() => {
    if (!editor || !open) return;
    const matches = updateDocumentSearch(editor, options, activeIndex);
    setMatchCount(matches.length);
    const nextIndex = matches.length ? Math.min(activeIndex, matches.length - 1) : 0;
    if (nextIndex !== activeIndex) setActiveIndex(nextIndex);
  }, [activeIndex, editor, open, options]);

  useEffect(() => () => { if (editor) clearDocumentSearch(editor); }, [editor]);

  if (!open) return null;

  function move(direction: 1 | -1) {
    if (!editor || !matchCount) return;
    const next = (activeIndex + direction + matchCount) % matchCount;
    setActiveIndex(next);
    setActiveDocumentMatch(editor, next);
  }

  function close() {
    if (editor) clearDocumentSearch(editor);
    onClose();
    editor?.commands.focus();
  }

  function replaceCurrent() {
    if (!editor) return;
    const result = replaceDocumentMatch(editor, replacement);
    setMatchCount(result?.matches.length || 0);
  }

  function replaceAll() {
    if (!editor) return;
    replaceAllDocumentMatches(editor, replacement);
    const matches = updateDocumentSearch(editor, options, 0);
    setActiveIndex(0);
    setMatchCount(matches.length);
  }

  return <section className="document-findbar" aria-label="文档查找替换">
    <div className="document-findbar-row">
      <button className="findbar-toggle" type="button" aria-expanded={replaceOpen} aria-label={replaceOpen ? "收起替换" : "展开替换"} title={replaceOpen ? "收起替换" : "展开替换"} onClick={() => setReplaceOpen((value) => !value)}>{replaceOpen ? <ChevronDown /> : <ChevronRight />}</button>
      <label><input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
        if (event.key === "Escape") close();
      }} placeholder="查找" /></label>
      <div className="findbar-match-count">{matchCount ? `${activeIndex + 1}/${matchCount}` : "0/0"}</div>
      <button className={caseSensitive ? "active" : ""} type="button" title="区分大小写" aria-label="区分大小写" aria-pressed={caseSensitive} onClick={() => setCaseSensitive((value) => !value)}><span className="findbar-mode-icon">Aa</span></button>
      <button className={wholeWord ? "active" : ""} type="button" title="全词匹配" aria-label="全词匹配" aria-pressed={wholeWord} onClick={() => setWholeWord((value) => !value)}><span className="findbar-mode-icon word">ab</span></button>
      <button className={regex ? "active" : ""} type="button" title="正则表达式" aria-label="正则表达式" aria-pressed={regex} onClick={() => setRegex((value) => !value)}><span className="findbar-mode-icon regex">.*</span></button>
      <i />
      <button type="button" title="上一个" aria-label="上一个" disabled={!matchCount} onClick={() => move(-1)}><ChevronUp /></button>
      <button type="button" title="下一个" aria-label="下一个" disabled={!matchCount} onClick={() => move(1)}><ChevronDown /></button>
      <button type="button" title="关闭" aria-label="关闭" onClick={close}><X /></button>
    </div>
    {replaceOpen ? <div className="document-findbar-row replace-row">
      <span />
      <label><input value={replacement} onChange={(event) => setReplacement(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") replaceCurrent(); if (event.key === "Escape") close(); }} placeholder="替换为" /></label>
      <button className="text-action" type="button" disabled={!matchCount} onClick={replaceCurrent}>替换</button>
      <button className="text-action" type="button" disabled={!matchCount} onClick={replaceAll}>全部替换</button>
    </div> : null}
  </section>;
}
