import SwiftUI
import Supabase

// MARK: - Sisu (rep gamification hub — weekly rank, badges, leaderboard)

struct SisuView: View {
    var onOpenSettings: (() -> Void)? = nil

    @State private var leaderboard: SisuLeaderboardResponse?
    @State private var badges: [SisuBadge] = []
    @State private var incentives: SisuIncentivesResponse?
    @State private var currentUserId: String?
    @State private var isLoading = true
    @State private var error: String?
    @State private var selectedBoard: Board = .closers

    private enum Board: String, CaseIterable {
        case setters = "Setters"
        case closers = "Closers"
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    if isLoading {
                        ProgressView("Loading…")
                            .frame(maxWidth: .infinity)
                            .padding(.top, 60)
                    } else if let error {
                        VStack(spacing: 12) {
                            Image(systemName: "wifi.exclamationmark")
                                .font(.system(size: 40))
                                .foregroundColor(.secondary)
                            Text(error).foregroundColor(.secondary)
                            Button("Retry") { Task { await loadData() } }
                                .buttonStyle(.borderedProminent)
                        }
                        .padding(.top, 60)
                    } else {
                        myRankCard
                        spiffsSection
                        goalSection
                        badgesSection
                        leaderboardSection
                    }
                }
                .padding(.bottom, AppSettings.floatingTabContentInset)
            }
            .navigationTitle("Sisu")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { onOpenSettings?() } label: {
                        Image(systemName: "gearshape.fill")
                    }
                    .accessibilityLabel("Settings")
                }
            }
            .refreshable { await loadData() }
        }
        .task { await loadData() }
    }

    // MARK: - My Rank

    private var myEntry: SisuLeaderboardEntry? {
        guard let currentUserId else { return nil }
        return (leaderboard?.setters ?? []).first(where: { $0.user_id == currentUserId })
            ?? (leaderboard?.closers ?? []).first(where: { $0.user_id == currentUserId })
    }

    private var myEntryBoard: Board? {
        guard let currentUserId else { return nil }
        if (leaderboard?.closers ?? []).contains(where: { $0.user_id == currentUserId }) { return .closers }
        if (leaderboard?.setters ?? []).contains(where: { $0.user_id == currentUserId }) { return .setters }
        return nil
    }

    @ViewBuilder
    private var myRankCard: some View {
        if let me = myEntry {
            VStack(spacing: 14) {
                HStack {
                    Text("THIS WEEK")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.secondary)
                    Spacer()
                    if let board = myEntryBoard {
                        Text(board == .closers ? "Closer" : "Setter")
                            .font(.caption.weight(.semibold))
                            .foregroundColor(AppSettings.brandBlue)
                    }
                }

                HStack(spacing: 20) {
                    VStack(spacing: 2) {
                        Text(rankEmoji(me.rank))
                            .font(.system(size: 30))
                        Text("Rank \(me.rank)")
                            .font(.caption2).foregroundColor(.secondary)
                    }
                    Divider().frame(height: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(me.primary_metric)")
                            .font(.system(size: 30, weight: .bold, design: .rounded))
                        Text(myEntryBoard == .closers ? "Sales" : "Inspections")
                            .font(.caption2).foregroundColor(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        HStack(spacing: 4) {
                            Image(systemName: "medal.fill").foregroundColor(.orange)
                            Text("\(me.badge_count)")
                                .font(.system(size: 20, weight: .bold, design: .rounded))
                        }
                        Text("Badges")
                            .font(.caption2).foregroundColor(.secondary)
                    }
                }
            }
            .padding()
            .background(Color(.secondarySystemBackground))
            .cornerRadius(16)
            .padding(.horizontal)
        }
    }

    private func rankEmoji(_ rank: Int) -> String {
        switch rank {
        case 1: return "🥇"
        case 2: return "🥈"
        case 3: return "🥉"
        default: return "#\(rank)"
        }
    }

    // MARK: - Active SPIFFs (live money — sits right under the rank card on purpose)

    @ViewBuilder
    private var spiffsSection: some View {
        if let spiffs = incentives?.activeSpiffs, !spiffs.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("ACTIVE SPIFFS")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.secondary)
                    .padding(.horizontal)

                ForEach(spiffs) { spiff in
                    SpiffCard(spiff: spiff)
                        .padding(.horizontal)
                }
            }
        }
    }

    // MARK: - Weekly Goal (personal targets — calmer than SPIFFs by design)

    @ViewBuilder
    private var goalSection: some View {
        if let inc = incentives, let goal = inc.goal, goal.hasAnyTarget {
            VStack(alignment: .leading, spacing: 10) {
                Text("MY WEEKLY GOAL")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.secondary)
                    .padding(.horizontal)

                VStack(spacing: 12) {
                    if let target = goal.weekly_doors_target {
                        GoalProgressRow(label: "Doors", current: inc.liveMetrics.doorsKnocked, target: target)
                    }
                    if let target = goal.weekly_inspections_target {
                        GoalProgressRow(label: "Inspections", current: inc.liveMetrics.inspectionsSet, target: target)
                    }
                    if let target = goal.weekly_sales_target {
                        GoalProgressRow(label: "Sales", current: inc.liveMetrics.closedSales, target: target)
                    }
                }
                .padding()
                .background(Color(.secondarySystemBackground))
                .cornerRadius(16)
                .padding(.horizontal)
            }
        }
    }

    // MARK: - Badges

    @ViewBuilder
    private var badgesSection: some View {
        if !badges.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("BADGES")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.secondary)
                    .padding(.horizontal)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(badges) { badge in
                            BadgeChip(badge: badge)
                        }
                    }
                    .padding(.horizontal)
                }
            }
        }
    }

    // MARK: - Leaderboard

    private var leaderboardSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Board", selection: $selectedBoard) {
                ForEach(Board.allCases, id: \.self) { board in
                    Text(board.rawValue).tag(board)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)

            let entries = selectedBoard == .closers ? (leaderboard?.closers ?? []) : (leaderboard?.setters ?? [])
            if entries.isEmpty {
                Text("No activity yet this week")
                    .font(.subheadline).foregroundColor(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(entries.prefix(15).enumerated()), id: \.element.id) { index, entry in
                        SisuLeaderboardRow(
                            entry: entry,
                            metricLabel: selectedBoard == .closers ? "Sales" : "Inspections",
                            isMe: entry.user_id == currentUserId
                        )
                        if index < min(entries.count, 15) - 1 {
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

    // MARK: - Load

    private func loadData() async {
        isLoading = true
        error = nil
        do {
            currentUserId = try? await supabase.auth.session.user.id.uuidString.lowercased()
            async let lb = APIClient.sisuLeaderboard()
            let board = try await lb
            leaderboard = board

            if let uid = currentUserId {
                badges = (try? await APIClient.sisuBadges(userId: uid)) ?? []
            }

            // SPIFFs/goal are additive — a failure here shouldn't blank the whole hub.
            incentives = try? await APIClient.sisuIncentives()

            // Board defaults to wherever the rep actually shows up.
            if let myBoard = myEntryBoard {
                selectedBoard = myBoard
            }
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

// MARK: - SPIFF Card

struct SpiffCard: View {
    let spiff: SisuSpiff

    private var accent: Color {
        if spiff.qualified { return Color(hex: "#10B981") }
        if spiff.isUrgent { return Color(hex: "#EF4444") }
        return AppSettings.brandBlue
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(spiff.name)
                        .font(.subheadline.weight(.bold))
                        .foregroundColor(AppSettings.darkText)
                    Text(spiff.metricLabel)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(spiff.rewardLabel)
                        .font(.subheadline.weight(.bold))
                        .foregroundColor(accent)
                    Text(spiff.timeRemainingLabel)
                        .font(.caption2.weight(spiff.isUrgent ? .bold : .regular))
                        .foregroundColor(spiff.isUrgent ? Color(hex: "#EF4444") : .secondary)
                }
            }

            // Progress toward the threshold
            VStack(alignment: .leading, spacing: 4) {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(accent.opacity(0.15))
                        Capsule()
                            .fill(accent)
                            .frame(width: max(8, geo.size.width * spiff.progressPct / 100))
                    }
                }
                .frame(height: 8)

                HStack {
                    if spiff.qualified {
                        Label("Qualified!", systemImage: "checkmark.seal.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundColor(accent)
                    } else {
                        Text("\(Int(spiff.currentValue)) of \(Int(spiff.threshold))")
                            .font(.caption)
                            .foregroundColor(AppSettings.darkText)
                    }
                    Spacer()
                    if let payout = spiff.payout_amount, spiff.qualified {
                        Text(String(format: "$%.0f earned", payout))
                            .font(.caption.weight(.semibold))
                            .foregroundColor(accent)
                    }
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(spiff.qualified ? accent.opacity(0.5) : Color.clear, lineWidth: 1.5)
        )
    }
}

// MARK: - Goal Progress Row

struct GoalProgressRow: View {
    let label: String
    let current: Int
    let target: Int

    private var fraction: Double {
        guard target > 0 else { return 0 }
        return min(1, Double(current) / Double(target))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                    .font(.caption.weight(.medium))
                    .foregroundColor(AppSettings.darkText)
                Spacer()
                Text("\(current) / \(target)")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(fraction >= 1 ? Color(hex: "#10B981") : AppSettings.darkText)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.secondary.opacity(0.15))
                    Capsule()
                        .fill(fraction >= 1 ? Color(hex: "#10B981") : AppSettings.brandBlue)
                        .frame(width: max(4, geo.size.width * fraction))
                }
            }
            .frame(height: 6)
        }
    }
}

// MARK: - Badge Chip

struct BadgeChip: View {
    let badge: SisuBadge

    private var tint: Color {
        if let hex = badge.incentive_badges?.color_hex, !hex.isEmpty {
            return Color(hex: hex)
        }
        return AppSettings.brandBlue
    }

    private var symbolName: String {
        switch badge.incentive_badges?.icon_key {
        case "target": return "target"
        case "trophy": return "trophy.fill"
        case "fire": return "flame.fill"
        case "star": return "star.fill"
        case "crown": return "crown.fill"
        case "lightning": return "bolt.fill"
        case "diamond": return "diamond.fill"
        case "rocket": return "arrow.up.forward.circle.fill"
        default: return "medal.fill"
        }
    }

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                Circle().fill(tint.opacity(0.15)).frame(width: 56, height: 56)
                Image(systemName: symbolName)
                    .font(.system(size: 22))
                    .foregroundColor(tint)
            }
            Text(badge.incentive_badges?.name ?? "Badge")
                .font(.caption2.weight(.medium))
                .foregroundColor(AppSettings.darkText)
                .lineLimit(1)
                .frame(width: 64)
        }
    }
}

// MARK: - Leaderboard Row

struct SisuLeaderboardRow: View {
    let entry: SisuLeaderboardEntry
    let metricLabel: String
    let isMe: Bool

    private var rankDisplay: String {
        switch entry.rank {
        case 1: return "🥇"
        case 2: return "🥈"
        case 3: return "🥉"
        default: return "\(entry.rank)"
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            Text(rankDisplay)
                .font(.system(size: 16))
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(entry.full_name)
                    .font(.subheadline.weight(isMe ? .bold : .medium))
                HStack(spacing: 6) {
                    Text(entry.role.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    if entry.badge_count > 0 {
                        HStack(spacing: 2) {
                            Image(systemName: "medal.fill").font(.system(size: 9))
                            Text("\(entry.badge_count)").font(.caption2)
                        }
                        .foregroundColor(.orange)
                    }
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text("\(entry.primary_metric)")
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundColor(entry.rank <= 3 ? AppSettings.darkText : .secondary)
                Text(metricLabel)
                    .font(.caption2).foregroundColor(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(isMe ? AppSettings.brandBlue.opacity(0.06) : Color.clear)
    }
}

#Preview {
    SisuView()
}
