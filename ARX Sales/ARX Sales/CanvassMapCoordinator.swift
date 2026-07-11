import MapKit
import Combine

@MainActor
final class CanvassMapCoordinator: ObservableObject {
    static let shared = CanvassMapCoordinator()

    @Published var lastRegion = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 35.22, longitude: -80.84),
        span: MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05)
    )

    var flyToCoordinate: ((CLLocationCoordinate2D) -> Void)?
}
