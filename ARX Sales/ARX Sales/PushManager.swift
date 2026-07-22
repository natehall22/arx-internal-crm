import Foundation
import UIKit
import UserNotifications
import Combine

/// Coordinates APNs permission, token registration, and notification-tap tab routing.
@MainActor
final class PushManager: NSObject, ObservableObject {
    static let shared = PushManager()

    /// Last device token hex string (for sign-out DELETE).
    @Published private(set) var deviceTokenHex: String?

    /// Deep-link tab request from a notification tap (ContentView observes).
    @Published var pendingTab: AppTab?

    private var didRequestAuthorization = false

    private override init() {
        super.init()
    }

    /// Call after successful sign-in — never at cold launch before auth.
    func requestAuthorizationAfterSignIn() {
        guard !didRequestAuthorization else {
            // Re-register if we already have a token (session restore).
            if deviceTokenHex != nil {
                UIApplication.shared.registerForRemoteNotifications()
            }
            return
        }
        didRequestAuthorization = true

        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error {
                print("[PushManager] authorization error: \(error.localizedDescription)")
            }
            guard granted else { return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    func handleDeviceToken(_ deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        deviceTokenHex = hex
        // The reported environment must match how this build was signed, or APNs rejects
        // the token with BadDeviceToken and the backend purges the row as "unregistered":
        //   • Debug (Xcode run / development provisioning) → sandbox APNs
        //   • Release (TestFlight / App Store)            → production APNs
        // Xcode flips the aps-environment entitlement development→production on distribution
        // export, so key this off the build configuration to stay in lockstep.
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        Task {
            do {
                try await APIClient.registerPushToken(hex, environment: environment)
            } catch {
                print("[PushManager] register failed: \(error.localizedDescription)")
            }
        }
    }

    func handleRegistrationFailure(_ error: Error) {
        print("[PushManager] registerForRemoteNotifications failed: \(error.localizedDescription)")
    }

    /// Call on sign-out — deletes server token then clears local state.
    func unregisterOnSignOut() async {
        let token = deviceTokenHex
        didRequestAuthorization = false
        if let token {
            try? await APIClient.unregisterPushToken(token)
        }
        deviceTokenHex = nil
        pendingTab = nil
    }

    func routeNotification(type: String?) {
        switch type?.lowercased() {
        case "spiff", "sisu_heat_qualified":
            pendingTab = .sisu
        case "appointment", "new_appointment", "appointment_assigned", "appointment_reassigned":
            let home = HomeScreenSetting(
                rawValue: UserDefaults.standard.string(forKey: AppSettings.Keys.homeScreen) ?? HomeScreenSetting.sisu.rawValue
            ) ?? .sisu
            pendingTab = home.tab
        default:
            let home = HomeScreenSetting(
                rawValue: UserDefaults.standard.string(forKey: AppSettings.Keys.homeScreen) ?? HomeScreenSetting.sisu.rawValue
            ) ?? .sisu
            pendingTab = home.tab
        }
    }
}

extension PushManager: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .sound])
        } else {
            completionHandler([.alert, .sound])
        }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        // Extract the only field routing needs before hopping actors — [AnyHashable: Any]
        // isn't Sendable, but the String is (silences the Swift 6 capture warning).
        let type = response.notification.request.content.userInfo["type"] as? String
        Task { @MainActor in
            PushManager.shared.routeNotification(type: type)
            completionHandler()
        }
    }
}

/// Minimal UIKit bridge for APNs device-token callbacks.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            PushManager.shared.handleDeviceToken(deviceToken)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in
            PushManager.shared.handleRegistrationFailure(error)
        }
    }
}
