import AuthenticationServices
import Capacitor
import UIKit

/// In-app OAuth sign-in sheet (ASWebAuthenticationSession) — see
/// frontend/src/lib/nativeAuth.ts. Opens the login URL in a system sheet
/// over the app and resolves with the `weekendleague://` callback URL the
/// backend redirects to once sign-in finishes, closing the sheet itself.
/// The sheet catches that scheme directly, so it is deliberately not
/// registered in Info.plist: no other app can open it.
@objc(NativeAuthPlugin)
public class NativeAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "NativeAuthPlugin"
    public let jsName = "NativeAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise)
    ]

    // Held for the sheet's lifetime; ASWebAuthenticationSession is
    // dismissed as soon as nothing references it.
    private var session: ASWebAuthenticationSession?

    @objc func signIn(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString),
              let callbackScheme = call.getString("callbackScheme") else {
            call.reject("url and callbackScheme are required")
            return
        }

        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { [weak self] callbackURL, error in
                self?.session = nil
                if let callbackURL = callbackURL {
                    call.resolve(["url": callbackURL.absoluteString])
                } else if let authError = error as? ASWebAuthenticationSessionError, authError.code == .canceledLogin {
                    call.reject("Sign-in canceled", "CANCELED")
                } else {
                    call.reject(error?.localizedDescription ?? "Sign-in failed")
                }
            }
            session.presentationContextProvider = self
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("Could not open the sign-in sheet")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.webView?.window ?? ASPresentationAnchor()
    }
}

/// Registers the app's own plugins (those not shipped as npm packages).
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeAuthPlugin())
    }
}
