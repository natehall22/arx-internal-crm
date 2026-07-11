import SwiftUI
import Combine
import ARKit

// MARK: - Main Measure Tab

struct MeasureView: View {
    @StateObject private var vm = MeasureViewModel()
    @State private var activeScan: ScanType? = nil

    var body: some View {
        NavigationView {
            Group {
                if vm.scanResults.isEmpty && vm.savedMeasurements.isEmpty {
                    emptyState
                } else {
                    scanList
                }
            }
            .navigationTitle("Measure")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button { activeScan = .roof } label: {
                            Label("New Roof Scan", systemImage: "house.fill")
                        }
                        Button { activeScan = .siding } label: {
                            Label("New Siding Scan", systemImage: "square.split.2x1.fill")
                        }
                    } label: { Image(systemName: "plus") }
                }
            }
            .fullScreenCover(item: $activeScan, onDismiss: {
                activeScan = nil
            }) { type in
                CaptureGuidanceView(scanType: type) { result in
                    vm.scanResults.insert(result, at: 0)
                    activeScan = nil
                    Task { await vm.fetchSaved() }
                }
            }
            .onAppear { Task { await vm.fetchSaved() } }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Color.clear.frame(height: AppSettings.floatingTabContentInset)
            }
        }
    }

    // MARK: - Scan List

    private var scanList: some View {
        List {
            // In-session scans — have full 3D data, can re-open review
            if !vm.scanResults.isEmpty {
                Section("This Session") {
                    ForEach(vm.scanResults.indices, id: \.self) { i in
                        let result = vm.scanResults[i]
                        let type: ScanType = result.roofFaces.isEmpty ? .siding : .roof
                        NavigationLink(destination:
                            ModelReviewView(scanResult: result, scanType: type) { updated in
                                vm.scanResults[i] = updated
                            }
                        ) {
                            ScanResultRow(result: result)
                        }
                    }
                    .onDelete { vm.scanResults.remove(atOffsets: $0) }
                }
            }

            // Saved measurements fetched from the CRM
            if vm.isLoadingSaved {
                Section {
                    HStack {
                        ProgressView()
                        Text("Loading saved measurements…")
                            .font(.subheadline).foregroundColor(.secondary)
                    }
                }
            } else if !vm.savedMeasurements.isEmpty {
                Section("Saved") {
                    ForEach(vm.savedMeasurements) { m in
                        SavedMeasurementRow(measurement: m)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await vm.fetchSaved() }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 28) {
            Spacer()

            ZStack {
                Circle().fill(Color.blue.opacity(0.1)).frame(width: 110, height: 110)
                Image(systemName: hasLiDAR ? "lidar.scanner" : "camera.metering.matrix")
                    .font(.system(size: 48)).foregroundColor(.blue)
            }

            VStack(spacing: 10) {
                Text(hasLiDAR ? "LiDAR Roof & Siding Scanner" : "AR Measurement")
                    .font(.title2.weight(.bold))
                Text("Walk around the structure — your phone builds a live 3D model, auto-detects roof facets with pitch angles and wall elevations for siding quotes.")
                    .font(.subheadline).foregroundColor(.secondary)
                    .multilineTextAlignment(.center).padding(.horizontal, 32)
                if hasLiDAR {
                    Label("LiDAR active — Pro accuracy", systemImage: "checkmark.seal.fill")
                        .font(.caption).foregroundColor(.green)
                }
            }

            VStack(spacing: 12) {
                Button { activeScan = .roof } label: {
                    Label("Start Roof Scan", systemImage: "house.fill")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity).padding()
                        .background(Color.blue).foregroundColor(.white).cornerRadius(14)
                }
                Button { activeScan = .siding } label: {
                    Label("Start Siding Scan", systemImage: "square.split.2x1.fill")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity).padding()
                        .background(Color(.secondarySystemBackground))
                        .foregroundColor(.primary).cornerRadius(14)
                }
            }
            .padding(.horizontal, 32)

            Spacer()
        }
    }

    private var hasLiDAR: Bool {
        ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
    }
}

// MARK: - Scan Result Row

struct ScanResultRow: View {
    let result: ScanResult
    var scanType: ScanType { result.roofFaces.isEmpty ? .siding : .roof }
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Label(scanType == .roof ? "Roof" : "Siding",
                      systemImage: scanType == .roof ? "house.fill" : "square.split.2x1.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(scanType == .roof ? .blue : .purple)
                Spacer()
                Text(result.scanDate, style: .date)
                    .font(.caption).foregroundColor(.secondary)
            }
            Text(result.address.isEmpty ? "No address" : result.address)
                .font(.subheadline.weight(.medium))
            HStack(spacing: 14) {
                if scanType == .roof {
                    Label(String(format: "%.2f sq", result.totalRoofSquares), systemImage: "square.grid.2x2")
                    Label("\(Int(result.totalRoofSqFt)) ft²", systemImage: "ruler")
                    Label("\(result.roofFaces.count) faces", systemImage: "triangle")
                } else {
                    Label(String(format: "%.2f sq", result.totalSidingSquares), systemImage: "square.grid.2x2")
                    Label("\(Int(result.totalSidingSqFt)) ft²", systemImage: "ruler")
                    Label("\(result.wallFaces.count) walls", systemImage: "rectangle.portrait")
                }
                if result.usedLiDAR {
                    Label("LiDAR", systemImage: "lidar.scanner").foregroundColor(.blue)
                }
            }
            .font(.caption).foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Saved measurement list date (Supabase often returns fractional seconds)

enum MeasurementListDateParsing {
    private static let withFractionalSeconds: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let dateTime: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func parse(_ string: String) -> Date? {
        if let d = withFractionalSeconds.date(from: string) { return d }
        return dateTime.date(from: string)
    }
}

// MARK: - Saved Measurement Row (API-backed)

struct SavedMeasurementRow: View {
    let measurement: SavedMeasurement
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                let isRoof = measurement.scanTypeLabel == "Roof"
                Label(measurement.scanTypeLabel,
                      systemImage: isRoof ? "house.fill" : "square.split.2x1.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(isRoof ? .blue : .purple)
                Spacer()
                if let dateStr = measurement.created_at,
                   let date = MeasurementListDateParsing.parse(dateStr) {
                    Text(date, style: .date)
                        .font(.caption).foregroundColor(.secondary)
                }
            }
            Text(measurement.address_text ?? "No address")
                .font(.subheadline.weight(.medium))
            HStack(spacing: 14) {
                if let sq = measurement.total_squares {
                    Label(String(format: "%.2f sq", sq), systemImage: "square.grid.2x2")
                }
                if let area = measurement.total_area_sqft {
                    Label("\(Int(area)) ft²", systemImage: "ruler")
                }
                if let faces = measurement.facet_count, faces > 0 {
                    Label("\(faces) faces", systemImage: "triangle")
                }
                if measurement.usedLiDAR {
                    Label("LiDAR", systemImage: "lidar.scanner").foregroundColor(.blue)
                }
            }
            .font(.caption).foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - ViewModel

@MainActor
class MeasureViewModel: ObservableObject {
    // In-session scans (have full 3D data for review)
    @Published var scanResults: [ScanResult] = []
    // Persisted scans fetched from the CRM API
    @Published var savedMeasurements: [SavedMeasurement] = []
    @Published var isLoadingSaved = false

    func fetchSaved() async {
        isLoadingSaved = true
        defer { isLoadingSaved = false }
        let result = try? await APIClient.measurementList()
        savedMeasurements = result ?? []
    }
}

// MARK: - ScanType: Identifiable (for fullScreenCover)

extension ScanType: Identifiable {
    public var id: String { rawValue }
}
