/**
 * The order lines the CRM generates for a roof (lib/materials-order-list.ts keys), with an example of the quantity
 * text each prints. The item-mapping screen lists these so an owner can attach an ABC item number to each one.
 * `exampleQty` is only used to show "reads as …" live; the real quantity always comes from the order.
 */
export type StandardLine = { key: string; label: string; exampleQty: string; qtyUnitWord: string; caveat?: string }

export const STANDARD_LINES: StandardLine[] = [
  { key: 'field_shingles', label: 'Field shingles', exampleQty: '20.0 sq · 58 bundles', qtyUnitWord: 'bundles' },
  { key: 'starter', label: 'Starter strip', exampleQty: '3 bundles', qtyUnitWord: 'bundles' },
  { key: 'hip_ridge_cap', label: 'Hip & ridge cap', exampleQty: '2.10 sq · 6 bundles', qtyUnitWord: 'bundles' },
  { key: 'ridge_vent', label: 'Ridge vent', exampleQty: '40 LF · 5 pieces', qtyUnitWord: 'pieces' },
  { key: 'underlayment', label: 'Underlayment (synthetic)', exampleQty: '4 rolls', qtyUnitWord: 'rolls' },
  { key: 'ice_water_low_slope', label: 'Ice & water shield (low slope)', exampleQty: '2 rolls', qtyUnitWord: 'rolls' },
  { key: 'ice_water_valleys', label: 'Ice & water shield (valleys)', exampleQty: '1 roll if needed', qtyUnitWord: 'rolls', caveat: 'Printed as "if needed", so it is not read automatically. Ops types the quantity with its word on the order sheet (for example \"12 sticks\") first.' },
  { key: 'drip_edge', label: 'Drip edge', exampleQty: '12 sticks if needed', qtyUnitWord: 'sticks', caveat: 'Printed as "if needed", so it is not read automatically. Ops types the quantity with its word on the order sheet (for example \"12 sticks\") first.' },
  { key: 'step_flashing', label: 'Step flashing', exampleQty: '~40 pieces', qtyUnitWord: 'pieces', caveat: 'Printed as approximate (~), so it is not read automatically. Ops types the quantity with its word (for example \"40 pieces\") first.' },
  { key: 'wall_flashing', label: 'Wall / apron flashing', exampleQty: '30 LF', qtyUnitWord: 'lf' },
  { key: 'pipe_boots', label: 'Pipe boots', exampleQty: '3 (from measure)', qtyUnitWord: 'each', caveat: 'Printed with a note after the number, so it is not read automatically. Ops types the quantity with its word (for example \"40 pieces\") first.' },
]
