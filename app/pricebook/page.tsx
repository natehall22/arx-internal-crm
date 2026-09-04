import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import Nav from '@/components/Nav'
import { redirect } from 'next/navigation'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { isBarredFromSalesDocAccess } from '@/lib/permissions'
import PricebookItemPhotoCell from '@/components/pricebook/PricebookItemPhotoCell'

// Matches the role gate on /api/admin/pricing/items/[id]/image
const PRICEBOOK_IMAGE_EDIT_ROLES = new Set(['admin', 'operations'])

export default async function PricebookPage() {
  const { profile, authUser: user } = await requireAuth()
  const supabase = createClient()
  const admin = createServiceClient()
  
  const pricebookPermissions = await resolveEffectivePermissionNames(admin, user.id, profile)
  let customRoleName: string | null = null
  let customRoleDisplayName: string | null = null
  if (profile.custom_role_id) {
    const { data: customRole } = await admin
      .from('custom_roles')
      .select('name, display_name')
      .eq('id', profile.custom_role_id)
      .maybeSingle()
    customRoleName = customRole?.name ?? null
    customRoleDisplayName = customRole?.display_name ?? null
  }
  if (
    isBarredFromSalesDocAccess({
      role: profile.role,
      customRoleName,
      customRoleDisplayName,
      permissionNames: pricebookPermissions.permissionNames,
    })
  ) {
    redirect('/dashboard')
  }
  if (
    !pricebookPermissions.fullAccess &&
    !pricebookPermissions.permissionNames.has('pricebook:view') &&
    !pricebookPermissions.permissionNames.has('pricebook:edit')
  ) {
    redirect('/dashboard')
  }

  // Get default pricebook
  const { data: defaultPricebook } = await supabase
    .from('pricebooks')
    .select('id')
    .eq('org_id', profile.org_id)
    .eq('is_default', true)
    .single()

  const pricebookId = defaultPricebook?.id

  const { data: items } = await supabase
    .from('pricebook_items')
    .select('*')
    .eq('org_id', profile.org_id)
    .eq('active', true)
    .order('category', { ascending: true })
    .order('name', { ascending: true })

  const canEditPhotos = PRICEBOOK_IMAGE_EDIT_ROLES.has(profile.role)

  const itemsByCategory: Record<string, any[]> = items?.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = []
    }
    acc[item.category].push(item)
    return acc
  }, {} as Record<string, any[]>) || {}

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Pricebook</h1>

        <div className="space-y-8">
          {Object.entries(itemsByCategory).map(([category, categoryItems]) => (
            <div key={category} className="bg-white shadow rounded-lg p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4 capitalize">{category}</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Photo
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Unit
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Unit Price
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Labor
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Taxable
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {categoryItems.map((item: any) => (
                      <tr key={item.id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <PricebookItemPhotoCell
                            itemId={item.id}
                            itemName={item.name}
                            initialImageUrl={item.image_url ?? null}
                            canEdit={canEditPhotos}
                          />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {item.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                          {item.item_type.replace('_', ' ')}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {item.unit}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          ${item.unit_price.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {item.is_labor ? 'Yes' : 'No'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {item.is_taxable ? 'Yes' : 'No'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
