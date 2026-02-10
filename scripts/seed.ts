/**
 * Seed script for initial database setup
 * Run with: npx tsx scripts/seed.ts
 * 
 * Requires:
 * - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars
 * - Supabase migrations already run
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function seed() {
  console.log('Starting seed...')

  // 1. Create default org
  const { data: org, error: orgError } = await supabase
    .from('orgs')
    .insert({ name: 'ARX Roofing' })
    .select()
    .single()

  if (orgError) {
    console.error('Error creating org:', orgError)
    return
  }

  console.log('✓ Created org:', org.id)

  // 2. Create admin user (you'll need to create this user in Supabase Auth first)
  // For now, we'll just create the user record - the actual auth user must exist
  console.log('⚠️  Note: You must create an auth user first, then update this script with the user ID')
  console.log('   Or use Supabase dashboard to create user, then run this script')

  // 3. Create default pricebook
  const { data: pricebook, error: pricebookError } = await supabase
    .from('pricebooks')
    .insert({
      org_id: org.id,
      name: 'Default Pricebook',
      is_default: true,
    })
    .select()
    .single()

  if (pricebookError) {
    console.error('Error creating pricebook:', pricebookError)
    return
  }

  console.log('✓ Created pricebook:', pricebook.id)

  // 4. Create starter pricebook items
  const items = [
    // Roofing
    {
      org_id: org.id,
      pricebook_id: pricebook.id,
      category: 'roofing',
      item_type: 'install',
      name: 'Roof Install - Asphalt Shingle',
      unit: 'square',
      unit_price: 350.00,
      is_labor: true,
      is_taxable: true,
      active: true,
    },
    {
      org_id: org.id,
      pricebook_id: pricebook.id,
      category: 'roofing',
      item_type: 'tearoff',
      name: 'Tear-off 1 Layer',
      unit: 'square',
      unit_price: 80.00,
      is_labor: true,
      is_taxable: true,
      active: true,
    },
    {
      org_id: org.id,
      pricebook_id: pricebook.id,
      category: 'roofing',
      item_type: 'tearoff',
      name: 'Additional Layer',
      unit: 'square',
      unit_price: 40.00,
      is_labor: true,
      is_taxable: true,
      active: true,
    },
    // Addons
    {
      org_id: org.id,
      pricebook_id: pricebook.id,
      category: 'addons',
      item_type: 'dumpster',
      name: 'Dump/Haul Away',
      unit: 'job',
      unit_price: 250.00,
      is_labor: false,
      is_taxable: true,
      active: true,
    },
    {
      org_id: org.id,
      pricebook_id: pricebook.id,
      category: 'addons',
      item_type: 'cleanup',
      name: 'Clean-up/Magnetic Sweep',
      unit: 'job',
      unit_price: 150.00,
      is_labor: true,
      is_taxable: true,
      active: true,
    },
    {
      org_id: org.id,
      pricebook_id: pricebook.id,
      category: 'addons',
      item_type: 'addon',
      name: 'Pipe Boots',
      unit: 'each',
      unit_price: 25.00,
      is_labor: false,
      is_taxable: true,
      active: true,
    },
    // Siding
    {
      org_id: org.id,
      pricebook_id: pricebook.id,
      category: 'siding',
      item_type: 'install',
      name: 'Siding Install - Vinyl',
      unit: 'square',
      unit_price: 280.00,
      is_labor: true,
      is_taxable: true,
      active: true,
    },
    // Windows
    {
      org_id: org.id,
      pricebook_id: pricebook.id,
      category: 'windows',
      item_type: 'install',
      name: 'Window Install - Double Hung',
      unit: 'each',
      unit_price: 450.00,
      is_labor: true,
      is_taxable: true,
      active: true,
    },
    {
      org_id: org.id,
      pricebook_id: pricebook.id,
      category: 'windows',
      item_type: 'install',
      name: 'Window Install - Casement',
      unit: 'each',
      unit_price: 550.00,
      is_labor: true,
      is_taxable: true,
      active: true,
    },
    {
      org_id: org.id,
      pricebook_id: pricebook.id,
      category: 'addons',
      item_type: 'disposal',
      name: 'Window Disposal',
      unit: 'each',
      unit_price: 25.00,
      is_labor: false,
      is_taxable: true,
      active: true,
    },
  ]

  const { data: createdItems, error: itemsError } = await supabase
    .from('pricebook_items')
    .insert(items)
    .select()

  if (itemsError) {
    console.error('Error creating pricebook items:', itemsError)
    return
  }

  console.log(`✓ Created ${createdItems?.length || 0} pricebook items`)

  console.log('\n✅ Seed complete!')
  console.log('\nNext steps:')
  console.log('1. Create an admin user in Supabase Auth dashboard')
  console.log('2. Insert user record in users table with org_id:', org.id)
  console.log('3. Set role to "admin"')
}

seed().catch(console.error)
