#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod navigation;
#[cfg(windows)]
mod request_policy;
#[cfg(windows)]
mod visibility;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(windows)]
            // Pinned runtime-wry omits initial Navigate for this hidden bootstrap URL.
            let url = tauri::WebviewUrl::External("about:blank".parse()?);
            #[cfg(not(windows))]
            let url = tauri::WebviewUrl::App("index.html".into());
            let window = tauri::WebviewWindowBuilder::new(app, "main", url)
                .title("QR Crypt Relay")
                .visible(false)
                .devtools(false)
                .disable_drag_drop_handler()
                .on_navigation(navigation::navigation_allowed)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .on_download(|_, _| false)
                .build()?;

            #[cfg(windows)]
            {
                let main = window.clone();
                window
                    .with_webview(move |webview| {
                        let hwnd = main
                            .hwnd()
                            .unwrap_or_else(|_| request_policy::fail_closed());
                        // SAFETY: with_webview serializes native setup and navigation on the UI thread.
                        unsafe {
                            let controller = webview.controller();
                            controller
                                .SetIsVisible(false)
                                .unwrap_or_else(|_| request_policy::fail_closed());
                            let core = controller
                                .CoreWebView2()
                                .unwrap_or_else(|_| request_policy::fail_closed());
                            request_policy::install(&core, webview.environment())
                                .unwrap_or_else(|_| request_policy::fail_closed());
                            visibility::install(hwnd, webview);
                            core.Navigate(windows::core::w!("http://tauri.localhost/index.html"))
                                .unwrap_or_else(|_| request_policy::fail_closed());
                        }
                        main.show()
                            .unwrap_or_else(|_| request_policy::fail_closed());
                    })
                    .unwrap_or_else(|_| request_policy::fail_closed());
            }
            #[cfg(not(windows))]
            window.show()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run QR Crypt Relay");
}
