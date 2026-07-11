//
//  ARX_SalesApp.swift
//  ARX Sales
//
//  Created by Nathan Hall on 5/16/26.
//

import SwiftUI
import Supabase

@main
struct ARX_SalesApp: App {
    @State private var isAuthenticated = false
    @AppStorage(AppSettings.Keys.colorScheme) private var colorSchemeRaw = ColorSchemeSetting.system.rawValue

    private var preferredScheme: ColorScheme? {
        (ColorSchemeSetting(rawValue: colorSchemeRaw) ?? .system).preferredColorScheme
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if isAuthenticated {
                    ContentView()
                } else {
                    AuthView()
                }
            }
            .preferredColorScheme(preferredScheme)
            .task {
                // Listen for auth state changes (sign in / sign out / token refresh).
                // `initialSession` is always emitted first — required for restored sessions on cold start.
                for await state in supabase.auth.authStateChanges {
                    switch state.event {
                    case .initialSession, .signedIn:
                        if let session = state.session, !session.isExpired {
                            let userId = session.user.id.uuidString.lowercased()
                            await OfflineLeadQueueBridge.shared.configure(forUserId: userId)
                            isAuthenticated = true
                        } else {
                            await OfflineLeadQueueBridge.shared.configure(forUserId: nil)
                            isAuthenticated = false
                        }
                    case .tokenRefreshed:
                        if let session = state.session, !session.isExpired {
                            let userId = session.user.id.uuidString.lowercased()
                            await OfflineLeadQueueBridge.shared.configure(forUserId: userId)
                            isAuthenticated = true
                        } else {
                            isAuthenticated = false
                            await OfflineLeadQueueBridge.shared.configure(forUserId: nil)
                        }
                    case .userUpdated:
                        if let session = state.session {
                            isAuthenticated = !session.isExpired
                        } else {
                            isAuthenticated = false
                        }
                    case .signedOut, .userDeleted:
                        isAuthenticated = false
                        await OfflineLeadQueueBridge.shared.configure(forUserId: nil)
                    case .passwordRecovery, .mfaChallengeVerified:
                        break
                    }
                }
            }
        }
    }
}
