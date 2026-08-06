import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "../config/env.js";

type ToolResult = {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

function runtimeTokenPath() {
  return path.join(process.cwd(), ".runtime/gbrain-token");
}

async function runBunCli(args: string[]) {
  const cliPath = path.resolve(process.cwd(), env.gbrain.cli);
  return new Promise<string>((resolve, reject) => {
    const child = spawn("bun", [cliPath, ...args], {
      cwd: path.resolve(process.cwd(), "../gbrain"),
      env: {
        ...process.env,
        PATH: [path.join(os.homedir(), ".bun/bin"), "/opt/homebrew/bin", "/usr/local/bin", process.env.PATH || ""].join(":")
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `gbrain cli exited with ${code}`));
    });
  });
}

async function ensureToken() {
  if (env.gbrain.token) return env.gbrain.token;
  const tokenFile = runtimeTokenPath();
  try {
    const token = (await fs.readFile(tokenFile, "utf8")).trim();
    if (token) return token;
  } catch {
    // Create one below.
  }

  const stdout = await runBunCli(["auth", "create", `aiteam-app-${Date.now()}`]);
  const token = stdout.match(/gbrain_[a-zA-Z0-9]+/)?.[0];
  if (!token) throw new Error("无法创建 GBrain MCP token");
  await fs.mkdir(path.dirname(tokenFile), { recursive: true });
  await fs.writeFile(tokenFile, token, { mode: 0o600 });
  return token;
}

function parseSseJson(text: string) {
  const dataLine = text.split(/\r?\n/).find((line) => line.startsWith("data: "));
  const payload = dataLine ? dataLine.slice("data: ".length) : text;
  return JSON.parse(payload) as { result?: ToolResult; error?: { message?: string } };
}

function parseToolText(result: ToolResult) {
  const text = result.content?.find((item) => item.type === "text")?.text || "{}";
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export async function gbrainHealth() {
  const response = await fetch(`${env.gbrain.baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) return { ok: false, status: response.status };
  const body = (await response.json()) as Record<string, unknown>;
  return { ok: true, ...body };
}

export async function callGBrainTool<T = unknown>(name: string, args: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
  const token = await ensureToken();
  const response = await fetch(env.gbrain.mcpUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args }
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const raw = await response.text();
  const payload = parseSseJson(raw);
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || raw || `GBrain ${name} failed`);
  }
  if (payload.result?.isError) {
    throw new Error(JSON.stringify(parseToolText(payload.result)));
  }
  return parseToolText(payload.result || {}) as T;
}

export async function putGBrainPage(slug: string, content: string) {
  return callGBrainTool<{ slug: string; status: string; chunks?: number }>("put_page", { slug, content });
}

export function isGBrainPageNotFound(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const payload = JSON.parse(message) as { error?: string; message?: string };
    if (payload.error === "page_not_found") return true;
    return payload.message?.toLowerCase().includes("page not found") ?? false;
  } catch {
    return message.includes("page_not_found") || message.toLowerCase().includes("page not found");
  }
}

export async function deleteGBrainPage(slug: string) {
  try {
    return await callGBrainTool<{ slug?: string; status: string }>("delete_page", { slug });
  } catch (error) {
    if (isGBrainPageNotFound(error)) return { slug, status: "already_missing" };
    throw error;
  }
}

export async function restoreGBrainPage(slug: string) {
  return callGBrainTool<{ slug?: string; status: string }>("restore_page", { slug });
}

export async function searchGBrain(query: string, limit = 8) {
  return callGBrainTool<Array<Record<string, unknown>>>("search", { query, limit }, 6_000);
}

export async function getGBrainPage(slug: string, includeDeleted = false) {
  return callGBrainTool<Record<string, unknown>>("get_page", { slug, include_deleted: includeDeleted });
}

export async function addGBrainTag(slug: string, tag: string) {
  return callGBrainTool("add_tag", { slug, tag });
}

export async function removeGBrainTag(slug: string, tag: string) {
  return callGBrainTool("remove_tag", { slug, tag });
}

export async function getGBrainTags(slug: string) {
  return callGBrainTool<{ tags?: string[] } | string[]>("get_tags", { slug });
}

export async function getGBrainVersions(slug: string) {
  return callGBrainTool<Array<Record<string, unknown>> | { versions?: Array<Record<string, unknown>> }>("get_versions", { slug });
}

export async function revertGBrainVersion(slug: string, versionId: number) {
  return callGBrainTool<Record<string, unknown>>("revert_version", { slug, version_id: versionId });
}

export async function addGBrainTimelineEntry(slug: string, summary: string, detail = "") {
  return callGBrainTool("add_timeline_entry", {
    slug,
    date: new Date().toISOString().slice(0, 10),
    summary,
    detail,
    source: "aiteam"
  });
}

export async function getGBrainTimeline(slug: string, limit = 50) {
  return callGBrainTool<Array<Record<string, unknown>> | { entries?: Array<Record<string, unknown>> }>("get_timeline", { slug, limit });
}

export async function getGBrainBacklinks(slug: string) {
  return callGBrainTool<Array<Record<string, unknown>> | { backlinks?: Array<Record<string, unknown>> }>("get_backlinks", { slug });
}

export interface GBrainFact {
  id: number;
  fact: string;
  kind?: string;
  entity_slug?: string;
  confidence?: number;
  [key: string]: unknown;
}

export async function extractGBrainFacts(turnText: string, sessionId: string) {
  return callGBrainTool<{ fact_ids?: number[]; inserted?: number; duplicates?: number }>("extract_facts", {
    turn_text: turnText,
    session_id: sessionId,
    visibility: "world"
  }, 90_000);
}

export async function recallGBrainFacts(sessionId: string, includePending = true, limit = 100) {
  return callGBrainTool<{ facts?: GBrainFact[]; total?: number } | GBrainFact[]>("recall", {
    session_id: sessionId,
    include_pending: includePending,
    limit
  });
}

export async function forgetGBrainFact(id: number | string, reason = "aiteam-user-request") {
  const factId = Number(id);
  if (!Number.isSafeInteger(factId) || factId <= 0) throw new Error("无效的 GBrain Fact ID");
  return callGBrainTool("forget_fact", { id: factId, reason });
}

export async function addGBrainLink(from: string, to: string, relation: string, evidence = "") {
  return callGBrainTool("add_link", { from, to, link_type: relation, context: evidence, link_source: "aiteam-extraction" });
}

export async function traverseGBrain(slug: string, depth = 2) {
  return callGBrainTool<Array<Record<string, unknown>>>("traverse_graph", { slug, depth, direction: "both" });
}

export type GBrainRecord = Record<string, unknown>;

export interface GBrainSource extends GBrainRecord {
  id: string;
  name: string;
  page_count: number;
  federated: boolean;
}

export interface GBrainJob extends GBrainRecord {
  id: number;
  name: string;
  queue: string;
  status: string;
  progress: unknown;
}

export async function getGBrainIdentity() {
  return callGBrainTool<GBrainRecord>("get_brain_identity", {});
}

export async function getGBrainStats() {
  return callGBrainTool<GBrainRecord>("get_stats", {});
}

export async function getGBrainHealthDashboard() {
  return callGBrainTool<GBrainRecord>("get_health", {});
}

export async function getGBrainStatusSnapshot() {
  return callGBrainTool<GBrainRecord>("get_status_snapshot", {});
}

export async function listGBrainSources() {
  return callGBrainTool<{ sources?: GBrainSource[] }>("sources_list", {});
}

export async function getGBrainSourceStatus(id: string) {
  return callGBrainTool<GBrainRecord>("sources_status", { id });
}

export async function listGBrainJobs(filters: { status?: string; queue?: string; name?: string; limit?: number } = {}) {
  return callGBrainTool<GBrainJob[]>("list_jobs", filters);
}

export async function getGBrainJob(id: number) {
  return callGBrainTool<GBrainJob>("get_job", { id });
}

export async function retryGBrainJob(id: number) {
  return callGBrainTool<GBrainRecord>("retry_job", { id });
}

export async function cancelGBrainJob(id: number) {
  return callGBrainTool<GBrainRecord>("cancel_job", { id });
}

export async function findGBrainAnomalies(options: { since?: string; lookback_days?: number; sigma?: number } = {}) {
  return callGBrainTool<GBrainRecord[]>("find_anomalies", options);
}

export async function findGBrainExperts(topic: string, limit = 5) {
  return callGBrainTool<GBrainRecord[]>("find_experts", { topic, limit, explain: true });
}

export async function findGBrainContradictions(slug?: string, severity?: string, limit = 20) {
  return callGBrainTool<GBrainRecord>("find_contradictions", { ...(slug ? { slug } : {}), ...(severity ? { severity } : {}), limit });
}

export async function findGBrainTrajectory(entitySlug: string, options: { metric?: string; kind?: string; since?: string; until?: string; limit?: number } = {}) {
  return callGBrainTool<GBrainRecord>("find_trajectory", { entity_slug: entitySlug, ...options });
}

export async function getGBrainOntology(entity: string, options: { asof?: string; min_confidence?: number; include_quarantined?: boolean } = {}) {
  return callGBrainTool<GBrainRecord[]>("ontology_get", { entity, ...options });
}

export async function proposeGBrainOntology(input: {
  entity: string;
  dimension: string;
  value: string;
  confidence?: number;
  source?: string;
  valid_from?: string;
  valid_to?: string;
  visibility?: "private" | "world";
}) {
  return callGBrainTool<GBrainRecord>("ontology_propose", input);
}

export async function listGBrainOntologyDimensions() {
  return callGBrainTool<GBrainRecord[]>("ontology_dimensions", {});
}

export async function listGBrainOntologyConflicts(minConfidence?: number) {
  return callGBrainTool<GBrainRecord[]>("ontology_conflicts", minConfidence === undefined ? {} : { min_confidence: minConfidence });
}

export async function getGBrainAdvisor() {
  return callGBrainTool<GBrainRecord>("advisor", {});
}

export async function getActiveGBrainSchemaPack() {
  return callGBrainTool<GBrainRecord>("get_active_schema_pack", {});
}

export async function listGBrainSchemaPacks() {
  return callGBrainTool<GBrainRecord>("list_schema_packs", {});
}

export async function getGBrainSchemaStats() {
  return callGBrainTool<GBrainRecord>("schema_stats", {});
}

export async function listGBrainSkills(section?: string) {
  return callGBrainTool<GBrainRecord>("list_skills", section ? { section } : {});
}

export async function getGBrainSkill(name: string, sourceId?: string) {
  return callGBrainTool<GBrainRecord>("get_skill", { name, ...(sourceId ? { source_id: sourceId } : {}) });
}

export async function listGBrainSkillpacks() {
  return callGBrainTool<GBrainRecord>("list_brain_skillpack", {});
}

export async function listGBrainLinkSources() {
  return callGBrainTool<GBrainRecord[]>("list_link_sources", {});
}
