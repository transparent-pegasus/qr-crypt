#[test]
fn denies_frontend_commands_in_generated_context() {
    let mut context: tauri::Context<tauri::Wry> = tauri::generate_context!();
    let authority = context.runtime_authority_mut();

    // Probe representative core commands against the compiled main/main local ACL.
    for command in [
        "plugin:app|version",
        "plugin:window|close",
        "plugin:webview|create_webview_window",
        "plugin:event|emit",
    ] {
        assert!(
            authority
                .resolve_access(command, "main", "main", &tauri::ipc::Origin::Local)
                .is_none(),
            "generated context allows {command} for main/main at the local origin"
        );
    }
}
