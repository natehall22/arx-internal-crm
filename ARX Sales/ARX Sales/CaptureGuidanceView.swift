import SwiftUI
import Combine
import ARKit
import SceneKit

// MARK: - Capture Guidance View
// Hover-style guided walk-around scan. Prompts the user through
// each position, builds LiDAR mesh in real time, then hands off
// to ModelReviewView when the scan is complete.

struct CaptureGuidanceView: View {
    let scanType: ScanType
    var address: String = ""
    var opportunityId: String? = nil
    let onComplete: (ScanResult) -> Void

    @StateObject private var vm = CaptureGuidanceVM()
    @State private var showReview = false
    @State private var scanResult: ScanResult? = nil
    @Environment(\.dismiss) private var dismiss

    var positions: [CapturePosition] {
        scanType == .roof ? CapturePosition.roofPositions : CapturePosition.sidingPositions
    }

    var body: some View {
        ZStack {
            // Live AR camera with mesh overlay
            CaptureARView(vm: vm)
                .ignoresSafeArea()

            // Mesh quality overlay
            meshOverlay

            // Top bar
            topBar

            // Bottom guidance panel
            VStack {
                Spacer()
                bottomPanel
            }
        }
        .fullScreenCover(isPresented: $showReview) {
            if let result = scanResult {
                ModelReviewView(
                    scanResult: result,
                    scanType: scanType,
                    address: address,
                    opportunityId: opportunityId
                ) { finalResult in
                    onComplete(finalResult)
                    showReview = false
                }
            }
        }
    }

    // MARK: - Top Bar

    private var topBar: some View {
        VStack {
            HStack {
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(12)
                        .background(.ultraThinMaterial)
                        .clipShape(Circle())
                }
                Spacer()
                VStack(spacing: 2) {
                    Text(scanType == .roof ? "Roof Scan" : "Siding Scan")
                        .font(.subheadline.weight(.semibold)).foregroundColor(.white)
                    Text("\(vm.completedCount)/\(positions.count) positions")
                        .font(.caption2).foregroundColor(.white.opacity(0.8))
                }
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(.ultraThinMaterial).cornerRadius(20)
                Spacer()
                // Mesh coverage badge
                MeshBadge(coverage: vm.meshCoverage)
            }
            .padding(.horizontal, 16).padding(.top, 56)
            Spacer()
        }
    }

    // MARK: - Mesh Overlay (wireframe tint)

    private var meshOverlay: some View {
        // Visual feedback — color shifts as mesh improves
        Color.blue
            .opacity(vm.meshCoverage < 0.3 ? 0.05 : 0)
            .ignoresSafeArea()
            .allowsHitTesting(false)
    }

    // MARK: - Bottom Panel

    private var bottomPanel: some View {
        VStack(spacing: 0) {
            // Position progress strip
            positionStrip
                .padding(.bottom, 16)

            // Current instruction
            if let current = positions.first(where: { !vm.completedPositions.contains($0.id) }) {
                VStack(spacing: 8) {
                    Text(current.label.uppercased())
                        .font(.caption.weight(.bold))
                        .foregroundColor(.blue)
                        .tracking(1.5)
                    Text(current.instruction)
                        .font(.subheadline).foregroundColor(.white)
                        .multilineTextAlignment(.center)
                }
                .padding(.bottom, 16)
            } else {
                Text("Great coverage! Review your scan below.")
                    .font(.subheadline).foregroundColor(.white)
                    .padding(.bottom, 16)
            }

            // Action buttons
            HStack(spacing: 16) {
                // Mark current position complete
                if vm.completedCount < positions.count {
                    Button {
                        if let current = positions.first(where: { !vm.completedPositions.contains($0.id) }) {
                            vm.markComplete(positionId: current.id)
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        }
                    } label: {
                        Label("Got it", systemImage: "checkmark")
                            .font(.body.weight(.semibold))
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(Color.blue)
                            .cornerRadius(14)
                    }
                }

                // Done — go to review
                if vm.completedCount >= 2 {  // at least 2 positions for a valid scan
                    Button {
                        processScan()
                    } label: {
                        Group {
                            if vm.isProcessing {
                                HStack(spacing: 8) {
                                    ProgressView().tint(.white)
                                    Text("Processing…")
                                }
                            } else {
                                Label("Review Scan", systemImage: "arrow.right")
                            }
                        }
                        .font(.body.weight(.semibold))
                        .foregroundColor(vm.isProcessing ? .white.opacity(0.7) : .black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(vm.isProcessing ? Color.gray : Color.white)
                        .cornerRadius(14)
                    }
                    .disabled(vm.isProcessing)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
        }
        .background(.ultraThinMaterial)
        .cornerRadius(24, corners: [.topLeft, .topRight])
    }

    // MARK: - Position Strip

    private var positionStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(positions) { pos in
                    let isDone = vm.completedPositions.contains(pos.id)
                    let isCurrent = !isDone && positions.first(where: { !vm.completedPositions.contains($0.id) })?.id == pos.id
                    VStack(spacing: 4) {
                        ZStack {
                            Circle()
                                .fill(isDone ? Color.blue : isCurrent ? Color.white : Color.white.opacity(0.2))
                                .frame(width: 36, height: 36)
                            if isDone {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundColor(.white)
                            } else {
                                Text("\(pos.id + 1)")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundColor(isCurrent ? .black : .white.opacity(0.6))
                            }
                        }
                        Text(pos.label)
                            .font(.caption2)
                            .foregroundColor(isDone ? .white : isCurrent ? .white : .white.opacity(0.5))
                            .lineLimit(1)
                    }
                    .frame(width: 56)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
        }
    }

    // MARK: - Process Scan

    private func processScan() {
        vm.isProcessing = true
        // Snapshot the anchors on the main actor (via the lock-guarded accessor)
        // before crossing to the background queue, rather than reading
        // `vm.collectedAnchors` from inside the background closure — see
        // `CaptureGuidanceVM.snapshotAnchors()` for why that was an unsynchronized
        // cross-thread race.
        let anchors = vm.snapshotAnchors()
        DispatchQueue.global(qos: .userInitiated).async {
            let processor = MeshProcessor()
            let result = processor.process(anchors: anchors, scanType: scanType)
            DispatchQueue.main.async {
                vm.isProcessing = false
                scanResult = result
                showReview = true
            }
        }
    }
}

// MARK: - Mesh Badge

struct MeshBadge: View {
    let coverage: Double
    var color: Color { coverage < 0.3 ? .red : coverage < 0.7 ? .yellow : .green }
    var label: String { coverage < 0.3 ? "Scanning" : coverage < 0.7 ? "Good" : "Ready" }
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).font(.caption.weight(.medium)).foregroundColor(.white)
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(.ultraThinMaterial).cornerRadius(20)
    }
}

// MARK: - Capture Guidance ViewModel

class CaptureGuidanceVM: NSObject, ObservableObject, ARSessionDelegate {
    @Published var completedPositions: Set<Int> = []
    @Published var meshCoverage: Double = 0.0
    @Published var isProcessing = false

    // `_collectedAnchors` is written from ARSessionDelegate callbacks below, which
    // ARKit fires on its own internal session thread — not the main thread —
    // regardless of this type's default MainActor isolation
    // (SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor). It was previously read directly
    // from `processScan()`'s `DispatchQueue.global` closure, an unsynchronized
    // cross-thread read/write on the array. `anchorsLock` guards both sides, and
    // `snapshotAnchors()` is the only way to read it, so a lock can't be forgotten
    // at a new call site.
    private var _collectedAnchors: [ARMeshAnchor] = []
    private let anchorsLock = NSLock()

    weak var arSession: ARSession?

    var completedCount: Int { completedPositions.count }

    func markComplete(positionId: Int) {
        completedPositions.insert(positionId)
    }

    /// Thread-safe snapshot of the most recent mesh anchors. Safe to call from any thread.
    func snapshotAnchors() -> [ARMeshAnchor] {
        anchorsLock.lock()
        defer { anchorsLock.unlock() }
        return _collectedAnchors
    }

    func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
        updateAnchors(session)
    }

    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        updateAnchors(session)
    }

    private func updateAnchors(_ session: ARSession) {
        let meshAnchors = session.currentFrame?.anchors.compactMap { $0 as? ARMeshAnchor } ?? []
        anchorsLock.lock()
        _collectedAnchors = meshAnchors
        anchorsLock.unlock()
        let coverage = min(Double(meshAnchors.count) / 30.0, 1.0)
        DispatchQueue.main.async { self.meshCoverage = coverage }
    }
}

// MARK: - Capture AR View (UIViewRepresentable)

struct CaptureARView: UIViewRepresentable {
    @ObservedObject var vm: CaptureGuidanceVM

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView()
        view.delegate = context.coordinator
        view.scene = SCNScene()
        view.autoenablesDefaultLighting = true
        view.session.delegate = vm

        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal, .vertical]
        if ARWorldTrackingConfiguration.isSupported {
            config.worldAlignment = .gravityAndHeading
        }
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
            config.sceneReconstruction = .mesh
        }
        view.session.run(config)
        vm.arSession = view.session
        return view
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator() }

    class Coordinator: NSObject, ARSCNViewDelegate {
        // Render LiDAR mesh as blue wireframe
        func renderer(_ renderer: SCNSceneRenderer, nodeFor anchor: ARAnchor) -> SCNNode? {
            guard let mesh = anchor as? ARMeshAnchor else { return nil }
            return meshNode(from: mesh)
        }
        func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
            guard let mesh = anchor as? ARMeshAnchor else { return }
            node.geometry = meshNode(from: mesh)?.geometry
        }
        private func meshNode(from anchor: ARMeshAnchor) -> SCNNode? {
            let geo = buildGeometry(from: anchor)
            geo.firstMaterial?.fillMode = .lines
            geo.firstMaterial?.diffuse.contents = UIColor.systemBlue.withAlphaComponent(0.5)
            let node = SCNNode(geometry: geo)
            return node
        }
        private func buildGeometry(from anchor: ARMeshAnchor) -> SCNGeometry {
            let v = anchor.geometry.vertices
            let f = anchor.geometry.faces
            let src = SCNGeometrySource(buffer: v.buffer, vertexFormat: .float3,
                                         semantic: .vertex, vertexCount: v.count,
                                         dataOffset: v.offset, dataStride: v.stride)
            let data = Data(bytes: f.buffer.contents(), count: f.buffer.length)
            let elem = SCNGeometryElement(data: data, primitiveType: .triangles,
                                          primitiveCount: f.count, bytesPerIndex: f.bytesPerIndex)
            return SCNGeometry(sources: [src], elements: [elem])
        }
    }
}

// MARK: - Corner Radius Helper

extension View {
    func cornerRadius(_ radius: CGFloat, corners: UIRectCorner) -> some View {
        clipShape(RoundedCornerShape(radius: radius, corners: corners))
    }
}

struct RoundedCornerShape: Shape {
    var radius: CGFloat
    var corners: UIRectCorner
    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(roundedRect: rect, byRoundingCorners: corners,
                                cornerRadii: CGSize(width: radius, height: radius))
        return Path(path.cgPath)
    }
}
