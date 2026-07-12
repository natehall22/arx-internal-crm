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
        // Matches entitlements `aps-environment` = development (pre-App-Store).
        // App Store release: switch entitlement + this string to production.
        let environment = "sandbox"
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

    func routeNotification(userInfo: [AnyHashable: Any]) {
        let type = (userInfo["type"] as? String)?.lowercased()
        switch type {
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
        let userInfo = response.notification.request.content.userInfo
        Task { @MainActor in
            PushManager.shared.routeNotification(userInfo: userInfo)
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
