import SwiftUI
import MapKit
import Combine

// MARK: - Territory model

struct Territory: Decodable, Identifiable {
    let id: String
    let name: String
    let color: String
    let boundary_geojson: GeoJSONBoundary
    let assigned_user_ids: [String]
    let assigned_to_me: Bool

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        color = try c.decodeIfPresent(String.self, forKey: .color) ?? "#3B82F6"
        boundary_geojson = (try? c.decode(GeoJSONBoundary.self, forKey: .boundary_geojson)) ?? GeoJSONBoundary.empty
        assigned_user_ids = try c.decodeIfPresent([String].self, forKey: .assigned_user_ids) ?? []
        assigned_to_me = try c.decodeIfPresent(Bool.self, forKey: .assigned_to_me) ?? false
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, color, boundary_geojson, assigned_user_ids, assigned_to_me
    }
}

struct GeoJSONBoundary: Codable {
    static let empty = GeoJSONBoundary(type: "Polygon", coordinates: nil, coordinatesMulti: nil)

    let type: String
    let coordinates: [[[Double]]]?
    let coordinatesMulti: [[[[Double]]]]?

    init(type: String, coordinates: [[[Double]]]?, coordinatesMulti: [[[[Double]]]]?) {
        self.type = type
        self.coordinates = coordinates
        self.coordinatesMulti = coordinatesMulti
    }

    enum CodingKeys: String, CodingKey { case type, coordinates }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = (try? c.decode(String.self, forKey: .type)) ?? "Polygon"
        if type == "MultiPolygon" {
            coordinatesMulti = try? c.decode([[[[Double]]]].self, forKey: .coordinates)
            coordinates = nil
        } else {
            coordinates = try? c.decode([[[Double]]].self, forKey: .coordinates)
            coordinatesMulti = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(type, forKey: .type)
        if let coordinatesMulti { try c.encode(coordinatesMulti, forKey: .coordinates) }
        else if let coordinates { try c.encode(coordinates, forKey: .coordinates) }
    }

    var polygons: [MKPolygon] {
        if type == "MultiPolygon", let multi = coordinatesMulti {
            return multi.compactMap { ringSet in
                guard let outer = ringSet.first else { return nil }
                return polygon(from: outer)
            }
        }
        if let rings = coordinates, let outer = rings.first {
            if let poly = polygon(from: outer) { return [poly] }
        }
        return []
    }

    private func polygon(from ring: [[Double]]) -> MKPolygon? {
        let coords = ring.compactMap { pair -> CLLocationCoordinate2D? in
            guard pair.count >= 2 else { return nil }
            return CLLocationCoordinate2D(latitude: pair[1], longitude: pair[0])
        }
        guard coords.count >= 3 else { return nil }
        return MKPolygon(coordinates: coords, count: coords.count)
    }
}

// MARK: - Layers sheet

struct LayersSheetView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage(AppSettings.Keys.showTerritories) private var showTerritories = true
    @AppStorage(AppSettings.Keys.showWeather) private var showWeather = false
    @AppStorage(AppSettings.Keys.showRoofAge) private var showRoofAge = false
    @AppStorage(AppSettings.Keys.myPinsOnly) private var myPinsOnly = false
    @AppStorage(AppSettings.Keys.mapStyle) private var mapStyleRaw = MapStyleSetting.hybrid.rawValue

    let weatherAvailable: Bool

    var body: some View {
        NavigationView {
            List {
                Section("Map Layers") {
                    Toggle("Territories", isOn: $showTerritories)
                    if weatherAvailable {
                        Toggle("Weather (hail/wind)", isOn: $showWeather)
                    }
                    Toggle("Roof age (est.)", isOn: $showRoofAge)
                    Toggle("My pins only", isOn: $myPinsOnly)
                }
                Section("Map Style") {
                    Picker("Style", selection: $mapStyleRaw) {
                        ForEach(MapStyleSetting.allCases) { style in
                            Text(style.label).tag(style.rawValue)
                        }
                    }
                    .pickerStyle(.segmented)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Layers")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

// MARK: - Address search

struct AddressSearchSheet: View {
    @Environment(\.dismiss) private var dismiss
    let region: MKCoordinateRegion
    let onSelect: (CLLocationCoordinate2D) -> Void

    @State private var query = ""
    @StateObject private var completer = AddressSearchCompleter()

    var body: some View {
        NavigationView {
            List {
                ForEach(completer.results, id: \.self) { result in
                    Button {
                        completer.resolve(result) { coord in
                            if let coord { onSelect(coord) }
                            dismiss()
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(result.title)
                                .foregroundColor(AppSettings.darkText)
                            if !result.subtitle.isEmpty {
                                Text(result.subtitle)
                                    .font(.caption)
                                    .foregroundColor(AppSettings.darkText.opacity(0.7))
                            }
                        }
                    }
                }
            }
            .searchable(text: $query, prompt: "Search address")
            .onChange(of: query) { completer.update(query: $0, region: region) }
            .navigationTitle("Search")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .onAppear { completer.update(query: query, region: region) }
    }
}

@MainActor
final class AddressSearchCompleter: NSObject, ObservableObject, MKLocalSearchCompleterDelegate {
    @Published var results: [MKLocalSearchCompletion] = []
    private let completer = MKLocalSearchCompleter()

    override init() {
        super.init()
        completer.delegate = self
        completer.resultTypes = .address
    }

    func update(query: String, region: MKCoordinateRegion) {
        completer.queryFragment = query
        completer.region = region
    }

    func resolve(_ completion: MKLocalSearchCompletion, handler: @escaping (CLLocationCoordinate2D?) -> Void) {
        let request = MKLocalSearch.Request(completion: completion)
        MKLocalSearch(request: request).start { response, _ in
            DispatchQueue.main.async {
                handler(response?.mapItems.first?.placemark.coordinate)
            }
        }
    }

    nonisolated func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
        Task { @MainActor in
            self.results = completer.results
        }
    }

    nonisolated func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
        Task { @MainActor in self.results = [] }
    }
}

// MARK: - Geometry helpers

enum TerritoryGeometry {
    static func pointInPolygon(_ point: CLLocationCoordinate2D, polygon: MKPolygon) -> Bool {
        let renderer = MKPolygonRenderer(polygon: polygon)
        let mapPoint = MKMapPoint(point)
        let cgPoint = renderer.point(for: mapPoint)
        return renderer.path.contains(cgPoint)
    }

    static func pinsInside(territory: Territory, pins: [CanvassPin]) -> Int {
        let polys = territory.boundary_geojson.polygons
        guard !polys.isEmpty else { return 0 }
        return pins.filter { pin in
            let coord = CLLocationCoordinate2D(latitude: pin.lat, longitude: pin.lng)
            return polys.contains { pointInPolygon(coord, polygon: $0) }
        }.count
    }
}

// MARK: - Nav Bar settings (Phase 4)

struct NavBarSettingsView: View {
    @AppStorage(AppSettings.Keys.tabBarConfig) private var tabBarConfigRaw = ""
    @State private var config = TabBarConfig.default

    var body: some View {
        List {
            Section("Tab Order & Visibility") {
                ForEach(config.order.indices, id: \.self) { idx in
                    let entry = config.order[idx]
                    if let tab = AppTab(rawValue: entry.tab) {
                        HStack {
                            Image(systemName: tab.systemImage)
                            Text(tab.title)
                            Spacer()
                            if tab == .dashboard || tab == .canvass {
                                Text("Required").font(.caption).foregroundColor(.secondary)
                            } else {
                                Toggle("", isOn: bindingForVisible(idx))
                                    .labelsHidden()
                            }
                        }
                    }
                }
                .onMove { from, to in config.order.move(fromOffsets: from, toOffset: to) }
            }
            Section {
                Text("Dashboard and Canvass are always available. Opportunities and Measure follow your role permissions.")
                    .font(.caption)
                    .foregroundColor(AppSettings.darkText.opacity(0.75))
            }
        }
        .navigationTitle("Nav Bar")
        .toolbar { EditButton() }
        .onAppear { config = TabBarConfig.load(from: tabBarConfigRaw) }
        .onDisappear { tabBarConfigRaw = config.saveRaw() }
    }

    private func bindingForVisible(_ idx: Int) -> Binding<Bool> {
        Binding(
            get: { config.order[idx].visible },
            set: { config.order[idx].visible = $0 }
        )
    }
}

extension APIClient {
    static func fetchTerritories() async throws -> [Territory] {
        struct Response: Decodable { let territories: [Territory] }
        let data = try await request(path: "/api/mobile/territories")
        return try JSONDecoder().decode(Response.self, from: data).territories
    }
}
