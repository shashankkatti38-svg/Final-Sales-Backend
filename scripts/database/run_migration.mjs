import postgres from '../../node_modules/postgres/src/index.js';
const connStr = process.env.DIRECT_URL;
if (!connStr) {
  console.error("DIRECT_URL missing");
  process.exit(1);
}

const sql = postgres(connStr, { ssl: 'require' });

async function run() {
  console.log("Applying Migration...");

  // 1. Core Helper Functions
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION public.crm_org()
    RETURNS text
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $$
      SELECT organization_id
      FROM public.user_roles
      WHERE user_id = auth.uid()::text
      LIMIT 1;
    $$;

    CREATE OR REPLACE FUNCTION public.crm_is_admin()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid()::text
          AND organization_id = public.crm_org()
          AND role = 'Organization Admin'
      );
    $$;

    REVOKE ALL ON FUNCTION public.crm_org() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.crm_org() TO authenticated, service_role;

    REVOKE ALL ON FUNCTION public.crm_is_admin() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.crm_is_admin() TO authenticated, service_role;
  `);
  console.log("✓ Functions crm_org and crm_is_admin created");

  // 2. Table Defaults, Phone Column Type, and Compatibility View
  await sql.unsafe(`
    ALTER TABLE public.leads
      ALTER COLUMN id SET DEFAULT gen_random_uuid()::text,
      ALTER COLUMN organization_id SET DEFAULT public.crm_org(),
      ALTER COLUMN owner_id SET DEFAULT auth.uid()::text,
      ALTER COLUMN created_at SET DEFAULT now(),
      ALTER COLUMN phone TYPE text USING phone::text;

    CREATE OR REPLACE VIEW public.organizations AS
      SELECT * FROM public."Organization";

    GRANT SELECT, UPDATE ON public.organizations TO authenticated, service_role;
  `);
  console.log("✓ Leads table defaults & phone column updated, organizations view created");

  // 3. Profiles & User Roles Mapping for Current Auth Users
  await sql.unsafe(`
    INSERT INTO public.profiles (id, display_name, created_at)
    SELECT
      u.id::text,
      coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
      u.created_at
    FROM auth.users u
    ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name;

    INSERT INTO public.user_roles (id, user_id, organization_id, role)
    SELECT
      gen_random_uuid()::text,
      u.id::text,
      '4df15334-08f1-4ea8-a764-c36266fbfdba',
      'Organization Admin'
    FROM auth.users u
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id::text
    );

    UPDATE public.leads
    SET owner_id = (SELECT id::text FROM auth.users WHERE email = 'shashankkatti32@gmail.com' LIMIT 1)
    WHERE owner_id = '0e379232-3f3e-43a7-ba02-7f5e3df4d788';
  `);
  console.log("✓ Profiles & roles mapped, legacy leads reallocated");

  // 4. Signup Trigger on auth.users
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION public.crm_signup()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    DECLARE
      new_org_id text := gen_random_uuid()::text;
    BEGIN
      INSERT INTO public.profiles (id, display_name, created_at)
      VALUES (
        NEW.id::text,
        coalesce(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        now()
      )
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public."Organization" (id, owner_id, name, created_at)
      VALUES (
        new_org_id,
        NEW.id::text,
        'My workspace',
        now()
      );

      INSERT INTO public.user_roles (id, user_id, organization_id, role)
      VALUES (
        gen_random_uuid()::text,
        NEW.id::text,
        new_org_id,
        'Organization Admin'
      );

      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS crm_on_signup ON auth.users;
    CREATE TRIGGER crm_on_signup
      AFTER INSERT ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION public.crm_signup();
  `);
  console.log("✓ crm_signup trigger created on auth.users");

  // 5. Row Level Security Policies
  await sql.unsafe(`
    ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "leads_select_policy" ON public.leads;
    DROP POLICY IF EXISTS "leads_insert_policy" ON public.leads;
    DROP POLICY IF EXISTS "leads_update_policy" ON public.leads;
    DROP POLICY IF EXISTS "leads_delete_policy" ON public.leads;

    CREATE POLICY "leads_select_policy" ON public.leads
      FOR SELECT TO authenticated
      USING (
        organization_id = public.crm_org()
        AND (
          owner_id = auth.uid()::text
          OR assigned_to = auth.uid()::text
          OR public.crm_is_admin()
        )
      );

    CREATE POLICY "leads_insert_policy" ON public.leads
      FOR INSERT TO authenticated
      WITH CHECK (
        organization_id = public.crm_org()
        AND owner_id = auth.uid()::text
      );

    CREATE POLICY "leads_update_policy" ON public.leads
      FOR UPDATE TO authenticated
      USING (
        organization_id = public.crm_org()
        AND (
          owner_id = auth.uid()::text
          OR assigned_to = auth.uid()::text
          OR public.crm_is_admin()
        )
      )
      WITH CHECK (
        organization_id = public.crm_org()
        AND (
          owner_id = auth.uid()::text
          OR assigned_to = auth.uid()::text
          OR public.crm_is_admin()
        )
      );

    CREATE POLICY "leads_delete_policy" ON public.leads
      FOR DELETE TO authenticated
      USING (
        organization_id = public.crm_org()
        AND (
          owner_id = auth.uid()::text
          OR public.crm_is_admin()
        )
      );

    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
    DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;

    CREATE POLICY "profiles_select_policy" ON public.profiles
      FOR SELECT TO authenticated
      USING (
        id = auth.uid()::text
        OR EXISTS (
          SELECT 1 FROM public.user_roles r
          WHERE r.user_id = profiles.id
            AND r.organization_id = public.crm_org()
        )
      );

    CREATE POLICY "profiles_update_policy" ON public.profiles
      FOR UPDATE TO authenticated
      USING (id = auth.uid()::text)
      WITH CHECK (id = auth.uid()::text);

    ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "user_roles_select_policy" ON public.user_roles;

    CREATE POLICY "user_roles_select_policy" ON public.user_roles
      FOR SELECT TO authenticated
      USING (
        user_id = auth.uid()::text
        OR organization_id = public.crm_org()
      );

    ALTER TABLE public."Organization" ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "org_select_policy" ON public."Organization";
    DROP POLICY IF EXISTS "org_update_policy" ON public."Organization";

    CREATE POLICY "org_select_policy" ON public."Organization"
      FOR SELECT TO authenticated
      USING (
        id = public.crm_org()
        OR owner_id = auth.uid()::text
      );

    CREATE POLICY "org_update_policy" ON public."Organization"
      FOR UPDATE TO authenticated
      USING (
        id = public.crm_org()
        AND (owner_id = auth.uid()::text OR public.crm_is_admin())
      )
      WITH CHECK (
        id = public.crm_org()
        AND (owner_id = auth.uid()::text OR public.crm_is_admin())
      );

    -- Grant base table permissions to authenticated
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
    GRANT SELECT, UPDATE ON public.profiles TO authenticated;
    GRANT SELECT ON public.user_roles TO authenticated;
    GRANT SELECT, UPDATE ON public."Organization" TO authenticated;
  `);
  console.log("✓ RLS Policies and base grants applied successfully");

  await sql.end();
  console.log("Migration finished successfully!");
}

run().catch(err => {
  console.error("Migration error:", err);
  process.exit(1);
});
