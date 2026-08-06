import { one, query } from "../../db/pool.js";
import type { Note, NoteFact, NoteFolder } from "../../db/schema.js";

export async function findNote(tenantId: string, id: string, includeDeleted = false) {
  return one<Note>(
    `select * from notes where id = $1 and tenant_id = $2 ${includeDeleted ? "" : "and status = 'active'"}`,
    [id, tenantId]
  );
}

export async function listNoteFacts(tenantId: string, workspaceId: string, status?: NoteFact["status"], noteId?: string) {
  const values: unknown[] = [tenantId, workspaceId];
  let sql = `select * from note_facts where tenant_id = $1 and workspace_id = $2`;
  if (status) {
    values.push(status);
    sql += ` and status = $${values.length}`;
  }
  if (noteId) {
    values.push(noteId);
    sql += ` and note_id = $${values.length}`;
  }
  return query<NoteFact>(`${sql} order by updated_at desc`, values);
}

export async function listVerifiedFactText(tenantId: string, workspaceId: string, limit = 20) {
  const rows = await query<Pick<NoteFact, "fact" | "corrected_fact">>(
    `select fact, corrected_fact from note_facts
     where tenant_id = $1 and workspace_id = $2 and status = 'verified'
     order by updated_at desc limit $3`,
    [tenantId, workspaceId, limit]
  );
  return rows.map((row) => row.corrected_fact || row.fact);
}

export async function createFolder(input: Pick<NoteFolder, "id" | "tenant_id" | "workspace_id" | "owner_id" | "parent_id" | "name">) {
  return one<NoteFolder>(
    `insert into note_folders (id, tenant_id, workspace_id, owner_id, parent_id, name)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [input.id, input.tenant_id, input.workspace_id, input.owner_id, input.parent_id, input.name]
  );
}
