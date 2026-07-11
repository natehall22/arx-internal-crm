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

extension CanvassViewModel {
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
        if showRoofAge { pts.append(contentsOf: roofAgePoints) }
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
                await MainActor.run { weatherPoints = []; weatherDegraded = false }
            }
            if roofAge {
                await loadRoofAge(bbox: bbox)
            } else {
                await MainActor.run { roofAgePoints = []; roofAgeDegraded = false }
            }
        }
    }

    private func loadWeather(bbox: MapBbox) async {
        var allPoints: [MapOverlayPoint] = []
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
            } catch {
                anyDegraded = true
            }
        }
        await MainActor.run {
            weatherPoints = allPoints
            weatherDegraded = anyDegraded
        }
    }

    private func loadRoofAge(bbox: MapBbox) async {
        do {
            let data = try await APIClient.request(path: "/api/canvass/roof-age", queryItems: bbox.queryItems)
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            let degraded = json?["degraded"] as? Bool ?? false
            let features = json?["features"] as? [[String: Any]] ?? []
            let points = features.compactMap { MapOverlayPoint.fromRoofAgeFeature($0) }
            await MainActor.run {
                roofAgePoints = points
                roofAgeDegraded = degraded
            }
        } catch {
            await MainActor.run { roofAgePoints = []; roofAgeDegraded = true }
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
