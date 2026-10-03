# Sourcingo OS

Operating system for sourcing work at Sourcingo: inquiries, sales orders, TNA, warehouse (GRN and delivery challans), and portals for factories and buyers.

Built with Next.js and Supabase. The database schema, role-based access and business rules live in `supabase/migrations`.

## Set up

1. Create a Supabase project.
2. Apply the migrations in order (`supabase db push`, or paste each file from `supabase/migrations` into the SQL editor).
3. In Supabase, go to Authentication > URL Configuration and add `http://localhost:3000/auth/confirm` (and your production URL's `/auth/confirm`) as redirect URLs.
4. Copy `.env.example` to `.env.local` and fill in the project URL and publishable key from Project Settings > API.
5. `npm install` then `npm run dev`, and open http://localhost:3000.

## First owner

New sign-ups start inactive with no role. After signing in once, make yourself the owner in the SQL editor:

```sql
update profiles set role = 'owner', active = true where email = 'you@sourcingo.in';
```

After that, the owner approves everyone else in the app.
