import SwiftUI
import Supabase

// MARK: - Dashboard View

struct DashboardView: View {
    var onRoleLoaded: ((String) -> Void)? = nil
    var onOpenSettings: (() -> Void)? = nil

    @AppStorage(AppSettings.Keys.focusMode) private var focusMode = false

    @State private var stats: PersonalStats?
    @State private var teamStats: TeamStatsResponse?
    @State private var isLoading = true
    @State private var error: String?
    @State private var timeframe = "week"
    @State private var userName: String = ""
    @State private var userRole: String = ""

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {

                    // MARK: - Timeframe Picker
                    Picker("Timeframe", selection: $timeframe) {
                        Text("Week").tag("week")
                        Text("Month").tag("month")
                        Text("All Time").tag("all")
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal)
                    .onChange(of: timeframe) { _ in
                        Task { await loadData() }
                    }

                    if isLoading {
                        ProgressView("Loading...")
                            .frame(maxWidth: .infinity)
                            .padding(.top, 60)

                    } else if let error {
                        VStack(spacing: 12) {
                            Image(systemName: "wifi.exclamationmark")
                                .font(.system(size: 40))
                                .foregroundColor(.secondary)
                            Text(error)
                                .foregroundColor(.secondary)
                            Button("Retry") {
                                Task { await loadData() }
                            }
                            .buttonStyle(.borderedProminent)
                        }
                        .padding(.top, 60)

                    } else {
                        // MARK: - My Numbers
                        myNumbersSection

                        if !focusMode {
                            leaderboardSection
                        }
                    }
                }
                .padding(.bottom, AppSettings.floatingTabContentInset)
            }
            .navigationTitle(greeting)
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        onOpenSettings?()
                    } label: {
                        Image(systemName: "gearshape.fill")
                    }
                    .accessibilityLabel("Settings")
                }
            }
            .refreshable {
                await loadData()
            }
        }
        .task {
            await loadUserProfile()
            await loadData()
        }
    }

    // MARK: - My Numbers Section

    private var myNumbersSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("MY NUMBERS")
                .font(.caption.weight(.semibold))
                .foregroundColor(.secondary)
                .padding(.horizontal)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                StatCard(label: "Doors", value: stats?.doorsKnocked ?? 0, icon: "hand.raised.fill", color: .blue)
                StatCard(label: "Contacts", value: stats?.contacts ?? 0, icon: "person.fill.checkmark", color: .purple)
                StatCard(label: "Inspections", value: stats?.inspectionsSet ?? 0, icon: "calendar.badge.plus", color: .orange)
                StatCard(label: "Sales", value: stats?.sales ?? 0, icon: "dollarsign.circle.fill", color: .green)
            }
            .padding(.horizontal)

            // Close rate + efficiency (closers only — nil when not applicable)
            if stats?.closeRate != nil || stats?.efficiency != nil {
                HStack(spacing: 12) {
                    if let closeRate = stats?.closeRate {
                        RateCard(label: "Close Rate", value: closeRate, color: .teal)
                    }
                    if let efficiency = stats?.efficiency {
                        RateCard(label: "Efficiency", value: efficiency, color: .indigo)
                    }
                }
                .padding(.horizontal)
            }
        }
    }

    // MARK: - Leaderboard Section

    private var leaderboardSection: some View {
        VStack(alignment: .leading, spacing: 12) {

            if let setters = teamStats?.setterStats, !setters.isEmpty {
                LeaderboardSection(title: "SETTERS", members: setters, metric: "Inspections", keyPath: \.inspectionsSet)
            }

            if let closers = teamStats?.closerStats, !closers.isEmpty {
                LeaderboardSection(title: "CLOSERS", members: closers, metric: "Sales", keyPath: \.sales)
            }
        }
    }

    // MARK: - Helpers

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        let time = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening"
        let first = userName.components(separatedBy: " ").first ?? userName
        let capitalized = first.prefix(1).uppercased() + first.dropFirst()
        return userName.isEmpty ? "Good \(time)" : "Good \(time), \(capitalized)"
    }

    private func loadUserProfile() async {
        guard let user = try? await supabase.auth.user() else { return }

        // Name from metadata
        let metadata = user.userMetadata
        let name = metadata["full_name"]?.stringValue ?? metadata["name"]?.stringValue
        if let name, !name.isEmpty {
            userName = name
        } else {
            userName = user.email?.components(separatedBy: "@").first ?? ""
        }

        // Role from users table — drives tab visibility in parent
        struct UserRow: Decodable { let role: String? }
        if let rows = try? await supabase
            .from("users")
            .select("role")
            .eq("id", value: user.id)
            .limit(1)
            .execute()
            .value as [UserRow],
           let role = rows.first?.role {
            userRole = role
            onRoleLoaded?(role)
        }
    }

    private func loadData() async {
        isLoading = true
        error = nil
        do {
            async let personal = APIClient.personalStats(timeframe: timeframe)
            async let team = APIClient.teamStats(timeframe: timeframe)
            let (p, t) = try await (personal, team)
            stats = p
            teamStats = t
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

// MARK: - Stat Card

struct StatCard: View {
    let label: String
    let value: Int
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .foregroundColor(color)
                Spacer()
            }
            Text("\(value)")
                .font(.system(size: 34, weight: .bold, design: .rounded))
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(14)
    }
}

// MARK: - Rate Card

struct RateCard: View {
    let label: String
    let value: Double
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
            Text(String(format: "%.1f%%", value))
                .font(.system(size: 28, weight: .bold, design: .rounded))
                .foregroundColor(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(14)
    }

    // closeRate/efficiency come in as already-percentage e.g. 35.5 = 35.5%
    private var formatted: String {
        String(format: "%.1f%%", value)
    }
}

// MARK: - Leaderboard Section

struct LeaderboardSection: View {
    let title: String
    let members: [TeamMemberStats]
    let metric: String
    let keyPath: KeyPath<TeamMemberStats, Int?>

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundColor(.secondary)
                .padding(.horizontal)

            VStack(spacing: 0) {
                ForEach(Array(members.prefix(10).enumerated()), id: \.element.id) { index, member in
                    LeaderboardRow(rank: index + 1, member: member, metric: metric, value: member[keyPath: keyPath] ?? 0)
                    if index < min(members.count, 10) - 1 {
                        Divider().padding(.leading, 56)
                    }
                }
            }
            .background(Color(.secondarySystemBackground))
            .cornerRadius(14)
            .padding(.horizontal)
        }
    }
}

// MARK: - Leaderboard Row

struct LeaderboardRow: View {
    let rank: Int
    let member: TeamMemberStats
    let metric: String
    let value: Int

    var body: some View {
        HStack(spacing: 12) {
            // Rank
            Text(rankEmoji)
                .font(.system(size: 18))
                .frame(width: 32)

            // Name
            VStack(alignment: .leading, spacing: 2) {
                Text(member.name ?? "Unknown")
                    .font(.subheadline.weight(.medium))
                Text(member.role?.replacingOccurrences(of: "_", with: " ").capitalized ?? "")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // Value
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(value)")
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundColor(rank <= 3 ? .primary : .secondary)
                Text(metric)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var rankEmoji: String {
        switch rank {
        case 1: return "🥇"
        case 2: return "🥈"
        case 3: return "🥉"
        default: return "\(rank)"
        }
    }
}

#Preview {
    DashboardView()
}
