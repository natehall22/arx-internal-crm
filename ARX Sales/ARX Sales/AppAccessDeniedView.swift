import SwiftUI
import Supabase

/// Shown instead of the tab UI when `/api/mobile/capabilities` reports `app_access: false`
/// (inside-sales queue workers) or a cached prior denial for this user, offline.
/// ARX Sales is the field-canvassing app for setters/closers only.
struct AppAccessDeniedView: View {
    @State private var isSigningOut = false

    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            Image(systemName: "figure.walk.circle")
                .font(.system(size: 56))
                .foregroundColor(AppSettings.brandBlue)

            Text("This app is for field reps")
                .font(.title2.weight(.semibold))
                .foregroundColor(AppSettings.darkText)
                .multilineTextAlignment(.center)

            Text("ARX Sales is the canvassing app for setters and closers in the field. Inside sales works from the web CRM. If you think this is a mistake, contact your admin.")
                .font(.subheadline)
                .foregroundColor(AppSettings.darkText.opacity(0.75))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Spacer()

            Button {
                signOut()
            } label: {
                if isSigningOut {
                    ProgressView()
                } else {
                    Text("Sign Out")
                        .fontWeight(.semibold)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(AppSettings.brandBlue)
            .disabled(isSigningOut)
            .padding(.bottom, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
    }

    private func signOut() {
        isSigningOut = true
        Task {
            try? await supabase.auth.signOut()
            await MainActor.run { isSigningOut = false }
        }
    }
}

#Preview {
    AppAccessDeniedView()
}
