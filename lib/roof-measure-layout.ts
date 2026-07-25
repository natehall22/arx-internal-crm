/** Right-side control rail (rem) — keeps phone section card off HD / NC aerial controls. */
export const ROOF_MEASURE_PHONE_CONTROL_RAIL_REM = 8

export function toggleMeasurementsSidebarCollapsed(collapsed: boolean): boolean {
  return !collapsed
}

export type MeasurementsSidebarLayout = {
  sidebarHidden: boolean
  showSidebarRestoreControl: boolean
}

export function resolveMeasurementsSidebarLayout(
  collapsed: boolean,
): MeasurementsSidebarLayout {
  return {
    sidebarHidden: collapsed,
    showSidebarRestoreControl: collapsed,
  }
}

export function phoneSectionCardMaxWidthCss(
  controlRailRem = ROOF_MEASURE_PHONE_CONTROL_RAIL_REM,
): string {
  return `calc(100% - ${controlRailRem}rem)`
}

/** Tailwind class fragment for section-card max width on phone (static literals for JIT). */
export function phoneSectionCardMaxWidthClass(
  controlRailRem = ROOF_MEASURE_PHONE_CONTROL_RAIL_REM,
): string {
  if (controlRailRem !== ROOF_MEASURE_PHONE_CONTROL_RAIL_REM) {
    return `max-lg:max-w-[calc(100%-${controlRailRem}rem)] lg:max-w-[min(calc(100%-2rem),20rem)]`
  }
  return 'max-lg:max-w-[calc(100%-8rem)] lg:max-w-[min(calc(100%-2rem),20rem)]'
}

/** Section detail card — drops below desktop Show measurements when sidebar collapsed. */
export function sectionCardPositionClass(collapsed: boolean): string {
  if (collapsed) {
    return 'top-4 left-4 lg:top-[4.75rem]'
  }
  return 'top-4 left-4'
}

/** Show measurements restore control — lg top-left; phone bottom-left above attribution. */
export function showMeasurementsButtonClass(): string {
  return 'absolute z-30 inline-flex w-max max-w-[calc(100%-2rem)] items-center min-h-[44px] rounded-lg border border-sky-500/60 bg-gray-900/95 px-4 py-2.5 text-sm font-semibold text-white shadow-lg backdrop-blur-sm hover:bg-gray-800 bottom-4 left-[max(1rem,env(safe-area-inset-left))] max-lg:bottom-[max(1rem,calc(env(safe-area-inset-bottom)+2.75rem))] lg:bottom-auto lg:top-4 lg:left-4'
}

export function measurementsToolShellClass(collapsed: boolean): string {
  const base =
    'flex flex-col lg:flex-row h-[calc(100vh-64px-env(safe-area-inset-bottom,0px))] overflow-x-hidden min-w-0'
  if (collapsed) {
    return `${base} max-lg:flex-1`
  }
  return base
}

export function measurementsSidebarPanelClass(collapsed: boolean): string {
  const base =
    'w-full lg:w-96 lg:flex-shrink-0 min-w-0 bg-gray-800 border-b lg:border-b-0 lg:border-r border-gray-700 flex flex-col overflow-y-auto'
  if (collapsed) {
    return `${base} hidden`
  }
  return `${base} max-h-[50vh] lg:max-h-[calc(100vh-64px)]`
}

export function measurementsMapPanelClass(collapsed: boolean): string {
  const base = 'flex-1 relative min-h-0 min-w-0 lg:min-h-[400px]'
  if (collapsed) {
    return `${base} min-h-[300px] max-lg:min-h-[calc(100vh-64px-env(safe-area-inset-bottom,0px))] lg:min-h-[calc(100vh-64px)]`
  }
  return `${base} min-h-[300px]`
}

/** Keeps imagery controls above Google Maps attribution (desktop bottom-right stack). */
export function mapImageryControlsPositionClass(): string {
  return 'max-lg:top-[max(1rem,env(safe-area-inset-top))] max-lg:right-[max(1rem,env(safe-area-inset-right))] max-lg:left-auto max-lg:bottom-auto lg:top-auto lg:left-auto lg:bottom-[max(1rem,calc(env(safe-area-inset-bottom,0px)+2.75rem))] lg:right-[max(1rem,env(safe-area-inset-right))]'
}
