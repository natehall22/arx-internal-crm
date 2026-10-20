import Foundation

// MARK: - Models (GET/POST /api/referral-partners, /api/referral-partners/[id])

struct ReferralPartner: Decodable, Identifiable, Equatable {
    struct PartnerType: Decodable, Equatable {
        let id: String
        let name: String
        let inactivity_days: Int?
    }
    struct Assignee: Decodable, Equatable {
        let id: String?
        let full_name: String?
    }

    let id: String
    let name: String
    let phone: String?
    let email: String?
    let company: String?
    let notes: String?
    let other_type_text: String?
    /// "assigned" | "open" | "company_relationship"
    let status: String
    let assigned_user_id: String?
    let last_touched_at: String?
    let days_until_open: Int?
    let is_mine: Bool?
    /// Near-spelling match rather than a prefix match.
    let similar: Bool?
    let type: PartnerType?
    let assignee: Assignee?

    var isMine: Bool { is_mine ?? false }

    var typeLabel: String {
        let base = type?.name ?? "Other"
        let other = other_type_text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return base.lowercased() == "other" && !other.isEmpty ? other : base
    }

    /// "Assigned To: Rep Name" / "Open" / "Company Relationship".
    var assignedToLabel: String {
        switch status {
        case "company_relationship": return "Company Relationship"
        case "open": return "Open"
        default:
            if isMine { return "Assigned To you" }
            let name = assignee?.full_name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return "Assigned To: \(name.isEmpty ? "Unknown rep" : name)"
        }
    }

    var opensInLabel: String? {
        guard let days = days_until_open else { return nil }
        if days == 0 { return "Opens today" }
        return days == 1 ? "Opens in 1 day" : "Opens in \(days) days"
    }
}

struct ReferralPartnerType: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let is_active: Bool
}

struct ReferralPartnerTouch: Decodable, Identifiable {
    struct Who: Decodable { let full_name: String? }
    let id: String
    let type: String
    let body: String
    let created_at: String
    let user: Who?
}

struct ReferralPartnerDetail: Decodable {
    let partner: ReferralPartner
    let can_work: Bool
    let touches: [ReferralPartnerTouch]
    let referred_count: Int
    let jobs_sold: Int
    let revenue_sold: Double
}

struct ReferralPartnerSummary: Decodable {
    struct Soon: Decodable, Identifiable {
        let id: String
        let name: String
        let days_until_open: Int
    }
    let assigned_count: Int
    let opening_soon: [Soon]
    let opening_soon_count: Int
    let jobs_this_month: Int
}

/// Fixed product wording; `type` is the `activities.type` the server expects.
enum PartnerTouchKind: String, CaseIterable, Identifiable {
    case call, text, email, visit
    var id: String { rawValue }
    var label: String {
        switch self {
        case .call: return "Called"
        case .text: return "Texted"
        case .email: return "Emailed"
        case .visit: return "Visited"
        }
    }
}

enum PartnerAPIError: LocalizedError {
    /// 409: the phone is already a partner. Carries the (redacted) existing row.
    case alreadyExists(ReferralPartner?)
    case message(String)
    var errorDescription: String? {
        switch self {
        case .alreadyExists: return "That phone number is already in the system."
        case .message(let m): return m
        }
    }
}

private struct PartnerFailure: Decodable {
    let error: String?
    let partner: ReferralPartner?
}

// MARK: - Calls

extension APIClient {
    /// JSON request that keeps the server's `{ error }` text and exposes the 409 duplicate row.
    private static func partnerSend(
        _ method: String,
        path: String,
        body: (some Encodable)? = Optional<String>.none,
        queryItems: [URLQueryItem] = []
    ) async throws -> Data {
        guard let token = await bearerToken() else { throw APIError.unauthenticated }
        var components = URLComponents(string: baseURL + path)!
        if !queryItems.isEmpty { components.queryItems = queryItems }
        var req = URLRequest(url: components.url!)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        req.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode < 400 { return data }
        let failure = try? JSONDecoder().decode(PartnerFailure.self, from: data)
        if http.statusCode == 409, failure?.error == "exists" {
            throw PartnerAPIError.alreadyExists(failure?.partner)
        }
        if let message = failure?.error, !message.isEmpty { throw PartnerAPIError.message(message) }
        throw APIError.httpError(http.statusCode)
    }

    static func referralPartners(query: String, scope: String) async throws -> [ReferralPartner] {
        struct Response: Decodable { let partners: [ReferralPartner] }
        let data = try await partnerSend(
            "GET", path: "/api/referral-partners",
            queryItems: [URLQueryItem(name: "q", value: query), URLQueryItem(name: "scope", value: scope)]
        )
        return try JSONDecoder().decode(Response.self, from: data).partners
    }

    static func referralPartnerTypes() async throws -> [ReferralPartnerType] {
        struct Response: Decodable { let types: [ReferralPartnerType] }
        let data = try await partnerSend("GET", path: "/api/referral-partner-types")
        return try JSONDecoder().decode(Response.self, from: data).types.filter { $0.is_active }
    }

    static func referralPartnerDetail(id: String) async throws -> ReferralPartnerDetail {
        let data = try await partnerSend("GET", path: "/api/referral-partners/\(id)")
        return try JSONDecoder().decode(ReferralPartnerDetail.self, from: data)
    }

    static func referralPartnerSummary() async throws -> ReferralPartnerSummary {
        let data = try await partnerSend("GET", path: "/api/referral-partners/summary")
        return try JSONDecoder().decode(ReferralPartnerSummary.self, from: data)
    }

    struct NewReferralPartner: Encodable {
        let type_id: String
        let other_type_text: String
        let name: String
        let phone: String
        let company: String
        let email: String
        let notes: String
    }

    static func createReferralPartner(_ partner: NewReferralPartner) async throws -> ReferralPartner {
        struct Response: Decodable { let partner: ReferralPartner }
        let data = try await partnerSend("POST", path: "/api/referral-partners", body: partner)
        return try JSONDecoder().decode(Response.self, from: data).partner
    }

    static func logPartnerTouch(id: String, kind: PartnerTouchKind) async throws {
        struct Body: Encodable { let type: String }
        _ = try await partnerSend("POST", path: "/api/referral-partners/\(id)/touch", body: Body(type: kind.rawValue))
    }

    /// PATCH /api/opportunities/[id] — Referred By. `nil` clears it. Server enforces who may set it.
    static func setReferredBy(opportunityId: String, partnerId: String?) async throws {
        struct Body: Encodable {
            let referral_partner_id: String?
            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(referral_partner_id, forKey: .referral_partner_id) // explicit null clears
            }
            enum CodingKeys: String, CodingKey { case referral_partner_id }
        }
        _ = try await partnerSend("PATCH", path: "/api/opportunities/\(opportunityId)", body: Body(referral_partner_id: partnerId))
    }
}
