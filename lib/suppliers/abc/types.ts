/** Shapes shared by the ABC Supply connector. Client-safe (types only). */
export type AbcEnvironment = 'sandbox' | 'production'

export type AbcDeliveryService = 'COM' | 'CPU' | 'EXP' | 'OTR' | 'OTG' | 'OTW' | 'TPC'

export type ItemMapRow = {
  lineKey: string
  itemNumber: string
  uom: string
  /** The word after the number in the CRM quantity text, e.g. "bundles" for "58 bundles". */
  qtyUnitWord: string
  /** Typed in by us. Used ONLY to decide whether an order needs a second approver — never shown against another supplier's price. */
  estUnitPriceCents: number | null
}

export type SupplierApiSettings = {
  provider: 'abc_supply'
  environment: AbcEnvironment
  /** Per-supplier kill switch. */
  orderingEnabled: boolean
  shipToNumber: string | null
  branchNumber: string | null
  deliveryService: AbcDeliveryService
  itemMap: ItemMapRow[]
  /** Org-level kill switch + second-approver threshold, carried here so every check sees one object. */
  orgOrderingEnabled: boolean
  secondApprovalCents: number
}
