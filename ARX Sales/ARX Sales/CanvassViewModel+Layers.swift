import Foundation
import MapKit
import Supabase

// MARK: - Overlay point for weather / roof age

struct MapOverlayPoint: Identifiable {
    let id: String
    let coordinate: CLLocationCoordinate2D
    let colorHex: String
    let kind: String
}

/// Parcel roof-age layer circle — matches web `roofAgeMarkerRadiusMeters` at street zoom.
struct RoofAgeCircleModel: Identifiable {
    let id: String
    let coordinate: CLLocationCoordinate2D
    let radiusMeters: CLLocationDistance
    let colorHex: String
    let yearBuilt: Int
    let roofAge: Int

    static func fromRoofAgeFeature(_ f: [String: Any]) -> RoofAgeCircleModel? {
        guard let geom = f["geometry"] as? [String: Any],
              let coords = geom["coordinates"] as? [Double], coords.count >= 2,
              let props = f["properties"] as? [String: Any] else { return nil }
        let yearBuilt: Int? = {
            if let n = props["yearBuilt"] as? Int { return n }
            if let n = props["yearBuilt"] as? NSNumber { return n.intValue }
            return nil
        }()
        let roofAge: Int? = {
            if let n = props["roofAge"] as? Int { return n }
            if let n = props["roofAge"] as? NSNumber { return n.intValue }
            return nil
        }()
        guard let yearBuilt, let roofAge else { return nil }
        let color: String
        if roofAge >= 20 { color = "#B91C1C" }
        else if roofAge >= 15 { color = "#EA580C" }
        else { color = "#F59E0B" }
        let radius: CLLocationDistance = roofAge >= 20 ? 9 : 7
        let lat = coords[1]
        let lng = coords[0]
        return RoofAgeCircleModel(
            id: String(format: "%.5f,%.5f-%d", lat, lng, yearBuilt),
            coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng),
            radiusMeters: radius,
            colorHex: color,
            yearBuilt: yearBuilt,
            roofAge: roofAge
        )
    }
}

/// Warning (active NWS severe-weather alert) or swath (radar-derived hail-fall
/// footprint) polygon — the backend returns these alongside point storm reports,
/// but they were previously dropped entirely since only Point geometries were parsed.
struct WeatherPolygonFeature: Identifiable {
    let id: String
    let kind: String    // "warning" | "swath"
    let layer: String   // "hail" | "wind"
    let polygons: [MKPolygon]

    var colorHex: String {
        switch (kind, layer) {
        case ("warning", _): return "#DC2626"   // active alert — most urgent, always red
        case (_, "wind"): return "#3B82F6"
        default: return "#F59E0B"               // hail swath — amber, softer than an active warning
        }
    }
}

extension WeatherPolygonFeature {
    /// Parses Polygon/MultiPolygon `warning`/`swath` features. Point `report` features
    /// are handled separately by `MapOverlayPoint.fromWeatherFeature`.
    static func from(_ f: [String: Any], layer: String) -> WeatherPolygonFeature? {
        guard let props = f["properties"] as? [String: Any],
              let kind = props["kind"] as? String, kind == "warning" || kind == "swath",
              let geom = f["geometry"] as? [String: Any],
              let geomType = geom["type"] as? String else { return nil }

        let polygons: [MKPolygon]
        switch geomType {
        case "Polygon":
            guard let rings = geom["coordinates"] as? [[[Double]]], let outer = rings.first,
                  let poly = polygon(from: outer) else { return nil }
            polygons = [poly]
        case "MultiPolygon":
            guard let multi = geom["coordinates"] as? [[[[Double]]]] else { return nil }
            polygons = multi.compactMap { ringSet in
                guard let outer = ringSet.first else { return nil }
                return polygon(from: outer)
            }
        default:
            return nil
        }
        guard !polygons.isEmpty else { return nil }
        let layerName = props["layer"] as? String ?? layer
        return WeatherPolygonFeature(id: UUID().uuidString, kind: kind, layer: layerName, polygons: polygons)
    }

    private static func polygon(from ring: [[Double]]) -> MKPolygon? {
        let coords = ring.compactMap { pair -> CLLocationCoordinate2D? in
            guard pair.count >= 2 else { return nil }
            return CLLocationCoordinate2D(latitude: pair[1], longitude: pair[0])
        }
        guard coords.count >= 3 else { return nil }
        return MKPolygon(coordinates: coords, count: coords.count)
    }
}

extension CanvassViewModel {
    /// Matches web `MIN_ROOF_AGE_ZOOM` — parcel circles only at street zoom.
    static let minRoofAgeDisplayZoom = 16

    static func zoomLevel(for region: MKCoordinateRegion) -> Int {
        let delta = region.span.latitudeDelta
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

    @MainActor
    func loadMyUserId() async {
        if let session = try? await supabase.auth.session {
            myUserId = session.user.id.uuidString.lowercased()
        }
    }

    func filteredPins(
        pending: [CanvassPin],
        queuedItems: [QueuedLeadItem] = [],
        myUserId: String?,
        focusMode: Bool,
        myPinsOnly: Bool,
        timeFilter: PinTimeFilter
    ) -> [CanvassPin] {
        displayPins(merging: pending, queuedItems: queuedItems).filter { pin in
            if focusMode || myPinsOnly {
                guard CanvassPinFilters.matchesOwner(pin, myUserId: myUserId) else { return false }
            }
            return CanvassPinFilters.matchesTime(pin, filter: timeFilter)
        }
    }

    func overlayPoints(showWeather: Bool, showRoofAge: Bool) -> [MapOverlayPoint] {
        var pts: [MapOverlayPoint] = []
        if showWeather { pts.append(contentsOf: weatherPoints) }
        _ = showRoofAge // roof-age parcel layer uses MKCircle overlays, not point markers
        return pts
    }

    func coverageLabel(pins: [CanvassPin], partial: Bool) -> String? {
        guard let region = lastRegion else { return nil }
        let visible = territories.filter { t in
            t.boundary_geojson.polygons.contains { poly in
                let renderer = MKPolygonRenderer(polygon: poly)
                let centerPt = renderer.point(for: MKMapPoint(region.center))
                return renderer.path.contains(centerPt)
            }
        }
        guard let t = visible.first(where: { $0.assigned_to_me }) ?? visible.first else { return nil }
        let count = TerritoryGeometry.pinsInside(territory: t, pins: pins)
        let suffix = partial ? " in view" : ""
        return "\(t.name) — \(count) knocked\(suffix)"
    }

    func loadTerritoriesIfNeeded(show: Bool) {
        guard show, !territoriesLoaded else { return }
        Task {
            do {
                territories = try await APIClient.fetchTerritories()
                territoriesLoaded = true
            } catch {
                territories = []
            }
        }
    }

    func loadOverlays(for region: MKCoordinateRegion, weather: Bool, roofAge: Bool) {
        let bbox = region.bbox
        overlayTask?.cancel()
        overlayTask = Task {
            if weather {
                await loadWeather(bbox: bbox)
            } else {
                await MainActor.run { weatherPoints = []; weatherPolygons = []; weatherDegraded = false }
            }
            if roofAge {
                await loadRoofAge(bbox: bbox, region: region)
            } else {
                await MainActor.run { roofAgePoints = []; roofAgeCircles = []; roofAgeDegraded = false }
            }
        }
    }

    private func loadWeather(bbox: MapBbox) async {
        var allPoints: [MapOverlayPoint] = []
        var allPolygons: [WeatherPolygonFeature] = []
        var anyDegraded = false
        for layer in ["hail", "wind"] {
            var items = bbox.queryItems
            items.append(URLQueryItem(name: "layer", value: layer))
            do {
                let data = try await APIClient.request(path: "/api/canvass/weather", queryItems: items)
                let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                if json?["degraded"] as? Bool == true { anyDegraded = true }
                let features = json?["features"] as? [[String: Any]] ?? []
                allPoints.append(contentsOf: features.compactMap { MapOverlayPoint.fromWeatherFeature($0, layer: layer) })
                allPolygons.append(contentsOf: features.compactMap { WeatherPolygonFeature.from($0, layer: layer) })
            } catch {
                anyDegraded = true
            }
        }
        await MainActor.run {
            weatherPoints = allPoints
            weatherPolygons = allPolygons
            weatherDegraded = anyDegraded
        }
    }

    private func loadRoofAge(bbox: MapBbox, region: MKCoordinateRegion) async {
        let zoom = Self.zoomLevel(for: region)
        guard zoom >= Self.minRoofAgeDisplayZoom else {
            await MainActor.run { roofAgePoints = []; roofAgeCircles = []; roofAgeDegraded = false }
            return
        }
        do {
            let data = try await APIClient.request(path: "/api/canvass/roof-age", queryItems: bbox.queryItems)
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            let degraded = json?["degraded"] as? Bool ?? false
            let features = json?["features"] as? [[String: Any]] ?? []
            let circles = features.compactMap { RoofAgeCircleModel.fromRoofAgeFeature($0) }
            await MainActor.run {
                roofAgePoints = []
                roofAgeCircles = circles
                roofAgeDegraded = degraded
            }
        } catch {
            await MainActor.run { roofAgePoints = []; roofAgeCircles = []; roofAgeDegraded = true }
        }
    }
}

struct MapBbox {
    let n, s, e, w: Double
    var queryItems: [URLQueryItem] {
        [
            URLQueryItem(name: "n", value: "\(n)"),
            URLQueryItem(name: "s", value: "\(s)"),
            URLQueryItem(name: "e", value: "\(e)"),
            URLQueryItem(name: "w", value: "\(w)"),
        ]
    }
}

extension MKCoordinateRegion {
    var bbox: MapBbox {
        MapBbox(
            n: center.latitude + span.latitudeDelta / 2,
            s: center.latitude - span.latitudeDelta / 2,
            e: center.longitude + span.longitudeDelta / 2,
            w: center.longitude - span.longitudeDelta / 2
        )
    }
}

extension MapOverlayPoint {
    static func fromWeatherFeature(_ f: [String: Any], layer: String) -> MapOverlayPoint? {
        guard let geom = f["geometry"] as? [String: Any],
              let coords = geom["coordinates"] as? [Double], coords.count >= 2,
              let props = f["properties"] as? [String: Any] else { return nil }
        let layerName = props["layer"] as? String ?? layer
        let color = layerName == "wind" ? "#3B82F6" : "#EF4444"
        return MapOverlayPoint(
            id: UUID().uuidString,
            coordinate: CLLocationCoordinate2D(latitude: coords[1], longitude: coords[0]),
            colorHex: color,
            kind: "weather"
        )
    }

    static func fromRoofAgeFeature(_ f: [String: Any]) -> MapOverlayPoint? {
        guard let geom = f["geometry"] as? [String: Any],
              let coords = geom["coordinates"] as? [Double], coords.count >= 2,
              let props = f["properties"] as? [String: Any] else { return nil }
        let age: Int? = {
            if let n = props["roofAge"] as? Int { return n }
            if let n = props["roofAge"] as? NSNumber { return n.intValue }
            return nil
        }()
        guard let age else { return nil }
        let color: String
        if age >= 20 { color = "#B91C1C" }
        else if age >= 15 { color = "#EA580C" }
        else { color = "#F59E0B" }
        return MapOverlayPoint(
            id: UUID().uuidString,
            coordinate: CLLocationCoordinate2D(latitude: coords[1], longitude: coords[0]),
            colorHex: color,
            kind: "roofAge"
        )
    }
}
