import SwiftUI
import RoomPlan
import ARKit
import SceneKit
import MapKit

// MARK: - Scan Mode Selector

struct ARScanView: View {
    let onComplete: (MeasurementSession) -> Void
    @State private var mode: ScanMode? = nil
    @Environment(\.dismiss) private var dismiss

    enum ScanMode { case roomPlan, arTap, overhead }

    var body: some View {
        Group {
            if let mode {
                switch mode {
                case .roomPlan: RoomPlanScanView(onComplete: onComplete)
                case .arTap:    ARTapMeasureView(onComplete: onComplete)
                case .overhead: OverheadSketchView(onComplete: onComplete)
                }
            } else {
                modePicker
            }
        }
    }

    // MARK: Mode Picker

    private var modePicker: some View {
        NavigationView {
            List {
                if RoomCaptureSession.isSupported {
                    Section {
                        Button { mode = .roomPlan } label: {
                            ModeRow(
                                icon: "lidar.scanner",
                                iconColor: .blue,
                                title: "LiDAR Room Scan",
                                subtitle: "Walk through / around the structure. Apple's guided scan builds a live 3D model and detects all surfaces automatically.",
                                badge: "Pro · Most Accurate"
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }

                Section {
                    Button { mode = .arTap } label: {
                        ModeRow(
                            icon: "camera.metering.spot",
                            iconColor: .purple,
                            title: "AR Tap-to-Measure",
                            subtitle: "Point at the structure and tap to place measurement points. Works on all iPhones.",
                            badge: "All devices"
                        )
                    }
                    .buttonStyle(.plain)

                    Button { mode = .overhead } label: {
                        ModeRow(
                            icon: "map",
                            iconColor: .green,
                            title: "Satellite Overhead Sketch",
                            subtitle: "Draw the roof outline on satellite imagery. Best when you're not on site.",
                            badge: "No camera needed"
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Choose Scan Method")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

// MARK: - Mode Row

struct ModeRow: View {
    let icon: String
    let iconColor: Color
    let title: String
    let subtitle: String
    let badge: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(iconColor.opacity(0.12))
                    .frame(width: 48, height: 48)
                Image(systemName: icon)
                    .font(.system(size: 22))
                    .foregroundColor(iconColor)
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(title).font(.subheadline).fontWeight(.semibold)
                    Spacer()
                    Text(badge)
                        .font(.caption2).fontWeight(.medium)
                        .foregroundColor(iconColor)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(iconColor.opacity(0.1))
                        .cornerRadius(8)
                }
                Text(subtitle)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 6)
    }
}

// MARK: - ① RoomPlan Scan (LiDAR + Apple's guided scan UI)

struct RoomPlanScanView: UIViewControllerRepresentable {
    let onComplete: (MeasurementSession) -> Void

    func makeUIViewController(context: Context) -> RoomPlanViewController {
        RoomPlanViewController(onComplete: onComplete)
    }
    func updateUIViewController(_ vc: RoomPlanViewController, context: Context) {}
}

class RoomPlanViewController: UIViewController, RoomCaptureSessionDelegate, RoomCaptureViewDelegate {
    let onComplete: (MeasurementSession) -> Void
    private var captureView: RoomCaptureView!
    private var pitchRise = 6

    init(onComplete: @escaping (MeasurementSession) -> Void) {
        self.onComplete = onComplete
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        captureView = RoomCaptureView(frame: view.bounds)
        captureView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        captureView.captureSession.delegate = self
        captureView.delegate = self
        view.addSubview(captureView)

        // Done button overlay
        let doneBtn = UIButton(type: .system)
        doneBtn.setTitle("Done Scanning", for: .normal)
        doneBtn.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        doneBtn.backgroundColor = UIColor.systemBlue
        doneBtn.setTitleColor(.white, for: .normal)
        doneBtn.layer.cornerRadius = 14
        doneBtn.addTarget(self, action: #selector(stopScan), for: .touchUpInside)
        doneBtn.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(doneBtn)
        NSLayoutConstraint.activate([
            doneBtn.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            doneBtn.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            doneBtn.widthAnchor.constraint(equalToConstant: 200),
            doneBtn.heightAnchor.constraint(equalToConstant: 50),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        captureView.captureSession.run(configuration: RoomCaptureSession.Configuration())
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        captureView.captureSession.stop()
    }

    @objc private func stopScan() {
        captureView.captureSession.stop()
    }

    // Called when scan completes — process CapturedRoom into measurements
    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        return true
    }

    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        guard error == nil else { return }
        let session = buildSession(from: processedResult)
        DispatchQueue.main.async { self.onComplete(session) }
    }

    private func buildSession(from room: CapturedRoom) -> MeasurementSession {
        var segments: [MeasurementSegment] = []

        // Floor surfaces → roof footprint proxy
        for (i, floor) in room.floors.enumerated() {
            let w = Double(floor.dimensions.x) * 3.28084  // m → ft
            let l = Double(floor.dimensions.z) * 3.28084
            segments.append(MeasurementSegment(
                label: "Section \(i + 1)",
                lengthFeet: l,
                widthFeet: w,
                isArea: true
            ))
        }

        // Walls → linear measurements
        for (i, wall) in room.walls.enumerated() {
            let len = Double(wall.dimensions.x) * 3.28084
            segments.append(MeasurementSegment(
                label: "Wall \(i + 1)",
                lengthFeet: len,
                widthFeet: 0,
                isArea: false
            ))
        }

        return MeasurementSession(
            address: "",
            segments: segments,
            usedLiDAR: true,
            pitchRise: pitchRise
        )
    }
}

// MARK: - ② AR Tap-to-Measure (all devices)

struct ARTapMeasureView: View {
    let onComplete: (MeasurementSession) -> Void
    @StateObject private var session = ARTapSession()
    @State private var showPitchPicker = false
    @State private var showSaveSheet = false
    @State private var jobAddress = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            ARSceneView(session: session).ignoresSafeArea()

            // Crosshair
            Image(systemName: "plus")
                .font(.system(size: 20, weight: .ultraLight))
                .foregroundColor(.white).shadow(radius: 2)

            // Top bar
            VStack {
                HStack {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(.white).padding(12)
                            .background(.ultraThinMaterial).clipShape(Circle())
                    }
                    Spacer()
                    Text("AR Measure")
                        .font(.subheadline).fontWeight(.semibold)
                        .foregroundColor(.white)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(.ultraThinMaterial).cornerRadius(20)
                    Spacer()
                    Button { session.undoLast() } label: {
                        Image(systemName: "arrow.uturn.backward")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(.white).padding(12)
                            .background(.ultraThinMaterial).clipShape(Circle())
                    }
                    .opacity(session.points.isEmpty ? 0.3 : 1)
                    .disabled(session.points.isEmpty)
                }
                .padding(.horizontal, 16).padding(.top, 56)
                Spacer()
            }

            // Bottom HUD
            VStack {
                Spacer()
                if !session.segments.isEmpty {
                    MeasurementHUD(session: session, showPitchPicker: $showPitchPicker)
                        .padding(.horizontal, 16).padding(.bottom, 8)
                }
                VStack(spacing: 12) {
                    Text(session.instructionText)
                        .font(.subheadline).foregroundColor(.white)
                        .multilineTextAlignment(.center).padding(.horizontal, 24)
                    HStack(spacing: 16) {
                        Button { session.placePoint() } label: {
                            Circle().fill(Color.white).frame(width: 70, height: 70)
                                .overlay(
                                    Image(systemName: session.isFirstPoint ? "scope" : "record.circle")
                                        .font(.system(size: 28)).foregroundColor(.blue)
                                )
                                .shadow(radius: 6)
                        }
                        if session.canFinish {
                            Button { showSaveSheet = true } label: {
                                Text("Done")
                                    .fontWeight(.semibold).foregroundColor(.white)
                                    .padding(.horizontal, 28).padding(.vertical, 14)
                                    .background(Color.blue).cornerRadius(30).shadow(radius: 4)
                            }
                        }
                    }
                }
                .padding(.bottom, 40)
            }
        }
        .sheet(isPresented: $showPitchPicker) {
            PitchPickerSheet(selectedRise: $session.pitchRise).presentationDetents([.medium])
        }
        .sheet(isPresented: $showSaveSheet) {
            SaveMeasurementSheet(session: session, address: $jobAddress) {
                onComplete(session.buildResult(address: jobAddress))
            }
            .presentationDetents([.medium])
        }
    }
}

// MARK: - ③ Satellite Overhead Sketch

struct OverheadSketchView: View {
    let onComplete: (MeasurementSession) -> Void
    @StateObject private var vm = OverheadSketchVM()
    @State private var showPitchPicker = false
    @State private var showSaveSheet = false
    @State private var jobAddress = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            // Satellite map with drawing overlay
            OverheadMapView(vm: vm)
                .ignoresSafeArea()

            // Top bar
            VStack {
                HStack {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(.white).padding(12)
                            .background(.ultraThinMaterial).clipShape(Circle())
                    }
                    Spacer()
                    Text("Overhead Sketch")
                        .font(.subheadline).fontWeight(.semibold)
                        .foregroundColor(.white)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(.ultraThinMaterial).cornerRadius(20)
                    Spacer()
                    Button { vm.undoLast() } label: {
                        Image(systemName: "arrow.uturn.backward")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(.white).padding(12)
                            .background(.ultraThinMaterial).clipShape(Circle())
                    }
                    .opacity(vm.polygonPoints.isEmpty ? 0.3 : 1)
                    .disabled(vm.polygonPoints.isEmpty)
                }
                .padding(.horizontal, 16).padding(.top, 56)
                Spacer()
            }

            // Bottom HUD
            VStack {
                Spacer()
                if vm.areaFt2 > 0 {
                    HStack(spacing: 20) {
                        VStack(spacing: 2) {
                            Text("AREA").font(.caption2).fontWeight(.semibold).foregroundColor(.secondary)
                            Text("\(Int(vm.areaFt2)) ft²")
                                .font(.system(size: 22, weight: .bold, design: .rounded))
                        }
                        Divider().frame(height: 36)
                        Button { showPitchPicker = true } label: {
                            VStack(spacing: 2) {
                                Text("PITCH").font(.caption2).fontWeight(.semibold).foregroundColor(.secondary)
                                HStack(spacing: 4) {
                                    Text("\(vm.pitchRise)/12")
                                        .font(.system(size: 22, weight: .bold, design: .rounded))
                                    Image(systemName: "chevron.up.chevron.down")
                                        .font(.caption).foregroundColor(.blue)
                                }
                            }
                        }
                        Divider().frame(height: 36)
                        VStack(spacing: 2) {
                            Text("SQUARES").font(.caption2).fontWeight(.semibold).foregroundColor(.secondary)
                            Text(String(format: "%.1f", vm.squares))
                                .font(.system(size: 22, weight: .bold, design: .rounded))
                        }
                    }
                    .padding(14).background(.ultraThinMaterial).cornerRadius(16)
                    .padding(.horizontal, 16).padding(.bottom, 8)
                }
                HStack(spacing: 16) {
                    Text(vm.polygonPoints.isEmpty ? "Tap to place roof outline points" : "Keep tapping corners, then tap Done")
                        .font(.subheadline).foregroundColor(.white)
                        .multilineTextAlignment(.center)
                    if vm.areaFt2 > 0 {
                        Button { showSaveSheet = true } label: {
                            Text("Done")
                                .fontWeight(.semibold).foregroundColor(.white)
                                .padding(.horizontal, 24).padding(.vertical, 12)
                                .background(Color.blue).cornerRadius(24)
                        }
                    }
                }
                .padding(.bottom, 40)
            }
        }
        .sheet(isPresented: $showPitchPicker) {
            PitchPickerSheet(selectedRise: $vm.pitchRise).presentationDetents([.medium])
        }
        .sheet(isPresented: $showSaveSheet) {
            SaveMeasurementSheet(overheadVM: vm, address: $jobAddress) {
                onComplete(vm.buildResult(address: jobAddress))
            }
            .presentationDetents([.medium])
        }
    }
}

// MARK: - Overhead Map View

struct OverheadMapView: UIViewRepresentable {
    @ObservedObject var vm: OverheadSketchVM

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.mapType = .satelliteFlyover
        map.showsUserLocation = true
        map.isUserInteractionEnabled = true
        map.delegate = context.coordinator

        // Center on user location if available
        if let loc = context.coordinator.lastLocation {
            map.setRegion(MKCoordinateRegion(center: loc, latitudinalMeters: 100, longitudinalMeters: 100), animated: false)
        }

        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        map.addGestureRecognizer(tap)
        context.coordinator.map = map
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        // Redraw polygon overlay
        map.removeOverlays(map.overlays)
        if vm.polygonPoints.count >= 3 {
            let poly = MKPolygon(coordinates: vm.polygonPoints, count: vm.polygonPoints.count)
            map.addOverlay(poly)
        }
        if vm.polygonPoints.count >= 2 {
            let line = MKPolyline(coordinates: vm.polygonPoints, count: vm.polygonPoints.count)
            map.addOverlay(line)
        }
        // Annotation pins for each vertex
        map.removeAnnotations(map.annotations.filter { !($0 is MKUserLocation) })
        for coord in vm.polygonPoints {
            let ann = MKPointAnnotation()
            ann.coordinate = coord
            map.addAnnotation(ann)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(vm: vm) }

    class Coordinator: NSObject, MKMapViewDelegate, CLLocationManagerDelegate {
        let vm: OverheadSketchVM
        weak var map: MKMapView?
        var lastLocation: CLLocationCoordinate2D?
        private let lm = CLLocationManager()

        init(vm: OverheadSketchVM) {
            self.vm = vm
            super.init()
            lm.delegate = self
            lm.requestWhenInUseAuthorization()
            lm.startUpdatingLocation()
        }

        func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
            guard let loc = locations.last else { return }
            lastLocation = loc.coordinate
            if let map, vm.polygonPoints.isEmpty {
                map.setRegion(MKCoordinateRegion(center: loc.coordinate, latitudinalMeters: 80, longitudinalMeters: 80), animated: true)
            }
            lm.stopUpdatingLocation()
        }

        @objc func handleTap(_ gr: UITapGestureRecognizer) {
            guard let map = gr.view as? MKMapView else { return }
            let coord = map.convert(gr.location(in: map), toCoordinateFrom: map)
            vm.addPoint(coord)
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }

        func mapView(_ map: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let poly = overlay as? MKPolygon {
                let r = MKPolygonRenderer(polygon: poly)
                r.fillColor = UIColor.systemBlue.withAlphaComponent(0.15)
                r.strokeColor = UIColor.systemBlue.withAlphaComponent(0.6)
                r.lineWidth = 2
                return r
            }
            if let line = overlay as? MKPolyline {
                let r = MKPolylineRenderer(polyline: line)
                r.strokeColor = UIColor.systemBlue
                r.lineWidth = 2
                r.lineDashPattern = [6, 4]
                return r
            }
            return MKOverlayRenderer(overlay: overlay)
        }

        func mapView(_ map: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            guard !(annotation is MKUserLocation) else { return nil }
            let v = MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: "vertex")
            v.markerTintColor = .systemBlue
            v.glyphImage = UIImage(systemName: "circle.fill")
            v.canShowCallout = false
            return v
        }
    }
}

// MARK: - Overhead Sketch ViewModel

class OverheadSketchVM: ObservableObject {
    @Published var polygonPoints: [CLLocationCoordinate2D] = []
    @Published var pitchRise: Int = 6

    var pitchMultiplier: Double {
        let r = Double(pitchRise)
        return sqrt(1 + (r / 12) * (r / 12))
    }

    // Shoelace formula in meters → sq ft
    var areaM2: Double {
        guard polygonPoints.count >= 3 else { return 0 }
        var area = 0.0
        let n = polygonPoints.count
        for i in 0..<n {
            let j = (i + 1) % n
            let xi = polygonPoints[i].longitude * cos(polygonPoints[i].latitude * .pi / 180) * 111_320
            let yi = polygonPoints[i].latitude * 110_540
            let xj = polygonPoints[j].longitude * cos(polygonPoints[j].latitude * .pi / 180) * 111_320
            let yj = polygonPoints[j].latitude * 110_540
            area += xi * yj - xj * yi
        }
        return abs(area) / 2.0
    }

    var areaFt2: Double { areaM2 * 10.7639 * pitchMultiplier }
    var squares: Double { areaFt2 / 100.0 }

    func addPoint(_ coord: CLLocationCoordinate2D) {
        polygonPoints.append(coord)
    }

    func undoLast() {
        guard !polygonPoints.isEmpty else { return }
        polygonPoints.removeLast()
    }

    func buildResult(address: String) -> MeasurementSession {
        let seg = MeasurementSegment(
            label: "Roof Outline",
            lengthFeet: sqrt(areaFt2),
            widthFeet: sqrt(areaFt2),
            isArea: true
        )
        return MeasurementSession(address: address, segments: [seg], usedLiDAR: false, pitchRise: pitchRise)
    }
}

// MARK: - Shared: AR Tap Session

class ARTapSession: NSObject, ObservableObject {
    @Published var points: [SCNVector3] = []
    @Published var segments: [ARSegment] = []
    @Published var pitchRise: Int = 6
    weak var sceneView: ARSCNView?
    private var pointNodes: [SCNNode] = []
    private var lineNodes: [SCNNode] = []

    var hasLiDAR: Bool { ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) }
    var isFirstPoint: Bool { points.isEmpty }
    var canFinish: Bool { !segments.isEmpty }

    var pitchMultiplier: Double {
        let r = Double(pitchRise); return sqrt(1 + (r/12)*(r/12))
    }
    var totalFootprintSqFt: Double { segments.filter(\.isArea).reduce(0) { $0 + $1.areaFt2 } }
    var totalRoofArea: Double { totalFootprintSqFt * pitchMultiplier }
    var totalSquares: Double { totalRoofArea / 100.0 }

    var instructionText: String {
        if points.isEmpty { return "Tap to place the first measurement point" }
        if points.count == 1 { return "Tap the opposite corner to complete a measurement" }
        return "Tap to add more, or tap Done"
    }

    func startSession() {
        guard let view = sceneView else { return }
        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal, .vertical]
        if hasLiDAR { config.sceneReconstruction = .mesh }
        view.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    }

    func placePoint() {
        guard let view = sceneView else { return }
        placePointAt(screenPoint: CGPoint(x: view.bounds.midX, y: view.bounds.midY))
    }

    func placePointAt(screenPoint: CGPoint) {
        guard let view = sceneView else { return }
        var worldPos: SCNVector3?

        let hits = view.hitTest(screenPoint, types: [.existingPlaneUsingExtent, .estimatedHorizontalPlane, .featurePoint])
        if let hit = hits.first {
            let t = hit.worldTransform
            worldPos = SCNVector3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        }
        guard let pos = worldPos else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()

        let sphere = SCNSphere(radius: 0.015)
        sphere.firstMaterial?.diffuse.contents = UIColor.systemBlue
        let node = SCNNode(geometry: sphere)
        node.position = pos
        view.scene.rootNode.addChildNode(node)
        pointNodes.append(node); points.append(pos)

        if points.count >= 2 && points.count % 2 == 0 {
            let a = points[points.count-2]; let b = points[points.count-1]
            let dist = simd_distance(simd_float3(a.x,a.y,a.z), simd_float3(b.x,b.y,b.z))
            let ft = Double(dist) * 3.28084
            let lineNode = makeLine(from: a, to: b)
            view.scene.rootNode.addChildNode(lineNode); lineNodes.append(lineNode)
            segments.append(ARSegment(label: "Section \(segments.count+1)", lengthFeet: ft, widthFeet: ft, isArea: true))
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        }
    }

    func undoLast() {
        guard !points.isEmpty else { return }
        pointNodes.last?.removeFromParentNode(); pointNodes.removeLast(); points.removeLast()
        if points.count % 2 == 0 && !segments.isEmpty {
            lineNodes.last?.removeFromParentNode(); lineNodes.removeLast(); segments.removeLast()
        }
    }

    func buildResult(address: String) -> MeasurementSession {
        let segs = segments.map { MeasurementSegment(label: $0.label, lengthFeet: $0.lengthFeet, widthFeet: $0.widthFeet, isArea: $0.isArea) }
        return MeasurementSession(address: address, segments: segs, usedLiDAR: hasLiDAR, pitchRise: pitchRise)
    }

    private func makeLine(from a: SCNVector3, to b: SCNVector3) -> SCNNode {
        let dx=b.x-a.x; let dy=b.y-a.y; let dz=b.z-a.z
        let dist=sqrt(dx*dx+dy*dy+dz*dz)
        let cyl=SCNCylinder(radius:0.005, height:CGFloat(dist))
        cyl.firstMaterial?.diffuse.contents=UIColor.systemBlue
        let node=SCNNode(geometry:cyl)
        node.position=SCNVector3((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2)
        node.look(at: b, up: sceneView?.scene.rootNode.worldUp ?? SCNVector3(0,1,0), localFront: SCNVector3(0,1,0))
        return node
    }
}

// MARK: - AR Scene View

struct ARSceneView: UIViewRepresentable {
    @ObservedObject var session: ARTapSession
    func makeUIView(context: Context) -> ARSCNView {
        let v = ARSCNView()
        v.delegate = context.coordinator
        v.scene = SCNScene()
        v.autoenablesDefaultLighting = true
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        v.addGestureRecognizer(tap)
        session.sceneView = v
        session.startSession()
        return v
    }
    func updateUIView(_ v: ARSCNView, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(session: session) }

    class Coordinator: NSObject, ARSCNViewDelegate {
        let session: ARTapSession
        init(session: ARTapSession) { self.session = session }
        @objc func handleTap(_ gr: UITapGestureRecognizer) {
            session.placePointAt(screenPoint: gr.location(in: session.sceneView))
        }
    }
}

// MARK: - Shared Controls

struct MeasurementHUD: View {
    @ObservedObject var session: ARTapSession
    @Binding var showPitchPicker: Bool
    var body: some View {
        HStack(spacing: 12) {
            statCell(label: "AREA", value: "\(Int(session.totalFootprintSqFt)) ft²")
            Divider().frame(height: 36)
            statCell(label: "SQUARES", value: String(format: "%.1f", session.totalSquares))
            Divider().frame(height: 36)
            Button { showPitchPicker = true } label: {
                HStack(spacing: 4) {
                    statCell(label: "PITCH", value: "\(session.pitchRise)/12")
                    Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundColor(.blue)
                }
            }
        }
        .padding(14).background(.ultraThinMaterial).cornerRadius(16)
    }
    private func statCell(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption2).fontWeight(.semibold).foregroundColor(.secondary)
            Text(value).font(.system(size: 20, weight: .bold, design: .rounded))
        }.frame(maxWidth: .infinity)
    }
}

struct PitchPickerSheet: View {
    @Binding var selectedRise: Int
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationView {
            List(Array(0...18), id: \.self) { rise in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(rise)/12 pitch").fontWeight(selectedRise == rise ? .semibold : .regular)
                        Text(pitchLabel(rise)).font(.caption).foregroundColor(.secondary)
                    }
                    Spacer()
                    if selectedRise == rise { Image(systemName: "checkmark").foregroundColor(.blue) }
                }
                .contentShape(Rectangle())
                .onTapGesture { selectedRise = rise; dismiss() }
            }
            .navigationTitle("Select Pitch").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
    private func pitchLabel(_ r: Int) -> String {
        switch r {
        case 0...2: return "Flat / low slope"
        case 3...5: return "Low pitch"
        case 6...9: return "Standard pitch"
        case 10...12: return "Steep pitch"
        default: return "Very steep"
        }
    }
}

struct SaveMeasurementSheet: View {
    var session: ARTapSession? = nil
    var overheadVM: OverheadSketchVM? = nil
    @Binding var address: String
    let onSave: () -> Void
    @Environment(\.dismiss) private var dismiss

    var area: Double   { session?.totalRoofArea   ?? overheadVM?.areaFt2 ?? 0 }
    var squares: Double { session?.totalSquares    ?? overheadVM?.squares ?? 0 }
    var pitch: Int     { session?.pitchRise        ?? overheadVM?.pitchRise ?? 6 }
    var method: String { session != nil ? (session!.hasLiDAR ? "LiDAR" : "AR Tap") : "Overhead Sketch" }

    var body: some View {
        NavigationView {
            Form {
                Section("Job Address (optional)") {
                    TextField("123 Main St", text: $address).textContentType(.fullStreetAddress)
                }
                Section("Results") {
                    LabeledContent("Roof Area",  value: "\(Int(area)) ft²")
                    LabeledContent("Squares",    value: String(format: "%.2f", squares))
                    LabeledContent("Pitch",      value: "\(pitch)/12")
                    LabeledContent("Method",     value: method)
                }
                Section {
                    Button { onSave(); dismiss() } label: {
                        Text("Save Measurement").fontWeight(.semibold).frame(maxWidth: .infinity).foregroundColor(.white)
                    }
                    .listRowBackground(Color.blue)
                }
            }
            .navigationTitle("Save").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

// MARK: - AR Segment

struct ARSegment: Identifiable {
    let id = UUID()
    var label: String
    var lengthFeet: Double
    var widthFeet: Double
    var isArea: Bool
    var areaFt2: Double { isArea ? lengthFeet * widthFeet : 0 }
}
