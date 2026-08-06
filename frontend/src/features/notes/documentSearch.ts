import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface DocumentSearchOptions {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface DocumentSearchMatch {
  from: number;
  to: number;
  text: string;
}

interface SearchState {
  options: DocumentSearchOptions;
  matches: DocumentSearchMatch[];
  activeIndex: number;
}

const searchKey = new PluginKey<SearchState>("documentSearch");
const emptyOptions: DocumentSearchOptions = { query: "", caseSensitive: false, wholeWord: false, regex: false };

export function buildSearchRegex(options: DocumentSearchOptions) {
  if (!options.query) return null;
  const source = options.regex ? options.query : escapeRegex(options.query);
  const bounded = options.wholeWord ? `\\b(?:${source})\\b` : source;
  try {
    return new RegExp(bounded, options.caseSensitive ? "gu" : "giu");
  } catch {
    return null;
  }
}

export function findTextMatches(text: string, options: DocumentSearchOptions) {
  const expression = buildSearchRegex(options);
  if (!expression) return [] as Array<{ index: number; length: number; text: string }>;
  const matches: Array<{ index: number; length: number; text: string }> = [];
  for (const match of text.matchAll(expression)) {
    if (match.index === undefined || !match[0]) continue;
    matches.push({ index: match.index, length: match[0].length, text: match[0] });
    if (match[0].length === 0) expression.lastIndex += 1;
  }
  return matches;
}

export function findDocumentMatches(doc: ProseMirrorNode, options: DocumentSearchOptions) {
  const matches: DocumentSearchMatch[] = [];
  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    for (const match of findTextMatches(node.text, options)) {
      matches.push({ from: position + match.index, to: position + match.index + match.length, text: match.text });
    }
  });
  return matches;
}

export const DocumentSearchExtension = Extension.create({
  name: "documentSearch",
  addProseMirrorPlugins() {
    return [new Plugin<SearchState>({
      key: searchKey,
      state: {
        init: (_, state) => ({ options: emptyOptions, matches: [], activeIndex: -1 }),
        apply(transaction, previous, _oldState, nextState) {
          const meta = transaction.getMeta(searchKey) as Partial<SearchState> | undefined;
          const options = meta?.options || previous.options;
          const matches = transaction.docChanged || meta?.options ? findDocumentMatches(nextState.doc, options) : previous.matches;
          const requested = meta?.activeIndex ?? previous.activeIndex;
          const activeIndex = matches.length ? Math.min(Math.max(requested, 0), matches.length - 1) : -1;
          return { options, matches, activeIndex };
        }
      },
      props: {
        decorations(state) {
          const search = searchKey.getState(state);
          if (!search?.matches.length) return DecorationSet.empty;
          return DecorationSet.create(state.doc, search.matches.map((match, index) => Decoration.inline(
            match.from,
            match.to,
            { class: index === search.activeIndex ? "document-search-hit active" : "document-search-hit" }
          )));
        }
      }
    })];
  }
});

export function updateDocumentSearch(editor: Editor, options: DocumentSearchOptions, activeIndex = 0) {
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { options, activeIndex }));
  return searchKey.getState(editor.state)?.matches || [];
}

export function setActiveDocumentMatch(editor: Editor, activeIndex: number) {
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { activeIndex }));
  const search = searchKey.getState(editor.state);
  const match = search?.matches[search.activeIndex];
  if (match) {
    editor.commands.setTextSelection({ from: match.from, to: match.to });
    editor.commands.scrollIntoView();
  }
  return search;
}

export function replaceDocumentMatch(editor: Editor, replacement: string) {
  const search = searchKey.getState(editor.state);
  const match = search?.matches[search.activeIndex];
  if (!search || !match) return search;
  const transaction = editor.state.tr.insertText(replacement, match.from, match.to);
  editor.view.dispatch(transaction);
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { options: search.options, activeIndex: search.activeIndex }));
  return searchKey.getState(editor.state);
}

export function replaceAllDocumentMatches(editor: Editor, replacement: string) {
  const search = searchKey.getState(editor.state);
  if (!search?.matches.length) return 0;
  let transaction = editor.state.tr;
  for (const match of [...search.matches].reverse()) transaction = transaction.insertText(replacement, match.from, match.to);
  editor.view.dispatch(transaction);
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { options: search.options, activeIndex: 0 }));
  return search.matches.length;
}

export function clearDocumentSearch(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { options: emptyOptions, activeIndex: -1 }));
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
