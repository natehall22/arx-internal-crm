'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Nav from '@/components/Nav'
import { ridgeHipCapOrderSummary } from '@/lib/hip-ridge-cap-squares'
import { BUNDLES_PER_SQUARE, CAP_LF_PER_BUNDLE } from '@/lib/roof-shingle-constants'
import { formatNumericDraft, parseDraftFloat, previewNumber } from '@/lib/numeric-input-draft'

interface PricebookItem {
  id: string
  name: string
  category: string
  unit: string
  unit_price: number
  is_adder: boolean
  adder_category: string | null
  visibility: string
  show_to_customer?: boolean
  price_type?: 'fixed' | 'percentage' | null
}

interface RoofingType {
  id: string
  name: string
  description: string | null
  price_per_square: number
  material_cost_per_square: number | null
  labor_cost_per_square: number | null
  labor_multiplier: number
  default_warranty_years: number
  default_warranty_text: string | null
  color: string
  is_default: boolean
}

interface RoofingType {
  id: string
  name: string
  description: string | null
  price_per_square: number
  material_cost_per_square: number | null
  labor_cost_per_square: number | null
  labor_multiplier: number
  default_warranty_years: number
  default_warranty_text: string | null
  color: string
  is_default: boolean
}

interface LineItem {
  id: string
  pricebook_item_id: string | null
  category: string
  name: string
  description: string
  unit: string
  quantity: number
  unit_price: number
  line_total: number
  is_adder: boolean
  show_to_customer?: boolean
  price_type?: 'fixed' | 'percentage' | null
}

interface ProposalForm {
  customer_name: string
  customer_email: string
  customer_phone: string
  customer_address: string
  title: string
  scope_of_work: string
  materials_description: string
  warranty_info: string
  discount_amount: number
  discount_percent: number
  tax_rate: number
  financing_available: boolean
  financing_program_id: string | null
  financing_term_months: number
  financing_rate: number
  accent_color: string
  roofing_type_id: string | null
}

interface FinancingProgramOption {
  id: string
  lender_name: string
  financing_rate: number
  term_months: number
}

const toCents = (value: number) => Math.round((Number(value) || 0) * 100)
const fromCents = (cents: number) => cents / 100

const defaultForm: ProposalForm = {
  customer_name: '',
  customer_email: '',
  customer_phone: '',
  customer_address: '',
  title: 'Roofing Proposal',
  scope_of_work: '',
  materials_description: '',
  warranty_info: '',
  discount_amount: 0,
  discount_percent: 0,
  tax_rate: 8.25,
  financing_available: false,
  financing_program_id: null,
  financing_term_months: 60,
  financing_rate: 9.99,
  accent_color: '#4f46e5',
  roofing_type_id: null,
}

const adderCategories = [
  'Ventilation',
  'Gutters',
  'Skylights',
  'Chimney',
  'Decking',
  'Flashing',
  'Other',
]

const RIDGE_CAP_LF_PER_BUNDLE = CAP_LF_PER_BUNDLE
const HIP_CAP_LF_PER_BUNDLE = CAP_LF_PER_BUNDLE

function toHalfPercent(value: number): number {
  return Math.round(value * 2) / 2
}

export default function ProposalBuilderPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const opportunityId = searchParams.get('opportunity_id') || searchParams.get('opportunity')
  const proposalIdParam = searchParams.get('proposal_id')
  const measurementId = searchParams.get('measurement_id')
  const urlSquares = searchParams.get('squares')
  const urlCustomerName = searchParams.get('customer_name')
  const urlCustomerAddress = searchParams.get('customer_address')
  
  const [loading, setLoading] = useState(true)
  const [measurementData, setMeasurementData] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<ProposalForm>(defaultForm)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [pricebookItems, setPricebookItems] = useState<PricebookItem[]>([])
  const [adders, setAdders] = useState<PricebookItem[]>([])
  const [selectedAdderCategory, setSelectedAdderCategory] = useState<string>('all')
  const [showAddItem, setShowAddItem] = useState(false)
  const [userRole, setUserRole] = useState<string>('')
  const [templates, setTemplates] = useState<any[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [roofingTypes, setRoofingTypes] = useState<RoofingType[]>([])
  const [selectedRoofingType, setSelectedRoofingType] = useState<RoofingType | null>(null)
  const [isTearOff, setIsTearOff] = useState<boolean | null>(null)
  const [tearOffOptions, setTearOffOptions] = useState<PricebookItem[]>([])
  const [selectedTearOff, setSelectedTearOff] = useState<PricebookItem | null>(null)
  const [wastePercent, setWastePercent] = useState<number>(10) // Default 10% waste
  const [savedProposalWastePercent, setSavedProposalWastePercent] = useState<number | null>(null)
  const [quantityModalItem, setQuantityModalItem] = useState<PricebookItem | null>(null)
  /**
   * Draft text backing the quantity box. Held as a string so a rep can clear the field
   * and type a full number (e.g. 1240 sq ft of siding) — clamping to the minimum on
   * every keystroke made the box impossible to type into.
   */
  const [quantityModalRaw, setQuantityModalRaw] = useState<string>('1')
  const quantityModalValue = previewNumber(quantityModalRaw, 0)
  /** Same idea for the per-line quantity boxes, keyed by line item id. */
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({})
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null)
  const [resolvedOpportunityId, setResolvedOpportunityId] = useState<string | null>(null)
  /** When editing, preserve sent/viewed so Save does not downgrade status */
  const [initialProposalStatus, setInitialProposalStatus] = useState<string | null>(null)
  const [financingProgramsList, setFinancingProgramsList] = useState<FinancingProgramOption[]>([])
  const [financingEstimate, setFinancingEstimate] = useState<{
    monthly_payment: number
    financed_contract_total: number
  } | null>(null)

  // Tracks whether cap line items have been auto-injected for this session.
  // Prevents re-adding if the estimator deletes one, and avoids duplication on re-renders.
  const capLineItemsInjectedRef = useRef(false)

  const effectiveOpportunityId = opportunityId || resolvedOpportunityId

  useEffect(() => {
    loadData()
  }, [opportunityId, measurementId, proposalIdParam])

  const loadData = async () => {
    try {
      // Build query params
      const params = new URLSearchParams()
      if (opportunityId) params.set('opportunity_id', opportunityId)
      if (measurementId) params.set('measurement_id', measurementId)
      if (proposalIdParam) params.set('proposal_id', proposalIdParam)

      const response = await fetch(`/api/proposals/builder?${params.toString()}`)
      
      if (!response.ok) {
        if (response.status === 401) {
          router.push('/login')
          return
        }
        router.push('/dashboard')
        return
      }

      const data = await response.json()
      
      setUserRole(data.role)
      setPricebookItems(data.pricebookItems || [])
      setAdders(data.adders || [])
      setTemplates(data.templates || [])
      setRoofingTypes(data.roofingTypes || [])
      setFinancingProgramsList(data.financingPrograms || [])
      
      // Set default roofing type (but don't auto-populate line items - user should select in step 3)
      if (data.roofingTypes?.length) {
        const defaultType = data.roofingTypes.find((t: RoofingType) => t.is_default) || data.roofingTypes[0]
        setSelectedRoofingType(defaultType)
        setForm(prev => ({ ...prev, roofing_type_id: defaultType.id }))
        console.log('Default roofing type loaded:', defaultType.name, 'price_per_square:', defaultType.price_per_square)
      }

      // Apply template defaults
      if (data.templates?.length) {
        const defaultTemplate = data.templates.find((t: any) => t.is_default) || data.templates[0]
        setSelectedTemplate(defaultTemplate.id)
        if (defaultTemplate.default_scope_of_work) {
          setForm(prev => ({ ...prev, scope_of_work: defaultTemplate.default_scope_of_work }))
        }
        if (defaultTemplate.default_warranty_info) {
          setForm(prev => ({ ...prev, warranty_info: defaultTemplate.default_warranty_info }))
        }
        if (defaultTemplate.accent_color) {
          setForm(prev => ({ ...prev, accent_color: defaultTemplate.accent_color }))
        }
      }

      // Apply opportunity data (skip overwriting customer when loading an existing proposal for edit)
      if (data.opportunity && !data.existingProposal) {
        const opp = data.opportunity
        const lead = opp.leads
          ? Array.isArray(opp.leads)
            ? opp.leads[0]
            : opp.leads
          : null
        const customer = opp.customers
          ? Array.isArray(opp.customers)
            ? opp.customers[0]
            : opp.customers
          : null
        const nameFromParts = [lead?.first_name, lead?.last_name].filter(Boolean).join(' ').trim()
        const customerName =
          (typeof lead?.homeowner_name === 'string' && lead.homeowner_name.trim()) ||
          nameFromParts ||
          (typeof opp.contact_name === 'string' && opp.contact_name.trim()) ||
          (typeof customer?.name === 'string' && customer.name.trim()) ||
          urlCustomerName ||
          ''
        setForm(prev => ({
          ...prev,
          customer_name: customerName,
          customer_email: lead?.email || opp.contact_email || customer?.email || '',
          customer_phone: lead?.phone || opp.contact_phone || customer?.phone || '',
          customer_address: opp.address_text || lead?.address_text || customer?.address_text || urlCustomerAddress || '',
        }))
      } else if (urlCustomerName || urlCustomerAddress) {
        setForm(prev => ({
          ...prev,
          customer_name: urlCustomerName || prev.customer_name,
          customer_address: urlCustomerAddress || prev.customer_address,
        }))
      }

      // Apply measurement data (do not auto-fill line items when editing an existing proposal)
      if (data.measurement) {
        setMeasurementData(data.measurement)
        const measurementQuoteReady = data.measurement.raw_data?.quote_ready === true || data.measurement.status === 'completed'

        if (typeof data.measurement.suggested_waste_percent === 'number') {
          const suggested = Number(data.measurement.suggested_waste_percent)
          if (Number.isFinite(suggested) && suggested > 0) {
            setWastePercent(toHalfPercent(suggested))
            setSavedProposalWastePercent(null)
          }
        }
        
        if (data.measurement.address_text) {
          setForm(prev => ({
            ...prev,
            customer_address: prev.customer_address || data.measurement.address_text,
          }))
        }

        if (!data.existingProposal && measurementQuoteReady) {
          const base =
            data.measurement.total_squares || parseFloat(urlSquares || '0')
          const wastePct = Number(data.measurement.suggested_waste_percent || 0)
          const orderSquares =
            base > 0 && wastePct > 0 ? base * (1 + wastePct / 100) : base
          if (orderSquares > 0) {
            autoPopulateLineItems(data.pricebookItems || [], orderSquares)
          }
        }
      } else if (urlSquares && !data.existingProposal) {
        const squares = parseFloat(urlSquares)
        if (squares > 0) {
          autoPopulateLineItems(data.pricebookItems || [], squares)
        }
      }

      if (data.existingProposal) {
        const p = data.existingProposal.proposal as Record<string, unknown>
        setEditingProposalId(String(p.id))
        setInitialProposalStatus(typeof p.status === 'string' ? p.status : null)
        if (data.opportunityIdFromProposal) {
          setResolvedOpportunityId(String(data.opportunityIdFromProposal))
        }
        setForm({
          customer_name: String(p.customer_name || ''),
          customer_email: String(p.customer_email || ''),
          customer_phone: String(p.customer_phone || ''),
          customer_address: String(p.customer_address || ''),
          title: String(p.title || 'Roofing Proposal'),
          scope_of_work: String(p.scope_of_work || ''),
          materials_description: String(p.materials_description || ''),
          warranty_info: String(p.warranty_info || ''),
          discount_amount: Number(p.discount_amount) || 0,
          discount_percent: Number(p.discount_percent) || 0,
          tax_rate: Number(p.tax_rate) || 8.25,
          financing_available: Boolean(p.financing_available),
          financing_program_id: p.financing_program_id ? String(p.financing_program_id) : null,
          financing_term_months: Number(p.financing_term_months) || 60,
          financing_rate: Number(p.financing_rate) || 9.99,
          accent_color: String(p.accent_color || '#4f46e5'),
          roofing_type_id: null,
        })
        const persistedWastePercent = Number(p.sold_waste_percent)
        if (Number.isFinite(persistedWastePercent) && persistedWastePercent > 0) {
          const normalizedWaste = toHalfPercent(persistedWastePercent)
          setWastePercent(normalizedWaste)
          setSavedProposalWastePercent(normalizedWaste)
        } else {
          setSavedProposalWastePercent(null)
        }
        const mapped: LineItem[] = (data.existingProposal.lineItems || []).map((row: Record<string, unknown>) => ({
          id: String(row.id ?? crypto.randomUUID()),
          pricebook_item_id: (row.pricebook_item_id as string) || null,
          category: String(row.category ?? ''),
          name: String(row.name ?? ''),
          description: String(row.description ?? ''),
          unit: String(row.unit ?? 'each'),
          quantity: Number(row.quantity) || 0,
          unit_price: Number(row.unit_price) || 0,
          line_total: Number(row.line_total) || 0,
          is_adder: Boolean(row.is_adder),
          show_to_customer: Boolean(row.show_to_customer ?? false),
          price_type: (row.price_type as LineItem['price_type']) ?? null,
        }))
        setLineItems(mapped)
        setStep(4)
      } else {
        setEditingProposalId(null)
        setInitialProposalStatus(null)
        setResolvedOpportunityId(null)
        setSavedProposalWastePercent(null)
      }
    } catch (error) {
      console.error('Error loading builder data:', error)
      router.push('/dashboard')
    } finally {
      setLoading(false)
    }
  }

  // Calculate base squares from measurement data
  const baseSquares = measurementData?.total_squares || parseFloat(urlSquares || '0')
  const measurementWasteCategory =
    measurementData?.raw_data?.waste_category ?? measurementData?.waste_category ?? 'N/A'
  const measuredSuggestedWaste = Number(measurementData?.suggested_waste_percent || 0)
  const effectiveWastePercent =
    savedProposalWastePercent != null
      ? toHalfPercent(savedProposalWastePercent)
      : toHalfPercent(wastePercent)

  // Calculate waste squares and total squares
  const wasteSquares = baseSquares * (effectiveWastePercent / 100)
  const totalSquaresWithWaste = baseSquares + wasteSquares
  const rawBundleCount = totalSquaresWithWaste * BUNDLES_PER_SQUARE
  const roundedBundles = Math.ceil(rawBundleCount)
  const bundleRoundedSquares = roundedBundles / BUNDLES_PER_SQUARE
  const recommendedOrderSquares = Math.ceil(bundleRoundedSquares)

  // Cap shingle quantities — ordered separately from field shingles
  const ridgesLf = Number(measurementData?.ridges_lf || 0)
  const hipsLf = Number(measurementData?.hips_lf || 0)
  const capOrder = ridgeHipCapOrderSummary({ ridges_lf: ridgesLf, hips_lf: hipsLf })
  const ridgeCapBundles = ridgesLf > 0 ? Math.ceil(ridgesLf / RIDGE_CAP_LF_PER_BUNDLE) : 0
  const hipCapBundles = hipsLf > 0 ? Math.ceil(hipsLf / HIP_CAP_LF_PER_BUNDLE) : 0
  const totalCapBundles = ridgeCapBundles + hipCapBundles
  const hasCapData = ridgesLf > 0 || hipsLf > 0

  const buildRoofingLineItem = useCallback((type: RoofingType): LineItem => {
    const quantity = totalSquaresWithWaste
    const lineTotal = quantity * (type.price_per_square || 0)

    return {
      id: `roofing-${type.id}`,
      pricebook_item_id: null,
      category: 'Roofing',
      name: `${type.name} Installation`,
      description: `${baseSquares.toFixed(2)} sq + ${effectiveWastePercent}% waste = ${quantity.toFixed(2)} sq (order rec: ${recommendedOrderSquares} sq)`,
      unit: 'square',
      quantity,
      unit_price: type.price_per_square || 0,
      line_total: lineTotal,
      is_adder: false,
    }
  }, [baseSquares, effectiveWastePercent, recommendedOrderSquares, totalSquaresWithWaste])

  useEffect(() => {
    if (!selectedRoofingType || totalSquaresWithWaste <= 0) return

    const lineItemId = `roofing-${selectedRoofingType.id}`
    const nextRoofingItem = buildRoofingLineItem(selectedRoofingType)

    setLineItems(prev => {
      const existing = prev.find(item => item.id === lineItemId)
      if (!existing) return prev

      if (
        existing.quantity === nextRoofingItem.quantity &&
        existing.unit_price === nextRoofingItem.unit_price &&
        existing.line_total === nextRoofingItem.line_total &&
        existing.description === nextRoofingItem.description
      ) {
        return prev
      }

      return prev.map(item => (item.id === lineItemId ? { ...item, ...nextRoofingItem } : item))
    })
  }, [
    buildRoofingLineItem,
    recommendedOrderSquares,
    selectedRoofingType,
    totalSquaresWithWaste,
  ])

  // Auto-inject ridge cap and hip cap line items once when measurement data first loads.
  // Uses stable IDs so duplicates are never created. Runs once per builder session.
  useEffect(() => {
    if (capLineItemsInjectedRef.current) return
    if (!measurementData) return
    if (!hasCapData) return

    capLineItemsInjectedRef.current = true

    setLineItems(prev => {
      const isRidgeCap = (i: { id: string; name?: string; category?: string; is_adder?: boolean }) =>
        i.id === 'ridge-cap-auto' || (i.name === 'Ridge Cap Shingles' && !i.is_adder)
      const isHipCap = (i: { id: string; name?: string; category?: string; is_adder?: boolean }) =>
        i.id === 'hip-cap-auto' || (i.name === 'Hip Cap Shingles' && !i.is_adder)
      const hasRidge = prev.some(isRidgeCap)
      const hasHip = prev.some(isHipCap)
      if (hasRidge && hasHip) return prev

      const next = [...prev]
      if (!hasRidge && ridgesLf > 0 && capOrder && capOrder.ridgeCapSq > 0) {
        next.push({
          id: 'ridge-cap-auto',
          pricebook_item_id: null,
          category: 'Roofing',
          name: 'Ridge Cap Shingles',
          description: `${capOrder.ridgeCapSq.toFixed(2)} sq cap order (${ridgesLf} LF measured · ${ridgeCapBundles} bundles @ ${RIDGE_CAP_LF_PER_BUNDLE} LF)`,
          unit: 'square',
          quantity: capOrder.ridgeCapSq,
          unit_price: 0,
          line_total: 0,
          is_adder: false,
        })
      }
      if (!hasHip && hipsLf > 0 && capOrder && capOrder.hipCapSq > 0) {
        next.push({
          id: 'hip-cap-auto',
          pricebook_item_id: null,
          category: 'Roofing',
          name: 'Hip Cap Shingles',
          description: `${capOrder.hipCapSq.toFixed(2)} sq cap order (${hipsLf} LF measured · ${hipCapBundles} bundles @ ${HIP_CAP_LF_PER_BUNDLE} LF)`,
          unit: 'square',
          quantity: capOrder.hipCapSq,
          unit_price: 0,
          line_total: 0,
          is_adder: false,
        })
      }
      return next
    })
  }, [measurementData, hasCapData, ridgesLf, hipsLf, ridgeCapBundles, hipCapBundles, capOrder])

  useEffect(() => {
    if (!baseSquares) return
    // Temporary debug output per roof for ordering audits.
    console.log('[RoofOrderDebug]', {
      measuredSquaresBeforeWaste: Number(baseSquares.toFixed(2)),
      userWastePercent: wastePercent,
      measuredSuggestedWastePercent: measuredSuggestedWaste || null,
      effectiveWastePercent,
      wasteReason: 'User selected waste',
      complexityTier: measurementWasteCategory,
      finalOrderSquaresRaw: Number(totalSquaresWithWaste.toFixed(3)),
      bundleRounding: {
        bundlesPerSquare: BUNDLES_PER_SQUARE,
        rawBundles: Number(rawBundleCount.toFixed(3)),
        roundedBundles,
        squaresFromBundleRounding: Number(bundleRoundedSquares.toFixed(3)),
      },
      recommendedOrderSquares,
      pitch: measurementData?.predominant_pitch || null,
      valleysLf: Number(measurementData?.valleys_lf || 0),
      ridgesLf: Number(measurementData?.ridges_lf || 0),
      sectionCount: Number(measurementData?.facet_count || 0),
    })
  }, [
    baseSquares,
    bundleRoundedSquares,
    effectiveWastePercent,
    measurementData?.facet_count,
    measurementData?.predominant_pitch,
    measurementData?.ridges_lf,
    measurementData?.valleys_lf,
    measurementWasteCategory,
    measuredSuggestedWaste,
    rawBundleCount,
    recommendedOrderSquares,
    roundedBundles,
    totalSquaresWithWaste,
    wastePercent,
  ])

  const unitLower = (u?: string) => (u || '').trim().toLowerCase()
  const isPerSqftUnit = (u?: string) => unitLower(u) === 'per_sqft'

  // Convert quantity based on unit type
  // 1 square = 100 sq ft
  const convertQuantityForUnit = (squares: number, unit: string): number => {
    const u = unitLower(unit)

    // Manual sq ft (e.g. siding) — never from roof squares; use 1 until user enters quantity
    if (u === 'per_sqft') {
      return 1
    }

    if (u === 'sqft' || u === 'sq ft' || u === 'sf') {
      // Convert squares to square feet (1 square = 100 sq ft)
      return squares * 100
    }
    if (u === 'square' || u === 'sq' || u === 'squares') {
      return squares
    }
    // For "each", "job", "per job" - these are fixed quantity items, default to 1
    if (u === 'each' || u === 'job' || u === 'per job') {
      return 1
    }
    // For linear foot, we don't have that measurement, default to 1
    if (u === 'lf' || u === 'linear foot' || u === 'linear feet') {
      return 1
    }
    // For other unknown units, default to 1 (safer than using squares)
    return 1
  }

  const getUnitLabel = (unit: string): string => {
    const u = unitLower(unit)
    switch (u) {
      case 'per_sqft':
        return 'sq ft'
      case 'square':
      case 'sq':
      case 'squares':
        return 'squares'
      case 'sqft':
      case 'sq ft':
      case 'sf':
        return 'sq ft'
      case 'lf':
        return 'linear ft'
      case 'each':
        return 'each'
      case 'job':
        return 'job'
      case 'hour':
        return 'hours'
      case 'watt':
        return 'watts'
      case 'bundle':
        return 'bundles'
      case 'roll':
        return 'rolls'
      case 'sheet':
        return 'sheets'
      case 'percent':
        return '% of total'
      default:
        return unit || 'units'
    }
  }

  const autoPopulateLineItems = (items: PricebookItem[], squares: number) => {
    // Find main roofing product (usually priced per square)
    const roofingItems = items.filter(item => 
      item.category?.toLowerCase().includes('roofing') || 
      item.category?.toLowerCase().includes('shingle') ||
      item.unit?.toLowerCase() === 'square' ||
      item.unit?.toLowerCase() === 'sq'
    )

    const newLineItems: LineItem[] = []

    // Add main roofing product
    if (roofingItems.length > 0) {
      const mainProduct = roofingItems[0]
      const quantity = convertQuantityForUnit(squares, mainProduct.unit)
      newLineItems.push({
        id: crypto.randomUUID(),
        pricebook_item_id: mainProduct.id,
        category: mainProduct.category,
        name: mainProduct.name,
        description: '',
        unit: mainProduct.unit,
        quantity,
        unit_price: mainProduct.unit_price,
        line_total: mainProduct.unit_price * quantity,
        is_adder: false,
      })
    }

    // Add labor if available
    const laborItems = items.filter(item => 
      item.category?.toLowerCase().includes('labor') ||
      item.name?.toLowerCase().includes('labor') ||
      item.name?.toLowerCase().includes('installation')
    )

    if (laborItems.length > 0) {
      const laborItem = laborItems[0]
      const quantity = convertQuantityForUnit(squares, laborItem.unit)
      newLineItems.push({
        id: crypto.randomUUID(),
        pricebook_item_id: laborItem.id,
        category: laborItem.category,
        name: laborItem.name,
        description: '',
        unit: laborItem.unit,
        quantity,
        unit_price: laborItem.unit_price,
        line_total: laborItem.unit_price * quantity,
        is_adder: false,
      })
    }

    if (newLineItems.length > 0) {
      setLineItems(newLineItems)
    }
  }

  // Check if an item needs quantity input (for "each", "sheet", "bundle", "linear foot", per-sq-ft type items)
  const needsQuantityInput = (unit: string): boolean => {
    const u = unitLower(unit)
    return [
      'each',
      'sheet',
      'sheets',
      'bundle',
      'bundles',
      'roll',
      'rolls',
      'piece',
      'pieces',
      'unit',
      'units',
      'lf',
      'linear foot',
      'linear feet',
      'per_sqft',
    ].includes(u)
  }

  /** Set the modal quantity from a button/stepper. */
  const setQuantityModalNumber = (value: number) => {
    setQuantityModalRaw(formatNumericDraft(value))
  }

  const addLineItem = (item: PricebookItem, quantity?: number) => {
    // If this is an "each" type item and no quantity provided, show the quantity modal
    if (needsQuantityInput(item.unit) && !quantity) {
      setQuantityModalItem(item)
      setQuantityModalNumber(isPerSqftUnit(item.unit) ? 100 : 1)
      return
    }

    // If no quantity provided, calculate based on measurement data and unit type
    let calculatedQuantity = quantity || 1
    
    if (!quantity && measurementData?.total_squares) {
      calculatedQuantity = convertQuantityForUnit(measurementData.total_squares, item.unit)
    }
    
    const isPercentage = item.price_type === 'percentage' || item.unit === 'percent'
    const newItem: LineItem = {
      id: crypto.randomUUID(),
      pricebook_item_id: item.id,
      category: item.category,
      name: item.name,
      description: '',
      unit: item.unit,
      quantity: isPercentage ? 1 : calculatedQuantity,
      unit_price: item.unit_price,
      line_total: isPercentage ? 0 : item.unit_price * calculatedQuantity, // Percentage items calculated later
      is_adder: item.is_adder,
      show_to_customer: item.show_to_customer ?? false,
      price_type: item.price_type,
    }
    setLineItems(prev => [...prev, newItem])
    setShowAddItem(false)
  }

  const confirmQuantityAndAdd = () => {
    if (!quantityModalItem) return

    // Coerce the draft on save so a cleared field never commits a stale value.
    const isPerSqft = isPerSqftUnit(quantityModalItem.unit)
    const min = isPerSqft ? 0.01 : 1
    const base = parseDraftFloat(quantityModalRaw, { fallback: min }) ?? min
    const qty = isPerSqft ? Math.max(min, base) : Math.max(min, Math.round(base))

    const newItem: LineItem = {
      id: crypto.randomUUID(),
      pricebook_item_id: quantityModalItem.id,
      category: quantityModalItem.category,
      name: quantityModalItem.name,
      description: '',
      unit: quantityModalItem.unit,
      quantity: qty,
      unit_price: quantityModalItem.unit_price,
      line_total: quantityModalItem.unit_price * qty,
      is_adder: quantityModalItem.is_adder,
      show_to_customer: quantityModalItem.show_to_customer ?? false,
      price_type: quantityModalItem.price_type,
    }
    setLineItems(prev => [...prev, newItem])
    setQuantityModalItem(null)
    setQuantityModalNumber(1)
    setShowAddItem(false)
  }

  const updateLineItem = (id: string, field: string, value: any) => {
    setLineItems(prev => prev.map(item => {
      if (item.id !== id) return item
      const updated = { ...item, [field]: value }
      if (field === 'quantity' || field === 'unit_price') {
        updated.line_total = updated.quantity * updated.unit_price
      }
      return updated
    }))
  }

  /** Coerce a line's quantity draft on blur and drop the draft so it re-follows state. */
  const commitQuantityDraft = (item: LineItem, min: number) => {
    const raw = quantityDrafts[item.id]
    if (raw === undefined) return
    const parsed = parseDraftFloat(raw, { fallback: min }) ?? min
    updateLineItem(item.id, 'quantity', Math.max(min, parsed))
    setQuantityDrafts(prev => {
      const next = { ...prev }
      delete next[item.id]
      return next
    })
  }

  const removeLineItem = (id: string) => {
    setLineItems(prev => prev.filter(item => item.id !== id))
    setQuantityDrafts(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const isPercentageItem = (item: LineItem): boolean => {
    return item.price_type === 'percentage' || item.unit === 'percent'
  }

  const calculateTotals = () => {
    // First calculate base subtotal (non-percentage items) in cents for stable currency math.
    const baseSubtotalCents = lineItems
      .filter(item => !isPercentageItem(item))
      .reduce((sum, item) => sum + toCents(item.line_total || 0), 0)
    
    // Then calculate percentage-based items as % of base subtotal (also in cents).
    const percentageTotalCents = lineItems
      .filter(item => isPercentageItem(item))
      .reduce((sum, item) => sum + Math.round(baseSubtotalCents * ((item.unit_price || 0) / 100)), 0)
    
    const subtotalCents = baseSubtotalCents + percentageTotalCents
    let discountCents = form.discount_percent > 0
      ? Math.round(subtotalCents * ((form.discount_percent || 0) / 100))
      : toCents(form.discount_amount || 0)
    discountCents = Math.min(Math.max(discountCents, 0), subtotalCents)
    const afterDiscountCents = subtotalCents - discountCents
    const taxAmountCents = Math.round(afterDiscountCents * ((form.tax_rate || 0) / 100))
    const totalCents = afterDiscountCents + taxAmountCents
    const subtotal = fromCents(subtotalCents)
    const baseSubtotal = fromCents(baseSubtotalCents)
    const percentageTotal = fromCents(percentageTotalCents)
    const discountAmount = fromCents(discountCents)
    const afterDiscount = fromCents(afterDiscountCents)
    const taxAmount = fromCents(taxAmountCents)
    const total = fromCents(totalCents)
    const monthlyPayment = form.financing_available 
      ? calculateMonthlyPayment(total, form.financing_rate || 0, form.financing_term_months || 60)
      : 0

    return { 
      subtotal: subtotal || 0, 
      baseSubtotal: baseSubtotal || 0,
      percentageTotal: percentageTotal || 0,
      discountAmount: discountAmount || 0, 
      afterDiscount: afterDiscount || 0, 
      taxAmount: taxAmount || 0, 
      total: total || 0, 
      monthlyPayment: monthlyPayment || 0 
    }
  }

  const calculateMonthlyPayment = (principal: number, annualRate: number, months: number) => {
    const monthlyRate = annualRate / 100 / 12
    if (monthlyRate === 0) return principal / months
    return principal * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1)
  }

  const saveProposal = async (asDraft: boolean = true) => {
    // Validate required fields
    const missingFields: string[] = []
    if (!form.customer_name?.trim()) missingFields.push('Customer Name')
    if (!form.customer_phone?.trim()) missingFields.push('Phone Number')
    if (!form.customer_address?.trim()) missingFields.push('Address')
    if (!form.customer_email?.trim()) missingFields.push('Email')
    
    if (missingFields.length > 0) {
      alert(`Please fill in required fields: ${missingFields.join(', ')}`)
      setStep(1) // Go back to customer info step
      return
    }

    setSaving(true)

    try {
      const totals = calculateTotals()

      const statusForSave =
        editingProposalId &&
        asDraft &&
        initialProposalStatus &&
        ['sent', 'viewed'].includes(initialProposalStatus)
          ? initialProposalStatus
          : asDraft
            ? 'draft'
            : 'sent'

      const proposalData = {
        opportunity_id: effectiveOpportunityId || null,
        customer_name: form.customer_name,
        customer_email: form.customer_email,
        customer_phone: form.customer_phone,
        customer_address: form.customer_address,
        title: form.title,
        status: statusForSave,
        subtotal: totals.subtotal,
        discount_amount: totals.discountAmount,
        discount_percent: form.discount_percent,
        tax_rate: form.tax_rate,
        tax_amount: totals.taxAmount,
        total: totals.total,
        financing_available: form.financing_available,
        financing_program_id: form.financing_program_id,
        financing_term_months: form.financing_term_months,
        financing_rate: form.financing_rate,
        monthly_payment: totals.monthlyPayment,
        scope_of_work: form.scope_of_work,
        materials_description: form.materials_description,
        warranty_info: form.warranty_info,
        measured_squares: baseSquares > 0 ? Number(baseSquares.toFixed(2)) : null,
        sold_waste_percent: effectiveWastePercent > 0 ? Number(effectiveWastePercent.toFixed(2)) : null,
        sold_squares: totalSquaresWithWaste > 0 ? Number(totalSquaresWithWaste.toFixed(2)) : null,
        recommended_order_squares: recommendedOrderSquares > 0 ? recommendedOrderSquares : null,
        accent_color: form.accent_color,
      }

      const lineItemsData = lineItems.map((item, idx) => ({
        pricebook_item_id: item.pricebook_item_id,
        category: item.category,
        name: item.name,
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: item.line_total,
        is_adder: item.is_adder,
        show_to_customer: item.show_to_customer ?? false,  // Include customer visibility
      }))

      const response = await fetch('/api/proposals/builder', {
        method: editingProposalId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          editingProposalId
            ? {
                proposal_id: editingProposalId,
                proposal: proposalData,
                lineItems: lineItemsData,
              }
            : {
                proposal: proposalData,
                lineItems: lineItemsData,
              }
        ),
      })

      if (!response.ok) {
        const data = await response.json()
        console.error('Failed to save proposal:', data.error)
        alert(`Failed to save proposal: ${data.error || 'Unknown error'}`)
        setSaving(false)
        return
      }

      const { proposal } = await response.json()
      router.push(`/proposals/${proposal.id}`)
    } catch (error) {
      console.error('Error saving proposal:', error)
      alert(`Failed to save proposal: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setSaving(false)
    }
  }

  // Calculate totals with fallback for safety
  const totals = calculateTotals() || {
    subtotal: 0,
    baseSubtotal: 0,
    percentageTotal: 0,
    discountAmount: 0,
    afterDiscount: 0,
    taxAmount: 0,
    total: 0,
    monthlyPayment: 0,
  }

  const displayMonthlyPayment =
    form.financing_available && form.financing_program_id && financingEstimate
      ? financingEstimate.monthly_payment
      : totals.monthlyPayment

  const displayFinancedContractTotal =
    form.financing_available && form.financing_program_id && financingEstimate
      ? financingEstimate.financed_contract_total
      : null
  const primaryDisplayTotal =
    displayFinancedContractTotal != null && displayFinancedContractTotal > 0
      ? displayFinancedContractTotal
      : totals.total

  useEffect(() => {
    let cancelled = false
    if (!form.financing_available || !form.financing_program_id) {
      setFinancingEstimate(null)
      return
    }
    const t = calculateTotals()
    const total = t.total
    fetch(
      `/api/financing-programs/estimate?program_id=${encodeURIComponent(form.financing_program_id)}&total=${encodeURIComponent(String(total))}`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setFinancingEstimate({
          monthly_payment: data.monthly_payment,
          financed_contract_total: data.financed_contract_total,
        })
      })
      .catch(() => {
        if (!cancelled) setFinancingEstimate(null)
      })
    return () => {
      cancelled = true
    }
  }, [
    form.financing_available,
    form.financing_program_id,
    form.discount_percent,
    form.discount_amount,
    form.tax_rate,
    form.financing_rate,
    form.financing_term_months,
    lineItems,
  ])

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
    <div className="min-h-screen bg-gray-100">
      <Nav />
      
      {/* Progress Steps */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 sm:gap-8 overflow-x-auto">
              {[
                { num: 1, label: 'Customer Info' },
                { num: 2, label: 'Roofing Type' },
                { num: 3, label: 'Pricing' },
                { num: 4, label: 'Adders' },
                { num: 5, label: 'Review' },
              ].map((s, idx) => (
                <button
                  key={s.num}
                  onClick={() => setStep(s.num)}
                  className={`flex items-center gap-2 flex-shrink-0 ${step === s.num ? 'text-indigo-600' : 'text-gray-400'}`}
                >
                  <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                    step === s.num ? 'bg-indigo-600 text-white' : step > s.num ? 'bg-green-500 text-white' : 'bg-gray-200'
                  }`}>
                    {step > s.num ? '✓' : s.num}
                  </div>
                  <span className="hidden sm:block font-medium">{s.label}</span>
                </button>
              ))}
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm text-gray-500">Total</p>
              <p className="text-lg sm:text-2xl font-bold text-gray-900">
                $
                {(primaryDisplayTotal || 0).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Back Button */}
        <div className="mb-6">
          <button
            onClick={() => {
              if (effectiveOpportunityId) {
                router.push(`/opportunities/${effectiveOpportunityId}`)
              } else {
                router.back()
              }
            }}
            className="inline-flex items-center gap-2 text-indigo-600 hover:text-indigo-800 text-sm font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            {effectiveOpportunityId ? 'Back to Opportunity' : 'Back'}
          </button>
        </div>

        {/* Measurement Summary Banner */}
        {measurementData && (
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-6 mb-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold mb-1">Roof Measurement Loaded</h3>
                <p className="text-indigo-100 text-sm">{measurementData.address_text}</p>
              </div>
              <div className="flex gap-6 text-center">
                <div>
                  <div className="text-3xl font-bold">{measurementData.total_squares?.toFixed(1) || urlSquares}</div>
                  <div className="text-xs text-indigo-200 uppercase tracking-wider">Squares</div>
                </div>
                <div>
                  <div className="text-3xl font-bold">{measurementData.total_area_sqft?.toLocaleString() || '-'}</div>
                  <div className="text-xs text-indigo-200 uppercase tracking-wider">Sq Ft</div>
                </div>
                <div>
                  <div className="text-3xl font-bold">{measurementData.predominant_pitch || '-'}</div>
                  <div className="text-xs text-indigo-200 uppercase tracking-wider">Pitch</div>
                </div>
                <div>
                  <div className="text-3xl font-bold">{measurementData.facet_count || '-'}</div>
                  <div className="text-xs text-indigo-200 uppercase tracking-wider">Sections</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Customer Info */}
        {step === 1 && (
          <div className="bg-white rounded-2xl shadow-sm p-6 md:p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Customer Information</h2>
            
            <p className="text-sm text-gray-500 mb-4">Fields marked with * are required</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Customer Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.customer_name}
                  onChange={(e) => setForm(prev => ({ ...prev, customer_name: e.target.value }))}
                  className={`w-full px-4 py-3 border rounded-xl text-lg ${!form.customer_name?.trim() ? 'border-red-300' : 'border-gray-300'}`}
                  placeholder="John Smith"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email <span className="text-red-500">*</span></label>
                <input
                  type="email"
                  value={form.customer_email}
                  onChange={(e) => setForm(prev => ({ ...prev, customer_email: e.target.value }))}
                  className={`w-full px-4 py-3 border rounded-xl ${!form.customer_email?.trim() ? 'border-red-300' : 'border-gray-300'}`}
                  placeholder="john@example.com"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Phone <span className="text-red-500">*</span></label>
                <input
                  type="tel"
                  value={form.customer_phone}
                  onChange={(e) => setForm(prev => ({ ...prev, customer_phone: e.target.value }))}
                  className={`w-full px-4 py-3 border rounded-xl ${!form.customer_phone?.trim() ? 'border-red-300' : 'border-gray-300'}`}
                  placeholder="(555) 123-4567"
                  required
                />
              </div>
              
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Property Address <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.customer_address}
                  onChange={(e) => setForm(prev => ({ ...prev, customer_address: e.target.value }))}
                  className={`w-full px-4 py-3 border rounded-xl ${!form.customer_address?.trim() ? 'border-red-300' : 'border-gray-300'}`}
                  placeholder="123 Main St, City, State 12345"
                  required
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Proposal Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl"
                  placeholder="Roofing Proposal"
                />
              </div>
            </div>

            <div className="mt-8 flex justify-end">
              <button
                onClick={() => setStep(2)}
                disabled={!form.customer_name?.trim() || !form.customer_address?.trim() || !form.customer_phone?.trim() || !form.customer_email?.trim()}
                className="px-8 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Waste Factor */}
        {step === 2 && (
          <div className="bg-white rounded-2xl shadow-sm p-6 md:p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Material Waste Factor</h2>
            <p className="text-gray-500 mb-6">
              Add a waste percentage to account for cuts, overlaps, and material waste. Industry standard is typically 10-15%.
            </p>

            {/* Base Measurement Display */}
            <div className="bg-gray-50 rounded-xl p-6 mb-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div>
                  <p className="text-sm text-gray-500 mb-1">Measured Area</p>
                  <p className="text-2xl font-bold text-gray-900">{baseSquares.toFixed(1)}</p>
                  <p className="text-xs text-gray-400">squares</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-1">Waste Factor</p>
                  <p className="text-2xl font-bold text-amber-600">+{effectiveWastePercent}%</p>
                  <p className="text-xs text-gray-400">{wasteSquares.toFixed(1)} squares</p>
                </div>
                <div className="col-span-2 md:col-span-1">
                  <p className="text-sm text-gray-500 mb-1">Total Material</p>
                  <p className="text-2xl font-bold text-indigo-600">{totalSquaresWithWaste.toFixed(1)}</p>
                  <p className="text-xs text-gray-400">squares needed</p>
                </div>
                <div className="col-span-2 md:col-span-1">
                  <p className="text-sm text-gray-500 mb-1">Total Sq Ft</p>
                  <p className="text-2xl font-bold text-gray-700">{(totalSquaresWithWaste * 100).toLocaleString()}</p>
                  <p className="text-xs text-gray-400">square feet</p>
                </div>
              </div>
            </div>

            {/* Waste Percentage Selector */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-3">Select Waste Percentage</label>
              <div className="grid grid-cols-5 gap-3">
                {[5, 10, 12, 15, 20].map((percent) => (
                  <button
                    key={percent}
                    onClick={() => {
                      setWastePercent(percent)
                      setSavedProposalWastePercent(null)
                    }}
                    className={`py-4 px-3 rounded-xl font-semibold border-2 transition-all ${
                      effectiveWastePercent === percent
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                    }`}
                  >
                    {percent}%
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Waste Input */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Or enter custom percentage</label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="0"
                  max="50"
                  step="0.5"
                  value={wastePercent}
                  onChange={(e) => {
                    setWastePercent(parseFloat(e.target.value) || 0)
                    setSavedProposalWastePercent(null)
                  }}
                  className="w-32 px-4 py-3 border border-gray-300 rounded-xl text-center text-lg font-semibold"
                />
                <span className="text-gray-500 font-medium">%</span>
              </div>
            </div>

            {/* Visual Breakdown */}
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-6 border border-indigo-100">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Material Breakdown</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Measured Roof Area</span>
                  <span className="font-semibold text-gray-900">{baseSquares.toFixed(1)} squares</span>
                </div>
                <div className="flex justify-between items-center text-amber-700">
                  <span>Waste ({effectiveWastePercent}%)</span>
                  <span className="font-semibold">+{wasteSquares.toFixed(1)} squares</span>
                </div>
                <div className="border-t border-indigo-200 pt-3 flex justify-between items-center">
                  <span className="font-semibold text-gray-900">Total Material Needed</span>
                  <span className="text-xl font-bold text-indigo-600">{totalSquaresWithWaste.toFixed(1)} squares</span>
                </div>
                <div className="flex justify-between items-center text-gray-700">
                  <span>Recommended order (bundle-rounded)</span>
                  <span className="font-semibold">{recommendedOrderSquares} squares</span>
                </div>
                <div className="text-xs text-gray-500">
                  {roundedBundles} bundles ({BUNDLES_PER_SQUARE} bundles/square), rounded up from {rawBundleCount.toFixed(2)} bundles.
                </div>
              </div>
            </div>

            {/* Materials to Order — full bundle breakdown including cap shingles */}
            <div className="mt-4 bg-gray-900 text-white rounded-xl p-5">
              <h3 className="text-sm font-bold text-gray-300 uppercase tracking-widest mb-4">Materials to Order</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-white">Field Shingles</p>
                    <p className="text-xs text-gray-400">{baseSquares.toFixed(2)} sq + {effectiveWastePercent}% waste</p>
                  </div>
                  <p className="text-lg font-bold text-white">{roundedBundles} bundles</p>
                </div>

                {capOrder && capOrder.ridgeCapSq > 0 && (
                  <div className="flex justify-between items-start border-t border-gray-700 pt-3">
                    <div>
                      <p className="font-semibold text-white">Ridge Cap Shingles</p>
                      <p className="text-xs text-amber-400 font-medium">Order separately — cap squares, not field LF</p>
                      <p className="text-xs text-gray-400">
                        {capOrder.ridgeCapSq.toFixed(2)} sq ({ridgesLf} LF measured · {ridgeCapBundles} bundles @ {RIDGE_CAP_LF_PER_BUNDLE} LF)
                      </p>
                    </div>
                    <p className="text-lg font-bold text-white">{capOrder.ridgeCapSq.toFixed(2)} sq</p>
                  </div>
                )}

                {capOrder && capOrder.hipCapSq > 0 && (
                  <div className="flex justify-between items-start border-t border-gray-700 pt-3">
                    <div>
                      <p className="font-semibold text-white">Hip Cap Shingles</p>
                      <p className="text-xs text-amber-400 font-medium">Order separately — cap squares, not field LF</p>
                      <p className="text-xs text-gray-400">
                        {capOrder.hipCapSq.toFixed(2)} sq ({hipsLf} LF measured · {hipCapBundles} bundles @ {HIP_CAP_LF_PER_BUNDLE} LF)
                      </p>
                    </div>
                    <p className="text-lg font-bold text-white">{capOrder.hipCapSq.toFixed(2)} sq</p>
                  </div>
                )}

                <div className="border-t border-gray-500 pt-3 flex justify-between items-center">
                  <p className="font-bold text-white text-base">Total Bundles to Order</p>
                  <p className="text-2xl font-black text-green-400">{roundedBundles + totalCapBundles}</p>
                </div>
              </div>
            </div>

            {measurementData && (
              <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-xl">
                <p className="text-sm font-semibold text-gray-800 mb-2">Order Debug (Temporary)</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-700">
                  <p>Measured squares before waste: <strong>{baseSquares.toFixed(2)}</strong></p>
                  <p>Waste % used: <strong>{effectiveWastePercent}%</strong></p>
                  <p>Suggested waste / tier: <strong>{measuredSuggestedWaste || 'N/A'}% / {measurementWasteCategory}</strong></p>
                  <p>Final order squares (pre-round): <strong>{totalSquaresWithWaste.toFixed(3)}</strong></p>
                  <p>Bundle rounding: <strong>{rawBundleCount.toFixed(2)}</strong> {'->'} <strong>{roundedBundles}</strong> bundles</p>
                  <p>Recommended order squares: <strong>{recommendedOrderSquares}</strong></p>
                  <p>Pitch: <strong>{measurementData.predominant_pitch || '-'}</strong></p>
                  <p>Valleys LF: <strong>{measurementData.valleys_lf ?? 0}</strong></p>
                  <p>Ridge cap order: <strong>{capOrder?.ridgeCapSq.toFixed(2) ?? '0'} sq</strong> ({measurementData.ridges_lf ?? 0} LF)</p>
                  <p>Hip cap order: <strong>{capOrder?.hipCapSq.toFixed(2) ?? '0'} sq</strong> ({measurementData.hips_lf ?? 0} LF)</p>
                  <p>Section count: <strong>{measurementData.facet_count ?? 0}</strong></p>
                </div>
              </div>
            )}

            <div className="mt-8 flex justify-between">
              <button
                onClick={() => setStep(1)}
                className="px-6 py-3 border border-gray-300 rounded-xl font-medium hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                className="px-8 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700"
              >
                Continue to Roofing Type
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Roofing Type Selection */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Select Roofing Type</h2>
              <p className="text-gray-500 mb-6">Choose the type of roofing material for this project. Pricing will be calculated based on your selection.</p>

              {roofingTypes.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl">
                  <svg className="w-12 h-12 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  <p className="text-gray-500 mb-2">No roofing types configured</p>
                  <p className="text-sm text-gray-400">Ask your admin to set up roofing types in Admin → Pricing & Costs</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {roofingTypes.map((type) => (
                    <button
                      key={type.id}
                      onClick={() => {
                        console.log('Roofing type selected:', type.name, 'price_per_square:', type.price_per_square, 'totalSquaresWithWaste:', totalSquaresWithWaste)
                        setSelectedRoofingType(type)
                        setForm(prev => ({ ...prev, roofing_type_id: type.id }))
                        // Update warranty info if the type has default warranty text
                        if (type.default_warranty_text) {
                          setForm(prev => ({ ...prev, warranty_info: type.default_warranty_text || prev.warranty_info }))
                        }
                        // Auto-populate line items based on roofing type (using total with waste)
                        if (totalSquaresWithWaste > 0) {
                          const newLineItem = buildRoofingLineItem(type)
                          console.log('Creating line item:', totalSquaresWithWaste, 'squares x $', type.price_per_square, '= $', newLineItem.line_total, '(recommended order:', recommendedOrderSquares, 'sq)')
                          // Replace any existing roofing line items
                          setLineItems(prev => {
                            const nonRoofingItems = prev.filter(item => 
                              !item.name.toLowerCase().includes('roofing') && 
                              !item.name.toLowerCase().includes('installation') ||
                              item.is_adder
                            )
                            return [newLineItem, ...nonRoofingItems.filter(i => !i.is_adder)]
                          })
                        } else {
                          console.log('No squares available, not creating line item')
                        }
                      }}
                      className={`relative p-6 rounded-xl border-2 text-left transition-all ${
                        selectedRoofingType?.id === type.id
                          ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-600'
                          : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
                      }`}
                    >
                      {type.is_default && (
                        <span className="absolute top-3 right-3 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                          Default
                        </span>
                      )}
                      <div 
                        className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                        style={{ backgroundColor: type.color + '20' }}
                      >
                        <svg 
                          className="w-6 h-6" 
                          fill="none" 
                          stroke={type.color} 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-1">{type.name}</h3>
                      {type.description && (
                        <p className="text-sm text-gray-500 mb-3 line-clamp-2">{type.description}</p>
                      )}
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold" style={{ color: type.color }}>
                          ${(type.price_per_square || 0).toLocaleString()}
                        </span>
                        <span className="text-sm text-gray-400">/square</span>
                      </div>
                      {type.default_warranty_years && (
                        <p className="text-xs text-gray-500 mt-2">
                          {type.default_warranty_years} year warranty
                        </p>
                      )}
                      {selectedRoofingType?.id === type.id && (
                        <div className="absolute top-3 left-3">
                          <svg className="w-6 h-6 text-indigo-600" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                          </svg>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Show calculated price if roofing type selected and measurement available */}
              {selectedRoofingType && totalSquaresWithWaste > 0 && (
                <div className="mt-6 p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-700">Estimated Base Price</p>
                      <p className="text-xs text-gray-500">
                        {totalSquaresWithWaste.toFixed(1)} squares (incl. {effectiveWastePercent}% waste) × ${(selectedRoofingType?.price_per_square || 0).toLocaleString()}/sq
                      </p>
                    </div>
                    <p className="text-2xl font-bold text-indigo-600">
                      ${(totalSquaresWithWaste * (selectedRoofingType?.price_per_square || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              )}

              {/* Tear-off Question - shown after roofing type is selected */}
              {selectedRoofingType && (
                <div className="mt-8 p-6 bg-amber-50 border border-amber-200 rounded-xl">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Is this a tear-off job?</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Does the existing roof need to be removed before installing the new roof?
                  </p>
                  <div className="flex gap-4">
                    <button
                      onClick={() => {
                        setIsTearOff(true)
                        // Filter adders that are tear-off related
                        const tearOffAdders = adders.filter(a => 
                          a.name.toLowerCase().includes('tear') || 
                          a.name.toLowerCase().includes('removal') ||
                          a.adder_category?.toLowerCase() === 'tear-off' ||
                          a.adder_category?.toLowerCase() === 'tearoff'
                        )
                        setTearOffOptions(tearOffAdders)
                      }}
                      className={`flex-1 py-4 px-6 rounded-xl font-semibold border-2 transition-all ${
                        isTearOff === true
                          ? 'bg-amber-600 text-white border-amber-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-amber-400'
                      }`}
                    >
                      <div className="flex items-center justify-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Yes, Tear-off Required
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        setIsTearOff(false)
                        setSelectedTearOff(null)
                        setTearOffOptions([])
                      }}
                      className={`flex-1 py-4 px-6 rounded-xl font-semibold border-2 transition-all ${
                        isTearOff === false
                          ? 'bg-gray-600 text-white border-gray-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      <div className="flex items-center justify-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        No, Overlay/New
                      </div>
                    </button>
                  </div>

                  {/* Tear-off Options - shown when tear-off is selected */}
                  {isTearOff === true && tearOffOptions.length > 0 && (
                    <div className="mt-6">
                      <h4 className="text-sm font-medium text-gray-700 mb-3">Select Tear-off Option:</h4>
                      <div className="space-y-2">
                        {tearOffOptions.map((option) => (
                          <button
                            key={option.id}
                            onClick={() => setSelectedTearOff(option)}
                            className={`w-full p-4 rounded-lg border-2 text-left transition-all ${
                              selectedTearOff?.id === option.id
                                ? 'bg-amber-100 border-amber-500'
                                : 'bg-white border-gray-200 hover:border-amber-300'
                            }`}
                          >
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="font-medium text-gray-900">{option.name}</p>
                                <p className="text-sm text-gray-500">
                                  ${(option.unit_price || 0).toLocaleString()} / {option.unit}
                                </p>
                              </div>
                              {selectedTearOff?.id === option.id && (
                                <svg className="w-6 h-6 text-amber-600" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                                </svg>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Message when no tear-off options are configured */}
                  {isTearOff === true && tearOffOptions.length === 0 && (
                    <div className="mt-4 p-4 bg-white rounded-lg border border-amber-200">
                      <p className="text-sm text-amber-700">
                        <strong>Note:</strong> No tear-off options are configured. You can add tear-off line items manually in the next step, 
                        or ask your admin to create tear-off adders in Admin → Proposal Settings → Adders.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep(2)}
                className="px-6 py-3 border border-gray-300 rounded-xl font-medium hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={() => {
                  // If tear-off is selected and an option is chosen, add it to line items
                  if (isTearOff === true && selectedTearOff) {
                    const quantity = selectedTearOff.unit === 'square' ? totalSquaresWithWaste : 1
                    const newLineItem: LineItem = {
                      id: crypto.randomUUID(),
                      pricebook_item_id: selectedTearOff.id,
                      category: 'Tear-off',
                      name: selectedTearOff.name,
                      description: 'Removal of existing roofing material',
                      unit: selectedTearOff.unit,
                      quantity: quantity,
                      unit_price: selectedTearOff.unit_price,
                      line_total: quantity * selectedTearOff.unit_price,
                      is_adder: true,
                    }
                    // Check if tear-off already exists
                    const existingTearOff = lineItems.find(item => item.category === 'Tear-off')
                    if (!existingTearOff) {
                      setLineItems(prev => [...prev, newLineItem])
                    }
                  }
                  setStep(4)
                }}
                disabled={roofingTypes.length > 0 && !selectedRoofingType}
                className="px-8 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue to Pricing
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Line Items / Pricing */}
        {step === 4 && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Project Items</h2>

              {/* Admin/Ops view - can see and edit line items */}
              {['admin', 'operations'].includes(userRole) ? (
                <>
                  <div className="flex justify-end mb-4">
                    <button
                      onClick={() => setShowAddItem(true)}
                      className="px-4 py-2 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700"
                    >
                      + Add Item
                    </button>
                  </div>

                  {lineItems.filter(i => !i.is_adder).length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl">
                      <p className="text-gray-500 mb-4">No items added yet</p>
                      <button
                        onClick={() => setShowAddItem(true)}
                        className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700"
                      >
                        Add First Item
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {lineItems.filter(i => !i.is_adder).map((item) => (
                        <div key={item.id} className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                          <div className="flex-1">
                            <p className="font-medium text-gray-900">{item.name}</p>
                            <p className="text-sm text-gray-500">{item.category}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <input
                              type="number"
                              value={quantityDrafts[item.id] ?? formatNumericDraft(item.quantity)}
                              onChange={(e) => {
                                const raw = e.target.value
                                setQuantityDrafts(prev => ({ ...prev, [item.id]: raw }))
                                const parsed = parseDraftFloat(raw)
                                if (parsed !== null) {
                                  updateLineItem(item.id, 'quantity', parsed)
                                }
                              }}
                              onBlur={() => commitQuantityDraft(item, 0)}
                              className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-center"
                              min="0"
                              step="0.1"
                            />
                            <span className="text-gray-500 text-sm w-20">{getUnitLabel(item.unit)}</span>
                            <span className="text-gray-900 font-medium w-24 text-right">
                              ${item.unit_price.toFixed(2)}
                            </span>
                            <span className="text-indigo-600 font-bold w-28 text-right">
                              ${(item.line_total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                            <button
                              onClick={() => removeLineItem(item.id)}
                              className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                /* Sales Rep view - only sees total, not line items */
                <div className="space-y-6">
                  <div className="p-6 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border border-indigo-100">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">Base Project Price</h3>
                        <p className="text-sm text-gray-500 mt-1">
                          {measurementData ? (
                            <>Based on {measurementData.total_squares?.toFixed(1) || urlSquares} squares</>
                          ) : (
                            <>Calculated from measurement data</>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-3xl font-bold text-indigo-600">
                          ${lineItems.filter(i => !i.is_adder).reduce((sum, i) => sum + (i.line_total || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600">
                      <strong>Note:</strong> The base price is automatically calculated from the roof measurement and your company's pricing. 
                      You can add optional upgrades on the next step.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep(3)}
                className="px-6 py-3 border border-gray-300 rounded-xl font-medium hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={() => setStep(5)}
                className="px-8 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700"
              >
                Continue to Adders
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Adders */}
        {step === 5 && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Add-Ons & Upgrades</h2>
              <p className="text-gray-500 mb-4">Select additional items for this project</p>
              
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg mb-6">
                <p className="text-sm text-blue-800">
                  <strong>Note:</strong> Add-on pricing is visible to you while building. The customer proposal will only show the <strong>final total price</strong> - individual add-ons will not be itemized.
                </p>
              </div>

              {/* Category filter */}
              <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
                <button
                  onClick={() => setSelectedAdderCategory('all')}
                  className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${
                    selectedAdderCategory === 'all' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  All
                </button>
                {adderCategories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedAdderCategory(cat)}
                    className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${
                      selectedAdderCategory === cat ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Selected adders */}
              {lineItems.filter(i => i.is_adder).length > 0 && (
                <div className="mb-6 p-4 bg-green-50 rounded-xl border border-green-200">
                  <h3 className="font-medium text-green-800 mb-3">Selected Add-Ons</h3>
                  <div className="space-y-3">
                    {lineItems.filter(i => i.is_adder).map((item) => {
                      const isPercent = isPercentageItem(item)
                      const baseSubtotal = lineItems
                        .filter(li => !isPercentageItem(li))
                        .reduce((sum, li) => sum + (li.line_total || 0), 0)
                      const calculatedTotal = isPercent 
                        ? baseSubtotal * (item.unit_price / 100)
                        : item.line_total || 0
                      
                      return (
                      <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3 bg-white rounded-lg">
                        <div className="flex-1 min-w-[8rem]">
                          <span className="text-green-700 font-medium">{item.name}</span>
                          {isPercent ? (
                            <p className="text-xs text-gray-500">{item.unit_price}% of project total</p>
                          ) : (
                            <p className="text-xs text-gray-500">${item.unit_price.toLocaleString()} per {getUnitLabel(item.unit)}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 sm:gap-3">
                          {/* Quantity controls for "each" type items (not for percentage items) */}
                          {!isPercent && needsQuantityInput(item.unit) ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  updateLineItem(
                                    item.id,
                                    'quantity',
                                    isPerSqftUnit(item.unit)
                                      ? Math.max(0.01, item.quantity - 10)
                                      : Math.max(1, item.quantity - 1)
                                  )
                                }
                                className="w-8 h-8 flex items-center justify-center border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600"
                              >
                                −
                              </button>
                              <input
                                type="number"
                                min={isPerSqftUnit(item.unit) ? 0.01 : 1}
                                step={isPerSqftUnit(item.unit) ? 1 : 1}
                                value={quantityDrafts[item.id] ?? formatNumericDraft(item.quantity)}
                                onChange={(e) => {
                                  const raw = e.target.value
                                  setQuantityDrafts(prev => ({ ...prev, [item.id]: raw }))
                                  const parsed = parseDraftFloat(raw)
                                  if (parsed !== null && parsed > 0) {
                                    updateLineItem(item.id, 'quantity', parsed)
                                  }
                                }}
                                onBlur={() => commitQuantityDraft(item, isPerSqftUnit(item.unit) ? 0.01 : 1)}
                                className={`border border-gray-300 rounded-lg text-center font-medium ${
                                  isPerSqftUnit(item.unit) ? 'w-16 sm:w-24 px-2 py-1' : 'w-14 sm:w-16 px-2 py-1'
                                }`}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  updateLineItem(
                                    item.id,
                                    'quantity',
                                    isPerSqftUnit(item.unit) ? item.quantity + 10 : item.quantity + 1
                                  )
                                }
                                className="w-8 h-8 flex items-center justify-center border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600"
                              >
                                +
                              </button>
                            </div>
                          ) : !isPercent ? (
                            <span className="text-sm text-gray-500">{item.quantity} {getUnitLabel(item.unit)}</span>
                          ) : null}
                          <span className="font-bold text-green-800 w-20 sm:w-24 text-right">
                            ${calculatedTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                          <button
                            onClick={() => removeLineItem(item.id)}
                            className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Available adders */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {adders
                  .filter(a => selectedAdderCategory === 'all' || a.adder_category === selectedAdderCategory)
                  .filter(a => !lineItems.find(li => li.pricebook_item_id === a.id))
                  .map((adder) => {
                    const isPercent = adder.price_type === 'percentage' || adder.unit === 'percent'
                    return (
                    <button
                      key={adder.id}
                      onClick={() => addLineItem(adder)}
                      className="flex items-center justify-between p-4 border-2 border-gray-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50 transition-all text-left"
                    >
                      <div>
                        <p className="font-medium text-gray-900">{adder.name}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-gray-500">{adder.adder_category || adder.category}</p>
                          {needsQuantityInput(adder.unit) && !isPercent && (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">
                              Qty required
                            </span>
                          )}
                          {isPercent && (
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                              % based
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        {isPercent ? (
                          <>
                            <p className="font-bold text-indigo-600">{adder.unit_price}%</p>
                            <p className="text-xs text-gray-400">of project total</p>
                          </>
                        ) : (
                          <>
                            <p className="font-bold text-indigo-600">${(adder.unit_price || 0).toLocaleString()}</p>
                            <p className="text-xs text-gray-400">per {getUnitLabel(adder.unit)}</p>
                          </>
                        )}
                      </div>
                    </button>
                    )
                  })}
              </div>

              {adders.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  No add-ons available. Contact admin to add items.
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep(4)}
                className="px-6 py-3 border border-gray-300 rounded-xl font-medium hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={() => setStep(6)}
                className="px-8 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700"
              >
                Review Proposal
              </button>
            </div>
          </div>
        )}

        {/* Step 6: Review */}
        {step === 6 && (
          <div className="space-y-6">
            {/* Preview Card */}
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
              {/* Header */}
              <div 
                className="p-8 text-white"
                style={{ backgroundColor: form.accent_color }}
              >
                <h1 className="text-3xl font-bold mb-2">{form.title}</h1>
                <p className="text-white/80">Prepared for {form.customer_name}</p>
              </div>

              {/* Content */}
              <div className="p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-2">Customer</h3>
                    <p className="font-medium text-gray-900">{form.customer_name}</p>
                    <p className="text-gray-600">{form.customer_address}</p>
                    {form.customer_phone && <p className="text-gray-600">{form.customer_phone}</p>}
                    {form.customer_email && <p className="text-gray-600">{form.customer_email}</p>}
                  </div>
                  <div className="text-right">
                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-2">Project Total</h3>
                    <p className="text-4xl font-bold" style={{ color: form.accent_color }}>
                      $
                      {primaryDisplayTotal.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                    {form.financing_available && (
                      <p className="text-gray-500 mt-1">
                        or ${displayMonthlyPayment.toFixed(2)}/mo for {form.financing_term_months} months
                      </p>
                    )}
                  </div>
                </div>

                {/* Scope of Work */}
                {form.scope_of_work && (
                  <div className="mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Scope of Work</h3>
                    <p className="text-gray-600 whitespace-pre-wrap">{form.scope_of_work}</p>
                  </div>
                )}

                {/* Customer-Facing Pricing Summary - ONLY shows total */}
                <div className="bg-gray-50 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">Investment Summary</h3>
                    <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded">Customer View</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-gray-600">
                      <span>Subtotal</span>
                      <span>${(totals.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    {totals.discountAmount > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>Discount</span>
                        <span>-${(totals.discountAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-gray-600">
                      <span>Tax ({form.tax_rate}%)</span>
                      <span>${(totals.taxAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between text-xl font-bold text-gray-900 pt-2 border-t">
                      <span>Total Investment</span>
                      <span>
                        $
                        {(primaryDisplayTotal || 0).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-4 pt-3 border-t">
                    Note: Customer will only see the total investment amount. Line items and adders are not shown on the customer proposal.
                  </p>
                </div>

                {/* Financing */}
                {form.financing_available && (
                  <div className="mt-6 p-6 bg-indigo-50 rounded-xl border border-indigo-100">
                    <h3 className="text-lg font-semibold text-indigo-900 mb-2">Financing Available</h3>
                    <p className="text-indigo-700">
                      As low as <span className="font-bold text-2xl">${displayMonthlyPayment.toFixed(2)}</span>/month
                    </p>
                    <p className="text-sm text-indigo-600 mt-1">
                      {form.financing_term_months} months at {form.financing_rate}% APR
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Internal Breakdown - NOT shown to customer */}
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 md:p-8">
              <div className="flex items-center gap-3 mb-4">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <h3 className="text-lg font-semibold text-amber-900">Internal Breakdown</h3>
                <span className="px-2 py-1 bg-amber-200 text-amber-800 text-xs font-medium rounded">Not shown to customer</span>
              </div>
              
              <div className="space-y-3">
                {/* Base Price */}
                <div className="flex justify-between py-2 border-b border-amber-200">
                  <span className="text-amber-900">Base Project Price</span>
                  <span className="font-medium text-amber-900">
                    ${lineItems.filter(i => !i.is_adder).reduce((sum, i) => sum + (i.line_total || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {/* Adders breakdown */}
                {lineItems.filter(i => i.is_adder).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-amber-800">Add-Ons Included:</p>
                    {lineItems.filter(i => i.is_adder).map((item) => {
                      const isPercent = isPercentageItem(item)
                      const baseSubtotal = lineItems
                        .filter(li => !isPercentageItem(li))
                        .reduce((sum, li) => sum + (li.line_total || 0), 0)
                      const calculatedTotal = isPercent 
                        ? baseSubtotal * (item.unit_price / 100)
                        : item.line_total || 0
                      
                      return (
                      <div key={item.id} className="flex justify-between text-sm pl-4">
                        <span className="text-amber-700">
                          {item.name} 
                          {isPercent ? ` (${item.unit_price}%)` : item.quantity > 1 ? ` (×${item.quantity})` : ''}
                        </span>
                        <span className="text-amber-700">${calculatedTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                      )
                    })}
                    <div className="flex justify-between py-2 border-t border-amber-200">
                      <span className="text-amber-900">Total Add-Ons</span>
                      <span className="font-medium text-amber-900">
                        ${(() => {
                          const baseSubtotal = lineItems
                            .filter(li => !isPercentageItem(li))
                            .reduce((sum, li) => sum + (li.line_total || 0), 0)
                          return lineItems.filter(i => i.is_adder).reduce((sum, item) => {
                            const isPercent = isPercentageItem(item)
                            return sum + (isPercent ? baseSubtotal * (item.unit_price / 100) : item.line_total || 0)
                          }, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })
                        })()}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Additional Options */}
            <div className="bg-white rounded-2xl shadow-sm p-6 md:p-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Proposal Options</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Discount</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={form.discount_amount}
                      onChange={(e) => setForm(prev => ({ ...prev, discount_amount: parseFloat(e.target.value) || 0, discount_percent: 0 }))}
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg"
                      placeholder="$ Amount"
                    />
                    <span className="flex items-center text-gray-400">or</span>
                    <input
                      type="number"
                      value={form.discount_percent}
                      onChange={(e) => setForm(prev => ({ ...prev, discount_percent: parseFloat(e.target.value) || 0, discount_amount: 0 }))}
                      className="w-24 px-4 py-2 border border-gray-300 rounded-lg"
                      placeholder="%"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Tax Rate (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.tax_rate}
                    onChange={(e) => setForm(prev => ({ ...prev, tax_rate: parseFloat(e.target.value) || 0 }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={form.financing_available}
                      onChange={(e) =>
                        setForm(prev => ({
                          ...prev,
                          financing_available: e.target.checked,
                          ...(e.target.checked ? {} : { financing_program_id: null }),
                        }))
                      }
                      className="w-5 h-5 rounded border-gray-300 text-indigo-600"
                    />
                    <span className="font-medium text-gray-900">Offer Financing Option</span>
                  </label>
                </div>

                {form.financing_available && (
                  <>
                    {financingProgramsList.length > 0 && (
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Financing program</label>
                        <select
                          value={form.financing_program_id || ''}
                          onChange={(e) => {
                            const v = e.target.value
                            if (!v) {
                              setForm(prev => ({ ...prev, financing_program_id: null }))
                              return
                            }
                            const prog = financingProgramsList.find(x => x.id === v)
                            if (!prog) return
                            setForm(prev => ({
                              ...prev,
                              financing_program_id: prog.id,
                              financing_rate: prog.financing_rate,
                              financing_term_months: prog.term_months,
                            }))
                          }}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                        >
                          <option value="">Custom (manual APR & term)</option>
                          {financingProgramsList.map((prog) => (
                            <option key={prog.id} value={prog.id}>
                              {prog.lender_name} — {prog.financing_rate}% APR, {prog.term_months} mo
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Term (months)</label>
                      <select
                        value={form.financing_term_months}
                        onChange={(e) => setForm(prev => ({ ...prev, financing_term_months: parseInt(e.target.value) }))}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value={12}>12 months (1 year)</option>
                        <option value={24}>24 months (2 years)</option>
                        <option value={36}>36 months (3 years)</option>
                        <option value={48}>48 months (4 years)</option>
                        <option value={60}>60 months (5 years)</option>
                        <option value={72}>72 months (6 years)</option>
                        <option value={84}>84 months (7 years)</option>
                        <option value={120}>120 months (10 years)</option>
                        <option value={144}>144 months (12 years)</option>
                        <option value={180}>180 months (15 years)</option>
                        <option value={240}>240 months (20 years)</option>
                        <option value={300}>300 months (25 years)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">APR (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={form.financing_rate}
                        onChange={(e) => setForm(prev => ({ ...prev, financing_rate: parseFloat(e.target.value) || 0 }))}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                  </>
                )}

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Scope of Work</label>
                  <textarea
                    value={form.scope_of_work}
                    onChange={(e) => setForm(prev => ({ ...prev, scope_of_work: e.target.value }))}
                    rows={4}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl"
                    placeholder="Describe the work to be performed..."
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Accent Color</label>
                  <div className="flex gap-3">
                    {['#4f46e5', '#059669', '#dc2626', '#7c3aed', '#0891b2', '#ea580c'].map((color) => (
                      <button
                        key={color}
                        onClick={() => setForm(prev => ({ ...prev, accent_color: color }))}
                        className={`w-10 h-10 rounded-full border-2 ${form.accent_color === color ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap justify-between gap-3">
              <button
                onClick={() => setStep(5)}
                className="px-6 py-3 border border-gray-300 rounded-xl font-medium hover:bg-gray-50"
              >
                Back
              </button>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => saveProposal(true)}
                  disabled={saving}
                  className="px-6 py-3 border border-gray-300 rounded-xl font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Draft'}
                </button>
                <button
                  onClick={() => saveProposal(false)}
                  disabled={saving}
                  className="px-8 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Create Proposal'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Item Modal */}
        {showAddItem && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
              <div className="p-6 border-b flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">Add Item</h2>
                <button
                  onClick={() => setShowAddItem(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-6 overflow-y-auto max-h-[60vh]">
                {pricebookItems.length === 0 ? (
                  <div className="text-center py-8">
                    <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No Pricebook Items</h3>
                    <p className="text-gray-500 mb-4">
                      No items have been added to your pricebook yet.
                    </p>
                    <p className="text-sm text-gray-400">
                      Go to <span className="font-medium">Admin → Pricing & Costs → Pricebook Items</span> to add items.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pricebookItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => addLineItem(item)}
                        className="w-full flex items-center justify-between p-4 border border-gray-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50 transition-all text-left"
                      >
                        <div>
                          <p className="font-medium text-gray-900">{item.name}</p>
                          <p className="text-sm text-gray-500">{item.category}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-indigo-600">${(item.unit_price || 0).toLocaleString()}</p>
                          <p className="text-xs text-gray-400">per {getUnitLabel(item.unit)}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Quantity Input Modal - for "each" and "linear foot" type items */}
        {quantityModalItem && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
              <div className="p-6 border-b">
                <h2 className="text-xl font-bold text-gray-900">
                  {isPerSqftUnit(quantityModalItem.unit)
                    ? 'Enter square feet'
                    : quantityModalItem.unit?.toLowerCase() === 'lf' ||
                        quantityModalItem.unit?.toLowerCase() === 'linear foot' ||
                        quantityModalItem.unit?.toLowerCase() === 'linear feet'
                      ? 'Enter Total Linear Feet'
                      : 'Enter Quantity'}
                </h2>
                <p className="text-gray-500 text-sm mt-1">
                  {isPerSqftUnit(quantityModalItem.unit)
                    ? 'Use the actual coverage area (e.g. siding). This is separate from roof squares.'
                    : quantityModalItem.unit?.toLowerCase() === 'lf' ||
                        quantityModalItem.unit?.toLowerCase() === 'linear foot' ||
                        quantityModalItem.unit?.toLowerCase() === 'linear feet'
                      ? 'Enter the total linear feet needed'
                      : `How many ${getUnitLabel(quantityModalItem.unit)} do you need?`}
                </p>
              </div>
              <div className="p-6">
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-4 p-4 bg-gray-50 rounded-xl">
                    <div>
                      <p className="font-medium text-gray-900">{quantityModalItem.name}</p>
                      <p className="text-sm text-gray-500">{quantityModalItem.category}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-indigo-600">${(quantityModalItem.unit_price || 0).toLocaleString()}</p>
                      <p className="text-xs text-gray-400">per {getUnitLabel(quantityModalItem.unit)}</p>
                    </div>
                  </div>

                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {isPerSqftUnit(quantityModalItem.unit)
                      ? 'Square feet'
                      : `Quantity (${getUnitLabel(quantityModalItem.unit)})`}
                  </label>
                  {isPerSqftUnit(quantityModalItem.unit) ? (
                    <>
                      <input
                        type="number"
                        min={0.01}
                        step={1}
                        value={quantityModalRaw}
                        onChange={(e) => setQuantityModalRaw(e.target.value)}
                        onBlur={() => {
                          const parsed = parseDraftFloat(quantityModalRaw, { fallback: 0.01 }) ?? 0.01
                          setQuantityModalNumber(Math.max(0.01, parsed))
                        }}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl text-center text-2xl font-bold"
                      />
                      <div className="flex flex-wrap gap-2 mt-3">
                        {[100, 250, 500, 760, 1000, 1500, 2000].map((sq) => (
                          <button
                            key={sq}
                            type="button"
                            onClick={() => setQuantityModalNumber(sq)}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                              quantityModalValue === sq
                                ? 'bg-indigo-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {sq}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setQuantityModalNumber(Math.max(1, quantityModalValue - 1))}
                          className="w-12 h-12 flex items-center justify-center border border-gray-300 rounded-xl hover:bg-gray-50 text-xl font-bold text-gray-600"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min="1"
                          value={quantityModalRaw}
                          onChange={(e) => setQuantityModalRaw(e.target.value)}
                          onBlur={() => {
                            const parsed = parseDraftFloat(quantityModalRaw, { fallback: 1 }) ?? 1
                            setQuantityModalNumber(Math.max(1, Math.round(parsed)))
                          }}
                          className="flex-1 px-4 py-3 border border-gray-300 rounded-xl text-center text-2xl font-bold"
                        />
                        <button
                          type="button"
                          onClick={() => setQuantityModalNumber(quantityModalValue + 1)}
                          className="w-12 h-12 flex items-center justify-center border border-gray-300 rounded-xl hover:bg-gray-50 text-xl font-bold text-gray-600"
                        >
                          +
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-2 mt-3">
                        {(quantityModalItem.unit?.toLowerCase() === 'lf' ||
                        quantityModalItem.unit?.toLowerCase() === 'linear foot' ||
                        quantityModalItem.unit?.toLowerCase() === 'linear feet'
                          ? [10, 25, 50, 75, 100, 150, 200, 250, 300]
                          : [1, 2, 4, 6, 8, 10, 12, 16, 20]
                        ).map((qty) => (
                          <button
                            key={qty}
                            type="button"
                            onClick={() => setQuantityModalNumber(qty)}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                              quantityModalValue === qty
                                ? 'bg-indigo-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {qty}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Line total preview */}
                <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">Line Total</span>
                    <span className="text-2xl font-bold text-indigo-600">
                      ${(quantityModalItem.unit_price * quantityModalValue).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {quantityModalValue} × ${quantityModalItem.unit_price.toLocaleString()} per {getUnitLabel(quantityModalItem.unit)}
                  </p>
                </div>
              </div>
              <div className="p-6 border-t flex justify-end gap-3">
                <button
                  onClick={() => { setQuantityModalItem(null); setQuantityModalNumber(1); }}
                  className="px-4 py-2 border border-gray-300 rounded-xl hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmQuantityAndAdd}
                  className="px-6 py-2 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700"
                >
                  Add to Proposal
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
