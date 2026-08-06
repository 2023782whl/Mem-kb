import type pg from "pg";

export async function runMigrations(client: pg.PoolClient) {
  await client.query(`select set_config('app.system', 'true', false)`);
  await client.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'aiteam_runtime') then
        create role aiteam_runtime nologin nosuperuser nocreatedb nocreaterole noinherit;
      end if;
    end
    $$;
  `);
  await client.query(`create extension if not exists vector`);
  await client.query(`create extension if not exists pg_trgm`);

  await client.query(`
    create table if not exists tenants (
      id text primary key,
      name text not null,
      created_at timestamptz not null default now()
    );

    create table if not exists users (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      email text not null unique,
      name text not null,
      password_hash text not null,
      role text not null default 'viewer' check (role in ('admin','editor','viewer')),
      is_admin boolean not null default false,
      status text not null default 'active' check (status in ('active','disabled')),
      avatar_type text not null default 'initials' check (avatar_type in ('initials','preset','upload')),
      avatar_value text,
      created_at timestamptz not null default now()
    );

    alter table users add column if not exists role text;
    alter table users add column if not exists avatar_type text not null default 'initials';
    alter table users add column if not exists avatar_value text;
    update users
       set role = case when is_admin then 'admin' else coalesce(role, 'viewer') end
     where role is null or is_admin = true;
    alter table users alter column role set default 'viewer';
    alter table users alter column role set not null;
    do $$
    begin
      if not exists (select 1 from pg_constraint where conname = 'users_role_check') then
        alter table users add constraint users_role_check check (role in ('admin','editor','viewer'));
      end if;
    end
    $$;

    create table if not exists sessions (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      token_hash text not null unique,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    );

    create table if not exists business_units (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      name text not null,
      description text not null default '',
      created_at timestamptz not null default now(),
      unique (tenant_id, name)
    );

    create table if not exists business_unit_members (
      business_unit_id text not null references business_units(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      role text not null check (role in ('owner','editor','viewer')),
      created_at timestamptz not null default now(),
      primary key (business_unit_id, user_id)
    );

    create table if not exists workspaces (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      owner_id text not null references users(id),
      name text not null,
      description text not null default '',
      scope text not null check (scope in ('personal','team')),
      kind text not null default 'document' check (kind in ('document','image','mixed')),
      gbrain_source_id text not null,
      status text not null default 'active' check (status in ('active','archived')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    alter table workspaces add column if not exists business_unit_id text references business_units(id) on delete set null;

    create table if not exists workspace_members (
      workspace_id text not null references workspaces(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      role text not null check (role in ('owner','editor','viewer')),
      created_at timestamptz not null default now(),
      primary key (workspace_id, user_id)
    );

    create table if not exists categories (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      parent_id text references categories(id) on delete cascade,
      level smallint not null check (level between 1 and 3),
      name text not null,
      sort_order integer not null default 0,
      created_at timestamptz not null default now(),
      unique (workspace_id, parent_id, name)
    );

    create table if not exists products (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      category_id text not null references categories(id) on delete cascade,
      name text not null,
      attributes jsonb not null default '{}'::jsonb,
      sort_order integer not null default 0,
      created_at timestamptz not null default now()
    );
    alter table products add column if not exists sort_order integer not null default 0;

    create table if not exists assets (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      owner_id text not null references users(id),
      type text not null check (type in ('document','image','video','webpage','ai_answer')),
      format text not null default '',
      title text not null,
      mime_type text not null default 'text/markdown',
      size_bytes bigint not null default 0,
      storage_key text not null,
      sha256 text not null,
      status text not null check (status in ('queued','indexing','ready','failed','deleted')),
      summary text,
      extracted_text text,
      gbrain_slug text,
      error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    );

    alter table assets add column if not exists category_id text references categories(id) on delete set null;
    alter table assets add column if not exists product_id text references products(id) on delete set null;
    alter table assets add column if not exists source_url text;
    alter table assets add column if not exists ocr_text text;
    alter table assets add column if not exists tags text[] not null default '{}';
    alter table assets add column if not exists metadata jsonb not null default '{}'::jsonb;
    alter table assets add column if not exists markdown_storage_key text;
    alter table assets add column if not exists processing_provider text;
    alter table assets add column if not exists processing_version text;
    alter table assets add column if not exists processed_at timestamptz;
    alter table assets add column if not exists thumbnail_storage_key text;
    alter table assets add column if not exists index_text text;

    create table if not exists asset_media (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      asset_id text not null references assets(id) on delete cascade,
      storage_key text not null,
      mime_type text not null,
      size_bytes bigint not null,
      sha256 text not null,
      width integer,
      height integer,
      sequence integer not null default 0,
      alt_text text not null default '',
      ocr_text text not null default '',
      description text not null default '',
      anchor jsonb not null default '{}'::jsonb,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (asset_id, sha256)
    );
    create index if not exists idx_asset_media_asset_sequence on asset_media(asset_id, sequence);

    create table if not exists conversations (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      user_id text not null references users(id),
      title text not null,
      model_id text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    alter table conversations add column if not exists workspace_ids text[] not null default '{}';
    update conversations set workspace_ids = array[workspace_id] where cardinality(workspace_ids) = 0;

    create table if not exists messages (
      id text primary key,
      conversation_id text not null references conversations(id) on delete cascade,
      role text not null check (role in ('user','assistant')),
      content text not null,
      model_id text,
      created_at timestamptz not null default now()
    );

    create table if not exists message_citations (
      id text primary key,
      message_id text not null references messages(id) on delete cascade,
      asset_id text references assets(id) on delete set null,
      gbrain_slug text,
      title text not null,
      snippet text not null,
      score double precision not null default 0,
      created_at timestamptz not null default now()
    );

    alter table message_citations add column if not exists kind text not null default 'document';
    alter table message_citations add column if not exists url text;
    alter table message_citations add column if not exists workspace_id text references workspaces(id) on delete set null;

    create table if not exists query_events (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      conversation_id text references conversations(id) on delete set null,
      normalized_question text not null,
      model_id text not null,
      source_flags jsonb not null default '{}'::jsonb,
      latency_ms integer,
      created_at timestamptz not null default now()
    );
    alter table query_events add column if not exists workspace_ids text[] not null default '{}';
    update query_events set workspace_ids = array[workspace_id] where cardinality(workspace_ids) = 0;

    create table if not exists qa_traces (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      workspace_ids text[] not null default '{}',
      user_id text not null references users(id) on delete cascade,
      conversation_id text references conversations(id) on delete set null,
      user_message_id text references messages(id) on delete set null,
      assistant_message_id text references messages(id) on delete set null,
      source text not null default 'web' check (source in ('web','wechat')),
      status text not null default 'running' check (status in ('running','completed','failed','cancelled')),
      rating text check (rating in ('up','down')),
      issue_type text not null default 'none',
      question text not null,
      answer_preview text not null default '',
      model_id text not null,
      source_flags jsonb not null default '{}'::jsonb,
      citation_count integer not null default 0,
      duration_ms integer,
      error text,
      created_at timestamptz not null default now(),
      completed_at timestamptz,
      updated_at timestamptz not null default now()
    );

    create table if not exists qa_trace_events (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      trace_id text not null references qa_traces(id) on delete cascade,
      phase text not null,
      status text not null check (status in ('running','completed','failed','skipped')),
      detail text not null default '',
      duration_ms integer,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create table if not exists rag_evaluation_runs (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      created_by text not null references users(id) on delete cascade,
      status text not null default 'running' check (status in ('running','completed','failed')),
      query_count integer not null default 0,
      recall double precision not null default 0,
      accuracy double precision not null default 0,
      citation_correctness double precision not null default 0,
      error text,
      started_at timestamptz not null default now(),
      completed_at timestamptz,
      created_at timestamptz not null default now()
    );

    create table if not exists rag_evaluation_queries (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      run_id text not null references rag_evaluation_runs(id) on delete cascade,
      trace_id text references qa_traces(id) on delete set null,
      question text not null,
      status text not null check (status in ('passed','failed','skipped')),
      expected_document_ids text[] not null default '{}',
      hit_document_ids text[] not null default '{}',
      missed_document_ids text[] not null default '{}',
      recall double precision not null default 0,
      accuracy double precision not null default 0,
      citation_correct boolean not null default false,
      failure_reason text,
      details jsonb not null default '{}'::jsonb,
      duration_ms integer not null default 0,
      created_at timestamptz not null default now()
    );

    create table if not exists consolidation_configs (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade unique,
      enabled boolean not null default false,
      schedule_time text not null default '02:30',
      timezone text not null default 'Asia/Shanghai',
      workspace_ids text[] not null default '{}',
      updated_by text references users(id) on delete set null,
      next_run_at timestamptz,
      last_run_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists consolidation_runs (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      trigger text not null check (trigger in ('manual','cron')),
      status text not null default 'running' check (status in ('running','completed','failed')),
      workspace_ids text[] not null default '{}',
      conversations_scanned integer not null default 0,
      relations_added integer not null default 0,
      citations_repaired integer not null default 0,
      structures_organized integer not null default 0,
      error text,
      scheduled_key text,
      lease_owner text,
      lease_expires_at timestamptz,
      started_at timestamptz not null default now(),
      completed_at timestamptz,
      created_at timestamptz not null default now(),
      unique (tenant_id, scheduled_key)
    );

    alter table consolidation_runs add column if not exists lease_owner text;
    alter table consolidation_runs add column if not exists lease_expires_at timestamptz;

    create table if not exists consolidation_logs (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      run_id text not null references consolidation_runs(id) on delete cascade,
      phase text not null,
      level text not null default 'info' check (level in ('info','warning','error')),
      message text not null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create table if not exists channel_bindings (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      created_by text not null references users(id) on delete cascade,
      channel text not null default 'wechat' check (channel in ('wechat')),
      workspace_ids text[] not null,
      status text not null default 'pending' check (status in ('pending','active','expired','disabled')),
      connected boolean not null default false,
      credentials_enc text,
      config jsonb not null default '{}'::jsonb,
      lease_owner text,
      lease_expires_at timestamptz,
      last_connected_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    alter table channel_bindings add column if not exists lease_owner text;
    alter table channel_bindings add column if not exists lease_expires_at timestamptz;

    create unique index if not exists idx_channel_bindings_wechat_account
      on channel_bindings ((config->>'ilinkBotId'))
      where config->>'ilinkBotId' is not null and status <> 'disabled';

    create table if not exists channel_identities (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      binding_id text not null references channel_bindings(id) on delete cascade,
      external_user_id text not null,
      user_id text references users(id) on delete set null,
      display_name text not null default '',
      is_group boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (binding_id, external_user_id)
    );

    create table if not exists channel_messages (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      binding_id text not null references channel_bindings(id) on delete cascade,
      external_event_id text,
      external_conversation_id text not null,
      external_user_id text not null,
      direction text not null check (direction in ('inbound','outbound')),
      is_group boolean not null default false,
      content text not null,
      status text not null check (status in ('received','processing','completed','failed')),
      error text,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    alter table channel_messages add column if not exists attempts integer not null default 0;
    alter table channel_messages add column if not exists processing_started_at timestamptz;
    create unique index if not exists idx_channel_message_event
      on channel_messages(binding_id, external_event_id)
      where external_event_id is not null;

    create table if not exists channel_deliveries (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      binding_id text not null references channel_bindings(id) on delete cascade,
      message_id text references channel_messages(id) on delete set null,
      external_conversation_id text not null,
      status text not null check (status in ('pending','sending','delivered','failed')),
      attempts integer not null default 0,
      last_error text,
      delivered_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists graph_nodes (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      asset_id text references assets(id) on delete cascade,
      slug text not null,
      label text not null,
      node_type text not null,
      summary text not null default '',
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (workspace_id, slug)
    );

    create table if not exists graph_edges (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      source_node_id text not null references graph_nodes(id) on delete cascade,
      target_node_id text not null references graph_nodes(id) on delete cascade,
      relation text not null,
      evidence_asset_id text references assets(id) on delete cascade,
      evidence text not null default '',
      created_at timestamptz not null default now(),
      unique (workspace_id, source_node_id, target_node_id, relation, evidence_asset_id)
    );

    alter table graph_edges add column if not exists source text not null default 'extraction';
    alter table graph_edges add column if not exists confidence double precision not null default 1;
    alter table graph_edges add column if not exists metadata jsonb not null default '{}'::jsonb;

    create table if not exists asset_entities (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      asset_id text not null references assets(id) on delete cascade,
      label text not null,
      normalized_label text not null,
      entity_type text not null default 'topic',
      evidence text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (asset_id, normalized_label, entity_type)
    );

    create table if not exists image_embeddings (
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      asset_id text primary key references assets(id) on delete cascade,
      model_id text not null,
      embedding vector(1024) not null,
      created_at timestamptz not null default now()
    );

    create table if not exists document_chunks (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      asset_id text not null references assets(id) on delete cascade,
      chunk_index integer not null,
      heading text not null default '',
      content text not null,
      content_hash text not null,
      model_id text not null,
      embedding vector(1024) not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (asset_id, chunk_index)
    );

    create table if not exists query_embedding_cache (
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      query_hash text not null,
      model_id text not null,
      embedding vector(1024) not null,
      created_at timestamptz not null default now(),
      last_used_at timestamptz not null default now(),
      primary key (tenant_id, workspace_id, query_hash, model_id)
    );

    create table if not exists retrieval_result_cache (
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      query_hash text not null,
      embedding_model_id text not null,
      reranker_model_id text not null,
      results jsonb not null,
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      primary key (tenant_id, workspace_id, query_hash, embedding_model_id, reranker_model_id)
    );

    create table if not exists query_embedding_cache_v2 (
      tenant_id text not null references tenants(id) on delete cascade,
      query_hash text not null,
      model_id text not null,
      embedding vector(1024) not null,
      created_at timestamptz not null default now(),
      last_used_at timestamptz not null default now(),
      primary key (tenant_id, query_hash, model_id)
    );

    create table if not exists retrieval_scope_cache (
      tenant_id text not null references tenants(id) on delete cascade,
      scope_hash text not null,
      workspace_ids text[] not null,
      query_hash text not null,
      embedding_model_id text not null,
      reranker_model_id text not null,
      results jsonb not null,
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      primary key (tenant_id, scope_hash, query_hash, embedding_model_id, reranker_model_id)
    );

    create table if not exists model_configs (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      name text not null,
      kind text not null default 'LLM' check (kind in ('LLM','IMAGE')),
      api_protocol text not null default 'openai_chat_completions'
        check (api_protocol in ('openai_chat_completions','anthropic_messages','gemini_generate_content')),
      base_url text not null,
      model_name text not null,
      api_key_encrypted text not null,
      temperature double precision not null default 0.2,
      max_tokens integer not null default 8192 check (max_tokens between 128 and 200000),
      supports_vision boolean not null default false,
      capabilities jsonb not null default '[]'::jsonb,
      extra_body jsonb not null default '{}'::jsonb,
      enabled boolean not null default false,
      is_default boolean not null default false,
      verification_status text not null default 'unverified'
        check (verification_status in ('unverified','verifying','verified','failed')),
      verification_error text,
      verified_fingerprint text,
      config_revision integer not null default 1,
      security_revision integer not null default 1,
      key_revision integer not null default 1,
      verified_at timestamptz,
      deleted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tenant_id, name)
    );
    alter table model_configs drop constraint if exists model_configs_tenant_id_name_key;
    create unique index if not exists idx_model_configs_tenant_name_active
      on model_configs(tenant_id, name) where deleted_at is null;

    create table if not exists jobs (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      asset_id text references assets(id) on delete cascade,
      type text not null,
      status text not null check (status in ('queued','running','ready','failed')),
      attempts integer not null default 0,
      progress integer not null default 0,
      error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists feedback (
      id text primary key,
      message_id text not null references messages(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      value text not null check (value in ('up','down')),
      created_at timestamptz not null default now(),
      unique (message_id, user_id)
    );

    create table if not exists capture_records (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      source_message_id text references messages(id) on delete set null,
      asset_id text references assets(id) on delete set null,
      status text not null check (status in ('ready','failed')),
      error text,
      created_at timestamptz not null default now()
    );

    create table if not exists note_folders (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      owner_id text not null references users(id) on delete cascade,
      parent_id text references note_folders(id) on delete cascade,
      name text not null,
      sort_order integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists notes (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      owner_id text not null references users(id) on delete cascade,
      folder_id text references note_folders(id) on delete set null,
      title text not null,
      content_markdown text not null default '',
      tags text[] not null default '{}',
      is_favorite boolean not null default false,
      status text not null default 'active' check (status in ('active','deleted')),
      sync_status text not null default 'pending' check (sync_status in ('pending','synced','failed')),
      sync_error text,
      gbrain_slug text not null unique,
      version integer not null default 1,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    );

    alter table notes add column if not exists content_json jsonb not null default '{}'::jsonb;
    alter table notes add column if not exists source_asset_id text references assets(id) on delete set null;
    alter table notes add column if not exists published_asset_id text references assets(id) on delete set null;
    alter table notes add column if not exists published_version integer not null default 0;
    alter table notes add column if not exists auto_publish boolean not null default false;
    alter table notes add column if not exists last_published_hash text;
    alter table notes add column if not exists last_published_at timestamptz;

    update notes
       set published_version = 1,
           last_published_at = coalesce(last_published_at, updated_at)
     where published_version = 0 and sync_status = 'synced';

    create table if not exists note_revisions (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      note_id text not null references notes(id) on delete cascade,
      published_asset_id text references assets(id) on delete set null,
      created_by text not null references users(id),
      version integer not null,
      title text not null,
      content_markdown text not null,
      content_json jsonb not null default '{}'::jsonb,
      content_hash text not null,
      created_at timestamptz not null default now(),
      unique (note_id, version)
    );

    create table if not exists note_facts (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      note_id text not null references notes(id) on delete cascade,
      gbrain_fact_id bigint,
      fact text not null,
      corrected_fact text,
      kind text not null default 'knowledge',
      entity_slug text,
      confidence double precision not null default 0,
      status text not null default 'pending' check (status in ('pending','verified','forgotten')),
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists audit_logs (
      id text primary key,
      tenant_id text not null,
      user_id text,
      action text not null,
      resource_type text not null,
      resource_id text not null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create index if not exists idx_workspaces_tenant on workspaces(tenant_id, status);
    create index if not exists idx_business_units_tenant on business_units(tenant_id, name);
    create index if not exists idx_members_user on workspace_members(user_id, workspace_id);
    create index if not exists idx_assets_workspace on assets(workspace_id, status, created_at desc);
    create index if not exists idx_assets_title_trgm on assets using gin(title gin_trgm_ops);
    create index if not exists idx_categories_workspace on categories(workspace_id, level, sort_order);
    create index if not exists idx_products_category on products(category_id, created_at desc);
    create unique index if not exists idx_assets_dedupe on assets(tenant_id, workspace_id, sha256) where deleted_at is null;
    create index if not exists idx_messages_conversation on messages(conversation_id, created_at);
    create index if not exists idx_query_events_workspace_time on query_events(workspace_id, created_at desc);
    create index if not exists idx_qa_traces_tenant_time on qa_traces(tenant_id, created_at desc);
    create index if not exists idx_qa_traces_filters on qa_traces(tenant_id, status, source, issue_type, created_at desc);
    create index if not exists idx_qa_trace_events_trace on qa_trace_events(trace_id, created_at);
    create index if not exists idx_rag_evaluation_runs_workspace on rag_evaluation_runs(workspace_id, created_at desc);
    create index if not exists idx_rag_evaluation_queries_run on rag_evaluation_queries(run_id, created_at);
    create index if not exists idx_consolidation_runs_tenant on consolidation_runs(tenant_id, created_at desc);
    create index if not exists idx_consolidation_runs_pending on consolidation_runs(status, lease_expires_at)
      where status = 'running';
    create index if not exists idx_consolidation_logs_run on consolidation_logs(run_id, created_at);
    create index if not exists idx_channel_bindings_tenant on channel_bindings(tenant_id, updated_at desc);
    create index if not exists idx_channel_bindings_lease
      on channel_bindings(status, lease_expires_at)
      where status = 'active' and credentials_enc is not null;
    create index if not exists idx_channel_identities_binding on channel_identities(binding_id, updated_at desc);
    create index if not exists idx_channel_messages_binding on channel_messages(binding_id, created_at desc);
    create index if not exists idx_channel_deliveries_binding on channel_deliveries(binding_id, created_at desc);
    create index if not exists idx_graph_nodes_workspace on graph_nodes(workspace_id, node_type);
    create unique index if not exists idx_graph_nodes_asset on graph_nodes(workspace_id, asset_id) where asset_id is not null;
    create index if not exists idx_graph_edges_workspace on graph_edges(workspace_id, source_node_id, target_node_id);
    delete from graph_edges older using graph_edges newer
    where older.ctid < newer.ctid
      and older.workspace_id = newer.workspace_id
      and older.source_node_id = newer.source_node_id
      and older.target_node_id = newer.target_node_id
      and older.relation = newer.relation
      and older.source = newer.source;
    create unique index if not exists idx_graph_edges_asset_pair on graph_edges(workspace_id, source_node_id, target_node_id, relation, source);
    create index if not exists idx_asset_entities_workspace on asset_entities(workspace_id, normalized_label, asset_id);
    create index if not exists idx_image_embeddings_workspace on image_embeddings(workspace_id, asset_id);
    create index if not exists idx_image_embeddings_embedding_hnsw on image_embeddings using hnsw(embedding vector_cosine_ops);
    create index if not exists idx_document_chunks_workspace on document_chunks(tenant_id, workspace_id, asset_id, chunk_index);
    create index if not exists idx_document_chunks_content_trgm on document_chunks using gin(content gin_trgm_ops);
    create index if not exists idx_document_chunks_embedding_hnsw on document_chunks using hnsw(embedding vector_cosine_ops);
    create index if not exists idx_query_embedding_cache_last_used on query_embedding_cache(last_used_at);
    create index if not exists idx_retrieval_result_cache_expiry on retrieval_result_cache(expires_at);
    create index if not exists idx_query_embedding_cache_v2_last_used on query_embedding_cache_v2(last_used_at);
    create index if not exists idx_retrieval_scope_cache_expiry on retrieval_scope_cache(expires_at);
    create unique index if not exists idx_model_configs_tenant_kind_default
      on model_configs(tenant_id, kind) where is_default = true and deleted_at is null;
    create index if not exists idx_model_configs_tenant on model_configs(tenant_id, kind, enabled, updated_at desc);
    create index if not exists idx_jobs_status on jobs(status, created_at);
    create index if not exists idx_note_folders_workspace on note_folders(workspace_id, parent_id, sort_order);
    create unique index if not exists idx_note_folders_name on note_folders(workspace_id, coalesce(parent_id, ''), lower(name));
    create index if not exists idx_notes_workspace on notes(workspace_id, status, updated_at desc);
    create index if not exists idx_notes_folder on notes(folder_id, status, updated_at desc);
    create index if not exists idx_notes_search on notes using gin((title || ' ' || content_markdown) gin_trgm_ops);
    create index if not exists idx_notes_source_asset on notes(source_asset_id, status);
    create index if not exists idx_note_revisions_note on note_revisions(note_id, version desc);
    create index if not exists idx_note_facts_workspace on note_facts(workspace_id, status, updated_at desc);
    create unique index if not exists idx_note_facts_gbrain on note_facts(note_id, gbrain_fact_id) where gbrain_fact_id is not null;
    create index if not exists idx_audit_tenant_time on audit_logs(tenant_id, created_at desc);
  `);

  for (const table of [
    "tenants", "users", "sessions", "business_units", "business_unit_members", "workspaces", "workspace_members",
    "categories", "products", "assets", "asset_media", "conversations", "messages", "message_citations", "query_events", "graph_nodes",
    "graph_edges", "asset_entities", "image_embeddings", "document_chunks", "query_embedding_cache", "retrieval_result_cache",
    "query_embedding_cache_v2", "retrieval_scope_cache", "model_configs", "jobs",
    "feedback", "capture_records", "note_folders", "notes", "note_revisions", "note_facts", "audit_logs",
    "qa_traces", "qa_trace_events", "rag_evaluation_runs", "rag_evaluation_queries",
    "consolidation_configs", "consolidation_runs", "consolidation_logs",
    "channel_bindings", "channel_identities", "channel_messages", "channel_deliveries"
  ]) {
    await client.query(`alter table ${table} enable row level security`);
  }

  await client.query(`
    insert into asset_entities
      (id, tenant_id, workspace_id, asset_id, label, normalized_label, entity_type, evidence)
    select
      'entity_migrated_' || md5(asset_node.asset_id || ':' || lower(topic_node.label) || ':' || topic_node.node_type),
      asset_node.tenant_id,
      asset_node.workspace_id,
      asset_node.asset_id,
      topic_node.label,
      lower(regexp_replace(trim(topic_node.label), '\\s+', '', 'g')),
      coalesce(nullif(topic_node.node_type, ''), 'topic'),
      edge.evidence
    from graph_edges edge
    join graph_nodes asset_node on asset_node.id = edge.source_node_id and asset_node.asset_id is not null
    join graph_nodes topic_node on topic_node.id = edge.target_node_id and topic_node.asset_id is null
    where trim(topic_node.label) <> ''
    on conflict (asset_id, normalized_label, entity_type) do update
      set label = excluded.label, evidence = excluded.evidence, updated_at = now();

    delete from graph_nodes where asset_id is null;
    delete from graph_nodes node using assets asset
    where node.asset_id = asset.id and asset.deleted_at is not null;

    insert into graph_nodes
      (id, tenant_id, workspace_id, asset_id, slug, label, node_type, summary, metadata)
    select
      'node_asset_' || md5(asset.id), asset.tenant_id, asset.workspace_id, asset.id,
      asset.gbrain_slug, asset.title, asset.type, coalesce(asset.summary, ''), '{}'::jsonb
    from assets asset
    where asset.deleted_at is null and asset.status = 'ready' and asset.gbrain_slug is not null
    on conflict (workspace_id, slug) do update
      set asset_id = excluded.asset_id, label = excluded.label, node_type = excluded.node_type,
          summary = excluded.summary, updated_at = now();
  `);

  await client.query(`
    create or replace function aiteam_is_system() returns boolean
    language sql stable as $$
      select coalesce(current_setting('app.system', true), '') = 'true'
    $$;
    create or replace function aiteam_tenant_id() returns text
    language sql stable as $$
      select nullif(current_setting('app.tenant_id', true), '')
    $$;
    create or replace function aiteam_user_id() returns text
    language sql stable as $$
      select nullif(current_setting('app.user_id', true), '')
    $$;
  `);

  const tenantTables = [
    "users", "business_units", "workspaces", "categories", "products", "assets", "asset_media",
    "conversations", "query_events", "graph_nodes", "graph_edges", "asset_entities",
    "image_embeddings", "document_chunks", "query_embedding_cache", "retrieval_result_cache",
    "query_embedding_cache_v2", "retrieval_scope_cache", "model_configs",
    "jobs", "capture_records", "note_folders", "notes", "note_revisions", "note_facts", "audit_logs",
    "qa_traces", "qa_trace_events", "rag_evaluation_runs", "rag_evaluation_queries",
    "consolidation_configs", "consolidation_runs", "consolidation_logs",
    "channel_bindings", "channel_identities", "channel_messages", "channel_deliveries"
  ];
  for (const table of tenantTables) {
    await client.query(`drop policy if exists tenant_isolation on ${table}`);
    await client.query(`
      create policy tenant_isolation on ${table}
      for all
      using (aiteam_is_system() or tenant_id = aiteam_tenant_id())
      with check (aiteam_is_system() or tenant_id = aiteam_tenant_id())
    `);
  }

  await client.query(`
    drop policy if exists tenant_isolation on tenants;
    create policy tenant_isolation on tenants for all
      using (aiteam_is_system() or id = aiteam_tenant_id())
      with check (aiteam_is_system() or id = aiteam_tenant_id());

    drop policy if exists tenant_isolation on sessions;
    create policy tenant_isolation on sessions for all
      using (
        aiteam_is_system() or exists (
          select 1 from users u
          where u.id = sessions.user_id
            and u.tenant_id = aiteam_tenant_id()
            and u.id = aiteam_user_id()
        )
      )
      with check (
        aiteam_is_system() or exists (
          select 1 from users u
          where u.id = sessions.user_id
            and u.tenant_id = aiteam_tenant_id()
            and u.id = aiteam_user_id()
        )
      );

    drop policy if exists tenant_isolation on business_unit_members;
    create policy tenant_isolation on business_unit_members for all
      using (
        aiteam_is_system() or exists (
          select 1 from business_units bu
          where bu.id = business_unit_members.business_unit_id
            and bu.tenant_id = aiteam_tenant_id()
        )
      )
      with check (
        aiteam_is_system() or exists (
          select 1 from business_units bu
          where bu.id = business_unit_members.business_unit_id
            and bu.tenant_id = aiteam_tenant_id()
        )
      );

    drop policy if exists tenant_isolation on workspace_members;
    create policy tenant_isolation on workspace_members for all
      using (
        aiteam_is_system() or exists (
          select 1 from workspaces w
          where w.id = workspace_members.workspace_id
            and w.tenant_id = aiteam_tenant_id()
        )
      )
      with check (
        aiteam_is_system() or exists (
          select 1 from workspaces w
          where w.id = workspace_members.workspace_id
            and w.tenant_id = aiteam_tenant_id()
        )
      );

    drop policy if exists tenant_isolation on messages;
    create policy tenant_isolation on messages for all
      using (
        aiteam_is_system() or exists (
          select 1 from conversations c
          where c.id = messages.conversation_id
            and c.tenant_id = aiteam_tenant_id()
        )
      )
      with check (
        aiteam_is_system() or exists (
          select 1 from conversations c
          where c.id = messages.conversation_id
            and c.tenant_id = aiteam_tenant_id()
        )
      );

    drop policy if exists tenant_isolation on message_citations;
    create policy tenant_isolation on message_citations for all
      using (
        aiteam_is_system() or exists (
          select 1 from messages m
          join conversations c on c.id = m.conversation_id
          where m.id = message_citations.message_id
            and c.tenant_id = aiteam_tenant_id()
        )
      )
      with check (
        aiteam_is_system() or exists (
          select 1 from messages m
          join conversations c on c.id = m.conversation_id
          where m.id = message_citations.message_id
            and c.tenant_id = aiteam_tenant_id()
        )
      );

    drop policy if exists tenant_isolation on feedback;
    create policy tenant_isolation on feedback for all
      using (
        aiteam_is_system() or exists (
          select 1 from messages m
          join conversations c on c.id = m.conversation_id
          where m.id = feedback.message_id
            and c.tenant_id = aiteam_tenant_id()
        )
      )
      with check (
        aiteam_is_system() or exists (
          select 1 from messages m
          join conversations c on c.id = m.conversation_id
          where m.id = feedback.message_id
            and c.tenant_id = aiteam_tenant_id()
        )
      );
  `);

  for (const table of [
    "tenants", "users", "sessions", "business_units", "business_unit_members", "workspaces", "workspace_members",
    "categories", "products", "assets", "asset_media", "conversations", "messages", "message_citations", "query_events", "graph_nodes",
    "graph_edges", "asset_entities", "image_embeddings", "document_chunks", "query_embedding_cache", "retrieval_result_cache",
    "query_embedding_cache_v2", "retrieval_scope_cache", "model_configs",
    "jobs", "feedback", "capture_records", "note_folders", "notes", "note_revisions", "note_facts", "audit_logs",
    "qa_traces", "qa_trace_events", "rag_evaluation_runs", "rag_evaluation_queries",
    "consolidation_configs", "consolidation_runs", "consolidation_logs",
    "channel_bindings", "channel_identities", "channel_messages", "channel_deliveries"
  ]) {
    await client.query(`alter table ${table} force row level security`);
  }

  await client.query(`
    grant usage on schema public to aiteam_runtime;
    grant select, insert, update, delete on all tables in schema public to aiteam_runtime;
    grant usage, select on all sequences in schema public to aiteam_runtime;
    grant execute on all functions in schema public to aiteam_runtime;
    alter default privileges in schema public grant select, insert, update, delete on tables to aiteam_runtime;
    alter default privileges in schema public grant usage, select on sequences to aiteam_runtime;
    alter default privileges in schema public grant execute on functions to aiteam_runtime;
  `);
}
