import Foundation
import Network
import Combine

@MainActor
final class NetworkPathMonitor: ObservableObject {
    @Published private(set) var isOffline = false

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "arx.network.path")

    func start() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.isOffline = path.status != .satisfied
            }
        }
        monitor.start(queue: queue)
        isOffline = monitor.currentPath.status != .satisfied
    }

    func stop() {
        monitor.cancel()
    }
}
