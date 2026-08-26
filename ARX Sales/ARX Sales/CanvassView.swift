import SwiftUI
import MapKit
import CoreLocation
import Combine

// MARK: - Canvass View

struct CanvassView: View {
    var onOpenSettings: (() -> Void)? = nil
    var weatherOverlayAvailable: Bool = false

    @StateObject private var vm = CanvassViewModel()
    @ObservedObject private var offlineBridge = OfflineLeadQueueBridge.shared
    @ObservedObject private var mapCoordinator = CanvassMapCoordinator.shared
    @State private var showPendingSheet = false
    @State private var showLayersSheet = false
    @State private var showLeadListSheet = false
    /// Drives the lead sheet by identity, not a bool — `.sheet(isPresented:)` can present with a
    /// content closure captured *before* the pin/coordinate state lands, which left the sheet's
    /// `.task` seeding from a nil coordinate (blank address, no homeowner) even though the
    /// re-rendered body showed Directions. Carrying the payload in the item makes that impossible.
    @State private var leadSheetTarget: CanvassLeadSheetTarget? = nil
    @State private var mapZoomLevel = 10
    @State private var pendingLeadFromList: MobileLead? = nil
    @State private var leadListOpenGeneration = 0
    @State private var hasInitiallyZoomed = false
    @State private var trackingMode: MKUserTrackingMode = .none
    @State private var flyTarget: CLLocationCoordinate2D? = nil

    @AppStorage(AppSettings.Keys.mapStyle) private var mapStyleRaw = MapStyleSetting.hybrid.rawValue
    @AppStorage(AppSettings.Keys.enable3DBuildings) private var enable3DBuildings = true
    @AppStorage(AppSettings.Keys.showTerritories) private var showTerritories = true
    @AppStorage(AppSettings.Keys.showWeather) private var showWeather = false
    @AppStorage(AppSettings.Keys.showRoofAge) private var showRoofAge = false
    @AppStorage(AppSettings.Keys.myPinsOnly) private var myPinsOnly = false
    @AppStorage(AppSettings.Keys.focusMode) private var focusMode = false
    @AppStorage(AppSettings.Keys.pinTimeFilter) private var pinTimeFilterRaw = PinTimeFilter.all.rawValue

    private var timeFilter: PinTimeFilter { PinTimeFilter(rawValue: pinTimeFilterRaw) ?? .all }
    private var visiblePins: [CanvassPin] {
        vm.filteredPins(
            pending: offlineBridge.localPendingPins(ownerUserId: vm.myUserId),
            queuedItems: offlineBridge.pendingItems,
            myUserId: vm.myUserId,
            focusMode: focusMode,
            myPinsOnly: myPinsOnly,
            timeFilter: timeFilter
        )
    }

    private var visibleRoofAgeCircles: [RoofAgeCircleModel] {
        guard showRoofAge, mapZoomLevel >= CanvassViewModel.minRoofAgeDisplayZoom else { return [] }
        return vm.roofAgeCircles
    }

    var body: some View {
        ZStack {
            CanvassMapView(
                pins: visiblePins,
                territories: showTerritories ? vm.territories : [],
                weatherPolygons: (showWeather && weatherOverlayAvailable) ? vm.weatherPolygons : [],
                overlayPoints: vm.overlayPoints(showWeather: showWeather && weatherOverlayAvailable, showRoofAge: showRoofAge),
                roofAgeCircles: visibleRoofAgeCircles,
                userLocation: vm.userLocation,
                hasInitiallyZoomed: $hasInitiallyZoomed,
                trackingMode: $trackingMode,
                flyTarget: $flyTarget,
                mapStyle: MapStyleSetting(rawValue: mapStyleRaw) ?? .hybrid,
                enable3DBuildings: enable3DBuildings,
                onRegionChange: { region in
                    mapCoordinator.lastRegion = region
                    mapZoomLevel = CanvassViewModel.zoomLevel(for: region)
                    vm.loadPins(for: region)
                    vm.loadOverlays(for: region, weather: showWeather && weatherOverlayAvailable, roofAge: showRoofAge)
                    vm.loadTerritoriesIfNeeded(show: showTerritories)
                },
                onZoom: { vm.invalidateBoundsCache() },
                onMapTap: { coord in
                    leadListOpenGeneration += 1
                    leadSheetTarget = CanvassLeadSheetTarget(newLeadAt: coord)
                },
                onRoofAgeParcelTap: { parcel in
                    leadListOpenGeneration += 1
                    leadSheetTarget = CanvassLeadSheetTarget(
                        newLeadAt: parcel.coordinate,
                        roofAgeEst: CanvassPropertyRoofAgeEst(yearBuilt: parcel.yearBuilt, roofAge: parcel.roofAge)
                    )
                },
                onLongPress: { coord in
                    leadListOpenGeneration += 1
                    leadSheetTarget = CanvassLeadSheetTarget(newLeadAt: coord)
                },
                onPinTap: { pin in
                    leadListOpenGeneration += 1
                    leadSheetTarget = CanvassLeadSheetTarget(pin: pin)
                }
            )
            .ignoresSafeArea()

            // Floating controls — top-left settings, top-right map utilities
            VStack {
                HStack(alignment: .top) {
                    MapCircleButton(systemImage: "gearshape.fill") {
                        onOpenSettings?()
                    }
                    .accessibilityLabel("Settings")

                    Spacer()

                    VStack(spacing: 10) {
                        MapCircleButton(
                            systemImage: trackingGlyph,
                            isActive: trackingMode != .none
                        ) {
                            cycleTrackingMode()
                        }
                        .accessibilityLabel("Follow location")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)

                Spacer()

                HStack(alignment: .bottom) {
                    // `.leading` — default center alignment inset 50pt circles over the wide time scrubber.
                    VStack(alignment: .leading, spacing: 10) {
                        MapCircleButton(systemImage: "list.bullet", isActive: showLeadListSheet) {
                            showLeadListSheet = true
                        }
                        .accessibilityLabel("My Leads")
                        MapCircleButton(systemImage: "square.3.layers.3d", isActive: showLayersSheet) { showLayersSheet = true }
                        timeScrubberCapsule
                    }
                    .padding(.leading, 6)

                    Spacer()

                    VStack(spacing: 8) {
                        if let coverage = vm.coverageLabel(pins: visiblePins, partial: true) {
                            MapHUDChip { Text(coverage) }
                        }
                        if vm.weatherDegraded && showWeather && weatherOverlayAvailable {
                            MapHUDChip { Text("Weather unavailable (est.)") }
                        } else if showWeather && weatherOverlayAvailable && !vm.weatherPolygons.isEmpty {
                            WeatherLegendChip(hasWarning: vm.weatherPolygons.contains { $0.kind == "warning" })
                        }
                        if vm.roofAgeDegraded && showRoofAge {
                            MapHUDChip { Text("Roof age unavailable (est.)") }
                        } else if showRoofAge && mapZoomLevel < CanvassViewModel.minRoofAgeDisplayZoom {
                            MapHUDChip { Text("Zoom in for parcel layer (est.)") }
                        }
                        if focusMode || myPinsOnly {
                            MapHUDChip { Text("Filter: My pins only") }
                        }
                        if timeFilter != .all {
                            MapHUDChip { Text("Filter: Last \(timeFilter.label)") }
                        }
                        if let err = vm.loadError {
                            MapHUDChip {
                                HStack(spacing: 8) {
                                    Image(systemName: "exclamationmark.triangle.fill").foregroundColor(Color(hex: "#B45309"))
                                    Text(err)
                                }
                            }
                        }
                        if vm.isLoading {
                            MapHUDChip { HStack(spacing: 8) { ProgressView().scaleEffect(0.85); Text("Loading pins…") } }
                        } else if vm.loadError == nil {
                            MapHUDChip {
                                HStack(spacing: 6) {
                                    Image(systemName: "mappin.circle.fill").foregroundColor(AppSettings.brandBlue)
                                    Text(visiblePins.isEmpty ? "No leads in this area" : "\(visiblePins.count) lead\(visiblePins.count == 1 ? "" : "s")")
                                }
                            }
                        }
                        if offlineBridge.pendingCount > 0 {
                            Button { showPendingSheet = true } label: {
                                MapHUDChip { HStack(spacing: 6) { Text("⏳"); Text("\(offlineBridge.pendingCount) pending sync") } }
                            }.buttonStyle(.plain)
                        }
                    }
                }
                .padding(.bottom, AppSettings.floatingTabContentInset)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .sheet(item: $leadSheetTarget, onDismiss: {
            vm.cancelInFlightOneShotLocationCapture()
            vm.invalidateBoundsCache()
            if let r = vm.lastRegion { vm.loadPins(for: r) }
            Task { await offlineBridge.refresh() }
        }) { target in
            LeadSheetView(
                pin: target.pin,
                coordinate: target.coordinate,
                propertyRoofAgeEst: target.roofAgeEst,
                repGeoCapture: { await vm.locationForKnockSave() }
            )
                .canvassSheetPresentation()
        }
        .sheet(isPresented: $showPendingSheet) { PendingSyncSheet(bridge: offlineBridge).mediumSheetPresentation() }
        .sheet(isPresented: $showLayersSheet) {
            LayersSheetView(weatherAvailable: weatherOverlayAvailable).mediumSheetPresentation()
        }
        .sheet(isPresented: $showLeadListSheet, onDismiss: {
            openLeadFromListIfNeeded()
        }) {
            LeadListView { lead in
                pendingLeadFromList = lead
                showLeadListSheet = false
            }
            .largeSheetPresentation()
        }
        .onAppear {
            vm.startLocationTracking()
            offlineBridge.onSyncSuccess = { [weak vm] in
                vm?.invalidateBoundsCache()
                if let region = vm?.lastRegion {
                    vm?.loadPins(for: region)
                }
            }
            mapCoordinator.flyToCoordinate = { flyTarget = $0 }
            Task { await vm.loadMyUserId() }
        }
        .onChange(of: showTerritories) { _ in vm.loadTerritoriesIfNeeded(show: showTerritories) }
        // Weather/roof-age, unlike territories, were never wired to an onChange — flipping
        // either Layers toggle silently did nothing until the next incidental map pan/zoom
        // (the only other call site for loadOverlays is the onRegionChange closure above).
        // Reuse lastRegion the same defensive way onSyncSuccess above does.
        .onChange(of: showWeather) { _ in
            if let region = vm.lastRegion {
                vm.loadOverlays(for: region, weather: showWeather && weatherOverlayAvailable, roofAge: showRoofAge)
            }
        }
        .onChange(of: showRoofAge) { _ in
            if let region = vm.lastRegion {
                vm.loadOverlays(for: region, weather: showWeather && weatherOverlayAvailable, roofAge: showRoofAge)
            }
        }
    }

    private var timeScrubberCapsule: some View {
        HStack(spacing: 2) {
            ForEach(PinTimeFilter.allCases) { filter in
                Button { pinTimeFilterRaw = filter.rawValue } label: {
                    Text(filter.label)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(timeFilter == filter ? AppSettings.brandBlue : .white)
                        .padding(.horizontal, 8).padding(.vertical, 6)
                }.buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(Capsule().fill(Color.black.opacity(0.55)))
    }

    private var trackingGlyph: String {
        switch trackingMode {
        case .follow: return "location.fill"
        case .followWithHeading: return "location.north.line.fill"
        default: return "location"
        }
    }

    private func cycleTrackingMode() {
        switch trackingMode {
        case .none:
            trackingMode = .follow
        case .follow:
            trackingMode = .followWithHeading
        default:
            trackingMode = .none
        }
    }

    /// After My Leads sheet dismisses, fly the map and open the same pin flow as `onPinTap`.
    private func openLeadFromListIfNeeded() {
        guard let lead = pendingLeadFromList, let pin = lead.asCanvassPin else {
            pendingLeadFromList = nil
            return
        }
        pendingLeadFromList = nil
        let coord = CLLocationCoordinate2D(latitude: pin.lat, longitude: pin.lng)
        leadListOpenGeneration += 1
        let generation = leadListOpenGeneration

        // Force a fresh viewport fetch around the destination (list pins may be outside cache).
        vm.invalidateBoundsCache()
        mapCoordinator.flyToCoordinate?(coord)
        let region = MKCoordinateRegion(
            center: coord,
            span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
        )
        vm.loadPins(for: region)

        // Brief delay so the list sheet can finish dismissing before presenting LeadSheet.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            guard generation == leadListOpenGeneration else { return }
            leadSheetTarget = CanvassLeadSheetTarget(pin: pin)
        }
    }
}

// MARK: - Weather Legend Chip

/// One compact line, shown only when there's weather polygon data on screen — reads
/// as a plain status chip alongside the pin-count/filter chips, not a separate panel.
struct WeatherLegendChip: View {
    let hasWarning: Bool
    var body: some View {
        MapHUDChip {
            HStack(spacing: 10) {
                if hasWarning {
                    legendDot(color: Color(hex: "#DC2626"), label: "Active alert")
                }
                legendDot(color: Color(hex: "#F59E0B"), label: "Hail (est.)")
            }
        }
    }

    private func legendDot(color: Color, label: String) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(label)
        }
    }
}

// MARK: - ViewModel

class CanvassViewModel: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var pins: [CanvassPin] = []
    @Published var userLocation: CLLocationCoordinate2D? = nil
    @Published var isLoading = false
    @Published var loadError: String? = nil
    @Published var territories: [Territory] = []
    @Published var weatherPoints: [MapOverlayPoint] = []
    @Published var weatherPolygons: [WeatherPolygonFeature] = []
    @Published var roofAgePoints: [MapOverlayPoint] = []
    @Published var roofAgeCircles: [RoofAgeCircleModel] = []
    @Published var weatherDegraded = false
    @Published var roofAgeDegraded = false

    @Published var myUserId: String?
    var lastRegion: MKCoordinateRegion?
    var territoriesLoaded = false

    private let locationManager = CLLocationManager()
    private var loadTask: Task<Void, Never>? = nil
    var overlayTask: Task<Void, Never>? = nil
    private var lastLoadedBounds: (minLat: Double, maxLat: Double, minLng: Double, maxLng: Double)? = nil

    /// Most recent fix from `startUpdatingLocation` — fallback when one-shot capture times out.
    private(set) var lastUserLocation: CLLocation?
    private var oneShotLocationWaiters: [CheckedContinuation<CLLocation?, Never>] = []
    private var oneShotLocationTimeoutTask: Task<Void, Never>?

    deinit {
        oneShotLocationTimeoutTask?.cancel()
        let waiters = oneShotLocationWaiters
        oneShotLocationWaiters = []
        for cont in waiters {
            cont.resume(returning: nil)
        }
    }

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func startLocationTracking() {
        DispatchQueue.main.async {
            self.locationManager.requestWhenInUseAuthorization()
            self.locationManager.startUpdatingLocation()
        }
    }

    func stopLocationTracking() {
        DispatchQueue.main.async {
            self.locationManager.stopUpdatingLocation()
            self.completeOneShotLocationBatch(returning: nil)
        }
    }

    /// Lead sheet dismissed while a knock save may still be awaiting rep GPS — unblock waiters (nil → `lastUserLocation` fallback in save path).
    func cancelInFlightOneShotLocationCapture() {
        DispatchQueue.main.async {
            self.completeOneShotLocationBatch(returning: nil)
        }
    }

    /// Fresh GPS at knock save when possible; matches web canvass rep geo snapshot behavior.
    func locationForKnockSave() async -> CLLocation? {
        if let fresh = await requestOneShotLocation() {
            return fresh
        }
        return lastUserLocation
    }

    private func requestOneShotLocation() async -> CLLocation? {
        let status = locationManager.authorizationStatus
        guard status == .authorizedWhenInUse || status == .authorizedAlways else {
            return nil
        }

        return await withCheckedContinuation { continuation in
            DispatchQueue.main.async { [weak self] in
                guard let self else {
                    continuation.resume(returning: nil)
                    return
                }
                self.enqueueOneShotLocationWaiter(continuation)
            }
        }
    }

    private func enqueueOneShotLocationWaiter(_ continuation: CheckedContinuation<CLLocation?, Never>) {
        let startingBatch = oneShotLocationWaiters.isEmpty
        oneShotLocationWaiters.append(continuation)
        guard startingBatch else { return }

        locationManager.requestLocation()
        oneShotLocationTimeoutTask?.cancel()
        oneShotLocationTimeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard let self else { return }
            self.completeOneShotLocationBatch(returning: nil)
        }
    }

    private func completeOneShotLocationBatch(returning location: CLLocation?) {
        guard !oneShotLocationWaiters.isEmpty else { return }
        oneShotLocationTimeoutTask?.cancel()
        oneShotLocationTimeoutTask = nil
        let waiters = oneShotLocationWaiters
        oneShotLocationWaiters = []
        for cont in waiters {
            cont.resume(returning: location)
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        lastUserLocation = loc
        DispatchQueue.main.async {
            self.userLocation = loc.coordinate
            self.completeOneShotLocationBatch(returning: loc)
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        DispatchQueue.main.async {
            self.completeOneShotLocationBatch(returning: nil)
        }
    }

    func loadPins(for region: MKCoordinateRegion) {
        lastRegion = region

        let span   = region.span
        let center = region.center
        let minLat = center.latitude  - span.latitudeDelta  / 2
        let maxLat = center.latitude  + span.latitudeDelta  / 2
        let minLng = center.longitude - span.longitudeDelta / 2
        let maxLng = center.longitude + span.longitudeDelta / 2
        let zoom   = spanToZoom(span)

        // Skip if the new viewport is already fully covered by the last loaded bounds
        if let last = lastLoadedBounds,
           minLat >= last.minLat, maxLat <= last.maxLat,
           minLng >= last.minLng, maxLng <= last.maxLng {
            return
        }

        // Cancel any in-flight request — only the latest viewport matters
        loadTask?.cancel()
        loadTask = Task {
            guard !Task.isCancelled else { return }
            await MainActor.run { self.isLoading = true; self.loadError = nil }

            do {
                let response = try await APIClient.viewportPins(
                    minLat: minLat, maxLat: maxLat,
                    minLng: minLng, maxLng: maxLng,
                    zoom: zoom
                )
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    self.pins = response.pins
                    // Expand the cached bounds slightly so small pans don't re-fetch
                    let pad = span.latitudeDelta * 0.25
                    self.lastLoadedBounds = (
                        minLat: minLat - pad,
                        maxLat: maxLat + pad,
                        minLng: minLng - pad,
                        maxLng: maxLng + pad
                    )
                }
            } catch {
                if !Task.isCancelled {
                    await MainActor.run { self.loadError = error.localizedDescription }
                }
            }

            if !Task.isCancelled {
                await MainActor.run { self.isLoading = false }
            }
        }
    }

    func invalidateBoundsCache() {
        lastLoadedBounds = nil
    }

    /// Merge server pins with local pending pins (pending wins on same id).
    func displayPins(merging pending: [CanvassPin], queuedItems: [QueuedLeadItem] = []) -> [CanvassPin] {
        var byId = Dictionary(uniqueKeysWithValues: pins.map { ($0.id, $0) })
        for p in pending {
            byId[p.id] = p
        }
        for item in queuedItems {
            guard let leadId = item.request.lead_id, !leadId.isEmpty else { continue }
            guard let existing = byId[leadId] else { continue }
            byId[leadId] = CanvassPin(
                id: existing.id,
                lat: item.request.lat ?? existing.lat,
                lng: item.request.lng ?? existing.lng,
                d: item.request.canvass_disposition ?? existing.d,
                s: existing.s,
                o: existing.o,
                t: existing.t,
                ia: existing.ia,
                isPending: true,
                isPendingEdit: true,
                address_text: item.request.address_text ?? existing.address_text,
                homeowner_name: item.request.homeowner_name ?? existing.homeowner_name,
                phone: item.request.phone ?? existing.phone,
                notes: item.request.canvass_notes ?? existing.notes
            )
        }
        return Array(byId.values)
    }

    private func spanToZoom(_ span: MKCoordinateSpan) -> Int {
        let delta = span.latitudeDelta
        if delta < 0.002 { return 20 }
        if delta < 0.005 { return 19 }
        if delta < 0.01  { return 18 }
        if delta < 0.02  { return 17 }
        if delta < 0.05  { return 16 }
        if delta < 0.1   { return 15 }
        if delta < 0.2   { return 14 }
        if delta < 0.5   { return 13 }
        if delta < 1.0   { return 12 }
        if delta < 2.0   { return 11 }
        return 10
    }
}

// MARK: - MapKit UIViewRepresentable

struct CanvassMapView: UIViewRepresentable {
    let pins: [CanvassPin]
    var territories: [Territory] = []
    var weatherPolygons: [WeatherPolygonFeature] = []
    var overlayPoints: [MapOverlayPoint] = []
    var roofAgeCircles: [RoofAgeCircleModel] = []
    let userLocation: CLLocationCoordinate2D?
    @Binding var hasInitiallyZoomed: Bool
    @Binding var trackingMode: MKUserTrackingMode
    @Binding var flyTarget: CLLocationCoordinate2D?
    let mapStyle: MapStyleSetting
    let enable3DBuildings: Bool
    let onRegionChange: (MKCoordinateRegion) -> Void
    let onZoom: () -> Void
    let onMapTap: (CLLocationCoordinate2D) -> Void
    let onRoofAgeParcelTap: (RoofAgeCircleModel) -> Void
    let onLongPress: (CLLocationCoordinate2D) -> Void
    let onPinTap: (CanvassPin) -> Void

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.showsUserLocation = true
        map.showsCompass = false
        map.showsScale = false
        map.delegate = context.coordinator
        context.coordinator.applyMapConfigurationIfNeeded(to: map)

        let lp = UILongPressGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleLongPress(_:)))
        lp.minimumPressDuration = 0.5
        map.addGestureRecognizer(lp)

        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleMapTap(_:)))
        tap.delegate = context.coordinator
        map.addGestureRecognizer(tap)
        for gr in map.gestureRecognizers ?? [] {
            if let doubleTap = gr as? UITapGestureRecognizer, doubleTap !== tap, doubleTap.numberOfTapsRequired == 2 {
                tap.require(toFail: doubleTap)
            }
        }

        // Native compass — adaptive (visible when heading ≠ north)
        let compass = MKCompassButton(mapView: map)
        compass.compassVisibility = .adaptive
        compass.translatesAutoresizingMaskIntoConstraints = false
        map.addSubview(compass)
        NSLayoutConstraint.activate([
            compass.topAnchor.constraint(equalTo: map.safeAreaLayoutGuide.topAnchor, constant: 66),
            compass.trailingAnchor.constraint(equalTo: map.safeAreaLayoutGuide.trailingAnchor, constant: -16),
        ])
        context.coordinator.compassButton = compass

        // Native scale — bottom-leading, clear of settings gear and floating tab bar
        let scale = MKScaleView(mapView: map)
        scale.legendAlignment = .leading
        scale.translatesAutoresizingMaskIntoConstraints = false
        map.addSubview(scale)
        NSLayoutConstraint.activate([
            scale.leadingAnchor.constraint(equalTo: map.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            scale.bottomAnchor.constraint(equalTo: map.safeAreaLayoutGuide.bottomAnchor, constant: -100),
            scale.widthAnchor.constraint(equalToConstant: 80),
        ])
        context.coordinator.scaleView = scale

        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.applyMapConfigurationIfNeeded(to: map)

        if map.userTrackingMode != trackingMode {
            map.setUserTrackingMode(trackingMode, animated: true)
        }

        // Auto-zoom to user location the first time we get a fix — top-down (matches web tilt: 0).
        // Skip setCamera when follow is already on so we don't cancel tracking.
        if !hasInitiallyZoomed, let loc = userLocation {
            if trackingMode == .none {
                let camera = MKMapCamera(lookingAtCenter: loc, fromDistance: 600, pitch: 0, heading: 0)
                map.setCamera(camera, animated: true)
            }
            DispatchQueue.main.async { hasInitiallyZoomed = true }
        }

        if let target = flyTarget {
            let camera = map.camera.copy() as! MKMapCamera
            camera.centerCoordinate = target
            map.setCamera(camera, animated: true)
            DispatchQueue.main.async { flyTarget = nil }
        }

        syncTerritoryOverlays(map, context: context)
        syncWeatherPolygonOverlays(map, context: context)
        syncRoofAgeCircleOverlays(map, context: context)
        syncOverlayAnnotations(map, context: context)

        let incoming = Set(pins.map(\.id))
        let pinById = Dictionary(uniqueKeysWithValues: pins.map { ($0.id, $0) })

        let toRemove = map.annotations.filter {
            guard let p = $0 as? PinAnnotation else { return false }
            return !incoming.contains(p.pinId)
        }
        map.removeAnnotations(toRemove)

        for ann in map.annotations {
            guard let pinAnn = ann as? PinAnnotation,
                  let updated = pinById[pinAnn.pinId],
                  !pinAnn.pin.isMapDisplayEqual(to: updated) else { continue }
            map.removeAnnotation(ann)
            map.addAnnotation(PinAnnotation(updated))
        }

        let refreshedIds = Set(map.annotations.compactMap { ($0 as? PinAnnotation)?.pinId })
        let toAdd = pins.filter { !refreshedIds.contains($0.id) }.map(PinAnnotation.init)
        map.addAnnotations(toAdd)
    }

    /// Territory and weather polygons are both plain `MKPolygon` overlays on the same map,
    /// so each sync method only touches overlays it tagged itself (via `title` prefix) —
    /// otherwise toggling one layer would wipe out the other on the next render pass.
    private static let territoryTitlePrefix = "territory:"
    private static let weatherTitlePrefix = "weather:"
    private static let roofAgeCircleTitlePrefix = "roofAgeCircle:"

    private func syncTerritoryOverlays(_ map: MKMapView, context: Context) {
        let existing = map.overlays.compactMap { $0 as? MKPolygon }
            .filter { ($0.title ?? "").hasPrefix(Self.territoryTitlePrefix) }
        map.removeOverlays(existing)
        for t in territories {
            for poly in t.boundary_geojson.polygons {
                poly.title = Self.territoryTitlePrefix + t.id
                map.addOverlay(poly)
            }
        }
    }

    private func syncWeatherPolygonOverlays(_ map: MKMapView, context: Context) {
        let existing = map.overlays.compactMap { $0 as? MKPolygon }
            .filter { ($0.title ?? "").hasPrefix(Self.weatherTitlePrefix) }
        map.removeOverlays(existing)
        for feature in weatherPolygons {
            for poly in feature.polygons {
                poly.title = Self.weatherTitlePrefix + feature.kind + ":" + feature.layer + ":" + feature.id
                map.addOverlay(poly)
            }
        }
    }

    private func syncRoofAgeCircleOverlays(_ map: MKMapView, context: Context) {
        let existing = map.overlays.compactMap { $0 as? MKCircle }
            .filter { ($0.title ?? "").hasPrefix(Self.roofAgeCircleTitlePrefix) }
        map.removeOverlays(existing)
        for model in roofAgeCircles {
            let circle = MKCircle(center: model.coordinate, radius: model.radiusMeters)
            circle.title = Self.roofAgeCircleTitlePrefix + model.id
            map.addOverlay(circle)
        }
    }

    private func syncOverlayAnnotations(_ map: MKMapView, context: Context) {
        let toRemove = map.annotations.filter { $0 is OverlayPointAnnotation }
        map.removeAnnotations(toRemove)
        for pt in overlayPoints {
            map.addAnnotation(OverlayPointAnnotation(point: pt))
        }
    }

    private func applyMapConfiguration(to map: MKMapView) {
        if #available(iOS 16.0, *) {
            let elevation: MKMapConfiguration.ElevationStyle = enable3DBuildings ? .realistic : .flat
            switch mapStyle {
            case .standard:
                map.preferredConfiguration = MKStandardMapConfiguration(elevationStyle: elevation)
            case .hybrid:
                map.preferredConfiguration = MKHybridMapConfiguration(elevationStyle: elevation)
            case .satellite:
                map.preferredConfiguration = MKImageryMapConfiguration(elevationStyle: elevation)
            }
        } else {
            map.mapType = mapStyle.legacyMapType
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    // MARK: Coordinator

    class Coordinator: NSObject, MKMapViewDelegate, UIGestureRecognizerDelegate {
        var parent: CanvassMapView
        var compassButton: MKCompassButton?
        var scaleView: MKScaleView?
        private var regionDebounce: Task<Void, Never>?
        private var lastSpan: MKCoordinateSpan? = nil
        private var appliedMapStyle: MapStyleSetting?
        private var appliedEnable3D: Bool?

        init(_ parent: CanvassMapView) { self.parent = parent }

        func applyMapConfigurationIfNeeded(to map: MKMapView) {
            let style = parent.mapStyle
            let enable3D = parent.enable3DBuildings
            guard style != appliedMapStyle || enable3D != appliedEnable3D else { return }
            parent.applyMapConfiguration(to: map)
            appliedMapStyle = style
            appliedEnable3D = enable3D
        }

        func mapView(_ mapView: MKMapView, didChange mode: MKUserTrackingMode, animated: Bool) {
            DispatchQueue.main.async {
                if self.parent.trackingMode != mode {
                    self.parent.trackingMode = mode
                }
            }
        }

        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            let currentSpan = mapView.region.span
            let region = mapView.region

            let didZoom: Bool = {
                guard let prev = lastSpan else { return false }
                let ratio = currentSpan.latitudeDelta / max(prev.latitudeDelta, 1e-10)
                return ratio < 0.85 || ratio > 1.15
            }()
            lastSpan = currentSpan

            regionDebounce?.cancel()
            regionDebounce = Task {
                try? await Task.sleep(nanoseconds: 350_000_000)
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    if didZoom { self.parent.onZoom() }
                    self.parent.onRegionChange(region)
                }
            }
        }

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let circle = overlay as? MKCircle, let title = circle.title,
               title.hasPrefix(CanvassMapView.roofAgeCircleTitlePrefix) {
                let circleId = String(title.dropFirst(CanvassMapView.roofAgeCircleTitlePrefix.count))
                let model = parent.roofAgeCircles.first(where: { $0.id == circleId })
                let renderer = MKCircleRenderer(circle: circle)
                let fill = UIColor(hex: model?.colorHex ?? "#F59E0B")
                renderer.fillColor = fill.withAlphaComponent(1)
                renderer.strokeColor = UIColor.white.withAlphaComponent(0.95)
                renderer.lineWidth = 2
                return renderer
            }

            guard let poly = overlay as? MKPolygon, let title = poly.title else {
                return MKOverlayRenderer(overlay: overlay)
            }

            if title.hasPrefix(CanvassMapView.territoryTitlePrefix) {
                let territoryId = String(title.dropFirst(CanvassMapView.territoryTitlePrefix.count))
                if let t = parent.territories.first(where: { $0.id == territoryId }) {
                    let renderer = MKPolygonRenderer(polygon: poly)
                    let alpha: CGFloat = t.assigned_to_me ? 0.25 : 0.15
                    renderer.fillColor = UIColor(hex: t.color).withAlphaComponent(alpha)
                    renderer.strokeColor = UIColor(hex: t.color)
                    renderer.lineWidth = 2
                    return renderer
                }
            }

            if title.hasPrefix(CanvassMapView.weatherTitlePrefix) {
                // "weather:<kind>:<layer>:<id>" — id is the last component (a UUID, no colons).
                let id = String(title.split(separator: ":").last ?? "")
                if let feature = parent.weatherPolygons.first(where: { $0.id == id }) {
                    // A swath (large, low-urgency footprint) stays soft; an active warning
                    // stays bold and reads as "act on this now" without shouting over the map.
                    let color = UIColor(hex: feature.colorHex)
                    let isWarning = feature.kind == "warning"
                    let renderer = MKPolygonRenderer(polygon: poly)
                    renderer.fillColor = color.withAlphaComponent(isWarning ? 0.12 : 0.18)
                    renderer.strokeColor = color.withAlphaComponent(isWarning ? 0.9 : 0.6)
                    renderer.lineWidth = isWarning ? 2 : 1.5
                    if isWarning {
                        renderer.lineDashPattern = [6, 4]
                    }
                    return renderer
                }
            }

            return MKOverlayRenderer(overlay: overlay)
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            if let overlay = annotation as? OverlayPointAnnotation {
                let id = "OverlayPoint"
                let view = mapView.dequeueReusableAnnotationView(withIdentifier: id) as? MKMarkerAnnotationView
                    ?? MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: id)
                view.annotation = annotation
                view.markerTintColor = UIColor(hex: overlay.colorHex)
                view.glyphImage = UIImage(systemName: overlay.kind == "weather" ? "cloud.bolt" : "house")
                view.canShowCallout = false
                view.clusteringIdentifier = nil
                return view
            }
            if let cluster = annotation as? MKClusterAnnotation {
                let id = "Cluster"
                let view = mapView.dequeueReusableAnnotationView(withIdentifier: id) as? MKMarkerAnnotationView
                    ?? MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: id)
                view.annotation = cluster
                view.markerTintColor = UIColor(hex: "#3B82F6")
                view.glyphText = "\(cluster.memberAnnotations.count)"
                view.titleVisibility = .hidden
                view.subtitleVisibility = .hidden
                return view
            }

            guard let pin = annotation as? PinAnnotation else { return nil }
            let id = pin.isPending ? (pin.isPendingEdit ? "PendingEditPin" : "PendingPin") : "CanvassPin"
            let view = mapView.dequeueReusableAnnotationView(withIdentifier: id) as? MKMarkerAnnotationView
                ?? MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: id)
            view.annotation = annotation
            if pin.isPending {
                if pin.isPendingEdit {
                    view.markerTintColor = UIColor(hex: "#F59E0B")
                    view.glyphImage = UIImage(systemName: "arrow.clockwise.circle")
                } else {
                    view.markerTintColor = UIColor(hex: "#9CA3AF")
                    view.glyphImage = UIImage(systemName: "clock.arrow.circlepath")
                }
                view.clusteringIdentifier = nil
            } else {
                view.markerTintColor = pin.uiColor
                view.glyphImage = pin.glyphImage
                view.clusteringIdentifier = "canvass"
            }
            view.canShowCallout = false
            return view
        }

        func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
            guard let pin = (view.annotation as? PinAnnotation)?.pin else { return }
            mapView.deselectAnnotation(view.annotation, animated: false)
            parent.onPinTap(pin)
        }

        @objc func handleLongPress(_ gr: UILongPressGestureRecognizer) {
            guard gr.state == .began, let map = gr.view as? MKMapView else { return }
            let point = gr.location(in: map)
            let coord = map.convert(point, toCoordinateFrom: map)
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            parent.onLongPress(coord)
        }

        @objc func handleMapTap(_ gr: UITapGestureRecognizer) {
            guard gr.state == .ended, let map = gr.view as? MKMapView else { return }
            let point = gr.location(in: map)
            let coord = map.convert(point, toCoordinateFrom: map)
            if let parcel = hitTestRoofAgeParcel(at: point, in: map) {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                parent.onRoofAgeParcelTap(parcel)
                return
            }
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            parent.onMapTap(coord)
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            if viewHierarchyContainsMapAnnotation(touch.view) { return false }
            if mapTapShouldIgnore(touch.view) { return false }
            return true
        }

        private func viewHierarchyContainsMapAnnotation(_ view: UIView?) -> Bool {
            var current = view
            while let v = current {
                if v is MKAnnotationView { return true }
                current = v.superview
            }
            return false
        }

        /// Ignore taps on map chrome (compass, scale, controls) so they do not open New Lead.
        private func mapTapShouldIgnore(_ view: UIView?) -> Bool {
            var current = view
            while let v = current {
                if v is MKCompassButton || v is MKScaleView { return true }
                if v is UIControl { return true }
                if v === compassButton || v === scaleView { return true }
                current = v.superview
            }
            return false
        }

        private func hitTestRoofAgeParcel(at mapPoint: CGPoint, in map: MKMapView) -> RoofAgeCircleModel? {
            guard !parent.roofAgeCircles.isEmpty else { return nil }
            let hitRadiusPt: CGFloat = 22
            var best: (RoofAgeCircleModel, CGFloat)?
            for parcel in parent.roofAgeCircles {
                let centerPt = map.convert(parcel.coordinate, toPointTo: map)
                let dx = mapPoint.x - centerPt.x
                let dy = mapPoint.y - centerPt.y
                let distPt = hypot(dx, dy)
                if distPt <= hitRadiusPt {
                    if best == nil || distPt < best!.1 {
                        best = (parcel, distPt)
                    }
                }
            }
            return best?.0
        }
    }
}

// MARK: - Overlay point annotation

class OverlayPointAnnotation: NSObject, MKAnnotation {
    let point: MapOverlayPoint
    var coordinate: CLLocationCoordinate2D { point.coordinate }
    var colorHex: String { point.colorHex }
    var kind: String { point.kind }

    init(point: MapOverlayPoint) {
        self.point = point
        super.init()
    }
}

// MARK: - Pin Annotation

class PinAnnotation: NSObject, MKAnnotation {
    let pin: CanvassPin
    var pinId: String { pin.id }
    var isPending: Bool { pin.isPending }
    var isPendingEdit: Bool { pin.isPendingEdit }
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: pin.lat, longitude: pin.lng) }

    nonisolated init(_ pin: CanvassPin) {
        self.pin = pin
        super.init()
    }

    var uiColor: UIColor {
        if pin.ia == true { return UIColor(hex: "#10B981") }
        if pin.s == "inspection" { return UIColor(hex: "#10B981") }
        if let d = pin.d, let disp = CanvassDisposition.find(d) {
            return UIColor(hex: disp.color)
        }
        return UIColor(hex: "#3B82F6")
    }

    var glyphImage: UIImage? {
        if pin.ia == true { return UIImage(systemName: "dollarsign") }
        if pin.s == "inspection" { return UIImage(systemName: "calendar.badge.checkmark") }
        switch pin.d {
        case "hot_lead":       return UIImage(systemName: "flame.fill")
        case "go_back":        return UIImage(systemName: "arrow.uturn.left")
        case "not_home":       return UIImage(systemName: "house")
        case "not_interested": return UIImage(systemName: "xmark")
        case "bad_roof":       return UIImage(systemName: "exclamationmark.triangle")
        case "renter":         return UIImage(systemName: "person.fill")
        default:               return UIImage(systemName: "mappin")
        }
    }
}

// MARK: - UIColor hex helper

extension UIColor {
    convenience init(hex: String) {
        var h = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if h.hasPrefix("#") { h = String(h.dropFirst()) }
        var rgb: UInt64 = 0
        Scanner(string: h).scanHexInt64(&rgb)
        self.init(
            red:   CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8)  & 0xFF) / 255,
            blue:  CGFloat( rgb        & 0xFF) / 255,
            alpha: 1
        )
    }
}
