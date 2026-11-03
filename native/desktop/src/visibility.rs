use tauri::{WebviewWindow, webview::PlatformWebview};
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{
            IsIconic, IsWindowVisible, SIZE_MINIMIZED, WM_NCDESTROY, WM_SHOWWINDOW, WM_SIZE,
            WM_WINDOWPOSCHANGED,
        },
    },
};

const SUBCLASS_ID: usize = 1;

fn fail_closed() -> ! {
    eprintln!("Native visibility propagation failed; terminating relay.");
    std::process::exit(1);
}

pub(super) fn install(window: &WebviewWindow) -> tauri::Result<()> {
    let main = window.clone();
    window.with_webview(move |webview| {
        let hwnd = main.hwnd().unwrap_or_else(|_| fail_closed());
        // SAFETY: with_webview runs on the UI thread; the subclass owns this handle until WM_NCDESTROY.
        unsafe {
            webview
                .controller()
                .SetIsVisible(false)
                .unwrap_or_else(|_| fail_closed());
            let data = Box::into_raw(Box::new(webview));
            if !SetWindowSubclass(hwnd, Some(window_proc), SUBCLASS_ID, data as usize).as_bool() {
                drop(Box::from_raw(data));
                fail_closed();
            }
        }
        main.show().unwrap_or_else(|_| fail_closed());
    })
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    subclass_id: usize,
    data: usize,
) -> LRESULT {
    // SAFETY: Win32 invokes this on the installing UI thread with our live boxed handle.
    unsafe {
        match message {
            WM_SIZE | WM_SHOWWINDOW | WM_WINDOWPOSCHANGED => {
                let visible = match message {
                    WM_SIZE => {
                        wparam.0 != SIZE_MINIMIZED as usize && IsWindowVisible(hwnd).as_bool()
                    }
                    WM_SHOWWINDOW => wparam.0 != 0 && !IsIconic(hwnd).as_bool(),
                    _ => IsWindowVisible(hwnd).as_bool() && !IsIconic(hwnd).as_bool(),
                };
                // Wry 0.57 skips minimized bounds and does not propagate parent visibility.
                (*(data as *const PlatformWebview))
                    .controller()
                    .SetIsVisible(visible)
                    .unwrap_or_else(|_| fail_closed());
            }
            WM_NCDESTROY => {
                if !RemoveWindowSubclass(hwnd, Some(window_proc), subclass_id).as_bool() {
                    fail_closed();
                }
                drop(Box::from_raw(data as *mut PlatformWebview));
            }
            _ => {}
        }
        DefSubclassProc(hwnd, message, wparam, lparam)
    }
}
