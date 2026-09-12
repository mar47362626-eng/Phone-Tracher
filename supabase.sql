create table if not exists public.app_state (
  id integer primary key check (id = 1),
  state jsonb not null default '{"people": []}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;