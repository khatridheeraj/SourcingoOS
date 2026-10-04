# Sourcingo OS

The operating system for sourcing work at Sourcingo. Version 1 (fresh start, October 2026) does four things only:
orders (one per buyer PO, with style lines and factories), buyers (codes for the team, real names for the owner),
factories, and the team. New areas are added one at a time; see the long-term plan in the project.

Built with Next.js and Supabase. The schema, access rules and business rules live in `supabase/migrations`
and are tested by `supabase/tests/run.sh` (needs a local Postgres: `PGHOST=... PGUSER=... supabase/tests/run.sh`).

The first app is kept on the `archive/v1-app` branch, and its data in the database's private `old_app` schema.

## Set up

1. Create a Supabase project and apply the migrations in order (SQL editor or `supabase db push`).
2. In Supabase, go to Authentication > URL Configuration and add your site's `/auth/confirm` as a redirect URL.
3. Copy `.env.example` to `.env.local` and fill in the project URL and publishable key.
4. `npm install` then `npm run dev`, and open http://localhost:3000.

## First owner

Sign in once, then make yourself the owner of the first company in the SQL editor:

```sql
insert into members (company_id, user_id, role)
select c.id, p.id, 'owner' from companies c, profiles p where c.name = 'Sourcingo' and p.email = 'you@sourcingo.in';
update profiles set current_company_id = (select id from companies where name = 'Sourcingo') where email = 'you@sourcingo.in';
```

After that, the owner adds everyone else by email in Team.
