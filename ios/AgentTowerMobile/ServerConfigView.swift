import SwiftUI

struct ServerConfigView: View {
    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    @State private var serverURL: String = ""
    @State private var password: String = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var successMessage: String?

    private let authClient = AuthClient()

    init(initialError: String? = nil) {
        _errorMessage = State(initialValue: initialError)
    }

    var body: some View {
        Form {
            Section("Server") {
                TextField("http://192.168.1.20:3000", text: $serverURL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                SecureField("AgentTower password", text: $password)
                    .textContentType(.password)
            }

            Section {
                Button {
                    Task { await connect() }
                } label: {
                    if isSubmitting {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        Text("Connect")
                            .frame(maxWidth: .infinity)
                    }
                }
                .disabled(isSubmitting || serverURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty)
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                }
            }

            if let successMessage {
                Section {
                    Text(successMessage)
                        .foregroundStyle(.green)
                }
            }

            Section("Notes") {
                Text("This app connects to a running AgentTower server. It does not read ~/.claude or ~/.codex directly on iPhone.")
                Text("Use your Mac's LAN IP or a public HTTPS URL for a physical iPhone. `localhost` only works in the iOS Simulator if the server is running on the same Mac.")
            }
        }
        .navigationTitle("Connect")
        .onAppear {
            if serverURL.isEmpty {
                serverURL = settings.serverURLString
            }
        }
    }

    @MainActor
    private func connect() async {
        isSubmitting = true
        errorMessage = nil
        successMessage = nil

        defer { isSubmitting = false }

        let trimmed = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let prefixed = trimmed.contains("://") ? trimmed : "http://\(trimmed)"
        guard let url = URL(string: prefixed) else {
            errorMessage = AuthError.invalidURL.localizedDescription
            return
        }

        do {
            try await authClient.login(serverURL: url, password: password)
            settings.saveServerURL(trimmed)
            successMessage = "Connected."
            password = ""
            dismiss()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}
