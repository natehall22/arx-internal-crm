import Foundation
import simd
import ARKit

// MARK: - Scan Type

enum ScanType: String, Codable {
    case roof   = "roof"
    case siding = "siding"
}

// MARK: - Face Classification

enum FaceClass {
    case roof   // normal.y > 0.5  (upward-facing)
    case wall   // |normal.y| < 0.3 (mostly vertical)
    case ground // normal.y < -0.5 (downward, ignore)
    case other
}

// MARK: - Roof Face

struct RoofFace: Identifiable {
    let id: UUID
    var vertices: [SIMD3<Float>]  // world-space triangle vertices
    var normal: SIMD3<Float>      // averaged world-space normal
    var areaSqFt: Double
    var pitchRise: Int            // X in X/12
    var pitchDegrees: Double
    var azimuthDegrees: Double    // compass direction the slope faces
    var isSelected: Bool = false
    var label: String             // "Front Slope", "Left Slope", etc.
    var color: FaceColor

    // Computed centroid for tapping
    var centroid: SIMD3<Float> {
        guard !vertices.isEmpty else { return .zero }
        let sum = vertices.reduce(SIMD3<Float>.zero, +)
        return sum / Float(vertices.count)
    }

    init(vertices: [SIMD3<Float>], normal: SIMD3<Float>, areaSqFt: Double) {
        self.id = UUID()
        self.vertices = vertices
        self.normal = normal
        self.areaSqFt = areaSqFt

        // Pitch: angle of roof surface from horizontal
        // Use local variables — self is not fully initialized until all stored properties are set
        let angleRad = asin(Double(min(abs(normal.y), 1.0)))
        let angleDeg  = angleRad * 180 / .pi
        let pitchDeg  = 90 - angleDeg
        let rise      = Int(round(tan(pitchDeg * .pi / 180) * 12))
        self.pitchDegrees = pitchDeg
        self.pitchRise    = rise

        // Azimuth: which compass direction the face slopes toward
        let azRaw = atan2(Double(normal.x), Double(normal.z)) * 180 / .pi
        let az    = (azRaw + 360).truncatingRemainder(dividingBy: 360)
        self.azimuthDegrees = az
        self.isSelected     = false
        self.label          = RoofFace.label(for: az)
        self.color          = FaceColor.forPitch(rise)
    }

    static func label(for azimuth: Double) -> String {
        switch azimuth {
        case 315...360, 0..<45:   return "North Slope"
        case 45..<135:            return "East Slope"
        case 135..<225:           return "South Slope"
        case 225..<315:           return "West Slope"
        default:                  return "Slope"
        }
    }
}

// MARK: - Wall Face

struct WallFace: Identifiable {
    let id: UUID
    var vertices: [SIMD3<Float>]
    var normal: SIMD3<Float>
    var areaSqFt: Double
    var netAreaSqFt: Double       // area minus openings
    var openings: [Opening]
    var azimuthDegrees: Double
    var label: String
    var isSelected: Bool = false
    var color: FaceColor = .wall

    var centroid: SIMD3<Float> {
        guard !vertices.isEmpty else { return .zero }
        let sum = vertices.reduce(SIMD3<Float>.zero, +)
        return sum / Float(vertices.count)
    }

    init(vertices: [SIMD3<Float>], normal: SIMD3<Float>, areaSqFt: Double) {
        self.id = UUID()
        self.vertices = vertices
        self.normal = normal
        self.areaSqFt = areaSqFt
        self.netAreaSqFt = areaSqFt
        self.openings = []
        let azRaw = atan2(Double(normal.x), Double(normal.z)) * 180 / .pi
        let az    = (azRaw + 360).truncatingRemainder(dividingBy: 360)
        self.azimuthDegrees = az
        self.label          = WallFace.label(for: az)
    }

    mutating func recalcNet() {
        netAreaSqFt = max(0, areaSqFt - openings.reduce(0) { $0 + $1.areaSqFt })
    }

    static func label(for azimuth: Double) -> String {
        switch azimuth {
        case 315...360, 0..<45:   return "North Wall"
        case 45..<135:            return "East Wall"
        case 135..<225:           return "South Wall"
        case 225..<315:           return "West Wall"
        default:                  return "Wall"
        }
    }
}

// MARK: - Opening (window / door cutout for siding)

struct Opening: Identifiable, Codable {
    let id: UUID
    var type: OpeningType
    var widthFt: Double
    var heightFt: Double
    var areaSqFt: Double { widthFt * heightFt }

    init(type: OpeningType, widthFt: Double, heightFt: Double) {
        self.id = UUID()
        self.type = type
        self.widthFt = widthFt
        self.heightFt = heightFt
    }
}

enum OpeningType: String, Codable {
    case window = "Window"
    case door   = "Door"
    case garage = "Garage Door"
    case other  = "Other"

    var defaultSize: (width: Double, height: Double) {
        switch self {
        case .window:  return (3.0, 4.0)
        case .door:    return (3.0, 6.8)
        case .garage:  return (9.0, 7.0)
        case .other:   return (3.0, 3.0)
        }
    }
}

// MARK: - Scan Result

struct ScanResult {
    var roofFaces: [RoofFace]
    var wallFaces: [WallFace]
    var usedLiDAR: Bool
    var scanDate: Date = Date()
    var address: String = ""

    var totalRoofSqFt: Double  { roofFaces.reduce(0) { $0 + $1.areaSqFt } }
    var totalRoofSquares: Double { totalRoofSqFt / 100.0 }
    var totalSidingSqFt: Double  { wallFaces.reduce(0) { $0 + $1.netAreaSqFt } }
    var totalSidingSquares: Double { totalSidingSqFt / 100.0 }
}

// MARK: - Face Color

enum FaceColor {
    case pitch0_3   // flat/low
    case pitch4_6   // standard
    case pitch7_9   // steep
    case pitch10up  // very steep
    case wall
    case selected

    static func forPitch(_ rise: Int) -> FaceColor {
        switch rise {
        case 0...3:  return .pitch0_3
        case 4...6:  return .pitch4_6
        case 7...9:  return .pitch7_9
        default:     return .pitch10up
        }
    }

    var uiColor: UIColor {
        switch self {
        case .pitch0_3:  return UIColor(hex: "#3B82F6").withAlphaComponent(0.7)  // blue
        case .pitch4_6:  return UIColor(hex: "#10B981").withAlphaComponent(0.7)  // green
        case .pitch7_9:  return UIColor(hex: "#F59E0B").withAlphaComponent(0.7)  // amber
        case .pitch10up: return UIColor(hex: "#EF4444").withAlphaComponent(0.7)  // red
        case .wall:      return UIColor(hex: "#8B5CF6").withAlphaComponent(0.6)  // purple
        case .selected:  return UIColor.white.withAlphaComponent(0.9)
        }
    }

    var label: String {
        switch self {
        case .pitch0_3:  return "Flat/Low (0–3/12)"
        case .pitch4_6:  return "Standard (4–6/12)"
        case .pitch7_9:  return "Steep (7–9/12)"
        case .pitch10up: return "Very Steep (10+/12)"
        case .wall:      return "Wall"
        case .selected:  return "Selected"
        }
    }
}

// MARK: - Capture Position (Hover-style guided positions)

struct CapturePosition: Identifiable {
    let id: Int
    let label: String
    let instruction: String
    let symbolName: String
    var isComplete: Bool = false

    static let roofPositions: [CapturePosition] = [
        CapturePosition(id: 0, label: "Front",        instruction: "Face the front of the structure",        symbolName: "1.circle.fill"),
        CapturePosition(id: 1, label: "Front-Right",  instruction: "Stand at the front-right corner",        symbolName: "2.circle.fill"),
        CapturePosition(id: 2, label: "Right",        instruction: "Face the right side",                    symbolName: "3.circle.fill"),
        CapturePosition(id: 3, label: "Back-Right",   instruction: "Stand at the back-right corner",         symbolName: "4.circle.fill"),
        CapturePosition(id: 4, label: "Back",         instruction: "Face the back of the structure",         symbolName: "5.circle.fill"),
        CapturePosition(id: 5, label: "Back-Left",    instruction: "Stand at the back-left corner",          symbolName: "6.circle.fill"),
        CapturePosition(id: 6, label: "Left",         instruction: "Face the left side",                     symbolName: "7.circle.fill"),
        CapturePosition(id: 7, label: "Front-Left",   instruction: "Stand at the front-left corner",         symbolName: "8.circle.fill"),
    ]

    static let sidingPositions: [CapturePosition] = [
        CapturePosition(id: 0, label: "Front Wall",   instruction: "Stand back, capture the full front wall",  symbolName: "1.circle.fill"),
        CapturePosition(id: 1, label: "Right Wall",   instruction: "Stand back, capture the full right wall",  symbolName: "2.circle.fill"),
        CapturePosition(id: 2, label: "Back Wall",    instruction: "Stand back, capture the full back wall",   symbolName: "3.circle.fill"),
        CapturePosition(id: 3, label: "Left Wall",    instruction: "Stand back, capture the full left wall",   symbolName: "4.circle.fill"),
    ]
}
