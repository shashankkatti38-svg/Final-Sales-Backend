import postgres from '../../node_modules/postgres/src/index.js';
const sql = postgres(process.env.DIRECT_URL, { ssl: 'require' });

async function main() {
  await sql`
    CREATE OR REPLACE FUNCTION public.set_default_lead_org()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.organization_id IS NULL THEN
        NEW.organization_id := '4df15334-08f1-4ea8-a764-c36266fbfdba';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `;

  await sql`DROP TRIGGER IF EXISTS trg_set_default_lead_org ON public.leads;`;

  await sql`
    CREATE TRIGGER trg_set_default_lead_org
    BEFORE INSERT ON public.leads
    FOR EACH ROW
    EXECUTE FUNCTION public.set_default_lead_org();
  `;

  console.log("✓ Automatic lead ingestion trigger active: any website lead is automatically routed into SalesWorks360 dashboard");
  await sql.end();
}

main().catch(console.error);
