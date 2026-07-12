import Foundation
import Supabase

// MARK: - Dashboard Models

struct PersonalStats: Codable {
    let doorsKnocked: Int?
    let contacts: Int?
    let inspectionsSet: Int?
    let sits: Int?
    let sales: Int?
    let closeRate: Double?
    let efficiency: Double?
}

struct TeamMemberStats: Codable, Identifiable {
    let id: String
    let name: String?
    let role: String?
    let doorsKnocked: Int?
    let contacts: Int?
    let inspectionsSet: Int?
    let sits: Int?
    let sales: Int?
    let closeRate: String?
    let efficiency: String?
}

struct TeamStatsResponse: Codable {
    let setterStats: [TeamMemberStats]?
    let closerStats: [TeamMemberStats]?
}

// MARK: - Sisu Models

struct SisuLeaderboardEntry: Decodable, Identifiable {
    let user_id: String
    let full_name: String
    let role: String
    let primary_metric: Int
    let doors_knocked: Int
    let rank: Int
    let badge_count: Int
    var id: String { user_id }
}

struct SisuLeaderboardResponse: Decodable {
    let setters: [SisuLeaderboardEntry]
    let closers: [SisuLeaderboardEntry]
    let asOf: String
}

struct SisuBadge: Decodable, Identifiable {
    let id: String
    let badge_id: String
    let awarded_at: String
    let incentive_badges: SisuBadgeInfo?

    struct SisuBadgeInfo: Decodable {
        let name: String?
        let description: String?
        let icon_key: String?
        let color_hex: String?
        let image_url: String?
    }
}

struct SisuBadgesResponse: Decodable {
    let badges: [SisuBadge]
}

/// A SPIFF ("Heat") program with the current rep's live progress toward it.
/// Mirrors `SpiffWithProgress` in lib/incentive-metrics.ts — do not add fields
/// that don't exist server-side; extend /api/sisu/incentives first.
struct SisuSpiff: Decodable, Identifiable {
    let id: String
    let name: String
    let description: String?
    let trigger_metric: String
    let threshold: Double
    let reward_type: String
    let reward_amount: Double?
    let reward_note: String?
    let eligible_roles: [String]
    let starts_at: String
    let ends_at: String
    let status: String
    let currentValue: Double
    let qualified: Bool
    let payout_amount: Double?
    let payroll_pay_date: String?

    /// 0...100, clamped. `threshold` can be 0 for misconfigured programs — guard divide-by-zero.
    var progressPct: Double {
        guard threshold > 0 else { return 0 }
        return min(100, max(0, (currentValue / threshold) * 100))
    }

    /// "$200 Cash", "$50 Gift Card", or "Recognition" — matches formatReward() on web.
    var rewardLabel: String {
        if reward_type == "recognition" { return "Recognition" }
        if let note = reward_note, !note.isEmpty { return note }
        if let amount = reward_amount {
            let formatted = String(format: "$%.0f", amount)
            return reward_type == "gift_card" ? "\(formatted) Gift Card" : "\(formatted) Cash"
        }
        return reward_type == "gift_card" ? "Gift Card" : "Cash"
    }

    /// Human label for the trigger metric — matches spiffMetricLabel() on web.
    var metricLabel: String {
        switch trigger_metric {
        case "inspections_set": return "Inspections Set"
        case "inspections_sat": return "Inspections Sat"
        case "closed_sales": return "Closed Sales"
        case "closed_revenue": return "Closed Revenue ($)"
        case "doors_knocked": return "Doors Knocked"
        case "close_rate": return "Close Rate (%)"
        case "upgrade_attached": return "Upgrades Attached"
        default: return trigger_metric.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    var endsAtDate: Date? { ISO8601DateParser.parse(ends_at) }

    /// "2d left", "6h left", "Ended" — matches timeRemainingLabel() on web.
    var timeRemainingLabel: String {
        guard let end = endsAtDate else { return "" }
        let diff = end.timeIntervalSinceNow
        if diff <= 0 { return "Ended" }
        let hours = diff / 3600
        if hours < 2 {
            let mins = Int(diff / 60)
            return "\(mins / 60)h \(String(format: "%02d", mins % 60))m left"
        }
        if hours < 24 { return "\(Int(hours))h left" }
        return "\(Int(hours / 24))d left"
    }

    /// Within 24h of ending and not yet qualified — surfaces urgency in the UI.
    var isUrgent: Bool {
        guard !qualified, let end = endsAtDate else { return false }
        let diff = end.timeIntervalSinceNow
        return diff > 0 && diff < 24 * 60 * 60
    }
}

/// A rep's active weekly targets. Mirrors `UserIncentiveGoal` in lib/incentive-metrics.ts.
/// Set by managers via the web admin; iOS is read-only.
struct SisuIncentiveGoal: Decodable {
    let id: String
    let weekly_doors_target: Int?
    let weekly_inspections_target: Int?
    let weekly_sales_target: Int?
    let weekly_revenue_target: Double?
    let effective_from: String
    let effective_to: String?

    var hasAnyTarget: Bool {
        weekly_doors_target != nil || weekly_inspections_target != nil
            || weekly_sales_target != nil || weekly_revenue_target != nil
    }
}

/// This-week live counts backing goal progress bars. Subset of `LiveMetrics` on
/// web (badge-milestone-only fields like doorsKnockedForBadge are omitted —
/// iOS doesn't need them since badge unlock progress isn't shown here).
struct SisuLiveMetrics: Decodable {
    let inspectionsSet: Int
    let doorsKnocked: Int
    let closedSales: Int
}

struct SisuIncentivesResponse: Decodable {
    let liveMetrics: SisuLiveMetrics
    let goal: SisuIncentiveGoal?
    let activeSpiffs: [SisuSpiff]
    let asOf: String
}

/// Minimal ISO8601 parser shared by Sisu models — handles both fractional-second
/// and whole-second timestamp formats Postgres/PostgREST can emit.
enum ISO8601DateParser {
    static func parse(_ string: String) -> Date? {
        let withFractional = ISO8601DateFormatter()
        withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFractional.date(from: string) { return date }
        let whole = ISO8601DateFormatter()
        whole.formatOptions = [.withInternetDateTime]
        return whole.date(from: string)
    }
}

// MARK: - Canvass Models

struct CanvassPin: Codable, Identifiable {
    let id: String
    let lat: Double
    let lng: Double
    let d: String?      // canvass_disposition
    let s: String?      // status
    let o: String?      // owner_user_id
    let t: String?      // created_at
    let ia: Bool?       // installation_agreement_signed (sold)
    /// Local-only pending sync marker (not from API).
    var isPending: Bool = false
    /// Queued edit to an existing server pin (distinct from new-lead pending).
    var isPendingEdit: Bool = false

    enum CodingKeys: String, CodingKey {
        case id, lat, lng, d, s, o, t, ia
    }
    /// Whether map marker appearance should change (pending overlay, disposition, owner).
    func isMapDisplayEqual(to other: CanvassPin) -> Bool {
        d == other.d && s == other.s && o == other.o && ia == other.ia
            && isPending == other.isPending && isPendingEdit == other.isPendingEdit
            && lat == other.lat && lng == other.lng
    }
}

struct CanvassViewportResponse: Codable {
    let pins: [CanvassPin]
    let hasMore: Bool?
    let truncated: Bool?
}

struct CanvassLeadDetail: Codable, Identifiable {
    let id: String
    let lat: Double?
    let lng: Double?
    let address_text: String?
    let homeowner_name: String?
    let phone: String?
    let email: String?
    let canvass_disposition: String?
    let canvass_notes: String?
    let status: String?
    let created_at: String?
    let updated_at: String?
    let owner_name: String?      // setter who last touched the lead
}

/// Plain data payload — freely passed between the main actor and `OfflineLeadQueue`
/// (a background actor), so it opts out of the project's default MainActor isolation.
nonisolated struct SaveLeadRequest: Codable {
    var lead_id: String?
    var client_lead_id: String?
    var lat: Double?
    var lng: Double?
    var address_text: String?
    var homeowner_name: String?
    var phone: String?
    var canvass_disposition: String?
    var canvass_notes: String?
    var source: String = "canvass"

    /// Merge newer non-nil fields into this request (offline queue coalescing).
    mutating func merge(from newer: SaveLeadRequest) {
        if let v = newer.lead_id { lead_id = v }
        if let v = newer.client_lead_id { client_lead_id = v }
        if let v = newer.lat { lat = v }
        if let v = newer.lng { lng = v }
        if let v = newer.address_text { address_text = v }
        if let v = newer.homeowner_name { homeowner_name = v }
        if let v = newer.phone { phone = v }
        if let v = newer.canvass_disposition { canvass_disposition = v }
        if let v = newer.canvass_notes { canvass_notes = v }
        if !newer.source.isEmpty { source = newer.source }
    }
}

struct SaveLeadResponse: Codable, Equatable {
    let lead_id: String?
    let status: String?
}

// MARK: - Opportunity Models

struct Opportunity: Decodable, Identifiable {
    let id: String
    let lead_id: String?
    let customer_id: String?
    let owner_user_id: String?
    let setter_user_id: String?
    let address_text: String?
    let project_type: String?
    let status: String?
    let inspection_outcome: String?
    let inspection_outcome_at: String?
    let inspection_notes: String?
    let created_at: String?
    let updated_at: String?
    let leads: OppLead?
    let users: OppUser?
    let lead_phone: String?
    let lead_email: String?
    let inspection_date: String?

    struct OppLead: Decodable {
        let homeowner_name: String?
    }
    struct OppUser: Decodable {
        let full_name: String?
    }

    var displayName: String {
        leads?.homeowner_name ?? "Homeowner"
    }
    var closerName: String? { users?.full_name }

    var statusLabel: String {
        switch status {
        case "open": return "Open"
        case "in_progress": return "In Progress"
        case "negotiation": return "Negotiation"
        case "won": return "Won"
        case "lost": return "Lost"
        default: return status?.capitalized ?? "—"
        }
    }

    var statusColor: String {
        switch status {
        case "won": return "#10B981"
        case "lost": return "#EF4444"
        case "in_progress", "negotiation": return "#F59E0B"
        default: return "#3B82F6"
        }
    }

    var inspectionOutcomeLabel: String? {
        switch inspection_outcome {
        case "completed": return "Inspected"
        case "no_show": return "No Show"
        case "cancelled": return "Cancelled"
        case "rescheduled": return "Rescheduled"
        default: return inspection_outcome?.capitalized
        }
    }
}

// MARK: - LiDAR measure payload (POST /api/opportunities/:id/measure/lidar)

struct LidarElevationPayload: Encodable {
    let elevation_name: String
    let wall_width_ft: Double?
    let wall_height_ft: Double?
    let lidar_confidence: Double?
    let captured_at: String?
}

struct LidarMeasurePayload: Encodable {
    let elevations: [LidarElevationPayload]
    let device_model: String?

    static func from(wallFaces: [WallFace]) -> LidarMeasurePayload {
        let elevations = wallFaces.map { face -> LidarElevationPayload in
            let verts = face.vertices
            let ys = verts.map { Double($0.y) }.sorted()
            let p5 = percentile(ys, 0.05)
            let p95 = percentile(ys, 0.95)
            let heightM = max(0, p95 - p5)
            let heightFt = heightM * 3.28084
            let widthFt = heightFt > 0.5 ? face.areaSqFt / heightFt : nil
            return LidarElevationPayload(
                elevation_name: face.elevationName,
                wall_width_ft: widthFt.map { $0 > 0.5 ? $0 : nil } ?? nil,
                wall_height_ft: heightFt > 0.5 ? heightFt : nil,
                lidar_confidence: nil,
                captured_at: nil
            )
        }
        return LidarMeasurePayload(
            elevations: elevations.isEmpty
                ? [LidarElevationPayload(
                    elevation_name: "Front",
                    wall_width_ft: nil,
                    wall_height_ft: nil,
                    lidar_confidence: nil,
                    captured_at: nil
                )]
                : elevations,
            device_model: nil
        )
    }

    private static func percentile(_ sorted: [Double], _ p: Double) -> Double {
        guard !sorted.isEmpty else { return 0 }
        let vals = sorted
        let idx = Int(Double(vals.count - 1) * p)
        return vals[min(max(idx, 0), vals.count - 1)]
    }
}

// MARK: - Canvass Dispositions

struct CanvassDisposition: Identifiable {
    let id: String
    let label: String
    let color: String   // hex

    static let all: [CanvassDisposition] = [
        .init(id: "hot_lead",        label: "Hot Lead",        color: "#EF4444"),
        .init(id: "go_back",         label: "Go Back",         color: "#F59E0B"),
        .init(id: "not_home",        label: "Not Home",        color: "#9CA3AF"),
        .init(id: "not_interested",  label: "Not Interested",  color: "#6B7280"),
        .init(id: "bad_roof",        label: "Bad Roof",        color: "#78716C"),
        .init(id: "renter",          label: "Renter",          color: "#A1A1AA"),
    ]

    static func find(_ id: String?) -> CanvassDisposition? {
        all.first { $0.id == id }
    }
}

// MARK: - API Client

struct APIClient {
    static let baseURL = "https://arx-internal-crm.vercel.app"

    static func bearerToken() async -> String? {
        return try? await supabase.auth.session.accessToken
    }

    static func request(path: String, queryItems: [URLQueryItem] = []) async throws -> Data {
        guard let token = await bearerToken() else {
            throw APIError.unauthenticated
        }
        var components = URLComponents(string: baseURL + path)!
        if !queryItems.isEmpty { components.queryItems = queryItems }
        var req = URLRequest(url: components.url!)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode < 400 else {
            throw APIError.httpError((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return data
    }

    static func post(path: String, body: some Encodable, timeout: TimeInterval = 15) async throws -> Data {
        guard let token = await bearerToken() else { throw APIError.unauthenticated }
        return try await post(path: path, body: body, accessToken: token, timeout: timeout)
    }

    static func post(path: String, body: some Encodable, accessToken: String, timeout: TimeInterval = 15) async throws -> Data {
        var req = URLRequest(url: URL(string: baseURL + path)!)
        req.httpMethod = "POST"
        req.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(body)
        req.timeoutInterval = timeout
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard http.statusCode < 400 else {
            throw APIError.httpError(http.statusCode)
        }
        return data
    }

    // MARK: - Dashboard

    static func personalStats(timeframe: String = "week") async throws -> PersonalStats {
        let data = try await request(
            path: "/api/dashboard/personal-stats",
            queryItems: [URLQueryItem(name: "timeframe", value: timeframe)]
        )
        return try JSONDecoder().decode(PersonalStats.self, from: data)
    }

    static func teamStats(timeframe: String = "week") async throws -> TeamStatsResponse {
        let data = try await request(
            path: "/api/dashboard/team-stats",
            queryItems: [URLQueryItem(name: "timeframe", value: timeframe)]
        )
        return try JSONDecoder().decode(TeamStatsResponse.self, from: data)
    }

    // MARK: - Sisu

    static func sisuLeaderboard() async throws -> SisuLeaderboardResponse {
        struct EmptyBody: Encodable {}
        let data = try await post(path: "/api/sisu/leaderboard", body: EmptyBody())
        return try JSONDecoder().decode(SisuLeaderboardResponse.self, from: data)
    }

    static func sisuBadges(userId: String) async throws -> [SisuBadge] {
        let data = try await request(path: "/api/sisu/badges", queryItems: [
            URLQueryItem(name: "userId", value: userId)
        ])
        return try JSONDecoder().decode(SisuBadgesResponse.self, from: data).badges
    }

    static func sisuIncentives() async throws -> SisuIncentivesResponse {
        let data = try await request(path: "/api/sisu/incentives")
        return try JSONDecoder().decode(SisuIncentivesResponse.self, from: data)
    }

    // MARK: - Canvass

    static func viewportPins(minLat: Double, maxLat: Double, minLng: Double, maxLng: Double, zoom: Int) async throws -> CanvassViewportResponse {
        let data = try await request(path: "/api/canvass/leads/viewport", queryItems: [
            URLQueryItem(name: "minLat", value: "\(minLat)"),
            URLQueryItem(name: "maxLat", value: "\(maxLat)"),
            URLQueryItem(name: "minLng", value: "\(minLng)"),
            URLQueryItem(name: "maxLng", value: "\(maxLng)"),
            URLQueryItem(name: "zoom",   value: "\(zoom)"),
        ])
        return try JSONDecoder().decode(CanvassViewportResponse.self, from: data)
    }

    static func leadDetails(ids: [String]) async throws -> [CanvassLeadDetail] {
        struct Body: Encodable { let ids: [String] }
        struct Response: Decodable { let leads: [CanvassLeadDetail] }
        let data = try await post(path: "/api/canvass/leads/viewport", body: Body(ids: ids))
        return (try JSONDecoder().decode(Response.self, from: data)).leads
    }

    static func saveLeadDirect(_ payload: SaveLeadRequest) async throws -> SaveLeadResponse {
        guard let token = await bearerToken() else { throw APIError.unauthenticated }
        return try await saveLeadDirect(payload, accessToken: token)
    }

    static func saveLeadDirect(_ payload: SaveLeadRequest, accessToken: String) async throws -> SaveLeadResponse {
        let data = try await post(path: "/api/canvass/lead", body: payload, accessToken: accessToken)
        return try JSONDecoder().decode(SaveLeadResponse.self, from: data)
    }

    /// Tries online save; on transport/5xx failure enqueues for offline replay.
    static func saveLeadQueued(_ payload: SaveLeadRequest) async throws -> SaveLeadOutcome {
        do {
            let response = try await saveLeadDirect(payload)
            return .synced(response)
        } catch {
            guard OfflineQueuePolicy.shouldQueue(error: error) else { throw error }
            let enqueued = await OfflineLeadQueue.shared.enqueue(payload)
            guard enqueued else { throw APIError.offlineQueueUnavailable }
            return .queuedOffline
        }
    }

    static func saveLead(_ payload: SaveLeadRequest) async throws -> SaveLeadResponse {
        let outcome = try await saveLeadQueued(payload)
        switch outcome {
        case .synced(let response):
            return response
        case .queuedOffline:
            throw APIError.offlineQueued
        }
    }

    // MARK: - Opportunities

    static func fetchOpportunities() async throws -> [Opportunity] {
        struct Response: Decodable { let opportunities: [Opportunity] }
        let data = try await request(path: "/api/opportunities", queryItems: [
            URLQueryItem(name: "full", value: "true"),
        ])
        return (try JSONDecoder().decode(Response.self, from: data)).opportunities
    }

    static func fetchOpportunity(id: String) async throws -> Opportunity {
        struct Response: Decodable { let opportunity: Opportunity }
        let data = try await request(path: "/api/opportunities/\(id)")
        return (try JSONDecoder().decode(Response.self, from: data)).opportunity
    }

    /// POST siding wall-face data to the opportunity's LiDAR measure endpoint.
    static func postLidarMeasure(opportunityId: String, wallFaces: [WallFace]) async throws {
        let payload = LidarMeasurePayload.from(wallFaces: wallFaces)
        _ = try await post(path: "/api/opportunities/\(opportunityId)/measure/lidar", body: payload)
    }

    // MARK: - Measurements

    static func measurementList() async throws -> [SavedMeasurement] {
        struct Response: Decodable { let measurements: [SavedMeasurement] }
        let data = try await request(path: "/api/measurements", queryItems: [
            URLQueryItem(name: "list", value: "true")
        ])
        return (try JSONDecoder().decode(Response.self, from: data)).measurements
    }

    static func saveMeasurement(_ payload: SaveMeasurementRequest) async throws -> String {
        struct Response: Decodable { let measurement: MeasurementResult? }
        struct MeasurementResult: Decodable { let id: String }
        let data = try await post(path: "/api/measurements", body: payload)
        let decoded = try JSONDecoder().decode(Response.self, from: data)
        guard let id = decoded.measurement?.id, !id.isEmpty else {
            throw APIError.invalidResponse
        }
        return id
    }
}

// MARK: - Measurement Payload

struct SaveMeasurementRequest: Encodable {
    let measurements: MeasurementPayload
    let opportunityId: String?

    struct MeasurementPayload: Encodable {
        let address: String
        let total_area_sqft: Double
        let total_squares: Double
        let scan_type: String       // "roof" or "siding"
        let used_lidar: Bool
        let facets: [FacetPayload]?
        let raw_data: RawData

        struct FacetPayload: Encodable {
            let area_sqft: Double
            let pitch: String           // e.g. "6/12"
            let pitch_degrees: Double
            let pitch_source: String    // always "manual" for iOS LiDAR
            let geometry_reviewed: Bool // always true — user reviewed in 3D
            let orientation: String     // "N" / "S" / "E" / "W"
            let points: [[Double]]?     // nil — iOS verts are world-space, not geo coords
        }

        struct RawData: Encodable {
            let roof_face_count: Int
            let wall_face_count: Int
            let total_siding_sqft: Double
        }
    }
}

extension SaveMeasurementRequest {
    init(scanResult: ScanResult, scanType: ScanType, address: String, opportunityId: String? = nil) {
        let isRoof = scanType == .roof

        let facets: [MeasurementPayload.FacetPayload]? = isRoof
            ? scanResult.roofFaces.map { face in
                MeasurementPayload.FacetPayload(
                    area_sqft: face.areaSqFt,
                    pitch: "\(face.pitchRise)/12",
                    pitch_degrees: face.pitchDegrees,
                    pitch_source: "manual",
                    geometry_reviewed: true,
                    orientation: compassDirection(face.azimuthDegrees),
                    points: nil
                )
            }
            : nil

        self.measurements = MeasurementPayload(
            address: address,
            total_area_sqft: isRoof ? scanResult.totalRoofSqFt : scanResult.totalSidingSqFt,
            total_squares: isRoof ? scanResult.totalRoofSquares : scanResult.totalSidingSquares,
            scan_type: scanType.rawValue,
            used_lidar: scanResult.usedLiDAR,
            facets: facets,
            raw_data: MeasurementPayload.RawData(
                roof_face_count: scanResult.roofFaces.count,
                wall_face_count: scanResult.wallFaces.count,
                total_siding_sqft: scanResult.totalSidingSqFt
            )
        )
        self.opportunityId = opportunityId
    }
}

// MARK: - Saved Measurement (API list response)

struct SavedMeasurement: Decodable, Identifiable {
    let id: String
    let address_text: String?
    let total_area_sqft: Double?
    let total_squares: Double?
    let facet_count: Int?
    let status: String?
    let created_at: String?
    let raw_data: RawDataField?

    struct RawDataField: Decodable {
        let scan_type: String?
        let used_lidar: Bool?
        let wall_face_count: Int?
        let total_siding_sqft: Double?
    }

    var scanTypeLabel: String { raw_data?.scan_type == "siding" ? "Siding" : "Roof" }
    var usedLiDAR: Bool { raw_data?.used_lidar ?? false }
}

private func compassDirection(_ degrees: Double) -> String {
    switch degrees {
    case 315...360, 0..<45:  return "N"
    case 45..<135:           return "E"
    case 135..<225:          return "S"
    default:                 return "W"
    }
}

enum APIError: Error, LocalizedError {
    case unauthenticated
    case httpError(Int)
    case invalidResponse
    case offlineQueued
    case offlineQueueUnavailable
    /// Scheduling-specific errors returned by the server (e.g. conflict, no closer).
    case schedulingConflict(String)
    var errorDescription: String? {
        switch self {
        case .unauthenticated: return "Not signed in"
        case .httpError(let code): return "Server error (\(code))"
        case .invalidResponse: return "Unexpected server response"
        case .offlineQueued: return "Saved offline — will sync when back online"
        case .offlineQueueUnavailable: return "Not signed in — could not save offline"
        case .schedulingConflict(let msg): return msg
        }
    }
}

// MARK: - Mobile app (ARX Sales)

/// Flags from `GET /api/mobile/capabilities` — match Admin → Roles “View Opportunities”.
struct MobileAppCapabilities: Decodable, Equatable {
    /// False for inside-sales queue workers — ARX Sales is the field-canvassing app for
    /// setters/closers. Defaults `true` so an older cached value / offline-first launch
    /// never strands a legitimate field rep; the server is authoritative once reachable.
    let appAccess: Bool
    let opportunitiesTab: Bool
    let measureTab: Bool
    let weatherOverlay: Bool

    enum CodingKeys: String, CodingKey {
        case appAccess = "app_access"
        case opportunitiesTab = "opportunities_tab"
        case measureTab = "measure_tab"
        case weatherOverlay = "weather_overlay"
    }

    init(appAccess: Bool = true, opportunitiesTab: Bool = false, measureTab: Bool = false, weatherOverlay: Bool = false) {
        self.appAccess = appAccess
        self.opportunitiesTab = opportunitiesTab
        self.measureTab = measureTab
        self.weatherOverlay = weatherOverlay
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        appAccess = try c.decodeIfPresent(Bool.self, forKey: .appAccess) ?? true
        opportunitiesTab = try c.decodeIfPresent(Bool.self, forKey: .opportunitiesTab) ?? false
        measureTab = try c.decodeIfPresent(Bool.self, forKey: .measureTab) ?? false
        weatherOverlay = try c.decodeIfPresent(Bool.self, forKey: .weatherOverlay) ?? false
    }
}

extension APIClient {
    static func mobileCapabilities() async throws -> MobileAppCapabilities {
        let data = try await request(path: "/api/mobile/capabilities", queryItems: [])
        return try JSONDecoder().decode(MobileAppCapabilities.self, from: data)
    }
}

// MARK: - Schedule Inspection

struct ScheduleInspectionRequest: Encodable {
    /// ID of an existing lead (required — iOS always schedules against an existing pin).
    let lead_id: String
    /// Must be `true` to trigger the scheduling path.
    let schedule_inspection: Bool
    /// Local wall-clock time string in the format "YYYY-MM-DDTHH:MM".
    /// The server converts this to UTC using the closer's team timezone.
    let inspection_scheduled_for: String
    /// Optional notes appended to canvass_notes on the lead.
    let canvass_notes: String?
    /// Always `true` from iOS — let the server assign via round-robin.
    let use_round_robin: Bool
}

struct ScheduleInspectionResponse: Decodable {
    let lead_id: String?
    let opportunity_id: String?
    let appointment_id: String?
    let assigned_closer: String?
    let calendar_synced: Bool?
    let calendar_error: String?
    /// Server-side error code, present on 4xx responses.
    let code: String?
    let error: String?
}

extension APIClient {
    /// POST /api/canvass/lead with schedule_inspection = true.
    /// Throws `APIError.schedulingConflict` with a human-readable message on 4xx scheduling errors.
    static func scheduleInspection(_ payload: ScheduleInspectionRequest) async throws -> ScheduleInspectionResponse {
        guard let token = await bearerToken() else { throw APIError.unauthenticated }
        var req = URLRequest(url: URL(string: baseURL + "/api/canvass/lead")!)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(payload)
        req.timeoutInterval = 30 // scheduling involves calendar + email — allow more time

        let (data, response) = try await URLSession.shared.data(for: req)
        let http = response as? HTTPURLResponse
        let statusCode = http?.statusCode ?? 0

        // On 4xx, attempt to surface the server's error message to the user.
        if statusCode >= 400 {
            if let body = try? JSONDecoder().decode(ScheduleInspectionResponse.self, from: data),
               let msg = body.error, !msg.isEmpty {
                throw APIError.schedulingConflict(msg)
            }
            throw APIError.httpError(statusCode)
        }

        return try JSONDecoder().decode(ScheduleInspectionResponse.self, from: data)
    }
}
