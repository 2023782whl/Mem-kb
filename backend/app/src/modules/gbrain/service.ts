import { one, query } from "../../db/pool.js";
import {
  cancelGBrainJob,
  findGBrainAnomalies,
  findGBrainContradictions,
  findGBrainExperts,
  findGBrainTrajectory,
  getActiveGBrainSchemaPack,
  getGBrainAdvisor,
  getGBrainBacklinks,
  getGBrainHealthDashboard,
  getGBrainIdentity,
  getGBrainJob,
  getGBrainOntology,
  getGBrainSchemaStats,
  getGBrainSourceStatus,
  getGBrainStats,
  getGBrainStatusSnapshot,
  getGBrainTags,
  getGBrainTimeline,
  getGBrainSkill,
  listGBrainJobs,
  listGBrainLinkSources,
  listGBrainOntologyConflicts,
  listGBrainOntologyDimensions,
  listGBrainSchemaPacks,
  listGBrainSkillpacks,
  listGBrainSkills,
  listGBrainSources,
  proposeGBrainOntology,
  retryGBrainJob,
  traverseGBrain,
  type GBrainJob,
  type GBrainRecord,
  type GBrainSource
} from "../../services/gbrain.js";

export interface Capability<T> {
  available: boolean;
  data: T | null;
  error?: string;
}

export interface WorkspaceSeed {
  id: string;
  title: string;
  slug: string;
  kind: "asset" | "note" | "fact";
}

export interface AuditEntry {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
  user_name: string | null;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(message) as { message?: string; suggestion?: string };
    return [parsed.message, parsed.suggestion].filter(Boolean).join(" ") || message;
  } catch {
    return message;
  }
}

export async function capability<T>(task: () => Promise<T>): Promise<Capability<T>> {
  try {
    return { available: true, data: await task() };
  } catch (error) {
    return { available: false, data: null, error: errorMessage(error) };
  }
}

export function workspaceSlugPrefix(tenantId: string, workspaceId: string) {
  return `aiteam/${tenantId}/workspace/${workspaceId}/`;
}

export function filterWorkspaceAnomalies(rows: GBrainRecord[], prefix: string) {
  return rows.flatMap((row) => {
    const pageSlugs = Array.isArray(row.page_slugs)
      ? row.page_slugs.filter((slug): slug is string => typeof slug === "string" && slug.startsWith(prefix))
      : [];
    return pageSlugs.length ? [{ ...row, count: pageSlugs.length, page_slugs: pageSlugs }] : [];
  });
}

export function filterWorkspaceRecords(rows: GBrainRecord[], prefix: string) {
  return rows.filter((row) => JSON.stringify(row).includes(prefix));
}

export async function listWorkspaceSeeds(tenantId: string, workspaceId: string) {
  return query<WorkspaceSeed>(
    `select id, title, gbrain_slug as slug, 'asset'::text as kind
       from assets
      where tenant_id = $1 and workspace_id = $2 and deleted_at is null and gbrain_slug is not null
     union all
     select id, title, gbrain_slug as slug, 'note'::text as kind
       from notes
      where tenant_id = $1 and workspace_id = $2 and status = 'active' and gbrain_slug <> ''
     union all
     select id, coalesce(corrected_fact, fact) as title, entity_slug as slug, 'fact'::text as kind
       from note_facts
      where tenant_id = $1 and workspace_id = $2 and status <> 'forgotten' and entity_slug is not null
     order by title`,
    [tenantId, workspaceId]
  );
}

export async function assertWorkspaceSlug(tenantId: string, workspaceId: string, slug: string) {
  const allowed = await one<{ found: boolean }>(
    `select exists(
       select 1 from assets
        where tenant_id = $1 and workspace_id = $2 and gbrain_slug = $3 and deleted_at is null
       union all
       select 1 from notes
        where tenant_id = $1 and workspace_id = $2 and gbrain_slug = $3 and status = 'active'
       union all
       select 1 from note_facts
        where tenant_id = $1 and workspace_id = $2 and entity_slug = $3 and status <> 'forgotten'
     ) as found`,
    [tenantId, workspaceId, slug]
  );
  if (allowed?.found) return slug;
  const error = new Error("当前实体不属于该 Workspace");
  error.name = "PermissionDenied";
  throw error;
}

export async function getWorkspaceGraphDetail(slug: string, depth: number) {
  const [paths, backlinks, timeline, tags, trajectory] = await Promise.all([
    capability(() => traverseGBrain(slug, depth)),
    capability(() => getGBrainBacklinks(slug)),
    capability(() => getGBrainTimeline(slug, 30)),
    capability(() => getGBrainTags(slug)),
    capability(() => findGBrainTrajectory(slug, { kind: "all", limit: 100 }))
  ]);
  return { slug, depth, paths, backlinks, timeline, tags, trajectory };
}

export async function getWorkspaceIntelligence(input: {
  tenantId: string;
  workspaceId: string;
  topic?: string;
  slug?: string;
  severity?: string;
  isAdmin: boolean;
}) {
  const prefix = workspaceSlugPrefix(input.tenantId, input.workspaceId);
  const [anomalies, experts, contradictions, ontology] = await Promise.all([
    capability(async () => filterWorkspaceAnomalies(await findGBrainAnomalies(), prefix)),
    input.topic
      ? capability(async () => filterWorkspaceRecords(await findGBrainExperts(input.topic!, 8), prefix))
      : Promise.resolve<Capability<GBrainRecord[]>>({ available: true, data: [] }),
    input.slug
      ? capability(() => findGBrainContradictions(input.slug, input.severity, 30))
      : Promise.resolve<Capability<GBrainRecord>>({ available: true, data: { contradictions: [], note: "选择知识节点后检查冲突。" } }),
    input.slug
      ? capability(() => getGBrainOntology(input.slug!, { include_quarantined: false }))
      : Promise.resolve<Capability<GBrainRecord[]>>({ available: true, data: [] })
  ]);

  const [dimensions, conflicts] = input.isAdmin
    ? await Promise.all([
        capability(() => listGBrainOntologyDimensions()),
        capability(async () => filterWorkspaceRecords(await listGBrainOntologyConflicts(), prefix))
      ])
    : [
        { available: false, data: null, error: "仅管理员可查看全局 Ontology 维度。" },
        { available: false, data: null, error: "仅管理员可查看全局 Ontology 冲突。" }
      ];

  return { anomalies, experts, contradictions, ontology, dimensions, conflicts };
}

export async function getOperationsCenter(tenantId: string) {
  const [identity, stats, health, snapshot, sources, jobs, auditLogs] = await Promise.all([
    capability(() => getGBrainIdentity()),
    capability(() => getGBrainStats()),
    capability(() => getGBrainHealthDashboard()),
    capability(() => getGBrainStatusSnapshot()),
    capability(() => listGBrainSources()),
    capability(() => listGBrainJobs({ limit: 50 })),
    query<AuditEntry>(
      `select a.id, a.action, a.resource_type, a.resource_id, a.metadata, a.created_at, u.name as user_name
         from audit_logs a
         left join users u on u.id = a.user_id
        where a.tenant_id = $1
        order by a.created_at desc
        limit 50`,
      [tenantId]
    )
  ]);

  const sourceRows = sources.data?.sources || [];
  const sourceStatuses = await Promise.all(
    sourceRows.map(async (source: GBrainSource) => ({ source, status: await capability(() => getGBrainSourceStatus(source.id)) }))
  );
  return { identity, stats, health, snapshot, sources, sourceStatuses, jobs, auditLogs };
}

export async function getGovernanceCenter() {
  const [advisor, activeSchema, schemaPacks, schemaStats, skills, skillpacks, linkSources, dimensions, conflicts] = await Promise.all([
    capability(() => getGBrainAdvisor()),
    capability(() => getActiveGBrainSchemaPack()),
    capability(() => listGBrainSchemaPacks()),
    capability(() => getGBrainSchemaStats()),
    capability(() => listGBrainSkills()),
    capability(() => listGBrainSkillpacks()),
    capability(() => listGBrainLinkSources()),
    capability(() => listGBrainOntologyDimensions()),
    capability(() => listGBrainOntologyConflicts())
  ]);
  return { advisor, activeSchema, schemaPacks, schemaStats, skills, skillpacks, linkSources, dimensions, conflicts };
}

export async function getSkillDetail(name: string, sourceId?: string) {
  return capability(() => getGBrainSkill(name, sourceId));
}

export async function writeOntology(input: Parameters<typeof proposeGBrainOntology>[0]) {
  return proposeGBrainOntology(input);
}

export async function retryJob(id: number) {
  const current = await getGBrainJob(id);
  if (!jobCanRetry(current)) throw new Error(`任务 #${id} 当前状态为 ${current.status}，不能重试`);
  return retryGBrainJob(id);
}

export async function cancelJob(id: number) {
  const current = await getGBrainJob(id);
  if (!jobCanCancel(current)) throw new Error(`任务 #${id} 当前状态为 ${current.status}，不能取消`);
  return cancelGBrainJob(id);
}

export function jobCanRetry(job: GBrainJob) {
  return job.status === "failed" || job.status === "dead";
}

export function jobCanCancel(job: GBrainJob) {
  return ["waiting", "active", "delayed"].includes(job.status);
}
