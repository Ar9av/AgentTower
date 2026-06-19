import Foundation
import WebKit

enum AuthError: LocalizedError {
    case invalidURL
    case badResponse
    case unauthorized
    case rateLimited(Int)
    case missingCookie

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Enter a valid AgentTower URL."
        case .badResponse:
            return "AgentTower did not return a valid response."
        case .unauthorized:
            return "Incorrect password."
        case let .rateLimited(retryAfter):
            return "Too many attempts. Try again in \(retryAfter)s."
        case .missingCookie:
            return "Login succeeded but no session cookie was returned."
        }
    }
}

struct AuthClient {
    @MainActor
    func login(serverURL: URL, password: String) async throws {
        let endpoint = serverURL.appending(path: "api/auth/login")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["password": password])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.badResponse
        }

        switch httpResponse.statusCode {
        case 200:
            break
        case 401:
            throw AuthError.unauthorized
        case 429:
            let payload = try? JSONDecoder().decode(LoginErrorPayload.self, from: data)
            throw AuthError.rateLimited(payload?.retryAfter ?? 0)
        default:
            throw AuthError.badResponse
        }

        let headerFields = httpResponse.allHeaderFields.reduce(into: [String: String]()) { result, entry in
            guard let key = entry.key as? String, let value = entry.value as? String else { return }
            result[key] = value
        }
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: headerFields, for: serverURL)
        guard !cookies.isEmpty else {
            throw AuthError.missingCookie
        }

        let cookieStore = WKWebsiteDataStore.default().httpCookieStore
        for cookie in cookies {
            await cookieStore.setCookie(cookie)
        }
    }

    @MainActor
    func logout(serverURL: URL?) async {
        if let serverURL {
            var request = URLRequest(url: serverURL.appending(path: "api/auth/logout"))
            request.httpMethod = "POST"
            _ = try? await URLSession.shared.data(for: request)
        }
        let store = WKWebsiteDataStore.default()
        let dataTypes = WKWebsiteDataStore.allWebsiteDataTypes()
        await store.removeData(ofTypes: dataTypes, modifiedSince: .distantPast)
    }
}

private struct LoginErrorPayload: Decodable {
    let retryAfter: Int
}
