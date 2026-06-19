import SwiftUI
import WebKit

struct WebContainerView: View {
    let serverURL: URL

    var body: some View {
        WebView(serverURL: serverURL)
    }
}

struct WebView: UIViewRepresentable {
    let serverURL: URL

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.refreshControl = context.coordinator.makeRefreshControl(for: webView)
        webView.navigationDelegate = context.coordinator
        loadProjects(in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    private func loadProjects(in webView: WKWebView) {
        webView.load(URLRequest(url: serverURL.appending(path: "projects")))
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        func makeRefreshControl(for webView: WKWebView) -> UIRefreshControl {
            let refreshControl = UIRefreshControl()
            refreshControl.addAction(
                UIAction { [weak webView, weak refreshControl] _ in
                    webView?.reload()
                    refreshControl?.endRefreshing()
                },
                for: .valueChanged
            )
            return refreshControl
        }
    }
}
