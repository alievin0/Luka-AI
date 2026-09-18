-- AI Receptionist — core schema
--
-- Design notes that matter:
--
--  * The database is the source of truth for availability. Double booking is
--    prevented by an EXCLUSION CONSTRAINT, not by application logic, so two
--    concurrent requests for the same slot cannot both succeed however the
--    app is deployed or scaled.
--  * Bookings carry both the local wall-clock fields the business reads
--    (date, start_time) and the absolute instants the constraint compares
--    (starts_at, ends_at). The application converts using the business
--    timezone; the database never guesses.
--  * Every tenant-owned table carries business_id and is covered by RLS, so
--    one business can never read another's customers, bookings or messages.

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";

-- ─────────────────────────────────────────────────────────────────────────
-- Business (the tenant)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists businesses (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  name              text not null,
  kind              text not null default 'other',
  timezone          text not null default 'Asia/Amman',
  city              text,
  address           text,
  map_url           text,
  phone             text,
  currency          text not null default 'JOD',
  -- booking rules
  lead_time_min     integer not null default 60  check (lead_time_min >= 0),
  slot_step_min     integer not null default 15  check (slot_step_min > 0),
  horizon_days      integer not null default 30  check (horizon_days > 0),
  policies          jsonb   not null default '{}'::jsonb,
  escalation_contact text,
  -- owner_id is the Supabase auth user who administers this business
  owner_id          uuid,
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists services (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  code         text not null,
  name         text not null,
  duration_min integer not null check (duration_min > 0),
  price        numeric(10,2),
  currency     text,
  note         text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (business_id, code)
);

create table if not exists staff (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name        text not null,
  role        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 0 = Sunday … 6 = Saturday. A missing row means closed that day.
create table if not exists business_hours (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),
  open_time   text not null,
  close_time  text not null,
  unique (business_id, weekday),
  check (close_time > open_time)
);

-- Holidays and one-off closures. A null time range means the whole day.
create table if not exists blocked_times (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  staff_id    uuid references staff(id) on delete cascade,
  date        date not null,
  start_time  text,
  end_time    text,
  reason      text,
  created_at  timestamptz not null default now(),
  check ((start_time is null) = (end_time is null))
);
create index if not exists blocked_times_lookup on blocked_times (business_id, date);

-- ─────────────────────────────────────────────────────────────────────────
-- People and conversations
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name        text,
  contact     text not null,
  channel     text not null default 'web',
  created_at  timestamptz not null default now(),
  unique (business_id, channel, contact)
);

create table if not exists conversations (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  customer_id  uuid references customers(id) on delete set null,
  channel      text not null,
  status       text not null default 'open'
                 check (status in ('open', 'awaiting_human', 'closed')),
  intent       text,
  started_at   timestamptz not null default now(),
  last_at      timestamptz not null default now()
);
create index if not exists conversations_recent on conversations (business_id, last_at desc);

create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('customer', 'agent', 'human')),
  body            text not null,
  -- external id from the channel, so a retried webhook cannot store twice
  external_id     text,
  created_at      timestamptz not null default now()
);
create index if not exists messages_by_conversation on messages (conversation_id, created_at);
create unique index if not exists messages_external_unique
  on messages (business_id, external_id) where external_id is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- Bookings — the database is the source of truth
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists bookings (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  service_id   uuid not null references services(id) on delete restrict,
  staff_id     uuid references staff(id) on delete set null,
  customer_id  uuid references customers(id) on delete set null,
  -- what the business reads, in its own local clock
  date         date not null,
  start_time   text not null,
  duration_min integer not null check (duration_min > 0),
  -- what the overlap constraint compares
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       text not null default 'confirmed'
                 check (status in ('confirmed', 'cancelled', 'completed', 'no_show')),
  note         text,
  source       text not null default 'agent',
  created_at   timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- The real double-booking guard. Two confirmed bookings for the same business
-- and the same staff member may not overlap in time. A booking with no staff
-- assigned occupies the business itself, which is the single-chair case.
alter table bookings drop constraint if exists bookings_no_overlap;
alter table bookings add constraint bookings_no_overlap
  exclude using gist (
    business_id with =,
    coalesce(staff_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'confirmed');

create index if not exists bookings_by_day on bookings (business_id, date, status);

-- ─────────────────────────────────────────────────────────────────────────
-- Escalations — what a person still has to handle
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists escalations (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  customer_id     uuid references customers(id) on delete set null,
  reason          text not null,
  matched         text,
  customer_message text not null,
  status          text not null default 'open'
                    check (status in ('open', 'acknowledged', 'resolved')),
  resolved_by     uuid,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create index if not exists escalations_open on escalations (business_id, status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- Knowledge the receptionist is allowed to state
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists knowledge_items (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  question    text not null,
  answer      text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- Channels
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists channels (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind        text not null check (kind in ('whatsapp', 'instagram', 'web', 'voice')),
  -- the channel's own account id (a WhatsApp phone_number_id, an IG account id)
  external_id text,
  status      text not null default 'not_configured'
                check (status in ('not_configured', 'connected', 'error')),
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (business_id, kind)
);
create unique index if not exists channels_external_unique
  on channels (kind, external_id) where external_id is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- Agents, tasks and events — the state the world visualization mirrors
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists agents (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  code        text not null,
  name        text not null,
  role        text not null,
  zone        text not null,
  state       text not null default 'idle'
                check (state in ('idle','working','processing','waiting',
                                 'using_tool','escalated','error','offline','deploying')),
  -- 'live' code exists and runs; 'planned' is designed and not built
  lifecycle   text not null default 'planned'
                check (lifecycle in ('live', 'planned')),
  updated_at  timestamptz not null default now(),
  unique (business_id, code)
);

create table if not exists tasks (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  agent_code      text,
  title           text not null,
  status          text not null default 'running'
                    check (status in ('running', 'completed', 'failed', 'escalated')),
  started_at      timestamptz not null default now(),
  ended_at        timestamptz
);
create index if not exists tasks_recent on tasks (business_id, started_at desc);

create table if not exists task_steps (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  seq        integer not null,
  label      text not null,
  status     text not null default 'done'
               check (status in ('done', 'failed', 'skipped')),
  detail     text,
  created_at timestamptz not null default now(),
  unique (task_id, seq)
);

create table if not exists agent_events (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  task_id     uuid references tasks(id) on delete set null,
  agent_code  text,
  kind        text not null,
  -- the visual edge the world draws: who → whom
  from_node   text,
  to_node     text,
  summary     text not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists agent_events_recent on agent_events (business_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- Row level security: one business can never read another's data
-- ─────────────────────────────────────────────────────────────────────────
alter table businesses      enable row level security;
alter table services        enable row level security;
alter table staff           enable row level security;
alter table business_hours  enable row level security;
alter table blocked_times   enable row level security;
alter table customers       enable row level security;
alter table conversations   enable row level security;
alter table messages        enable row level security;
alter table bookings        enable row level security;
alter table escalations     enable row level security;
alter table knowledge_items enable row level security;
alter table channels        enable row level security;
alter table agents          enable row level security;
alter table tasks           enable row level security;
alter table task_steps      enable row level security;
alter table agent_events    enable row level security;

-- A signed-in owner reads and writes only their own businesses.
drop policy if exists businesses_owner on businesses;
create policy businesses_owner on businesses
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Every tenant-owned table inherits that check through business_id.
do $$
declare t text;
begin
  foreach t in array array[
    'services','staff','business_hours','blocked_times','customers',
    'conversations','messages','bookings','escalations','knowledge_items',
    'channels','agents','tasks','agent_events'
  ]
  loop
    execute format('drop policy if exists %I_owner on %I', t, t);
    execute format($f$
      create policy %I_owner on %I
        for all to authenticated
        using (exists (select 1 from businesses b
                       where b.id = %I.business_id and b.owner_id = auth.uid()))
        with check (exists (select 1 from businesses b
                            where b.id = %I.business_id and b.owner_id = auth.uid()))
    $f$, t, t, t, t);
  end loop;
end $$;

-- task_steps reaches its business through its task.
drop policy if exists task_steps_owner on task_steps;
create policy task_steps_owner on task_steps
  for all to authenticated
  using (exists (select 1 from tasks tk join businesses b on b.id = tk.business_id
                 where tk.id = task_steps.task_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from tasks tk join businesses b on b.id = tk.business_id
                      where tk.id = task_steps.task_id and b.owner_id = auth.uid()));

-- NOTE: the receptionist server uses the SERVICE ROLE key, which bypasses RLS
-- by design — it acts for whichever business the channel routed to, and that
-- routing is the server's own isolation boundary. The service role key must
-- never reach the browser. RLS above protects the owner-facing dashboard,
-- which uses the anon key plus the signed-in user.
