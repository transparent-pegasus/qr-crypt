#[path = "../src/navigation.rs"]
mod navigation;

fn assert_policy(inputs: &[&str], expected: bool) {
    for input in inputs {
        let url = tauri::Url::parse(input).expect("policy fixtures must be valid URLs");
        assert_eq!(
            navigation::navigation_allowed(&url),
            expected,
            "navigation for {input:?}, parsed as {url}"
        );
    }
}

#[test]
#[cfg(target_os = "windows")]
fn allows_windows_app_origin_and_normalized_default_port() {
    assert_policy(
        &[
            "http://tauri.localhost",
            "http://tauri.localhost/",
            "http://tauri.localhost/index.html?view=relay#frame-3",
            "http://tauri.localhost/assets/reader.wasm",
            // HTTP parsing normalizes host case, percent encoding and port 80.
            "HTTP://TAURI.LOCALHOST:80/a/../index.html#frame-3",
            "http://%74auri.localhost:80/",
        ],
        true,
    );
}

#[test]
#[cfg(not(target_os = "windows"))]
fn allows_non_windows_desktop_app_origin() {
    assert_policy(
        &[
            "tauri://localhost",
            "tauri://localhost/",
            "tauri://localhost/index.html?view=relay#frame-3",
            "tauri://localhost/assets/reader.wasm",
            "TAURI://localhost/index.html#frame-3",
        ],
        true,
    );
}

#[test]
#[cfg(target_os = "windows")]
fn rejects_windows_origin_confusion_credentials_and_ports() {
    assert_policy(
        &[
            "https://tauri.localhost/",
            "https://tauri.localhost:443/",
            "tauri://localhost/",
            "tauri://tauri.localhost/",
            "http://localhost/",
            "http://127.0.0.1/",
            "http://sub.tauri.localhost/",
            "http://tauri.localhost.example/",
            "http://tauri-localhost/",
            "http://tauri.localhost./",
            "http://user@tauri.localhost/",
            "http://user:password@tauri.localhost/",
            "http://:password@tauri.localhost/",
            "http://outside.example@tauri.localhost/",
            "http://tauri.localhost@outside.example/",
            "http://tauri.localhost:81/",
            "http://tauri.localhost:443/",
            "http://tauri.localhost:8080/",
            "http://tauri.localhost:0/",
        ],
        false,
    );
}

#[test]
#[cfg(not(target_os = "windows"))]
fn rejects_non_windows_origin_confusion_credentials_and_ports() {
    assert_policy(
        &[
            "http://tauri.localhost/",
            "https://tauri.localhost/",
            "http://localhost/",
            "https://localhost/",
            "tauri://tauri.localhost/",
            "tauri://127.0.0.1/",
            "tauri://sub.localhost/",
            "tauri://localhost.example/",
            "tauri://local-host/",
            "tauri://localhost./",
            "tauri://user@localhost/",
            "tauri://user:password@localhost/",
            "tauri://:password@localhost/",
            "tauri://outside.example@localhost/",
            "tauri://localhost@outside.example/",
            "tauri://localhost:80/",
            "tauri://localhost:443/",
            "tauri://localhost:8080/",
            "tauri://localhost:0/",
        ],
        false,
    );
}

#[test]
fn rejects_foreign_schemes_and_origins() {
    assert_policy(
        &[
            "http://outside.example/",
            "https://outside.example/",
            "tauri://outside.example/",
            "relay://localhost/",
            "tauri:/index.html",
            "file:///index.html",
            "data:text/html,relay",
            "javascript:void(0)",
            "about:blank",
            "blob:http://tauri.localhost/relay",
        ],
        false,
    );
}

#[test]
fn malformed_urls_fail_parsing_before_policy_evaluation() {
    for input in [
        "http://",
        "http://[::1/",
        "http://tauri.localhost:65536/",
        "tauri://localhost:not-a-port/",
    ] {
        assert!(
            tauri::Url::parse(input).is_err(),
            "must not parse: {input:?}"
        );
    }
}
