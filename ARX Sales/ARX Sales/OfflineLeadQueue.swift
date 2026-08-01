import Foundation
import Network
import SwiftUI
import Combine

// MARK: - Queue item

/// Plain data payload owned by the `OfflineLeadQueue` actor — opts out of the project's
/// default MainActor isolation so the actor can construct/mutate it without hopping actors.
nonisolated struct QueuedLeadItem: Codable, Identifiable {
    let id: UUID
    var request: SaveLeadRequest
    let enqueuedAt: Date
    var attemptCount: Int
    var needsAttention: Bool

    init(id: UUID = UUID(), request: SaveLeadRequest, enqueuedAt: Date = Date(), attemptCount: Int = 0, needsAttention: Bool = false) {
        self.id = id
        self.request = request
        self.enqueuedAt = enqueuedAt
        self.attemptCount = attemptCount
        self.needsAttention = needsAttention
    }
}

enum SaveLeadOutcome: Equatable {
    case synced(SaveLeadResponse)
    case queuedOffline
}

// MARK: - Enqueue policy (testable)

enum OfflineQueuePolicy {
    nonisolated static func shouldQueue(error: Error) -> Bool {
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .timedOut, .networkConnectionLost, .cannotFindHost, .dnsLookupFailed:
                return true
            default:
                return false
            }
        }
        if case APIError.httpError(let code) = error {
            return code >= 500
        }
        return false
    }
}

// MARK: - Actor-backed per-user file queue

actor OfflineLeadQueue {
    static let shared = OfflineLeadQueue()

    private static let appSupportDir: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    static func queueFileName(userId: String) -> String {
        "offline-lead-queue-\(userId).json"
    }

    private var items: [QueuedLeadItem] = []
    private var currentUserId: String?
    private var isFlushing = false
    private var flushGeneration: UInt = 0

    private init() {}

    func configuredUserId() -> String? { currentUserId }

    /// Switch active queue to the signed-in user. Pass nil on sign-out (no flush).
    func configure(userId: String?) {
        flushGeneration &+= 1
        currentUserId = userId
        items = []
        guard let userId else { return }
        let url = Self.appSupportDir.appendingPathComponent(Self.queueFileName(userId: userId))
        if let data = try? Data(contentsOf: url),
           let decoded = try? JSONDecoder().decode([QueuedLeadItem].self, from: data) {
            items = decoded
        }
    }

    func canEnqueue() -> Bool { currentUserId != nil }

    func allItems() -> [QueuedLeadItem] { items }

    var pendingCount: Int { items.count }

    @discardableResult
    func enqueue(_ request: SaveLeadRequest) async -> Bool {
        guard currentUserId != nil else { return false }
        if let clientId = request.client_lead_id, !clientId.isEmpty,
           let idx = items.firstIndex(where: { $0.request.client_lead_id == clientId }) {
            var existing = items[idx]
            existing.request.merge(from: request)
            existing.needsAttention = false
            existing.attemptCount = 0
            items[idx] = existing
        } else if let leadId = request.lead_id, !leadId.isEmpty,
                  let idx = items.firstIndex(where: { $0.request.lead_id == leadId }) {
            var existing = items[idx]
            existing.request.merge(from: request)
            existing.needsAttention = false
            existing.attemptCount = 0
            items[idx] = existing
        } else {
            items.append(QueuedLeadItem(request: request))
        }
        persist()
        await MainActor.run {
            OfflineLeadQueueBridge.shared.notifyChanged()
            OfflineLeadQueueBridge.shared.kickFlushIfOnline()
        }
        return true
    }

    func remove(id: UUID) async {
        items.removeAll { $0.id == id }
        persist()
        await MainActor.run { OfflineLeadQueueBridge.shared.notifyChanged() }
    }

    func retryItem(id: UUID) async {
        guard let idx = items.firstIndex(where: { $0.id == id }) else { return }
        items[idx].needsAttention = false
        items[idx].attemptCount = 0
        persist()
        await MainActor.run { OfflineLeadQueueBridge.shared.notifyChanged() }
        await flush()
    }

    func flush() async {
        guard let ownerUserId = currentUserId else { return }
        guard !isFlushing else { return }
        isFlushing = true
        let generation = flushGeneration
        defer { isFlushing = false }

        let maxBackoffAttempts = 10

        while let nextId = items.first(where: { !$0.needsAttention })?.id {
            guard currentUserId == ownerUserId, flushGeneration == generation else { return }
            do {
                guard let idx = items.firstIndex(where: { $0.id == nextId }) else { continue }
                let request = items[idx].request
                guard let token = await APIClient.bearerToken() else { return }
                guard currentUserId == ownerUserId, flushGeneration == generation else { return }
                _ = try await APIClient.saveLeadDirect(request, accessToken: token)
                guard currentUserId == ownerUserId, flushGeneration == generation else { return }
                guard let removeIdx = items.firstIndex(where: { $0.id == nextId }) else { continue }
                items.remove(at: removeIdx)
                persist()
                await MainActor.run {
                    OfflineLeadQueueBridge.shared.notifyChanged()
                    OfflineLeadQueueBridge.shared.notifySyncSuccess()
                }
            } catch {
                guard currentUserId == ownerUserId, flushGeneration == generation else { return }
                guard let idx = items.firstIndex(where: { $0.id == nextId }) else { continue }
                var item = items[idx]

                // Transient auth — retry briefly; permanent 401 becomes needsAttention.
                if case APIError.httpError(let code) = error, code == 401 {
                    item.attemptCount += 1
                    if item.attemptCount >= 3 { item.needsAttention = true }
                    items[idx] = item
                    persist()
                    await MainActor.run { OfflineLeadQueueBridge.shared.notifyChanged() }
                    if !item.needsAttention {
                        try? await Task.sleep(nanoseconds: 2_000_000_000)
                    }
                    continue
                }

                if !OfflineQueuePolicy.shouldQueue(error: error) {
                    item.needsAttention = true
                    items[idx] = item
                    persist()
                    await MainActor.run { OfflineLeadQueueBridge.shared.notifyChanged() }
                    continue
                }

                item.attemptCount += 1
                if item.attemptCount >= maxBackoffAttempts {
                    item.needsAttention = true
                }
                items[idx] = item
                persist()
                await MainActor.run { OfflineLeadQueueBridge.shared.notifyChanged() }

                if item.needsAttention { continue }

                let backoffSec = min(pow(2.0, Double(item.attemptCount)), 120.0)
                try? await Task.sleep(nanoseconds: UInt64(backoffSec * 1_000_000_000))
            }
        }
    }

    private func persist() {
        guard let userId = currentUserId else { return }
        let url = Self.appSupportDir.appendingPathComponent(Self.queueFileName(userId: userId))
        guard let data = try? JSONEncoder().encode(items) else { return }
        try? data.write(to: url, options: .atomic)
    }

    #if DEBUG
    func resetForTesting(userId: String) {
        currentUserId = userId
        items = []
        let url = Self.appSupportDir.appendingPathComponent(Self.queueFileName(userId: userId))
        try? FileManager.default.removeItem(at: url)
    }

    func debugEnqueueCoalesce(_ requests: [SaveLeadRequest]) async {
        for r in requests { await enqueue(r) }
    }
    #endif
}

#if DEBUG
enum OfflineQueueTests {
    static func runCoalesceTests() -> Bool {
        var base = SaveLeadRequest()
        base.client_lead_id = "abc"
        base.lat = 35.0
        base.canvass_disposition = "not_home"

        var update = SaveLeadRequest()
        update.client_lead_id = "abc"
        update.canvass_disposition = "hot_lead"
        update.canvass_notes = "Call back Tuesday"

        base.merge(from: update)
        guard base.canvass_disposition == "hot_lead",
              base.canvass_notes == "Call back Tuesday",
              base.lat == 35.0 else { return false }
        return true
    }
}
#endif

// MARK: - Observable bridge for SwiftUI

@MainActor
final class OfflineLeadQueueBridge: ObservableObject {
    static let shared = OfflineLeadQueueBridge()

    @Published private(set) var pendingItems: [QueuedLeadItem] = []
    @Published private(set) var pendingCount: Int = 0

    /// Called after a queued item syncs successfully — reload map pins.
    var onSyncSuccess: (() -> Void)?

    private var monitor: NWPathMonitor?
    private let monitorQueue = DispatchQueue(label: "arx.offline.queue.monitor")
    private var pathIsSatisfied = false
    private(set) var currentUserId: String?

    private init() {}

    /// Bind queue to signed-in user; pass nil on sign-out (stops monitor, clears UI, no flush).
    func configure(forUserId userId: String?) async {
        if userId == currentUserId, userId != nil, monitor != nil {
            await refresh()
            return
        }

        stopMonitor()
        currentUserId = userId

        if userId == nil {
            pendingItems = []
            pendingCount = 0
            onSyncSuccess = nil
            await OfflineLeadQueue.shared.configure(userId: nil)
            return
        }

        await OfflineLeadQueue.shared.configure(userId: userId)
        await refresh()
        startMonitorIfNeeded()

        if pathIsSatisfied {
            await OfflineLeadQueue.shared.flush()
            await refresh()
        }
    }

    /// Legacy entry — prefer configure(forUserId:) from auth layer.
    func start() {
        guard currentUserId != nil else { return }
        Task {
            await refresh()
            startMonitorIfNeeded()
        }
    }

    private func startMonitorIfNeeded() {
        guard currentUserId != nil else { return }
        guard monitor == nil else { return }
        let mon = NWPathMonitor()
        mon.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            Task { @MainActor in
                guard let self else { return }
                self.pathIsSatisfied = satisfied
                guard satisfied, self.currentUserId != nil else { return }
                await OfflineLeadQueue.shared.flush()
                await self.refresh()
            }
        }
        mon.start(queue: monitorQueue)
        pathIsSatisfied = mon.currentPath.status == .satisfied
        monitor = mon
    }

    private func stopMonitor() {
        monitor?.cancel()
        monitor = nil
        pathIsSatisfied = false
    }

    func notifyChanged() {
        Task { await refresh() }
    }

    func kickFlushIfOnline() {
        guard pathIsSatisfied, currentUserId != nil else { return }
        Task {
            await OfflineLeadQueue.shared.flush()
            await refresh()
        }
    }

    func notifySyncSuccess() {
        onSyncSuccess?()
    }

    func refresh() async {
        let items = await OfflineLeadQueue.shared.allItems()
        pendingItems = items
        pendingCount = items.count
    }

    func flushNow() async {
        guard currentUserId != nil else { return }
        await OfflineLeadQueue.shared.flush()
        await refresh()
    }

    func retry(id: UUID) async {
        await OfflineLeadQueue.shared.retryItem(id: id)
        await refresh()
    }

    /// Queued payload for a map pin id (client_lead_id or lead_id).
    func queuedItem(matchingPinId pinId: String) -> QueuedLeadItem? {
        pendingItems.first { item in
            item.request.client_lead_id == pinId || item.request.lead_id == pinId
        }
    }

    /// New offline leads only (no server lead_id yet).
    func localPendingPins(ownerUserId: String?) -> [CanvassPin] {
        pendingItems.compactMap { item in
            guard item.request.lead_id == nil,
                  let clientId = item.request.client_lead_id,
                  let lat = item.request.lat,
                  let lng = item.request.lng else { return nil }
            return CanvassPin(
                id: clientId,
                lat: lat,
                lng: lng,
                d: item.request.canvass_disposition,
                s: nil,
                o: ownerUserId,
                t: ISO8601DateFormatter().string(from: item.enqueuedAt),
                ia: nil,
                isPending: true,
                isPendingEdit: false,
                address_text: item.request.address_text,
                homeowner_name: item.request.homeowner_name,
                phone: item.request.phone,
                notes: item.request.canvass_notes
            )
        }
    }
}

// MARK: - Pending list sheet

struct PendingSyncSheet: View {
    @ObservedObject var bridge: OfflineLeadQueueBridge
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            List {
                if bridge.pendingItems.isEmpty {
                    Text("No pending syncs")
                        .foregroundColor(AppSettings.darkText.opacity(0.75))
                } else {
                    ForEach(bridge.pendingItems) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.request.address_text ?? "Lead")
                                .font(.subheadline.weight(.semibold))
                                .foregroundColor(AppSettings.darkText)
                            if item.request.lead_id != nil {
                                Text("Edit to existing lead")
                                    .font(.caption2)
                                    .foregroundColor(AppSettings.darkText.opacity(0.6))
                            }
                            if let disp = item.request.canvass_disposition, !disp.isEmpty {
                                Text(CanvassDisposition.find(disp)?.label ?? disp)
                                    .font(.caption)
                                    .foregroundColor(AppSettings.darkText.opacity(0.75))
                            }
                            if item.needsAttention {
                                Text("Needs attention — tap Retry")
                                    .font(.caption)
                                    .foregroundColor(Color(hex: "#B45309"))
                            } else {
                                Text("Waiting to sync")
                                    .font(.caption)
                                    .foregroundColor(AppSettings.darkText.opacity(0.6))
                            }
                        }
                        .swipeActions {
                            if item.needsAttention {
                                Button("Retry") {
                                    Task { await bridge.retry(id: item.id) }
                                }
                                .tint(AppSettings.brandBlue)
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Pending Sync")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Sync Now") {
                        Task { await bridge.flushNow() }
                    }
                }
            }
        }
    }
}
