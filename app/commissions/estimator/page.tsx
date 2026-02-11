'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'

interface CompPlan {
  id: string
  name: string
  plan_type: string
  base_percentage: number | null
  flat_amount: number | null
  tiers: { min: number; max: number | null; rate: number }[] | null
  volume_bonuses: { min_volume: number; max_volume: number | null; bonus_type: string; bonus_value: number }[] | null
  is_manager_plan: boolean
  personal_sales_enabled: boolean
  team_override_enabled: boolean
  team_overrides: { min_team_volume: number; max_team_volume: number | null; override_type: string; override_value: number }[] | null
}

interface TeamMember {
  id: string
  full_name: string
  role: string
}

interface Adder {
  id: string
  name: string
  unit_price: number
  price_type: 'fixed' | 'percentage' | null
  is_commissionable: boolean
  commission_percent: number | null  // What % of adder is commissionable (0-100)
  commission_cap: number | null      // Max commissionable amount per instance
  unit: string
}

export default function CommissionEstimatorPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [compPlan, setCompPlan] = useState<CompPlan | null>(null)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [isManager, setIsManager] = useState(false)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [adders, setAdders] = useState<Adder[]>([])
  const [selectedAdders, setSelectedAdders] = useState<{ [key: string]: number }>({}) // adder_id -> quantity

  // Estimator inputs
  const [personalSales, setPersonalSales] = useState('')
  const [teamSales, setTeamSales] = useState('')
  const [numTeamDeals, setNumTeamDeals] = useState('')

  // Calculated results
  const [estimate, setEstimate] = useState({
    personalCommission: 0,
    personalVolumeBonus: 0,
    teamOverride: 0,
    totalEstimate: 0,
    effectivePersonalRate: 0,
    effectiveOverrideRate: 0,
    totalSaleAmount: 0,
    commissionableAmount: 0,
    nonCommissionableAdders: 0,
    commissionableAdders: 0,
  })

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    calculateEstimate()
  }, [personalSales, teamSales, numTeamDeals, compPlan, selectedAdders, adders])

  const loadData = async () => {
    const supabase = createClientBrowser()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data: profile } = await supabase
      .from('users')
      .select('id, org_id, role, full_name, manager_id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      router.push('/dashboard')
      return
    }

    setCurrentUser(profile)
    const managerRoles = ['sales_manager', 'regional_manager', 'manager', 'admin']
    setIsManager(managerRoles.includes(profile.role))

    // Get user's comp plan
    const { data: userCompPlan } = await supabase
      .from('user_comp_plans')
      .select('*, comp_plans(*)')
      .eq('user_id', user.id)
      .lte('effective_from', new Date().toISOString().split('T')[0])
      .order('effective_from', { ascending: false })
      .limit(1)
      .single()

    if (userCompPlan?.comp_plans) {
      setCompPlan(userCompPlan.comp_plans as CompPlan)
    } else {
      // Try to get default plan
      const { data: defaultPlan } = await supabase
        .from('comp_plans')
        .select('*')
        .eq('org_id', profile.org_id)
        .eq('is_default', true)
        .eq('is_active', true)
        .single()

      if (defaultPlan) {
        setCompPlan(defaultPlan as CompPlan)
      }
    }

    // If manager, get team members
    if (managerRoles.includes(profile.role)) {
      const { data: team } = await supabase
        .from('users')
        .select('id, full_name, role')
        .eq('org_id', profile.org_id)
        .eq('manager_id', user.id)
        .eq('active', true)

      setTeamMembers(team || [])
    }

    // Load adders for commission calculation
    const { data: adderData } = await supabase
      .from('pricebook_items')
      .select('id, name, unit_price, price_type, is_commissionable, commission_percent, commission_cap, unit')
      .eq('org_id', profile.org_id)
      .eq('is_adder', true)
      .eq('active', true)
      .order('name')

    setAdders(adderData || [])

    setLoading(false)
  }

  const calculateEstimate = () => {
    if (!compPlan) return

    const baseSales = parseFloat(personalSales) || 0
    const team = parseFloat(teamSales) || 0
    const deals = parseInt(numTeamDeals) || 0

    // Calculate adder totals
    let commissionableAdders = 0
    let nonCommissionableAdders = 0

    adders.forEach(adder => {
      const qty = selectedAdders[adder.id] || 0
      if (qty > 0) {
        let adderAmount = 0
        if (adder.price_type === 'percentage') {
          // Percentage of base sales
          adderAmount = baseSales * (adder.unit_price / 100) * qty
        } else {
          adderAmount = adder.unit_price * qty
        }
        
        if (adder.is_commissionable) {
          // Apply commission_percent and commission_cap per instance
          const commissionPercent = adder.commission_percent ?? 100
          const commissionCap = adder.commission_cap
          
          // Calculate per-instance commissionable amount
          let perInstanceCommissionable = (adder.price_type === 'percentage' 
            ? baseSales * (adder.unit_price / 100) 
            : adder.unit_price) * (commissionPercent / 100)
          
          // Apply cap per instance if set
          if (commissionCap && perInstanceCommissionable > commissionCap) {
            perInstanceCommissionable = commissionCap
          }
          
          commissionableAdders += perInstanceCommissionable * qty
          
          // The non-commissionable portion of a commissionable adder
          const nonCommissionablePortion = adderAmount - (perInstanceCommissionable * qty)
          if (nonCommissionablePortion > 0) {
            nonCommissionableAdders += nonCommissionablePortion
          }
        } else {
          nonCommissionableAdders += adderAmount
        }
      }
    })

    // Total sale amount includes everything
    const totalSaleAmount = baseSales + commissionableAdders + nonCommissionableAdders
    
    // Commissionable amount excludes non-commissionable adders
    const commissionableAmount = baseSales + commissionableAdders

    let personalCommission = 0
    let personalVolumeBonus = 0
    let teamOverride = 0
    let effectivePersonalRate = 0
    let effectiveOverrideRate = 0

    // Calculate personal commission on COMMISSIONABLE amount only
    if (compPlan.personal_sales_enabled !== false && commissionableAmount > 0) {
      if (compPlan.plan_type === 'flat_rate') {
        personalCommission = compPlan.flat_amount || 0
      } else if (compPlan.plan_type === 'percentage') {
        effectivePersonalRate = compPlan.base_percentage || 0
        personalCommission = commissionableAmount * (effectivePersonalRate / 100)
      } else if (compPlan.plan_type === 'tiered' && compPlan.tiers) {
        // Find applicable tier based on commissionable amount
        const tier = compPlan.tiers.find(t => 
          commissionableAmount >= t.min && (t.max === null || commissionableAmount <= t.max)
        )
        effectivePersonalRate = tier?.rate || compPlan.base_percentage || 0
        personalCommission = commissionableAmount * (effectivePersonalRate / 100)
      }

      // Calculate volume bonus based on commissionable amount
      if (compPlan.volume_bonuses && compPlan.volume_bonuses.length > 0) {
        const volumeTier = compPlan.volume_bonuses.find(vb =>
          commissionableAmount >= vb.min_volume && (vb.max_volume === null || commissionableAmount <= vb.max_volume)
        )
        if (volumeTier) {
          if (volumeTier.bonus_type === 'percentage') {
            effectivePersonalRate += volumeTier.bonus_value
            personalVolumeBonus = commissionableAmount * (volumeTier.bonus_value / 100)
          } else {
            personalVolumeBonus = volumeTier.bonus_value
          }
        }
      }
    }

    // Calculate team override (for managers)
    if (compPlan.is_manager_plan && compPlan.team_override_enabled && team > 0) {
      if (compPlan.team_overrides && compPlan.team_overrides.length > 0) {
        const overrideTier = compPlan.team_overrides.find(to =>
          team >= to.min_team_volume && (to.max_team_volume === null || team <= to.max_team_volume)
        )
        if (overrideTier) {
          if (overrideTier.override_type === 'percentage') {
            effectiveOverrideRate = overrideTier.override_value
            teamOverride = team * (overrideTier.override_value / 100)
          } else {
            // Flat amount per deal
            teamOverride = overrideTier.override_value * (deals || 1)
            effectiveOverrideRate = deals > 0 ? (teamOverride / team) * 100 : 0
          }
        }
      }
    }

    const totalEstimate = personalCommission + personalVolumeBonus + teamOverride

    setEstimate({
      personalCommission,
      personalVolumeBonus,
      teamOverride,
      totalEstimate,
      effectivePersonalRate,
      effectiveOverrideRate,
      totalSaleAmount,
      commissionableAmount,
      nonCommissionableAdders,
      commissionableAdders,
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link href="/dashboard" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
            ← Back to Dashboard
          </Link>
        </div>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Commission Estimator</h1>
          <p className="text-gray-500 mt-1">
            Estimate your earnings based on your comp plan
            {compPlan && <span className="text-indigo-600 font-medium ml-1">({compPlan.name})</span>}
          </p>
        </div>

        {!compPlan ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
            <p className="text-yellow-800">No compensation plan assigned. Contact your admin.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Input Section */}
            <div className="space-y-6">
              {/* Personal Sales */}
              {compPlan.personal_sales_enabled !== false && (
                <div className="bg-white rounded-xl shadow-sm border p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Personal Sales</h3>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Base Sale Amount ($)
                    </label>
                    <input
                      type="number"
                      value={personalSales}
                      onChange={(e) => setPersonalSales(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg"
                      placeholder="e.g., 50000"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Enter your base sale amount (before adders)
                    </p>
                  </div>

                  {/* Adders Section */}
                  {adders.length > 0 && (
                    <div className="mt-4 pt-4 border-t">
                      <h4 className="text-sm font-medium text-gray-700 mb-3">Add-ons / Adders</h4>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {adders.map((adder) => (
                          <div 
                            key={adder.id} 
                            className={`flex items-center justify-between p-2 rounded-lg ${
                              adder.is_commissionable ? 'bg-green-50' : 'bg-gray-50'
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{adder.name}</p>
                              <p className="text-xs text-gray-500">
                                {adder.price_type === 'percentage' 
                                  ? `${adder.unit_price}% of base` 
                                  : `$${adder.unit_price.toFixed(2)}/${adder.unit}`}
                                {adder.is_commissionable ? (
                                  <>
                                    <span className="ml-2 text-green-600">• Commissionable</span>
                                    {(adder.commission_percent !== null && adder.commission_percent !== 100) && (
                                      <span className="text-green-600"> ({adder.commission_percent}%)</span>
                                    )}
                                    {adder.commission_cap && (
                                      <span className="text-green-600"> (max ${adder.commission_cap.toLocaleString()})</span>
                                    )}
                                  </>
                                ) : (
                                  <span className="ml-2 text-gray-400">• Non-commissionable</span>
                                )}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 ml-3">
                              <button
                                onClick={() => setSelectedAdders(prev => ({
                                  ...prev,
                                  [adder.id]: Math.max(0, (prev[adder.id] || 0) - 1)
                                }))}
                                className="w-7 h-7 flex items-center justify-center rounded bg-white border text-gray-600 hover:bg-gray-100"
                              >
                                -
                              </button>
                              <span className="w-8 text-center text-sm font-medium">
                                {selectedAdders[adder.id] || 0}
                              </span>
                              <button
                                onClick={() => setSelectedAdders(prev => ({
                                  ...prev,
                                  [adder.id]: (prev[adder.id] || 0) + 1
                                }))}
                                className="w-7 h-7 flex items-center justify-center rounded bg-white border text-gray-600 hover:bg-gray-100"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      
                      {/* Adder Summary */}
                      {(estimate.commissionableAdders > 0 || estimate.nonCommissionableAdders > 0) && (
                        <div className="mt-3 p-3 bg-gray-100 rounded-lg text-sm">
                          <div className="flex justify-between text-gray-600">
                            <span>Commissionable adders:</span>
                            <span className="text-green-600 font-medium">+${estimate.commissionableAdders.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-gray-600">
                            <span>Non-commissionable adders:</span>
                            <span className="text-gray-500">+${estimate.nonCommissionableAdders.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between font-medium text-gray-900 pt-2 mt-2 border-t border-gray-200">
                            <span>Total sale amount:</span>
                            <span>${estimate.totalSaleAmount.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-indigo-600 font-medium">
                            <span>Commissionable amount:</span>
                            <span>${estimate.commissionableAmount.toFixed(2)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Show applicable rate info */}
                  <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Base Rate:</span>{' '}
                      {compPlan.plan_type === 'flat_rate' 
                        ? `$${compPlan.flat_amount} per sale`
                        : `${compPlan.base_percentage}%`}
                    </p>
                    {compPlan.volume_bonuses && compPlan.volume_bonuses.length > 0 && (
                      <p className="text-sm text-gray-600 mt-1">
                        <span className="font-medium">Volume Bonuses:</span> Available based on volume
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Team Sales (Manager only) */}
              {compPlan.is_manager_plan && compPlan.team_override_enabled && (
                <div className="bg-white rounded-xl shadow-sm border p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">Team Sales</h3>
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">Manager</span>
                  </div>
                  
                  {teamMembers.length > 0 && (
                    <div className="mb-4 p-3 bg-purple-50 rounded-lg">
                      <p className="text-sm text-purple-800 font-medium mb-1">Your Team ({teamMembers.length})</p>
                      <p className="text-xs text-purple-600">
                        {teamMembers.map(m => m.full_name).join(', ')}
                      </p>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Team&apos;s Total Sales Volume ($)
                      </label>
                      <input
                        type="number"
                        value={teamSales}
                        onChange={(e) => setTeamSales(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg"
                        placeholder="e.g., 200000"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Number of Team Deals
                      </label>
                      <input
                        type="number"
                        value={numTeamDeals}
                        onChange={(e) => setNumTeamDeals(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg"
                        placeholder="e.g., 15"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Used for flat-rate override calculations
                      </p>
                    </div>
                  </div>

                  {/* Override tiers info */}
                  {compPlan.team_overrides && compPlan.team_overrides.length > 0 && (
                    <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                      <p className="text-sm font-medium text-gray-700 mb-2">Override Tiers:</p>
                      <div className="space-y-1">
                        {compPlan.team_overrides.map((to, i) => (
                          <p key={i} className="text-xs text-gray-600">
                            ${to.min_team_volume.toLocaleString()} - {to.max_team_volume ? `$${to.max_team_volume.toLocaleString()}` : '∞'}:{' '}
                            <span className="font-medium text-purple-600">
                              {to.override_type === 'percentage' ? `${to.override_value}%` : `$${to.override_value}/deal`}
                            </span>
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Results Section */}
            <div className="space-y-6">
              {/* Estimate Summary */}
              <div className="bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl shadow-lg p-6 text-white">
                <h3 className="text-lg font-semibold mb-4 text-indigo-100">Estimated Earnings</h3>
                
                <div className="text-center mb-6">
                  <div className="text-5xl font-bold">
                    ${estimate.totalEstimate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <p className="text-indigo-200 text-sm mt-1">Total Estimated Commission</p>
                </div>

                <div className="space-y-3 border-t border-indigo-400/30 pt-4">
                  {compPlan?.personal_sales_enabled !== false && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-indigo-200">Personal Commission</span>
                        <span className="font-medium">
                          ${estimate.personalCommission.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      {estimate.personalVolumeBonus > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-indigo-200">Volume Bonus</span>
                          <span className="font-medium text-green-300">
                            +${estimate.personalVolumeBonus.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                  {compPlan?.is_manager_plan && compPlan?.team_override_enabled && (
                    <div className="flex justify-between text-sm">
                      <span className="text-indigo-200">Team Override</span>
                      <span className="font-medium text-purple-200">
                        ${estimate.teamOverride.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Sale Breakdown */}
              {(estimate.totalSaleAmount > 0 || estimate.nonCommissionableAdders > 0) && (
                <div className="bg-white rounded-xl shadow-sm border p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Sale Breakdown</h3>
                  
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Base Sale Amount</span>
                      <span className="font-medium">${(parseFloat(personalSales) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    {estimate.commissionableAdders > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>+ Commissionable Adders</span>
                        <span className="font-medium">${estimate.commissionableAdders.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    {estimate.nonCommissionableAdders > 0 && (
                      <div className="flex justify-between text-gray-400">
                        <span>+ Non-Commissionable Adders</span>
                        <span className="font-medium">${estimate.nonCommissionableAdders.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-2 border-t font-medium">
                      <span className="text-gray-900">Total Sale Amount</span>
                      <span>${estimate.totalSaleAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between p-2 bg-indigo-50 rounded-lg">
                      <span className="text-indigo-700 font-medium">Commission Calculated On</span>
                      <span className="text-indigo-700 font-bold">${estimate.commissionableAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    {estimate.nonCommissionableAdders > 0 && (
                      <p className="text-xs text-gray-500 mt-2">
                        Non-commissionable adders (like dumpsters, permits, etc.) are excluded from commission calculations.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Rate Breakdown */}
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Rate Breakdown</h3>
                
                <div className="space-y-4">
                  {compPlan?.personal_sales_enabled !== false && (
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">Effective Personal Rate</p>
                        <p className="text-xs text-gray-500">Base + Volume Bonus</p>
                      </div>
                      <div className="text-2xl font-bold text-indigo-600">
                        {estimate.effectivePersonalRate.toFixed(1)}%
                      </div>
                    </div>
                  )}

                  {compPlan?.is_manager_plan && compPlan?.team_override_enabled && (
                    <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">Team Override Rate</p>
                        <p className="text-xs text-gray-500">Based on team volume tier</p>
                      </div>
                      <div className="text-2xl font-bold text-purple-600">
                        {estimate.effectiveOverrideRate.toFixed(2)}%
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Scenarios */}
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Scenarios</h3>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => {
                      setPersonalSales('25000')
                      setTeamSales('100000')
                      setNumTeamDeals('8')
                    }}
                    className="p-3 text-left border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
                  >
                    <p className="font-medium text-gray-900 text-sm">Average Month</p>
                    <p className="text-xs text-gray-500">$25k personal, $100k team</p>
                  </button>
                  <button
                    onClick={() => {
                      setPersonalSales('50000')
                      setTeamSales('200000')
                      setNumTeamDeals('15')
                    }}
                    className="p-3 text-left border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
                  >
                    <p className="font-medium text-gray-900 text-sm">Good Month</p>
                    <p className="text-xs text-gray-500">$50k personal, $200k team</p>
                  </button>
                  <button
                    onClick={() => {
                      setPersonalSales('75000')
                      setTeamSales('350000')
                      setNumTeamDeals('25')
                    }}
                    className="p-3 text-left border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
                  >
                    <p className="font-medium text-gray-900 text-sm">Great Month</p>
                    <p className="text-xs text-gray-500">$75k personal, $350k team</p>
                  </button>
                  <button
                    onClick={() => {
                      setPersonalSales('100000')
                      setTeamSales('500000')
                      setNumTeamDeals('35')
                    }}
                    className="p-3 text-left border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
                  >
                    <p className="font-medium text-gray-900 text-sm">Best Month</p>
                    <p className="text-xs text-gray-500">$100k personal, $500k team</p>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
