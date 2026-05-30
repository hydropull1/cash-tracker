# Cash Tracker

A Vite React app for tracking cash pickups and dropoffs by day and week. Users authenticate with Supabase email/password auth, and every transaction is stored against the signed-in user.

## Local setup

Create a `.env` file:

```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Install dependencies and run the app:

```bash
npm install
npm run dev
```

## Supabase schema

Run this SQL in the Supabase SQL editor:

```sql
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('pickup', 'dropoff')),
  place text not null,
  amount numeric(12, 2) not null check (amount > 0),
  transaction_date date not null,
  note text,
  created_at timestamptz not null default now()
);

alter table public.transactions enable row level security;

create policy "Users can read their own transactions"
on public.transactions for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own transactions"
on public.transactions for insert
to authenticated
with check (auth.uid() = user_id);
```
