import { query } from "../../db/pool.js";
import type { RagEvaluationRun, User } from "../../db/schema.js";
import { retrieveDocumentKnowledge } from "../../services/document-retrieval.js";
import { createId } from "../../utils/id.js";
import { average, evaluationFailure } from "./metrics.js";

interface EvaluationFixture {
  trace_id: string;
  question: string;
  expected_document_ids: string[];
  citation_correct: boolean;
}

export async function runRagEvaluation(user: User, workspaceId: string) {
  const runId = createId("rag_eval");
  const [run] = await query<RagEvaluationRun>(
    `insert into rag_evaluation_runs (id, tenant_id, workspace_id, created_by)
     values ($1,$2,$3,$4) returning *`,
    [runId, user.tenant_id, workspaceId, user.id]
  );

  try {
    const fixtures = await query<EvaluationFixture>(
      `select t.id as trace_id, t.question,
              array_agg(distinct mc.asset_id) filter (where mc.asset_id is not null) as expected_document_ids,
              bool_and(case
                when mc.asset_id is not null then a.id is not null and a.deleted_at is null
                when mc.kind = 'web' then mc.url is not null
                else mc.gbrain_slug is not null
              end) as citation_correct
         from qa_traces t
         join message_citations mc on mc.message_id = t.assistant_message_id
         left join assets a on a.id = mc.asset_id
        where t.tenant_id = $1 and t.workspace_id = $2 and t.status = 'completed'
          and t.created_at >= now() - interval '90 days'
        group by t.id, t.question
        having count(mc.id) > 0
        order by max(t.created_at) desc
        limit 30`,
      [user.tenant_id, workspaceId]
    );

    const recalls: number[] = [];
    const accuracies: number[] = [];
    const citationScores: number[] = [];
    for (const fixture of fixtures) {
      const startedAt = Date.now();
      const expected = [...new Set(fixture.expected_document_ids || [])];
      try {
        const results = await retrieveDocumentKnowledge(user.tenant_id, workspaceId, fixture.question);
        const retrieved = [...new Set(results.map((item) => item.assetId).filter(Boolean))];
        const hit = retrieved.filter((id) => expected.includes(id));
        const missed = expected.filter((id) => !hit.includes(id));
        const recall = expected.length ? hit.length / expected.length : 0;
        const accuracy = retrieved.length ? hit.length / retrieved.length : 0;
        const passed = recall >= 0.8 && accuracy >= 0.5 && fixture.citation_correct;
        recalls.push(recall);
        accuracies.push(accuracy);
        citationScores.push(fixture.citation_correct ? 1 : 0);
        await saveQuery({
          runId, tenantId: user.tenant_id, fixture, status: passed ? "passed" : "failed",
          expected, hit, missed, recall, accuracy,
          failureReason: passed ? null : evaluationFailure(recall, accuracy, fixture.citation_correct),
          durationMs: Date.now() - startedAt,
          details: { retrievedDocumentIds: retrieved, retrievedDocuments: results.map((item) => ({ assetId: item.assetId, title: item.title, score: item.score })) }
        });
      } catch (error) {
        recalls.push(0);
        accuracies.push(0);
        citationScores.push(fixture.citation_correct ? 1 : 0);
        await saveQuery({
          runId, tenantId: user.tenant_id, fixture, status: "failed", expected,
          hit: [], missed: expected, recall: 0, accuracy: 0,
          failureReason: error instanceof Error ? error.message : "检索服务异常",
          durationMs: Date.now() - startedAt, details: {}
        });
      }
    }

    const [completed] = await query<RagEvaluationRun>(
      `update rag_evaluation_runs
          set status = 'completed', query_count = $2, recall = $3, accuracy = $4,
              citation_correctness = $5, completed_at = now()
        where id = $1 returning *`,
      [runId, fixtures.length, average(recalls), average(accuracies), average(citationScores)]
    );
    return completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "RAG 评测失败";
    await query(
      `update rag_evaluation_runs set status = 'failed', error = $2, completed_at = now() where id = $1`,
      [runId, message.slice(0, 2_000)]
    );
    throw error;
  }
}

async function saveQuery(input: {
  runId: string;
  tenantId: string;
  fixture: EvaluationFixture;
  status: "passed" | "failed";
  expected: string[];
  hit: string[];
  missed: string[];
  recall: number;
  accuracy: number;
  failureReason: string | null;
  durationMs: number;
  details: Record<string, unknown>;
}) {
  await query(
    `insert into rag_evaluation_queries
      (id, tenant_id, run_id, trace_id, question, status, expected_document_ids,
       hit_document_ids, missed_document_ids, recall, accuracy, citation_correct,
       failure_reason, details, duration_ms)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      createId("rag_query"), input.tenantId, input.runId, input.fixture.trace_id, input.fixture.question,
      input.status, input.expected, input.hit, input.missed, input.recall, input.accuracy,
      input.fixture.citation_correct, input.failureReason, JSON.stringify(input.details), input.durationMs
    ]
  );
}
