import Foundation
import Network
import Combine

@MainActor
final class NetworkPathMonitor: ObservableObject {
    @Published private(set) var isOffline = false

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "arx.network.path")

    func start() {
        monitor.pathUpdateHandler = { path in
            let satisfied = path.status == .satisfied
            Task { @MainActor [weak self] in
                self?.isOffline = !satisfied
            }
        }
        monitor.start(queue: queue)
        isOffline = monitor.currentPath.status != .satisfied
    }

    func stop() {
        monitor.cancel()
    }
}
