-- À exécuter une fois dans Supabase : Project -> SQL Editor -> New query.
create table public.preferences (
  user_id uuid references auth.users(id) on delete cascade primary key,
  favorite_categories text[] default '{}',
  home_zone text,
  favorite_event_ids text[] default '{}',
  age_range text,
  humor_types text[] default '{}',
  show_types text[] default '{}',
  budget text,
  audience text,
  when_pref text,
  kyc_completed boolean default false,
  updated_at timestamptz default now()
);

alter table public.preferences enable row level security;

create policy "Users manage their own preferences"
  on public.preferences
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
