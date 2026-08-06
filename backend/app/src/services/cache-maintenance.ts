import { query } from "../db/pool.js";

export async function cleanupRetrievalCaches(batchSize = 5_000) {
  const expiredScopes = await query<{ count: number }>(
    `with deleted as (
       delete from retrieval_scope_cache where ctid in (
         select ctid from retrieval_scope_cache where expires_at <= now() limit $1
       ) returning 1
     ) select count(*)::int as count from deleted`,
    [batchSize]
  );
  const expiredLegacy = await query<{ count: number }>(
    `with deleted as (
       delete from retrieval_result_cache where ctid in (
         select ctid from retrieval_result_cache where expires_at <= now() limit $1
       ) returning 1
     ) select count(*)::int as count from deleted`,
    [batchSize]
  );
  const staleEmbeddings = await query<{ count: number }>(
    `with deleted as (
       delete from query_embedding_cache_v2 where ctid in (
         select ctid from query_embedding_cache_v2 where last_used_at < now() - interval '30 days' limit $1
       ) returning 1
     ) select count(*)::int as count from deleted`,
    [batchSize]
  );
  return {
    scopes: expiredScopes[0]?.count || 0,
    legacy: expiredLegacy[0]?.count || 0,
    embeddings: staleEmbeddings[0]?.count || 0
  };
}
