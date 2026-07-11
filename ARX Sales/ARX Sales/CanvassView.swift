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
    @State private var showLeadSheet = false
    @State private var showPendingSheet = false
    @State private var showLayersSheet = false
    @State private var selectedPin: CanvassPin? = nil
    @State private var newLeadCoord: CLLocationCoordinate2D? = nil
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

    var body: some View {
        ZStack {
            CanvassMapView(
                pins: visiblePins,
                territories: showTerritories ? vm.territories : [],
                overlayPoints: vm.overlayPoints(showWeather: showWeather && weatherOverlayAvailable, showRoofAge: showRoofAge),
                userLocation: vm.userLocation,
                hasInitiallyZoomed: $hasInitiallyZoomed,
                trackingMode: $trackingMode,
                flyTarget: $flyTarget,
                mapStyle: MapStyleSetting(rawValue: mapStyleRaw) ?? .hybrid,
                enable3DBuildings: enable3DBuildings,
                onRegionChange: { region in
                    mapCoordinator.lastRegion = region
                    vm.loadPins(for: region)
                    vm.loadOverlays(for: region, weather: showWeather && weatherOverlayAvailable, roofAge: showRoofAge)
                    vm.loadTerritoriesIfNeeded(show: showTerritories)
                },
                onZoom: { vm.invalidateBoundsCache() },
                onLongPress: { coord in newLeadCoord = coord; selectedPin = nil; showLeadSheet = true },
                onPinTap: { pin in selectedPin = pin; newLeadCoord = nil; showLeadSheet = true }
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
                    VStack(spacing: 10) {
                        MapCircleButton(systemImage: "square.3.layers.3d", isActive: showLayersSheet) { showLayersSheet = true }
                        timeScrubberCapsule
                    }
                    .padding(.leading, 16)

                    Spacer()

                    VStack(spacing: 8) {
                        if let coverage = vm.coverageLabel(pins: visiblePins, partial: true) {
                            MapHUDChip { Text(coverage) }
                        }
                        if vm.weatherDegraded && showWeather && weatherOverlayAvailable {
                            MapHUDChip { Text("Weather unavailable (est.)") }
                        }
                        if vm.roofAgeDegraded && showRoofAge {
                            MapHUDChip { Text("Roof age unavailable (est.)") }
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
        }
        .sheet(isPresented: $showLeadSheet, onDismiss: {
            vm.invalidateBoundsCache()
            if let r = vm.lastRegion { vm.loadPins(for: r) }
            Task { await offlineBridge.refresh() }
        }) {
            LeadSheetView(pin: selectedPin, coordinate: newLeadCoord ?? selectedPin.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lng) })
                .canvassSheetPresentation()
        }
        .sheet(isPresented: $showPendingSheet) { PendingSyncSheet(bridge: offlineBridge).mediumSheetPresentation() }
        .sheet(isPresented: $showLayersSheet) {
            LayersSheetView(weatherAvailable: weatherOverlayAvailable).mediumSheetPresentation()
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
}

// MARK: - ViewModel

class CanvassViewModel: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var pins: [CanvassPin] = []
    @Published var userLocation: CLLocationCoordinate2D? = nil
    @Published var isLoading = false
    @Published var loadError: String? = nil
    @Published var territories: [Territory] = []
    @Published var weatherPoints: [MapOverlayPoint] = []
    @Published var roofAgePoints: [MapOverlayPoint] = []
    @Published var weatherDegraded = false
    @Published var roofAgeDegraded = false

    @Published var myUserId: String?
    var lastRegion: MKCoordinateRegion?
    var territoriesLoaded = false

    private let locationManager = CLLocationManager()
    private var loadTask: Task<Void, Never>? = nil
    var overlayTask: Task<Void, Never>? = nil
    private var lastLoadedBounds: (minLat: Double, maxLat: Double, minLng: Double, maxLng: Double)? = nil

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

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        DispatchQueue.main.async { self.userLocation = loc.coordinate }
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
                isPendingEdit: true
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
    var overlayPoints: [MapOverlayPoint] = []
    let userLocation: CLLocationCoordinate2D?
    @Binding var hasInitiallyZoomed: Bool
    @Binding var trackingMode: MKUserTrackingMode
    @Binding var flyTarget: CLLocationCoordinate2D?
    let mapStyle: MapStyleSetting
    let enable3DBuildings: Bool
    let onRegionChange: (MKCoordinateRegion) -> Void
    let onZoom: () -> Void
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

        // Auto-zoom to user location the first time we get a fix — pitched 3D aerial feel.
        // Skip setCamera when follow is already on so we don't cancel tracking.
        if !hasInitiallyZoomed, let loc = userLocation {
            if trackingMode == .none {
                let camera = MKMapCamera(lookingAtCenter: loc, fromDistance: 600, pitch: 45, heading: 0)
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

    private func syncTerritoryOverlays(_ map: MKMapView, context: Context) {
        let existing = map.overlays.compactMap { $0 as? MKPolygon }
        map.removeOverlays(existing)
        for t in territories {
            for poly in t.boundary_geojson.polygons {
                poly.title = t.id
                map.addOverlay(poly)
            }
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

    class Coordinator: NSObject, MKMapViewDelegate {
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
            if let poly = overlay as? MKPolygon, let territoryId = poly.title, let t = parent.territories.first(where: { $0.id == territoryId }) {
                let renderer = MKPolygonRenderer(polygon: poly)
                let alpha: CGFloat = t.assigned_to_me ? 0.25 : 0.15
                renderer.fillColor = UIColor(hex: t.color).withAlphaComponent(alpha)
                renderer.strokeColor = UIColor(hex: t.color)
                renderer.lineWidth = 2
                return renderer
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
