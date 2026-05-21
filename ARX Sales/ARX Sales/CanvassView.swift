import SwiftUI
import MapKit
import CoreLocation
import Combine

// MARK: - Canvass View

struct CanvassView: View {
    @StateObject private var vm = CanvassViewModel()
    @State private var showLeadSheet = false
    @State private var selectedPin: CanvassPin? = nil
    @State private var newLeadCoord: CLLocationCoordinate2D? = nil
    @State private var hasInitiallyZoomed = false

    var body: some View {
        ZStack(alignment: .bottom) {
            CanvassMapView(
                pins: vm.pins,
                userLocation: vm.userLocation,
                hasInitiallyZoomed: $hasInitiallyZoomed,
                onRegionChange: { region in
                    vm.loadPins(for: region)
                },
                onZoom: {
                    vm.invalidateBoundsCache()
                },
                onLongPress: { coord in
                    newLeadCoord = coord
                    selectedPin = nil
                    showLeadSheet = true
                },
                onPinTap: { pin in
                    selectedPin = pin
                    newLeadCoord = nil
                    showLeadSheet = true
                }
            )
            .ignoresSafeArea()

            // Bottom HUD
            VStack(spacing: 8) {
                if let err = vm.loadError {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(.yellow)
                        Text(err)
                            .font(.caption)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(.ultraThinMaterial)
                    .cornerRadius(20)
                }

                if vm.isLoading {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Loading pins…")
                            .font(.caption)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(.ultraThinMaterial)
                    .cornerRadius(20)
                } else if vm.loadError == nil {
                    HStack(spacing: 6) {
                        Image(systemName: "mappin.circle.fill")
                            .font(.caption)
                            .foregroundColor(.blue)
                        Text(vm.pins.isEmpty ? "No leads in this area" : "\(vm.pins.count) lead\(vm.pins.count == 1 ? "" : "s")")
                            .font(.caption)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(.ultraThinMaterial)
                    .cornerRadius(20)
                }
            }
            .padding(.bottom, 12)
        }
        .sheet(isPresented: $showLeadSheet, onDismiss: {
            vm.invalidateBoundsCache()
            if let r = vm.lastRegion { vm.loadPins(for: r) }
        }) {
            LeadSheetView(
                pin: selectedPin,
                coordinate: newLeadCoord ?? (selectedPin.map {
                    CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lng)
                })
            )
            .canvassSheetPresentation()
        }
        .onAppear {
            vm.startLocationTracking()
        }
    }
}

// MARK: - ViewModel

class CanvassViewModel: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var pins: [CanvassPin] = []
    @Published var userLocation: CLLocationCoordinate2D? = nil
    @Published var isLoading = false
    @Published var loadError: String? = nil

    var lastRegion: MKCoordinateRegion?
    private let locationManager = CLLocationManager()
    private var loadTask: Task<Void, Never>? = nil
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
    let userLocation: CLLocationCoordinate2D?
    @Binding var hasInitiallyZoomed: Bool
    let onRegionChange: (MKCoordinateRegion) -> Void
    let onZoom: () -> Void
    let onLongPress: (CLLocationCoordinate2D) -> Void
    let onPinTap: (CanvassPin) -> Void

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.mapType = .hybrid
        map.showsUserLocation = true
        map.delegate = context.coordinator

        // Long press to drop a pin
        let lp = UILongPressGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleLongPress(_:)))
        lp.minimumPressDuration = 0.5
        map.addGestureRecognizer(lp)

        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.parent = self

        // Auto-zoom to user location the first time we get a fix
        if !hasInitiallyZoomed, let loc = userLocation {
            let region = MKCoordinateRegion(center: loc, latitudinalMeters: 500, longitudinalMeters: 500)
            map.setRegion(region, animated: true)
            DispatchQueue.main.async { hasInitiallyZoomed = true }
        }

        // Sync annotations — remove stale, add new
        let existing = Set(map.annotations.compactMap { ($0 as? PinAnnotation)?.pinId })
        let incoming = Set(pins.map(\.id))

        let toRemove = map.annotations.filter {
            guard let p = $0 as? PinAnnotation else { return false }
            return !incoming.contains(p.pinId)
        }
        map.removeAnnotations(toRemove)

        let toAdd = pins.filter { !existing.contains($0.id) }.map(PinAnnotation.init)
        map.addAnnotations(toAdd)
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    // MARK: Coordinator

    class Coordinator: NSObject, MKMapViewDelegate {
        var parent: CanvassMapView
        private var regionDebounce: Task<Void, Never>?

        init(_ parent: CanvassMapView) { self.parent = parent }

        private var lastSpan: MKCoordinateSpan? = nil

        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            let currentSpan = mapView.region.span
            let region = mapView.region

            // Detect zoom change — if the user zoomed, invalidate the bounds cache
            // so we always fetch fresh data at the new detail level
            let didZoom: Bool = {
                guard let prev = lastSpan else { return false }
                let ratio = currentSpan.latitudeDelta / max(prev.latitudeDelta, 1e-10)
                return ratio < 0.85 || ratio > 1.15   // >15% span change = zoom
            }()
            lastSpan = currentSpan

            regionDebounce?.cancel()
            regionDebounce = Task {
                // 350 ms — single debounce, replaces the old 300ms+400ms chain
                try? await Task.sleep(nanoseconds: 350_000_000)
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    if didZoom { self.parent.onZoom() }
                    self.parent.onRegionChange(region)
                }
            }
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            // Cluster annotation — show count badge
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
            let id = "CanvassPin"
            let view = mapView.dequeueReusableAnnotationView(withIdentifier: id) as? MKMarkerAnnotationView
                ?? MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: id)
            view.annotation = annotation
            view.markerTintColor = pin.uiColor
            view.glyphImage = pin.glyphImage
            view.canShowCallout = false
            view.clusteringIdentifier = "canvass"   // enables auto-clustering
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

// MARK: - Pin Annotation

class PinAnnotation: NSObject, MKAnnotation {
    let pin: CanvassPin
    var pinId: String { pin.id }
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: pin.lat, longitude: pin.lng) }

    nonisolated init(_ pin: CanvassPin) {
        self.pin = pin
        super.init()
    }

    var uiColor: UIColor {
        // Sold (installation agreement) → green dollar
        if pin.ia == true { return UIColor(hex: "#10B981") }
        // Scheduled inspection → green
        if pin.s == "inspection" { return UIColor(hex: "#10B981") }
        // Disposition color
        if let d = pin.d, let disp = CanvassDisposition.find(d) {
            return UIColor(hex: disp.color)
        }
        return UIColor(hex: "#3B82F6") // blue = not knocked / unknown
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
