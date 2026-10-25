import Capacitor
import WebKit

class G0rBridgeViewController: CAPBridgeViewController, WKScriptMessageHandler {
    private var gestureDelivered = false

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        let controller = webView!.configuration.userContentController
        controller.add(self, name: "g0rSignal")
        controller.addUserScript(WKUserScript(source: """
            (() => {
                const warn = console.warn.bind(console);
                console.warn = (...args) => {
                    warn(...args);
                    if (args[0] === 'G0R_SIGNAL auto-done') {
                        window.webkit.messageHandlers.g0rSignal.postMessage('auto-done');
                    }
                };
            })();
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.body as? String == "auto-done",
              !gestureDelivered,
              let webView = webView else { return }
        gestureDelivered = true
        userContentController.removeScriptMessageHandler(forName: "g0rSignal")
        print("G0R_EVAL capacitor-eval after auto-done")
        webView.evaluateJavaScript("""
            (() => {
                const activation = {
                    isActive: navigator.userActivation?.isActive ?? null,
                    hasBeenActive: navigator.userActivation?.hasBeenActive ?? null
                };
                window.g0rGesture('capacitor-eval');
                return JSON.stringify(activation);
            })()
            """) { value, error in
            if let error = error {
                print("G0R_EVAL_ERROR \(error as NSError)")
            } else {
                print("G0R_EVAL_ACTIVATION \(value ?? "nil")")
            }
        }
    }
}
