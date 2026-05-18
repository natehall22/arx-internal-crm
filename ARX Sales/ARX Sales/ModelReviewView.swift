import SwiftUI
import SceneKit

// MARK: - Model Review View
// Shows the processed scan as a 3D SceneKit model.
// Faces are color-coded by type/pitch. Tap a face to select it,
// view its measurements, and optionally edit it.

struct ModelReviewView: View {
    @State var scanResult: ScanResult
    let scanType: ScanType
    let onComplete: (ScanResult) -> Void

    @State private var selectedRoofFace: RoofFace? = nil
    @State private var selectedWallFace: WallFace? = nil
    @State private var showFaceEdit = false
    @State private var showSaveSheet = false
    @State private var jobAddress = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                // Top bar
                HStack {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(.white).padding(12)
                            .background(.ultraThinMaterial).clipShape(Circle())
                    }
                    Spacer()
                    Text(scanType == .roof ? "Roof Review" : "Siding Review")
                        .font(.subheadline).fontWeight(.semibold).foregroundColor(.white)
                    Spacer()
                    Button { showSaveSheet = true } label: {
                        Text("Save")
                            .fontWeight(.semibold).foregroundColor(.black)
                            .padding(.horizontal, 16).padding(.vertical, 8)
                            .background(Color.white).cornerRadius(20)
                    }
                }
                .padding(.horizontal, 16).padding(.top, 56).padding(.bottom, 12)

                // 3D Model
                SceneModelView(
                    scanResult: scanResult,
                    scanType: scanType,
                    onSelectRoof: { face in
                        selectedRoofFace = face
                        selectedWallFace = nil
                    },
                    onSelectWall: { face in
                        selectedWallFace = face
                        selectedRoofFace = nil
                    }
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                // Legend
                legendBar

                // Selected face detail
                if let face = selectedRoofFace {
                    RoofFaceDetailSheet(face: face, onEdit: { showFaceEdit = true })
                        .transition(.move(edge: .bottom))
                } else if let face = selectedWallFace {
                    WallFaceDetailSheet(face: face, onEdit: { showFaceEdit = true })
                        .transition(.move(edge: .bottom))
                } else {
                    summaryBar
                }
            }
        }
        .sheet(isPresented: $showFaceEdit) {
            if let face = selectedRoofFace {
                FaceEditView(roofFace: face) { updated in
                    if let i = scanResult.roofFaces.firstIndex(where: { $0.id == updated.id }) {
                        scanResult.roofFaces[i] = updated
                    }
                    selectedRoofFace = updated
                }
            } else if let face = selectedWallFace {
                FaceEditView(wallFace: face) { updated in
                    if let i = scanResult.wallFaces.firstIndex(where: { $0.id == updated.id }) {
                        scanResult.wallFaces[i] = updated
                    }
                    selectedWallFace = updated
                }
            }
        }
        .sheet(isPresented: $showSaveSheet) {
            SaveScanSheet(scanResult: scanResult, scanType: scanType, address: $jobAddress) {
                var result = scanResult
                result.address = jobAddress
                onComplete(result)
            }
            .presentationDetents([.medium])
        }
    }

    // MARK: - Legend

    private var legendBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                if scanType == .roof {
                    ForEach([FaceColor.pitch0_3, .pitch4_6, .pitch7_9, .pitch10up], id: \.label) { color in
                        HStack(spacing: 5) {
                            Circle().fill(Color(color.uiColor)).frame(width: 10, height: 10)
                            Text(color.label).font(.caption2).foregroundColor(.white.opacity(0.8))
                        }
                    }
                } else {
                    HStack(spacing: 5) {
                        Circle().fill(Color(FaceColor.wall.uiColor)).frame(width: 10, height: 10)
                        Text("Wall face").font(.caption2).foregroundColor(.white.opacity(0.8))
                    }
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.vertical, 8)
    }

    // MARK: - Summary Bar

    private var summaryBar: some View {
        HStack(spacing: 0) {
            if scanType == .roof {
                summaryCell(label: "FACES",   value: "\(scanResult.roofFaces.count)")
                summaryCell(label: "AREA",    value: "\(Int(scanResult.totalRoofSqFt)) ft²")
                summaryCell(label: "SQUARES", value: String(format: "%.2f", scanResult.totalRoofSquares))
            } else {
                summaryCell(label: "WALLS",   value: "\(scanResult.wallFaces.count)")
                summaryCell(label: "GROSS",   value: "\(Int(scanResult.totalSidingSqFt)) ft²")
                summaryCell(label: "SQUARES", value: String(format: "%.2f", scanResult.totalSidingSquares))
            }
        }
        .padding(.vertical, 16)
        .background(.ultraThinMaterial)
    }

    private func summaryCell(label: String, value: String) -> some View {
        VStack(spacing: 4) {
            Text(label).font(.caption2).fontWeight(.semibold).foregroundColor(.secondary)
            Text(value).font(.system(size: 20, weight: .bold, design: .rounded)).foregroundColor(.white)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Scene Model View

struct SceneModelView: UIViewRepresentable {
    let scanResult: ScanResult
    let scanType: ScanType
    let onSelectRoof: (RoofFace) -> Void
    let onSelectWall: (WallFace) -> Void

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.scene = buildScene()
        view.allowsCameraControl = true
        view.backgroundColor = UIColor(white: 0.05, alpha: 1)
        view.autoenablesDefaultLighting = true
        view.antialiasingMode = .multisampling4X

        let tap = UITapGestureRecognizer(target: context.coordinator,
                                          action: #selector(Coordinator.handleTap(_:)))
        view.addGestureRecognizer(tap)
        context.coordinator.scnView = view
        context.coordinator.scanResult = scanResult
        return view
    }

    func updateUIView(_ uiView: SCNView, context: Context) {
        uiView.scene = buildScene()
        context.coordinator.scanResult = scanResult
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onSelectRoof: onSelectRoof, onSelectWall: onSelectWall)
    }

    // Build the SceneKit scene from scan result
    private func buildScene() -> SCNScene {
        let scene = SCNScene()
        let root = scene.rootNode

        if scanType == .roof {
            for (i, face) in scanResult.roofFaces.enumerated() {
                let node = buildFaceNode(vertices: face.vertices, color: face.color.uiColor)
                node.name = "roof_\(i)"
                root.addChildNode(node)
            }
        } else {
            for (i, face) in scanResult.wallFaces.enumerated() {
                let node = buildFaceNode(vertices: face.vertices, color: face.color.uiColor)
                node.name = "wall_\(i)"
                root.addChildNode(node)
            }
        }

        // Add a reference grid
        let grid = SCNFloor()
        grid.firstMaterial?.diffuse.contents = UIColor.darkGray.withAlphaComponent(0.3)
        grid.firstMaterial?.isDoubleSided = true
        let gridNode = SCNNode(geometry: grid)
        gridNode.position.y = scanResult.roofFaces.first?.vertices.first?.y ?? 0
        root.addChildNode(gridNode)

        return scene
    }

    private func buildFaceNode(vertices: [SIMD3<Float>], color: UIColor) -> SCNNode {
        guard vertices.count >= 3 else { return SCNNode() }

        var scnVertices: [SCNVector3] = vertices.map { SCNVector3($0.x, $0.y, $0.z) }
        var indices: [Int32] = []
        for i in stride(from: 0, to: vertices.count - 2, by: 3) {
            indices.append(contentsOf: [Int32(i), Int32(i+1), Int32(i+2)])
        }

        let src = SCNGeometrySource(vertices: scnVertices)
        let elem = SCNGeometryElement(indices: indices, primitiveType: .triangles)
        let geo = SCNGeometry(sources: [src], elements: [elem])
        let mat = SCNMaterial()
        mat.diffuse.contents = color
        mat.isDoubleSided = true
        mat.transparency = 0.75
        geo.materials = [mat]

        return SCNNode(geometry: geo)
    }

    // MARK: - Tap Coordinator

    class Coordinator: NSObject {
        let onSelectRoof: (RoofFace) -> Void
        let onSelectWall: (WallFace) -> Void
        var scnView: SCNView?
        var scanResult: ScanResult?

        init(onSelectRoof: @escaping (RoofFace) -> Void, onSelectWall: @escaping (WallFace) -> Void) {
            self.onSelectRoof = onSelectRoof
            self.onSelectWall = onSelectWall
        }

        @objc func handleTap(_ gr: UITapGestureRecognizer) {
            guard let view = scnView, let result = scanResult else { return }
            let pt = gr.location(in: view)
            let hits = view.hitTest(pt, options: [.searchMode: SCNHitTestSearchMode.closest.rawValue])
            guard let hit = hits.first, let name = hit.node.name else { return }

            UIImpactFeedbackGenerator(style: .light).impactOccurred()

            if name.hasPrefix("roof_"), let i = Int(name.dropFirst(5)), i < result.roofFaces.count {
                onSelectRoof(result.roofFaces[i])
            } else if name.hasPrefix("wall_"), let i = Int(name.dropFirst(5)), i < result.wallFaces.count {
                onSelectWall(result.wallFaces[i])
            }
        }
    }
}

// MARK: - Roof Face Detail Sheet

struct RoofFaceDetailSheet: View {
    let face: RoofFace
    let onEdit: () -> Void
    var body: some View {
        VStack(spacing: 0) {
            Capsule().fill(Color.white.opacity(0.3)).frame(width: 40, height: 4).padding(.top, 8)
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(face.label).font(.headline).foregroundColor(.white)
                    Text("Tap Edit to adjust boundaries or override pitch")
                        .font(.caption).foregroundColor(.white.opacity(0.6))
                }
                Spacer()
                Button { onEdit() } label: {
                    Text("Edit").fontWeight(.semibold).foregroundColor(.black)
                        .padding(.horizontal, 16).padding(.vertical, 8)
                        .background(Color.white).cornerRadius(20)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            HStack(spacing: 0) {
                detailCell(label: "PITCH", value: "\(face.pitchRise)/12")
                detailCell(label: "AREA",  value: "\(Int(face.areaSqFt)) ft²")
                detailCell(label: "SQUARES", value: String(format: "%.2f", face.areaSqFt/100))
                detailCell(label: "FACING", value: compassShort(face.azimuthDegrees))
            }
            .padding(.bottom, 16)
        }
        .background(.ultraThinMaterial)
    }
    private func detailCell(label: String, value: String) -> some View {
        VStack(spacing: 4) {
            Text(label).font(.caption2).fontWeight(.semibold).foregroundColor(.secondary)
            Text(value).font(.system(size: 18, weight: .bold, design: .rounded)).foregroundColor(.white)
        }.frame(maxWidth: .infinity)
    }
    private func compassShort(_ deg: Double) -> String {
        switch deg {
        case 315...360, 0..<45:  return "N"
        case 45..<135:           return "E"
        case 135..<225:          return "S"
        default:                 return "W"
        }
    }
}

// MARK: - Wall Face Detail Sheet

struct WallFaceDetailSheet: View {
    let face: WallFace
    let onEdit: () -> Void
    var body: some View {
        VStack(spacing: 0) {
            Capsule().fill(Color.white.opacity(0.3)).frame(width: 40, height: 4).padding(.top, 8)
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(face.label).font(.headline).foregroundColor(.white)
                    Text("\(face.openings.count) opening\(face.openings.count == 1 ? "" : "s") subtracted")
                        .font(.caption).foregroundColor(.white.opacity(0.6))
                }
                Spacer()
                Button { onEdit() } label: {
                    Text("Edit").fontWeight(.semibold).foregroundColor(.black)
                        .padding(.horizontal, 16).padding(.vertical, 8)
                        .background(Color.white).cornerRadius(20)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            HStack(spacing: 0) {
                detailCell(label: "GROSS",   value: "\(Int(face.areaSqFt)) ft²")
                detailCell(label: "OPENINGS", value: "\(Int(face.areaSqFt - face.netAreaSqFt)) ft²")
                detailCell(label: "NET",     value: "\(Int(face.netAreaSqFt)) ft²")
                detailCell(label: "SQUARES", value: String(format: "%.2f", face.netAreaSqFt/100))
            }
            .padding(.bottom, 16)
        }
        .background(.ultraThinMaterial)
    }
    private func detailCell(label: String, value: String) -> some View {
        VStack(spacing: 4) {
            Text(label).font(.caption2).fontWeight(.semibold).foregroundColor(.secondary)
            Text(value).font(.system(size: 18, weight: .bold, design: .rounded)).foregroundColor(.white)
        }.frame(maxWidth: .infinity)
    }
}

// MARK: - Save Scan Sheet

struct SaveScanSheet: View {
    let scanResult: ScanResult
    let scanType: ScanType
    @Binding var address: String
    let onSave: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var isSaving = false
    @State private var saveError: String? = nil

    var body: some View {
        NavigationView {
            Form {
                Section("Job Address") {
                    TextField("123 Main St", text: $address).textContentType(.fullStreetAddress)
                }
                Section("Results") {
                    if scanType == .roof {
                        LabeledContent("Faces Detected", value: "\(scanResult.roofFaces.count)")
                        LabeledContent("Total Roof Area", value: "\(Int(scanResult.totalRoofSqFt)) ft²")
                        LabeledContent("Squares", value: String(format: "%.2f", scanResult.totalRoofSquares))
                    } else {
                        LabeledContent("Walls Detected", value: "\(scanResult.wallFaces.count)")
                        LabeledContent("Net Siding Area", value: "\(Int(scanResult.totalSidingSqFt)) ft²")
                        LabeledContent("Squares", value: String(format: "%.2f", scanResult.totalSidingSquares))
                    }
                    LabeledContent("Method", value: scanResult.usedLiDAR ? "LiDAR Scan" : "AR Scan")
                }
                if let error = saveError {
                    Section {
                        Text(error).foregroundColor(.red).font(.caption)
                    }
                }
                Section {
                    Button {
                        Task { await save() }
                    } label: {
                        if isSaving {
                            HStack(spacing: 8) {
                                ProgressView().tint(.white)
                                Text("Saving…")
                            }
                            .frame(maxWidth: .infinity)
                        } else {
                            Text("Save Measurement")
                                .fontWeight(.semibold).frame(maxWidth: .infinity).foregroundColor(.white)
                        }
                    }
                    .disabled(isSaving || address.isEmpty)
                    .listRowBackground(isSaving ? Color.gray : Color.blue)
                }
            }
            .navigationTitle("Save").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func save() async {
        isSaving = true
        saveError = nil
        var result = scanResult
        result.address = address
        let payload = SaveMeasurementRequest(scanResult: result, scanType: scanType, address: address)
        do {
            _ = try await APIClient.saveMeasurement(payload)
            onSave()
            dismiss()
        } catch {
            saveError = error.localizedDescription
        }
        isSaving = false
    }
}
