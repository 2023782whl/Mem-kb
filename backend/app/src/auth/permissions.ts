import { one, query } from "../db/pool.js";
import type { User, UserRole, Workspace, WorkspaceRole } from "../db/schema.js";

const rank: Record<WorkspaceRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3
};

function requiredRole(action: "read" | "write" | "manage"): WorkspaceRole {
  if (action === "read") return "viewer";
  if (action === "write") return "editor";
  return "owner";
}

export function globalWorkspaceRole(role: UserRole): WorkspaceRole {
  if (role === "admin") return "owner";
  return role;
}

export function canPerformWorkspaceAction(role: WorkspaceRole, action: "read" | "write" | "manage") {
  return rank[role] >= rank[requiredRole(action)];
}

function authorizedWorkspace(user: User, workspace: Workspace, action: "read" | "write" | "manage") {
  if (user.role === "admin" || user.is_admin) return { ...workspace, member_role: "owner" as const };
  if (workspace.scope === "personal" && workspace.owner_id !== user.id) return null;
  const globalRole = globalWorkspaceRole(user.role);
  const memberRole = workspace.member_role;
  const effectiveRole = memberRole && rank[memberRole] > rank[globalRole] ? memberRole : globalRole;
  return canPerformWorkspaceAction(effectiveRole, action) ? { ...workspace, member_role: effectiveRole } : null;
}

export function assertTenantWrite(user: Pick<User, "role" | "is_admin">) {
  if (user.role === "viewer" && !user.is_admin) {
    const error = new Error("permission_denied");
    error.name = "PermissionDenied";
    throw error;
  }
}

export async function getWorkspaceForUser(user: User, workspaceId: string, action: "read" | "write" | "manage", includeArchived = false) {
  const workspace = await one<Workspace>(
    `select w.*,
            wm.role as member_role,
            (select count(*)::int from assets a where a.workspace_id = w.id and a.deleted_at is null) as asset_count
     from workspaces w
     left join workspace_members wm on wm.workspace_id = w.id and wm.user_id = $2
     where w.id = $1 and w.tenant_id = $3 and ($4::boolean = true or w.status = 'active')`,
    [workspaceId, user.id, user.tenant_id, includeArchived]
  );
  if (!workspace) return null;
  return authorizedWorkspace(user, workspace, action);
}

export async function assertWorkspaces(user: User, workspaceIds: string[], action: "read" | "write" | "manage", includeArchived = false) {
  const ids = [...new Set(workspaceIds)];
  if (!ids.length) return [];
  const rows = await query<Workspace>(
    `select w.*, wm.role as member_role,
            (select count(*)::int from assets a where a.workspace_id = w.id and a.deleted_at is null) as asset_count
     from workspaces w
     left join workspace_members wm on wm.workspace_id = w.id and wm.user_id = $2
     where w.id = any($1::text[]) and w.tenant_id = $3 and ($4::boolean = true or w.status = 'active')`,
    [ids, user.id, user.tenant_id, includeArchived]
  );
  const authorized = new Map(rows.map((workspace) => [workspace.id, authorizedWorkspace(user, workspace, action)]));
  const ordered = ids.map((id) => authorized.get(id)).filter(Boolean) as Array<Workspace & { member_role: WorkspaceRole }>;
  if (ordered.length !== ids.length) {
    const error = new Error("permission_denied");
    error.name = "PermissionDenied";
    throw error;
  }
  return ordered;
}

export async function assertWorkspace(user: User, workspaceId: string, action: "read" | "write" | "manage", includeArchived = false) {
  const workspace = await getWorkspaceForUser(user, workspaceId, action, includeArchived);
  if (!workspace) {
    const error = new Error("permission_denied");
    error.name = "PermissionDenied";
    throw error;
  }
  return workspace;
}

export async function listWorkspacesForUser(user: User, status: "active" | "archived" | "all" = "active") {
  return query<Workspace>(
    `select w.*,
            case
              when $3::text = 'admin' then 'owner'
              when w.scope = 'team' then coalesce(wm.role, $3::text)
              else wm.role
            end as member_role,
            (select count(*)::int from assets a where a.workspace_id = w.id and a.deleted_at is null) as asset_count
     from workspaces w
     left join workspace_members wm on wm.workspace_id = w.id and wm.user_id = $1
     where w.tenant_id = $2
       and ($4::text = 'all' or w.status = $4)
       and ($3::text = 'admin' or w.scope = 'team' or w.owner_id = $1 or wm.user_id is not null)
     order by case w.scope when 'team' then 0 else 1 end,
              (select count(*)::int from assets a where a.workspace_id = w.id and a.deleted_at is null) desc,
              w.updated_at desc`,
    [user.id, user.tenant_id, user.role, status]
  );
}

export function permissionMessage(action: "read" | "write" | "manage") {
  return action === "read" ? "缺少查看权限" : action === "write" ? "缺少编辑权限" : "缺少管理权限";
}
