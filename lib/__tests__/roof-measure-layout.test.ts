import {
  ROOF_MEASURE_PHONE_CONTROL_RAIL_REM,
  mapImageryControlsPositionClass,
  measurementsMapPanelClass,
  measurementsSidebarPanelClass,
  measurementsToolShellClass,
  phoneSectionCardMaxWidthClass,
  phoneSectionCardMaxWidthCss,
  resolveMeasurementsSidebarLayout,
  sectionCardPositionClass,
  showMeasurementsButtonClass,
  toggleMeasurementsSidebarCollapsed,
} from '@/lib/roof-measure-layout'

describe('roof-measure-layout', () => {
  it('toggleMeasurementsSidebarCollapsed flips collapsed flag', () => {
    expect(toggleMeasurementsSidebarCollapsed(false)).toBe(true)
    expect(toggleMeasurementsSidebarCollapsed(true)).toBe(false)
  })

  it('resolveMeasurementsSidebarLayout hides sidebar and shows restore when collapsed', () => {
    expect(resolveMeasurementsSidebarLayout(false)).toEqual({
      sidebarHidden: false,
      showSidebarRestoreControl: false,
    })
    expect(resolveMeasurementsSidebarLayout(true)).toEqual({
      sidebarHidden: true,
      showSidebarRestoreControl: true,
    })
  })

  it('phoneSectionCardMaxWidthCss reserves control rail', () => {
    expect(phoneSectionCardMaxWidthCss(8)).toBe('calc(100% - 8rem)')
    expect(phoneSectionCardMaxWidthCss()).toBe(
      `calc(100% - ${ROOF_MEASURE_PHONE_CONTROL_RAIL_REM}rem)`,
    )
    expect(ROOF_MEASURE_PHONE_CONTROL_RAIL_REM).toBe(8)
  })

  it('phoneSectionCardMaxWidthClass emits tailwind arbitrary max-width with 8rem rail', () => {
    expect(phoneSectionCardMaxWidthClass()).toContain('max-lg:max-w-[calc(100%-8rem)]')
    expect(phoneSectionCardMaxWidthClass()).toContain('lg:max-w-[min(calc(100%-2rem),20rem)]')
  })

  it('measurementsToolShellClass contains overflow containment', () => {
    expect(measurementsToolShellClass(false)).toContain('overflow-x-hidden')
    expect(measurementsToolShellClass(false)).toContain('min-w-0')
    expect(measurementsToolShellClass(true)).toContain('max-lg:flex-1')
  })

  it('sectionCardPositionClass offsets card below Show measurements when collapsed on desktop', () => {
    expect(sectionCardPositionClass(false)).toBe('top-4 left-4')
    expect(sectionCardPositionClass(true)).toBe('top-4 left-4 lg:top-[4.75rem]')
  })

  it('showMeasurementsButtonClass places restore lg top-left and phone bottom-left', () => {
    expect(showMeasurementsButtonClass()).toContain('lg:top-4 lg:left-4')
    expect(showMeasurementsButtonClass()).toContain('inline-flex')
    expect(showMeasurementsButtonClass()).toContain('2.75rem')
  })

  it('measurementsSidebarPanelClass hides panel when collapsed', () => {
    expect(measurementsSidebarPanelClass(true)).toContain('hidden')
    expect(measurementsSidebarPanelClass(false)).not.toContain('hidden')
    expect(measurementsSidebarPanelClass(false)).toContain('max-h-[50vh]')
    expect(measurementsSidebarPanelClass(false)).toContain('min-w-0')
  })

  it('measurementsMapPanelClass expands map height when sidebar collapsed', () => {
    expect(measurementsMapPanelClass(true)).toContain('min-h-[calc(100vh-64px')
    expect(measurementsMapPanelClass(false)).not.toContain('100vh-64px')
    expect(measurementsMapPanelClass(false)).toContain('min-w-0')
  })

  it('mapImageryControlsPositionClass reserves attribution space on desktop', () => {
    expect(mapImageryControlsPositionClass()).toContain('2.75rem')
    expect(mapImageryControlsPositionClass()).toContain('safe-area-inset-top')
    expect(mapImageryControlsPositionClass()).toContain('max-lg:left-auto')
  })
})
