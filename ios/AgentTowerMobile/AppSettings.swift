import Foundation
import WebKit

@MainActor
final class AppSettings: ObservableObject {
    @Published var serverURLString: String
    @Published var isConfigured: Bool
    @Published var isBootstrapping = true
    @Published var bootstrapError: String?

    private let defaults = UserDefaults.standard
    private let serverURLKey = "agenttower.serverURL"
    private let bundledPassword: String

    init() {
        let bundledURL = Self.bundledValue(forKey: "AgentTowerServerURL")
        let savedURL = defaults.string(forKey: serverURLKey)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let initialURL = bundledURL.isEmpty ? savedURL : bundledURL

        self.serverURLString = initialURL
        self.isConfigured = !initialURL.isEmpty
        self.bundledPassword = Self.bundledValue(forKey: "AgentTowerPassword")
    }

    var normalizedServerURL: URL? {
        guard !serverURLString.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let raw = serverURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        let prefixed = raw.contains("://") ? raw : "http://\(raw)"
        guard let url = URL(string: prefixed) else { return nil }
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        components.path = ""
        components.query = nil
        components.fragment = nil
        return components.url
    }

    func saveServerURL(_ value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        serverURLString = trimmed
        defaults.set(trimmed, forKey: serverURLKey)
        isConfigured = !trimmed.isEmpty
    }

    func bootstrap() async {
        defer { isBootstrapping = false }
        guard let serverURL = normalizedServerURL else { return }
        guard !bundledPassword.isEmpty else { return }

        do {
            try await AuthClient().login(serverURL: serverURL, password: bundledPassword)
            saveServerURL(serverURL.absoluteString)
        } catch {
            bootstrapError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            isConfigured = false
        }
    }

    func clearSession() async {
        let store = WKWebsiteDataStore.default()
        let dataTypes = WKWebsiteDataStore.allWebsiteDataTypes()
        await store.removeData(ofTypes: dataTypes, modifiedSince: .distantPast)
    }

    private static func bundledValue(forKey key: String) -> String {
        (Bundle.main.object(forInfoDictionaryKey: key) as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }
}
