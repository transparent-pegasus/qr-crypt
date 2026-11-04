use webview2_com::{
    CoTaskMemPWSTR,
    Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
        ICoreWebView2, ICoreWebView2_22, ICoreWebView2Environment,
    },
    WebResourceRequestedEventHandler,
};
use windows::core::{Interface, PWSTR, Result, w};

pub(super) fn fail_closed() -> ! {
    eprintln!("Native request confinement failed; terminating relay.");
    std::process::exit(1);
}

pub(super) fn install(
    webview: &ICoreWebView2,
    environment: ICoreWebView2Environment,
) -> Result<()> {
    // SAFETY: installation and callbacks run on the owning WebView UI thread.
    unsafe {
        let webview_22 = webview.cast::<ICoreWebView2_22>()?;
        let handler = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
            let args = args.unwrap_or_else(|| fail_closed());
            let request = args.Request().unwrap_or_else(|_| fail_closed());
            let mut uri = PWSTR::null();
            let result = request.Uri(&mut uri);
            let _uri = CoTaskMemPWSTR::from(uri);
            result.unwrap_or_else(|_| fail_closed());
            if uri.is_null() {
                fail_closed();
            }
            let allowed = uri
                .to_string()
                .ok()
                .and_then(|uri| tauri::Url::parse(&uri).ok())
                .as_ref()
                .is_some_and(crate::navigation::navigation_allowed);
            if !allowed {
                let response = environment
                    .CreateWebResourceResponse(
                        None,
                        403,
                        w!("Forbidden"),
                        w!("Content-Length: 0\r\n"),
                    )
                    .unwrap_or_else(|_| fail_closed());
                args.SetResponse(&response)
                    .unwrap_or_else(|_| fail_closed());
            }
            Ok(())
        }));
        // WebView2 retains the handler; its closure owns no window, controller or webview.
        let mut token = 0;
        webview.add_WebResourceRequested(&handler, &mut token)?;
        for filter in [w!("http://*"), w!("https://*")] {
            webview_22.AddWebResourceRequestedFilterWithRequestSourceKinds(
                filter,
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
            )?;
        }
        Ok(())
    }
}
