#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod navigation;
#[cfg(windows)]
mod visibility;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("QR Crypt Relay")
            .visible(false)
            .devtools(false)
            .disable_drag_drop_handler()
            .on_navigation(navigation::navigation_allowed)
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .on_download(|_, _| false)
            .build()?;

            #[cfg(windows)]
            visibility::install(&window)?;
            #[cfg(not(windows))]
            window.show()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run QR Crypt Relay");
}
