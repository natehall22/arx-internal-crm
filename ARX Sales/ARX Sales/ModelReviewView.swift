import SwiftUI
import SceneKit

// MARK: - Model Review View
// Shows the processed scan as a 3D SceneKit model.
// Faces are color-coded by type/pitch. Tap a face to select it,
// view its measurements, and optionally edit it.

struct ModelReviewView: View {
    @State var scanResult: ScanResult
    let scanType: ScanType
    let opportunityId: String?   // opportunity to link the measurement to (nil = standalone)
    let onComplete: (ScanResult) -> Void

    @State private var selectedRoofFace: RoofFace? = nil
    @State private var selectedWallFace: WallFace? = nil
    @State private var showFaceEdit = false
    @State private var showSaveSheet = false
    @State private var showDeleteConfirm = false
    @State private var jobAddress: String
    @Environment(\.dismiss) private var dismiss

    /// Designated init — seeds jobAddress from the caller's context (lead address or empty).
    init(scanResult: ScanResult,
         scanType: ScanType,
         address: String = "",
         opportunityId: String? = nil,
         onComplete: @escaping (ScanResult) -> Void) {
        _scanResult       = State(initialValue: scanResult)
        _jobAddress       = State(initialValue: address)
        self.scanType     = scanType
        self.opportunityId = opportunityId
        self.onComplete   = onComplete
    }

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
                        .font(.subheadline.weight(.semibold)).foregroundColor(.white)
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
                    RoofFaceDetailSheet(face: face, onEdit: { showFaceEdit = true },
                                        onDelete: { showDeleteConfirm = true })
                        .transition(.move(edge: .bottom))
                } else if let face = selectedWallFace {
                    WallFaceDetailSheet(face: bindingForWall(face), onEdit: { showFaceEdit = true },
                                        onDelete: { showDeleteConfirm = true })
                        .transition(.move(edge: .bottom))
                } else {
                    summaryBar
                }
            }
        }
        .confirmationDialog(
            "Delete this face?",
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { deleteSelectedFace() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Use this to remove a facet the scan merged or split incorrectly — common on complex roofs. This can't be undone; re-scan to get it back.")
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
            SaveScanSheet(scanResult: scanResult, scanType: scanType,
                          address: $jobAddress, opportunityId: opportunityId) {
                var result = scanResult
                result.address = jobAddress
                onComplete(result)
            }
            .mediumSheetPresentation()
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
            Text(label).font(.caption2.weight(.semibold)).foregroundColor(.secondary)
            Text(value).font(.system(size: 20, weight: .bold, design: .rounded)).foregroundColor(.white)
        }
        .frame(maxWidth: .infinity)
    }

    private func deleteSelectedFace() {
        if let face = selectedRoofFace {
            scanResult.roofFaces.removeAll { $0.id == face.id }
            selectedRoofFace = nil
        } else if let face = selectedWallFace {
            scanResult.wallFaces.removeAll { $0.id == face.id }
            selectedWallFace = nil
        }
    }

    private func bindingForWall(_ face: WallFace) -> Binding<WallFace> {
        Binding(
            get: { scanResult.wallFaces.first(where: { $0.id == face.id }) ?? face },
            set: { updated in
                if let i = scanResult.wallFaces.firstIndex(where: { $0.id == updated.id }) {
                    scanResult.wallFaces[i] = updated
                    selectedWallFace = updated
                }
            }
        )
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
        let (scene, cameraNode) = buildScene()
        view.scene = scene
        view.pointOfView = cameraNode
        view.allowsCameraControl = true
        view.backgroundColor = UIColor(white: 0.10, alpha: 1)
        view.autoenablesDefaultLighting = false   // we add our own lights in buildScene
        view.antialiasingMode = .multisampling4X

        let tap = UITapGestureRecognizer(target: context.coordinator,
                                          action: #selector(Coordinator.handleTap(_:)))
        view.addGestureRecognizer(tap)
        context.coordinator.scnView = view
        context.coordinator.scanResult = scanResult
        context.coordinator.sceneGeometrySignature = Self.sceneGeometrySignature(
            scanResult: scanResult, scanType: scanType
        )
        return view
    }

    func updateUIView(_ uiView: SCNView, context: Context) {
        context.coordinator.scanResult = scanResult
        let signature = Self.sceneGeometrySignature(scanResult: scanResult, scanType: scanType)
        guard context.coordinator.sceneGeometrySignature != signature else { return }
        context.coordinator.sceneGeometrySignature = signature
        let (scene, cameraNode) = buildScene()
        uiView.scene = scene
        uiView.pointOfView = cameraNode
    }

    /// Changes when face ids, vertex counts, or areas change — not on selection/sheet toggles alone.
    private static func sceneGeometrySignature(scanResult: ScanResult, scanType: ScanType) -> String {
        switch scanType {
        case .roof:
            return scanResult.roofFaces
                .map { "\($0.id.uuidString):\($0.vertices.count):\($0.areaSqFt)" }
                .joined(separator: "|")
        case .siding:
            return scanResult.wallFaces
                .map { "\($0.id.uuidString):\($0.vertices.count):\($0.areaSqFt)" }
                .joined(separator: "|")
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onSelectRoof: onSelectRoof, onSelectWall: onSelectWall)
    }

    // Build the SceneKit scene from scan result; returns scene + camera node for pointOfView.
    private func buildScene() -> (SCNScene, SCNNode) {
        let scene = SCNScene()
        let root = scene.rootNode

        var displayVerts: [SIMD3<Float>] = []

        if scanType == .roof {
            for (i, face) in scanResult.roofFaces.enumerated() {
                let node = buildFaceNode(vertices: face.vertices, color: face.color.uiColor)
                node.name = "roof_\(i)"
                root.addChildNode(node)
                displayVerts.append(contentsOf: face.vertices)
            }
        } else {
            for (i, face) in scanResult.wallFaces.enumerated() {
                let node = buildFaceNode(vertices: face.vertices, color: face.color.uiColor)
                node.name = "wall_\(i)"
                root.addChildNode(node)
                displayVerts.append(contentsOf: face.vertices)
            }
        }

        // Add a reference grid
        let grid = SCNFloor()
        grid.firstMaterial?.diffuse.contents = UIColor(white: 0.15, alpha: 1)
        grid.firstMaterial?.isDoubleSided = true
        let gridNode = SCNNode(geometry: grid)
        let lowestY = displayVerts.map { $0.y }.min() ?? 0
        gridNode.position.y = lowestY - 0.1
        root.addChildNode(gridNode)

        // Lighting — ambient fill + directional key light for 3-D shading
        let ambient = SCNLight()
        ambient.type = .ambient
        ambient.intensity = 600
        ambient.color = UIColor(white: 1.0, alpha: 1)
        let ambientNode = SCNNode()
        ambientNode.light = ambient
        root.addChildNode(ambientNode)

        let key = SCNLight()
        key.type = .directional
        key.intensity = 800
        key.color = UIColor(white: 1.0, alpha: 1)
        key.castsShadow = false
        let keyNode = SCNNode()
        keyNode.light = key
        keyNode.eulerAngles = SCNVector3(-Float.pi / 4, Float.pi / 4, 0)
        root.addChildNode(keyNode)

        let cameraNode = frameCamera(on: root, vertices: displayVerts)
        return (scene, cameraNode)
    }

    /// Place a camera that frames all mesh vertices (LiDAR coords are far from SceneKit origin).
    private func frameCamera(on root: SCNNode, vertices: [SIMD3<Float>]) -> SCNNode {
        let cameraNode = SCNNode()
        cameraNode.name = "review_camera"
        let cam = SCNCamera()
        cam.automaticallyAdjustsZRange = true
        cameraNode.camera = cam

        guard !vertices.isEmpty else {
            cameraNode.position = SCNVector3(0, 1.5, 4)
            root.addChildNode(cameraNode)
            return cameraNode
        }

        var minV = vertices[0]
        var maxV = vertices[0]
        for v in vertices {
            minV = simd_min(minV, v)
            maxV = simd_max(maxV, v)
        }
        let center = (minV + maxV) * 0.5
        let extent = maxV - minV
        let maxExtent = max(extent.x, max(extent.y, extent.z))
        let diagonal = simd_length(extent)
        let radius = max(maxExtent * 0.5, diagonal * 0.5)
        let distance = max(radius * 1.8, 0.5)

        cam.zNear = 0.001
        cam.zFar = Double(distance * 20)

        // One-shot aim (no LookAtConstraint) so allowsCameraControl can orbit freely.
        let viewDir = normalize(SIMD3<Float>(0.35, 0.25, 1.0))
        cameraNode.position = SCNVector3(
            center.x + viewDir.x * distance,
            center.y + viewDir.y * distance,
            center.z + viewDir.z * distance
        )
        cameraNode.look(at: SCNVector3(center.x, center.y, center.z))
        root.addChildNode(cameraNode)
        return cameraNode
    }

    private func buildFaceNode(vertices: [SIMD3<Float>], color: UIColor) -> SCNNode {
        guard vertices.count >= 3 else { return SCNNode() }

        let scnVertices: [SCNVector3] = vertices.map { SCNVector3($0.x, $0.y, $0.z) }
        var indices: [Int32] = []
        for i in stride(from: 0, to: vertices.count - 2, by: 3) {
            indices.append(contentsOf: [Int32(i), Int32(i+1), Int32(i+2)])
        }

        let src = SCNGeometrySource(vertices: scnVertices)
        let elem = SCNGeometryElement(indices: indices, primitiveType: .triangles)
        let geo = SCNGeometry(sources: [src], elements: [elem])
        let mat = SCNMaterial()
        mat.diffuse.contents = color
        mat.specular.contents = UIColor(white: 0.3, alpha: 1)   // subtle specular highlight
        mat.shininess = 0.25
        mat.isDoubleSided = true
        mat.lightingModel = .phong
        mat.transparency = 0.0   // fully opaque — 0 = opaque in SceneKit
        geo.materials = [mat]

        return SCNNode(geometry: geo)
    }

    // MARK: - Tap Coordinator

    class Coordinator: NSObject {
        let onSelectRoof: (RoofFace) -> Void
        let onSelectWall: (WallFace) -> Void
        var scnView: SCNView?
        var scanResult: ScanResult?
        var sceneGeometrySignature: String?

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
    let onDelete: () -> Void
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
                Button { onDelete() } label: {
                    Image(systemName: "trash")
                        .foregroundColor(.white)
                        .padding(8)
                        .background(.ultraThinMaterial).clipShape(Circle())
                }
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
            Text(label).font(.caption2.weight(.semibold)).foregroundColor(.secondary)
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
    @Binding var face: WallFace
    let onEdit: () -> Void
    let onDelete: () -> Void
    var body: some View {
        VStack(spacing: 0) {
            Capsule().fill(Color.white.opacity(0.3)).frame(width: 40, height: 4).padding(.top, 8)
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(face.label).font(.headline).foregroundColor(.white)
                    Text("Assign elevation for CRM upload")
                        .font(.caption).foregroundColor(.white.opacity(0.6))
                }
                Spacer()
                Button { onDelete() } label: {
                    Image(systemName: "trash")
                        .foregroundColor(.white)
                        .padding(8)
                        .background(.ultraThinMaterial).clipShape(Circle())
                }
                Button { onEdit() } label: {
                    Text("Edit").fontWeight(.semibold).foregroundColor(.black)
                        .padding(.horizontal, 16).padding(.vertical, 8)
                        .background(Color.white).cornerRadius(20)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 8)

            Picker("Elevation", selection: $face.elevationName) {
                ForEach(AppSettings.elevationNames, id: \.self) { name in
                    Text(name).tag(name)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .onChange(of: face.elevationName) { face.label = "\($0) Wall" }

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
            Text(label).font(.caption2.weight(.semibold)).foregroundColor(.secondary)
            Text(value).font(.system(size: 18, weight: .bold, design: .rounded)).foregroundColor(.white)
        }.frame(maxWidth: .infinity)
    }
}

// MARK: - Save Scan Sheet

struct SaveScanSheet: View {
    let scanResult: ScanResult
    let scanType: ScanType
    @Binding var address: String
    let opportunityId: String?
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
                        FormValueRow(label: "Faces Detected", value: "\(scanResult.roofFaces.count)")
                        FormValueRow(label: "Total Roof Area", value: "\(Int(scanResult.totalRoofSqFt)) ft²")
                        FormValueRow(label: "Squares", value: String(format: "%.2f", scanResult.totalRoofSquares))
                    } else {
                        FormValueRow(label: "Walls Detected", value: "\(scanResult.wallFaces.count)")
                        FormValueRow(label: "Net Siding Area", value: "\(Int(scanResult.totalSidingSqFt)) ft²")
                        FormValueRow(label: "Squares", value: String(format: "%.2f", scanResult.totalSidingSquares))
                    }
                    FormValueRow(label: "Method", value: scanResult.usedLiDAR ? "LiDAR Scan" : "AR Scan")
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
        do {
            // Siding scans linked to an opportunity use the dedicated LiDAR elevation endpoint.
            // Roof scans (and standalone scans) always use the generic measurements route.
            if scanType == .siding, let oppId = opportunityId {
                try await APIClient.postLidarMeasure(opportunityId: oppId,
                                                     wallFaces: result.wallFaces)
            } else {
                let payload = SaveMeasurementRequest(scanResult: result, scanType: scanType,
                                                     address: address, opportunityId: opportunityId)
                _ = try await APIClient.saveMeasurement(payload)
            }
            onSave()
            dismiss()
        } catch {
            saveError = error.localizedDescription
        }
        isSaving = false
    }
}
