pub(crate) fn navigation_allowed(url: &tauri::Url) -> bool {
    #[cfg(windows)]
    let (scheme, host) = ("http", "tauri.localhost");
    #[cfg(not(windows))]
    let (scheme, host) = ("tauri", "localhost");

    url.scheme() == scheme
        && url.host_str() == Some(host)
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
}
