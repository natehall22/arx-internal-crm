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

// MARK: - Appointment Models (GET /api/appointments?filter=upcoming)

/// Slim decode of enriched appointment rows from `/api/appointments`.
/// Phone lives on nested `leads`; address prefers appointment.address_text then leads.
struct MobileAppointment: Decodable, Identifiable {
    let id: String
    let scheduled_for: String
    let appointment_type: String?
    let address_text: String?
    let status: String?
    let leads: MobileAppointmentLead?
    let closer: MobileAppointmentUser?
    let setter: MobileAppointmentUser?

    struct MobileAppointmentLead: Decodable {
        let homeowner_name: String?
        let phone: String?
        let address_text: String?
    }

    struct MobileAppointmentUser: Decodable {
        let id: String?
        let full_name: String?
        let role: String?
    }

    var homeownerName: String {
        let name = leads?.homeowner_name?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (name?.isEmpty == false) ? name! : "Homeowner"
    }

    var displayAddress: String? {
        let apt = address_text?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let apt, !apt.isEmpty { return apt }
        let lead = leads?.address_text?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let lead, !lead.isEmpty { return lead }
        return nil
    }

    var phone: String? {
        let p = leads?.phone?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (p?.isEmpty == false) ? p : nil
    }

    var scheduledDate: Date? {
        Self.parseISO8601(scheduled_for)
    }

    var typeLabel: String {
        switch appointment_type {
        case "inspection": return "Inspection"
        case "insurance_call": return "Insurance Call"
        case "follow_up": return "Follow-up"
        case nil, "": return "Appointment"
        default:
            return appointment_type!
                .replacingOccurrences(of: "_", with: " ")
                .capitalized
        }
    }

    static func parseISO8601(_ raw: String) -> Date? {
        let withFrac = ISO8601DateFormatter()
        withFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFrac.date(from: raw) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: raw)
    }
}

struct MobileAppointmentsResponse: Decodable {
    let appointments: [MobileAppointment]
}

/// Row from GET /api/mobile/leads — caller's attributed/owned canvass leads.
struct MobileLead: Decodable, Identifiable {
    let id: String
    let lat: Double?
    let lng: Double?
    let address_text: String?
    let homeowner_name: String?
    let phone: String?
    let canvass_disposition: String?
    let canvass_notes: String?
    let status: String?
    let created_at: String?
    let updated_at: String?

    var displayName: String {
        let name = homeowner_name?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let name, !name.isEmpty { return name }
        let addr = address_text?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let addr, !addr.isEmpty { return addr }
        return "Lead"
    }

    var hasCoordinate: Bool {
        guard let lat, let lng else { return false }
        return lat != 0 || lng != 0
    }

    var asCanvassPin: CanvassPin? {
        guard let lat, let lng, hasCoordinate else { return nil }
        return CanvassPin(
            id: id,
            lat: lat,
            lng: lng,
            d: canvass_disposition,
            s: status,
            o: nil,
            t: created_at,
            ia: nil,
            address_text: address_text,
            homeowner_name: homeowner_name,
            phone: phone,
            notes: canvass_notes
        )
    }

    /// Matches web canvass "Scheduled" filter: status=inspection and/or disposition inspection_scheduled.
    var isScheduled: Bool {
        status == "inspection" || canvass_disposition == "inspection_scheduled"
    }
}

struct MobileLeadsResponse: Decodable {
    let leads: [MobileLead]
    let hasMore: Bool?
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

/// GET /api/commissions/weekly — week-to-date commission rows for the signed-in rep (estimate only).
struct WeeklyCommissionEstimate: Decodable {
    let weeklyTotal: Double
    let hasCompPlan: Bool
    let weekStart: String
    let weekEnd: String
    let role: String
    let perspectiveLane: String
    let isEstimate: Bool
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
    /// Local-only contact/address seed (My Leads, offline queue — not from viewport API).
    var address_text: String? = nil
    var homeowner_name: String? = nil
    var phone: String? = nil
    var notes: String? = nil

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

struct CanvassLeadDetail: Decodable, Identifiable {
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

    private enum CodingKeys: String, CodingKey {
        case id, lat, lng, address_text, homeowner_name, phone, email
        case canvass_disposition, canvass_notes, status, created_at, updated_at
        case owner_name, owner
    }

    private struct OwnerRef: Decodable {
        let full_name: String?
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        lat = Self.decodeFlexibleDouble(from: c, forKey: .lat)
        lng = Self.decodeFlexibleDouble(from: c, forKey: .lng)
        address_text = try c.decodeIfPresent(String.self, forKey: .address_text)
        homeowner_name = try c.decodeIfPresent(String.self, forKey: .homeowner_name)
        phone = try c.decodeIfPresent(String.self, forKey: .phone)
        email = try c.decodeIfPresent(String.self, forKey: .email)
        canvass_disposition = try c.decodeIfPresent(String.self, forKey: .canvass_disposition)
        canvass_notes = try c.decodeIfPresent(String.self, forKey: .canvass_notes)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
        updated_at = try c.decodeIfPresent(String.self, forKey: .updated_at)

        var resolvedOwner = try c.decodeIfPresent(String.self, forKey: .owner_name)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if resolvedOwner?.isEmpty != false,
           let nested = try c.decodeIfPresent(OwnerRef.self, forKey: .owner),
           let nestedName = nested.full_name?.trimmingCharacters(in: .whitespacesAndNewlines),
           !nestedName.isEmpty {
            resolvedOwner = nestedName
        }
        owner_name = resolvedOwner
    }

    private static func decodeFlexibleDouble(
        from container: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> Double? {
        if let value = try? container.decodeIfPresent(Double.self, forKey: key) {
            return value
        }
        guard let raw = try? container.decodeIfPresent(String.self, forKey: key) else {
            return nil
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return Double(trimmed)
    }
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
    /// Rep physical GPS at knock time (separate from property pin lat/lng).
    var rep_lat: Double?
    var rep_lng: Double?
    var rep_geo_accuracy: Double?
    var rep_geo_captured_at: String?

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
        if newer.rep_lat != nil {
            rep_lat = newer.rep_lat
            rep_lng = newer.rep_lng
            rep_geo_accuracy = newer.rep_geo_accuracy
            rep_geo_captured_at = newer.rep_geo_captured_at
        }
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

    static func delete(path: String, body: some Encodable) async throws {
        guard let token = await bearerToken() else { throw APIError.unauthenticated }
        var req = URLRequest(url: URL(string: baseURL + path)!)
        req.httpMethod = "DELETE"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(body)
        req.timeoutInterval = 15
        let (_, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode < 400 else {
            throw APIError.httpError((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
    }

    // MARK: - Push token

    static func registerPushToken(_ deviceToken: String, environment: String) async throws {
        struct Body: Encodable {
            let device_token: String
            let platform: String
            let environment: String
        }
        _ = try await post(
            path: "/api/mobile/push-token",
            body: Body(device_token: deviceToken, platform: "ios", environment: environment)
        )
    }

    static func unregisterPushToken(_ deviceToken: String) async throws {
        struct Body: Encodable { let device_token: String }
        try await delete(path: "/api/mobile/push-token", body: Body(device_token: deviceToken))
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

    static func weeklyCommissionEstimate() async throws -> WeeklyCommissionEstimate {
        let data = try await request(path: "/api/commissions/weekly")
        return try JSONDecoder().decode(WeeklyCommissionEstimate.self, from: data)
    }

    // MARK: - Appointments

    /// Upcoming scheduled appointments for the signed-in rep (Bearer-auth on existing web route).
    /// Decodes each row independently so one malformed appointment cannot hide the card.
    static func upcomingAppointments() async throws -> [MobileAppointment] {
        let data = try await request(path: "/api/appointments", queryItems: [
            URLQueryItem(name: "filter", value: "upcoming"),
        ])
        guard
            let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let rows = root["appointments"] as? [Any]
        else {
            return try JSONDecoder().decode(MobileAppointmentsResponse.self, from: data).appointments
        }
        let decoder = JSONDecoder()
        var out: [MobileAppointment] = []
        out.reserveCapacity(rows.count)
        for row in rows {
            guard JSONSerialization.isValidJSONObject(row),
                  let rowData = try? JSONSerialization.data(withJSONObject: row),
                  let apt = try? decoder.decode(MobileAppointment.self, from: rowData)
            else { continue }
            out.append(apt)
        }
        return out
    }

    // MARK: - My Leads

    static func myLeads() async throws -> MobileLeadsResponse {
        let data = try await request(path: "/api/mobile/leads")
        return try JSONDecoder().decode(MobileLeadsResponse.self, from: data)
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

    /// Google reverse geocode via CRM (`GET /api/canvass/reverse-geocode`).
    static func reverseGeocodeCanvass(lat: Double, lng: Double) async -> String? {
        let cacheKey = String(format: "%.5f,%.5f", lat, lng)
        if let cached = reverseGeocodeCache[cacheKey] {
            return cached
        }
        struct Response: Decodable {
            let ok: Bool
            let address: String?
        }
        do {
            let data = try await request(path: "/api/canvass/reverse-geocode", queryItems: [
                URLQueryItem(name: "lat", value: "\(lat)"),
                URLQueryItem(name: "lng", value: "\(lng)"),
            ])
            let decoded = try JSONDecoder().decode(Response.self, from: data)
            guard decoded.ok, let addr = decoded.address?.trimmingCharacters(in: .whitespacesAndNewlines), !addr.isEmpty else {
                return nil
            }
            reverseGeocodeCache[cacheKey] = addr
            return addr
        } catch {
            return nil
        }
    }

    /// In-memory reverse-geocode results keyed by rounded lat/lng (session only).
    private static var reverseGeocodeCache: [String: String] = [:]

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

// MARK: - Canvass scheduling (round-robin teams + availability)

struct CanvassSchedulingTeam: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
}

struct CanvassSchedulingMeta: Decodable {
    let teams: [CanvassSchedulingTeam]
    let inspection_duration: Int
    let user_team_id: String?
}

struct CanvassAvailabilitySlot: Decodable, Identifiable, Hashable {
    var id: String { time }
    let time: String
    let display: String
    let available: Bool
    let availableClosers: Int?

    enum CodingKeys: String, CodingKey {
        case time, display, available
        case availableClosers = "availableClosers"
    }
}

struct CanvassTeamAvailabilityResponse: Decodable {
    let slots: [CanvassAvailabilitySlot]
    let timezone: String?
    let hasCalendar: Bool?
    let closersInQueue: Int?
}

extension APIClient {
    static func fetchCanvassSchedulingMeta() async throws -> CanvassSchedulingMeta {
        let data = try await request(path: "/api/canvass/scheduling-meta")
        return try JSONDecoder().decode(CanvassSchedulingMeta.self, from: data)
    }

    static func fetchTeamAvailability(teamId: String, dateYmd: String, durationMinutes: Int) async throws -> CanvassTeamAvailabilityResponse {
        let data = try await request(path: "/api/canvass/team-availability", queryItems: [
            URLQueryItem(name: "team_id", value: teamId),
            URLQueryItem(name: "date", value: dateYmd),
            URLQueryItem(name: "duration", value: "\(durationMinutes)"),
            // Applies the Inspection buffer from Admin → Scheduling; matches the web canvass picker.
            URLQueryItem(name: "slot_kind", value: "inspection"),
        ])
        return try JSONDecoder().decode(CanvassTeamAvailabilityResponse.self, from: data)
    }
}

// MARK: - Schedule Inspection

/// POST body for `/api/canvass/lead` when scheduling (existing lead or create+schedule in one request).
struct CanvassLeadScheduleRequest: Encodable {
    var lead_id: String?
    var client_lead_id: String?
    var lat: Double?
    var lng: Double?
    var address_text: String?
    var homeowner_name: String?
    var phone: String?
    var canvass_disposition: String?
    var canvass_notes: String?
    /// Omitted when scheduling an existing lead so CRM source (e.g. Instant Estimate) is preserved.
    var source: String?
    var rep_lat: Double?
    var rep_lng: Double?
    var rep_geo_accuracy: Double?
    var rep_geo_captured_at: String?
    let schedule_inspection: Bool = true
    var inspection_scheduled_for: String
    let use_round_robin: Bool = true
    /// Web canvass sends `team:{uuid}` here for round-robin team scheduling.
    var closer_user_id: String?

    /// Blank strings encode as `""` and the canvass API treats present keys as patches (empty → null).
    /// Existing-lead schedule must omit unset contact/disposition fields so CRM data is not wiped.
    private static func schedulePatchFieldIfNonEmpty(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    /// Existing synced pin — omit coordinates so the server does not erase the house pin.
    static func forExistingLead(
        id: String,
        from save: SaveLeadRequest,
        inspectionScheduledFor localTime: String,
        scheduleNotes: String?,
        roundRobinTeamId: String? = nil
    ) -> CanvassLeadScheduleRequest {
        let mergedNotes: String? = {
            guard let scheduleNotes else { return save.canvass_notes }
            if let existing = save.canvass_notes, !existing.isEmpty {
                return existing + "\n\n" + scheduleNotes
            }
            return scheduleNotes
        }()
        return CanvassLeadScheduleRequest(
            lead_id: id,
            address_text: schedulePatchFieldIfNonEmpty(save.address_text),
            homeowner_name: schedulePatchFieldIfNonEmpty(save.homeowner_name),
            phone: schedulePatchFieldIfNonEmpty(save.phone),
            canvass_disposition: schedulePatchFieldIfNonEmpty(save.canvass_disposition),
            canvass_notes: schedulePatchFieldIfNonEmpty(mergedNotes),
            source: nil,
            rep_lat: save.rep_lat,
            rep_lng: save.rep_lng,
            rep_geo_accuracy: save.rep_geo_accuracy,
            rep_geo_captured_at: save.rep_geo_captured_at,
            inspection_scheduled_for: localTime,
            closer_user_id: roundRobinTeamId.map { "team:\($0)" }
        )
    }

    /// New knock or offline-pending pin — lead row is created (or deduped) in the same request.
    static func forCreateAndSchedule(
        from save: SaveLeadRequest,
        inspectionScheduledFor localTime: String,
        canvassNotes: String?,
        roundRobinTeamId: String? = nil
    ) -> CanvassLeadScheduleRequest {
        CanvassLeadScheduleRequest(
            lead_id: save.lead_id,
            client_lead_id: save.client_lead_id,
            lat: save.lat,
            lng: save.lng,
            address_text: save.address_text,
            homeowner_name: save.homeowner_name,
            phone: save.phone,
            canvass_disposition: save.canvass_disposition,
            canvass_notes: canvassNotes ?? save.canvass_notes,
            source: save.source,
            rep_lat: save.rep_lat,
            rep_lng: save.rep_lng,
            rep_geo_accuracy: save.rep_geo_accuracy,
            rep_geo_captured_at: save.rep_geo_captured_at,
            inspection_scheduled_for: localTime,
            closer_user_id: roundRobinTeamId.map { "team:\($0)" }
        )
    }
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
    /// POST `/api/canvass/lead` with `schedule_inspection = true` (never queued offline).
    /// Throws `APIError.schedulingConflict` with a human-readable message on 4xx scheduling errors.
    static func scheduleInspection(_ payload: CanvassLeadScheduleRequest) async throws -> ScheduleInspectionResponse {
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
