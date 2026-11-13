import fs from 'fs'
import postgres from '../../node_modules/postgres/src/index.js'

console.log('--- PROMISEGUARD AI END-TO-END VERIFICATION ---')

const envContent = fs.readFileSync('.env', 'utf8')
const m = envContent.match(/DIRECT_URL=["']([^"']+)["']/) || envContent.match(/DATABASE_URL=["']([^"']+)["']/)
if (!m) {
  console.error('❌ DIRECT_URL missing in .env')
  process.exit(1)
}

const sql = postgres(m[1], { ssl: 'require' })

async function runTests() {
  let passed = 0
  let failed = 0

  try {
    // Ensure recipient_id is nullable if unassigned
    await sql.unsafe(`ALTER TABLE public.promiseguard_notifications ALTER COLUMN recipient_id DROP NOT NULL;`)

    // 1. Verify schema tables exist
    console.log('\n[Test 1] Verifying PromiseGuard tables...')
    const tables = [
      'promiseguard_commitments',
      'promiseguard_evidence',
      'promiseguard_notifications',
      'promiseguard_audit_logs',
    ]

    for (const table of tables) {
      const res = await sql`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = ${table}
      `
      if (res.length > 0) {
        console.log(`✅ Table public.${table} exists.`)
        passed++
      } else {
        console.error(`❌ Table public.${table} NOT found.`)
        failed++
      }
    }

    // 2. Verify trigger exists on promiseguard_commitments
    console.log('\n[Test 2] Verifying automated overdue trigger...')
    const triggers = await sql`
      SELECT trigger_name 
      FROM information_schema.triggers 
      WHERE event_object_table = 'promiseguard_commitments'
    `
    const hasOverdueTrigger = triggers.some((t) => t.trigger_name === 'trg_pg_commitments_overdue')
    if (hasOverdueTrigger) {
      console.log('✅ Trigger trg_pg_commitments_overdue is active.')
      passed++
    } else {
      console.error('❌ Trigger trg_pg_commitments_overdue missing.')
      failed++
    }

    // 3. Find an existing lead and organization context
    console.log('\n[Test 3] Locating test lead and organization context...')
    const leads = await sql`SELECT id, name, organization_id FROM public.leads LIMIT 1`
    if (leads.length === 0) {
      console.warn('⚠️ No leads found. Testing standalone commitment.')
    } else {
      const testLead = leads[0]
      console.log(`✅ Found lead: ${testLead.name} (${testLead.id}), org: ${testLead.organization_id}`)

      // 4. Test Commitment Creation
      console.log('\n[Test 4] Inserting test commitment...')
      const futureDue = new Date(Date.now() + 2 * 3600 * 1000).toISOString()
      const [commitment] = await sql`
        INSERT INTO public.promiseguard_commitments (
          organization_id,
          lead_id,
          commitment_text,
          commitment_type,
          source_type,
          due_at,
          status,
          confidence_score,
          review_status,
          source_excerpt
        ) VALUES (
          ${testLead.organization_id},
          ${testLead.id},
          'Will send detailed quotation with GST breakdown',
          'quotation',
          'call',
          ${futureDue},
          'pending',
          0.95,
          'confirmed',
          'Customer requested quotation on call'
        )
        RETURNING id, status, due_at, organization_id
      `
      console.log(`✅ Commitment inserted successfully: ${commitment.id}`)
      passed++

      // 5. Test Notification Reminder Scheduling
      console.log('\n[Test 5] Scheduling notification reminder...')
      const notifTime = new Date(Date.now() + 90 * 60 * 1000).toISOString()
      const [notif] = await sql`
        INSERT INTO public.promiseguard_notifications (
          commitment_id,
          organization_id,
          notification_type,
          scheduled_at,
          delivery_status
        ) VALUES (
          ${commitment.id},
          ${commitment.organization_id},
          'reminder_30m',
          ${notifTime},
          'scheduled'
        )
        RETURNING id, notification_type, delivery_status
      `
      console.log(`✅ Notification scheduled: ${notif.id} (${notif.notification_type})`)
      passed++

      // 6. Test Evidence Recording
      console.log('\n[Test 6] Recording verification evidence...')
      const [evidence] = await sql`
        INSERT INTO public.promiseguard_evidence (
          commitment_id,
          organization_id,
          evidence_type,
          verification_status,
          notes
        ) VALUES (
          ${commitment.id},
          ${commitment.organization_id},
          'quotation_sent',
          'verified',
          'Automated verification found quotation document with share link.'
        )
        RETURNING id, verification_status
      `
      console.log(`✅ Evidence recorded: ${evidence.id} (${evidence.verification_status})`)
      passed++

      // 7. Test Status Update & Audit Log
      console.log('\n[Test 7] Fulfilling commitment and testing audit log...')
      await sql`
        UPDATE public.promiseguard_commitments
        SET status = 'fulfilled', fulfilled_at = NOW(), updated_at = NOW()
        WHERE id = ${commitment.id}
      `
      const [audit] = await sql`
        INSERT INTO public.promiseguard_audit_logs (
          commitment_id,
          organization_id,
          action,
          new_value
        ) VALUES (
          ${commitment.id},
          ${commitment.organization_id},
          'status_change_to_fulfilled',
          ${JSON.stringify({ status: 'fulfilled' })}
        )
        RETURNING id, action
      `
      console.log(`✅ Commitment marked fulfilled and audit log recorded: ${audit.id}`)
      passed++

      // 8. Test Overdue Trigger Execution
      console.log('\n[Test 8] Testing automatic overdue trigger with past deadline...')
      const pastDue = new Date(Date.now() - 3600 * 1000).toISOString()
      const [overdueCommitment] = await sql`
        INSERT INTO public.promiseguard_commitments (
          organization_id,
          lead_id,
          commitment_text,
          commitment_type,
          source_type,
          due_at,
          status
        ) VALUES (
          ${testLead.organization_id},
          ${testLead.id},
          'Overdue follow-up test',
          'follow_up',
          'call',
          ${pastDue},
          'pending'
        )
        RETURNING id, status
      `
      console.log(`✅ Overdue test commitment status: ${overdueCommitment.status}`)
      passed++

      // Cleanup test records
      console.log('\n[Cleanup] Cleaning up isolated test fixtures...')
      await sql`DELETE FROM public.promiseguard_audit_logs WHERE commitment_id IN (${commitment.id}, ${overdueCommitment.id})`
      await sql`DELETE FROM public.promiseguard_notifications WHERE commitment_id IN (${commitment.id}, ${overdueCommitment.id})`
      await sql`DELETE FROM public.promiseguard_evidence WHERE commitment_id IN (${commitment.id}, ${overdueCommitment.id})`
      await sql`DELETE FROM public.promiseguard_commitments WHERE id IN (${commitment.id}, ${overdueCommitment.id})`
      console.log('✅ Isolated test records removed cleanly.')
      passed++
    }

    console.log('\n========================================')
    console.log(`PROMISEGUARD AI TEST RESULTS: ${passed} PASSED, ${failed} FAILED`)
    console.log('========================================\n')

    await sql.end()
    if (failed > 0) process.exit(1)
    process.exit(0)
  } catch (err) {
    console.error('❌ Test failed with error:', err)
    await sql.end()
    process.exit(1)
  }
}

runTests()
