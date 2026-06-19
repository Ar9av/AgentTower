import SwiftUI

struct RootView: View {
    @EnvironmentObject private var settings: AppSettings

    var body: some View {
        Group {
            if settings.isBootstrapping {
                ProgressView("Connecting to AgentTower...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let serverURL = settings.normalizedServerURL, settings.isConfigured {
                WebContainerView(serverURL: serverURL)
                    .ignoresSafeArea(.container, edges: .bottom)
            } else {
                NavigationStack {
                    ServerConfigView(initialError: settings.bootstrapError)
                }
            }
        }
        .task {
            await settings.bootstrap()
        }
    }
}
