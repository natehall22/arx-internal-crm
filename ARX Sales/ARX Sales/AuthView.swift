import SwiftUI
import Supabase

struct AuthView: View {
    @State private var email = ""
    @State private var password = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @FocusState private var focusedField: Field?

    private enum Field { case email, password }

    /// Sampled from the shield artwork so the wordmark and dividers read as one mark with the image.
    private static let shieldCharcoal = Color(hex: "#2E2E2E")

    var body: some View {
        ZStack {
            Self.shieldCharcoal.opacity(0.04).ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer(minLength: 32)

                VStack(spacing: 14) {
                    Image("ARXShield")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 148, height: 148)
                        .shadow(color: Self.shieldCharcoal.opacity(0.18), radius: 16, y: 8)

                    Text("ARX SALES")
                        .font(.system(size: 15, weight: .bold))
                        .kerning(3.2)
                        .foregroundColor(Self.shieldCharcoal)
                }

                Spacer(minLength: 40)

                VStack(spacing: 14) {
                    fieldContainer {
                        TextField("Email", text: $email)
                            .keyboardType(.emailAddress)
                            .textContentType(.username)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                            .focused($focusedField, equals: .email)
                            .submitLabel(.next)
                            .onSubmit { focusedField = .password }
                    }

                    fieldContainer {
                        SecureField("Password", text: $password)
                            .textContentType(.password)
                            .focused($focusedField, equals: .password)
                            .submitLabel(.go)
                            .onSubmit(signIn)
                    }

                    if let errorMessage {
                        HStack(spacing: 6) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.caption)
                            Text(errorMessage)
                                .font(.footnote)
                        }
                        .foregroundColor(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button(action: signIn) {
                        Group {
                            if isLoading {
                                ProgressView().tint(.white)
                            } else {
                                Text("Sign In")
                                    .fontWeight(.semibold)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                    }
                    .background(AppSettings.brandBlue)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                    .disabled(isLoading || email.isEmpty || password.isEmpty)
                    .opacity(isLoading || email.isEmpty || password.isEmpty ? 0.6 : 1)
                    .padding(.top, 6)
                }
                .padding(.horizontal, 28)

                Spacer(minLength: 40)
            }
        }
    }

    @ViewBuilder
    private func fieldContainer<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(Color(.secondarySystemBackground))
            .foregroundColor(AppSettings.darkText)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Self.shieldCharcoal.opacity(0.08), lineWidth: 1)
            )
    }

    private func signIn() {
        focusedField = nil
        isLoading = true
        errorMessage = nil
        Task {
            do {
                try await supabase.auth.signIn(email: email, password: password)
            } catch {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }
}

#Preview {
    AuthView()
}
