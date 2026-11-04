use crate::{
    protocol::{hex, valid_nonce},
    win::{self, Result},
};
use std::{
    cell::RefCell,
    io::{Read, Write},
    path::Path,
    sync::mpsc::{Receiver, TryRecvError, sync_channel},
    time::{Duration, Instant},
};
use webview2_com::{
    BrowserProcessExitedEventHandler, CoTaskMemPWSTR,
    Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_BROWSER_PROCESS_EXIT_KIND_NORMAL, ICoreWebView2_13,
        ICoreWebView2BrowserProcessExitedEventHandler, ICoreWebView2Controller,
        ICoreWebView2Environment5, ICoreWebView2Environment7,
    },
};
use windows::core::{BOOL, HSTRING, Interface, PWSTR};

struct Session {
    controller: Option<ICoreWebView2Controller>,
    environment: ICoreWebView2Environment5,
    _handler: ICoreWebView2BrowserProcessExitedEventHandler,
    event_token: i64,
    browser: u32,
    nonce: String,
    mode: String,
    downloads: String,
    start: Instant,
    phase: usize,
    event: Option<(u32, i32)>,
    eof: bool,
}
thread_local! { static SESSION: RefCell<Option<Session>> = const {RefCell::new(None)}; }

fn fail(error: impl std::fmt::Display) -> ! {
    eprintln!(
        "TASK0_HELPER_FAILURE: {}",
        error.to_string().chars().take(6144).collect::<String>()
    );
    std::process::exit(1);
}
fn receipt(session: &Session, phase: &str, extra: &[String]) -> Result<()> {
    let mut line = format!(
        "NDL0\t1\t{}\t{}\t{phase}\t{}\t{}",
        session.nonce,
        session.mode,
        std::process::id(),
        session.browser
    );
    for field in extra {
        line.push('\t');
        line.push_str(field);
    }
    line.push('\n');
    if line.len() > 8192 {
        return Err("helper record cap".into());
    }
    let mut out = std::io::stdout().lock();
    out.write_all(line.as_bytes())
        .and_then(|_| out.flush())
        .map_err(|e| e.to_string())
}
// SAFETY: callers invoke these getters on the COM-owning UI thread; the runtime owns the allocation contract.
unsafe fn string(
    field: &str,
    get: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>,
) -> Result<String> {
    let mut value = PWSTR::null();
    let result = get(&mut value);
    let _allocation = CoTaskMemPWSTR::from(value);
    result.map_err(|e| format!("{field}: {e}"))?;
    if value.is_null() {
        return Err("null COM string".into());
    }
    for len in 0..=1024 {
        if unsafe { *value.0.add(len) } == 0 {
            let text = String::from_utf16(unsafe { std::slice::from_raw_parts(value.0, len) })
                .map_err(|_| "invalid COM UTF16")?;
            if text.len() > 1024 || text.chars().any(char::is_control) {
                return Err(format!(
                    "{field}: COM text bounds/control utf8_bytes={} utf16_units={len} empty={} control={}",
                    text.len(),
                    text.is_empty(),
                    text.chars().any(char::is_control)
                ));
            }
            return Ok(text);
        }
    }
    Err("COM string cap".into())
}

fn initialize(
    platform: tauri::webview::PlatformWebview,
    root: &str,
    nonce: &str,
    mode: &str,
    start: Instant,
) -> Result<()> {
    // SAFETY: with_webview executes this entire block on the UI thread.
    unsafe {
        let controller = platform.controller();
        let core = controller
            .CoreWebView2()
            .map_err(|e| format!("CoreWebView2: {e}"))?;
        let environment = platform.environment();
        let actual = environment
            .cast::<ICoreWebView2Environment7>()
            .map_err(|e| format!("Environment7: {e}"))?;
        let udf = string("UserDataFolder", |v| actual.UserDataFolder(v))?;
        let profile = core
            .cast::<ICoreWebView2_13>()
            .and_then(|v| v.Profile())
            .map_err(|e| format!("CoreWebView2_13/Profile: {e}"))?;
        let name = string("ProfileName", |v| profile.ProfileName(v))?;
        let path = string("ProfilePath", |v| profile.ProfilePath(v))?;
        let mut private = BOOL(1);
        profile
            .IsInPrivateModeEnabled(&mut private)
            .map_err(|e| format!("IsInPrivateModeEnabled: {e}"))?;
        if private.0 != 0 || name.len() > 128 {
            return Err(format!(
                "private/oversized profile identity private={} name_hex={}",
                private.0,
                hex(&name)
            ));
        }
        win::validate_profile(root, &udf, &name, &path).map_err(|e| {
            format!(
                "{e}; udf_hex={} name_hex={} profile_hex={}",
                hex(&udf),
                hex(&name),
                hex(&path)
            )
        })?;
        let version = string("BrowserVersionString", |v| {
            environment.BrowserVersionString(v)
        })?;
        if version.is_empty() || version.len() > 128 {
            return Err("runtime version cap".into());
        }
        let mut browser = 0;
        core.BrowserProcessId(&mut browser)
            .map_err(|e| e.to_string())?;
        if browser == 0 {
            return Err("missing actual browser PID".into());
        }
        let environment = environment
            .cast::<ICoreWebView2Environment5>()
            .map_err(|e| e.to_string())?;
        let handler = BrowserProcessExitedEventHandler::create(Box::new(move |_, args| {
            let args = args.unwrap_or_else(|| fail("missing browser-exit args"));
            let mut pid = 0;
            let mut kind = COREWEBVIEW2_BROWSER_PROCESS_EXIT_KIND_NORMAL;
            args.BrowserProcessId(&mut pid).unwrap_or_else(|e| fail(e));
            args.BrowserProcessExitKind(&mut kind)
                .unwrap_or_else(|e| fail(e));
            SESSION.with(|slot| {
                let mut slot = slot.borrow_mut();
                let session = slot
                    .as_mut()
                    .unwrap_or_else(|| fail("exit without owned session"));
                if session.phase < 2
                    || session.event.is_some()
                    || pid != session.browser
                    || kind != COREWEBVIEW2_BROWSER_PROCESS_EXIT_KIND_NORMAL
                {
                    fail(format!("wrong/duplicate/early/non-normal browser exit pid={pid} expected={} kind={} phase={} duplicate={}", session.browser, kind.0, session.phase, session.event.is_some()));
                }
                session.event = Some((pid, kind.0));
            });
            Ok(())
        }));
        let mut event_token = 0;
        environment
            .add_BrowserProcessExited(&handler, &mut event_token)
            .map_err(|e| e.to_string())?;
        let session = Session {
            controller: Some(controller),
            environment,
            _handler: handler,
            event_token,
            browser,
            nonce: nonce.into(),
            mode: mode.into(),
            downloads: format!("{root}\\downloads"),
            start,
            phase: 0,
            event: None,
            eof: false,
        };
        receipt(
            &session,
            "identity",
            &[hex(&udf), hex(&name), hex(&path), "0".into(), hex(&version)],
        )?;
        SESSION.with(|slot| *slot.borrow_mut() = Some(session));
    }
    Ok(())
}

enum Input {
    Command(String),
    Eof,
    Error,
}
fn input_thread(tx: std::sync::mpsc::SyncSender<Input>) {
    let mut input = std::io::stdin().lock();
    for _ in 0..2 {
        let mut line = Vec::new();
        loop {
            let mut byte = [0u8; 1];
            match input.read(&mut byte) {
                Ok(1) => {}
                _ => {
                    let _ = tx.send(Input::Error);
                    return;
                }
            }
            line.push(byte[0]);
            if line.len() > 128 {
                let _ = tx.send(Input::Error);
                return;
            }
            if byte[0] == b'\n' {
                break;
            }
        }
        match String::from_utf8(line) {
            Ok(line) => {
                if tx.send(Input::Command(line)).is_err() {
                    return;
                }
            }
            Err(_) => {
                let _ = tx.send(Input::Error);
                return;
            }
        }
    }
    let mut byte = [0u8; 1];
    let result = match input.read(&mut byte) {
        Ok(0) => Input::Eof,
        _ => Input::Error,
    };
    let _ = tx.send(result);
}

fn command(line: &str) -> Result<()> {
    let controller = SESSION.with(|slot| -> Result<Option<ICoreWebView2Controller>> {
        let mut slot = slot.borrow_mut();
        let s = slot.as_mut().ok_or("command before identity")?;
        let verb = if s.phase == 0 {
            "permit"
        } else if s.phase == 1 {
            "close"
        } else {
            return Err("extra parent command".into());
        };
        if line != format!("NDL0\t1\t{}\t{}\t{verb}\n", s.nonce, s.mode) {
            return Err("wrong nonce/mode/parent command".into());
        }
        if s.phase == 1 {
            s.phase = 2;
            return Ok(s.controller.take());
        }
        let controller = s.controller.as_ref().ok_or("missing controller")?;
        // SAFETY: dispatched by run_on_main_thread; profile references are dropped before Close.
        unsafe {
            let profile = controller
                .CoreWebView2()
                .and_then(|v| v.cast::<ICoreWebView2_13>())
                .and_then(|v| v.Profile())
                .map_err(|e| e.to_string())?;
            match s.mode.as_str() {
                "set" => profile
                    .SetDefaultDownloadFolderPath(&HSTRING::from(&s.downloads))
                    .map_err(|e| format!("SetDefaultDownloadFolderPath: {e}"))?,
                "read" => {}
                _ => return Err("invalid helper mode".into()),
            }
            let value = string("DefaultDownloadFolderPath", |v| {
                profile.DefaultDownloadFolderPath(v)
            })?;
            receipt(s, "value", &[hex(&value)])?;
            // Reject foreign returned destinations before filesystem access.
            if value != s.downloads {
                return Err("download destination differs from exact owned path".into());
            }
            win::canonical_owned(Path::new(&s.downloads))?;
        }
        s.phase = 1;
        Ok(None)
    })?;
    if let Some(controller) = controller {
        // No RefCell borrow crosses Close, which may dispatch an event reentrantly.
        unsafe {
            controller.Close().map_err(|e| e.to_string())?;
        }
        drop(controller);
        SESSION.with(|slot| {
            let mut slot = slot.borrow_mut();
            let s = slot.as_mut().unwrap();
            receipt(s, "closed", &[])?;
            s.phase = 3;
            Ok::<_, String>(())
        })?;
    }
    Ok(())
}

fn tick(app: &tauri::AppHandle, input: &Receiver<Input>, start: Instant) -> Result<()> {
    if start.elapsed().as_millis() >= 35_000 {
        return Err("helper monotonic deadline".into());
    }
    loop {
        match input.try_recv() {
            Ok(Input::Command(line)) => command(&line)?,
            Ok(Input::Eof) => SESSION.with(|slot| -> Result<()> {
                let mut slot = slot.borrow_mut();
                let s = slot.as_mut().ok_or("EOF before session")?;
                if s.phase < 2 {
                    return Err("early command EOF".into());
                }
                s.eof = true;
                Ok(())
            })?,
            Ok(Input::Error) => return Err("bounded parent input failed".into()),
            Err(TryRecvError::Empty | TryRecvError::Disconnected) => break,
        }
    }
    let done = SESSION.with(|slot| {
        slot.borrow()
            .as_ref()
            .is_some_and(|s| s.phase == 3 && s.event.is_some() && s.eof)
    });
    if done {
        let s = SESSION.with(|slot| slot.borrow_mut().take().unwrap());
        receipt(
            &s,
            "browser-exited",
            &["normal".into(), s.start.elapsed().as_millis().to_string()],
        )?;
        unsafe {
            s.environment
                .remove_BrowserProcessExited(s.event_token)
                .map_err(|e| e.to_string())?;
        }
        drop(s); // Release environment/handler on this same STA, after the matching event.
        app.exit(0);
    }
    Ok(())
}

pub fn run(root: &str, nonce: &str, mode: &str) -> Result<()> {
    let start = Instant::now();
    if !valid_nonce(nonce) || !["set", "read"].contains(&mode) {
        return Err("helper nonce/mode".into());
    }
    win::canonical_owned(Path::new(root))?;
    let profile = win::canonical_owned(&Path::new(root).join("profile"))?;
    win::canonical_owned(&Path::new(root).join("downloads"))?;
    if std::env::vars_os().any(|(key, _)| {
        key.to_string_lossy()
            .to_uppercase()
            .starts_with("WEBVIEW2_")
    }) {
        return Err("inherited WebView2 override".into());
    }
    // SAFETY: main is still single-threaded; only this disposable process's environment is set.
    unsafe {
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &profile);
    }
    let (root, nonce, mode) = (root.to_owned(), nonce.to_owned(), mode.to_owned());
    let app = tauri::Builder::default()
        .setup(move |app| {
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "proof",
                tauri::WebviewUrl::External("about:blank".parse()?),
            )
            .visible(false)
            .devtools(false)
            .data_directory(profile.into())
            .build()?;
            window.with_webview(move |platform| {
                initialize(platform, &root, &nonce, &mode, start).unwrap_or_else(|e| fail(e))
            })?;
            Ok(())
        })
        .build(tauri::generate_context!(
            "../../tests/e2e-native-relay/download-profile/tauri.conf.json"
        ))
        .map_err(|e| e.to_string())?;
    let (tx, rx) = sync_channel(4);
    std::thread::spawn(move || input_thread(tx));
    let input = std::sync::Arc::new(std::sync::Mutex::new(rx));
    let handle = app.handle().clone();
    std::thread::spawn(move || {
        loop {
            let target = handle.clone();
            let input = input.clone();
            if handle
                .run_on_main_thread(move || {
                    tick(&target, &input.lock().unwrap(), start).unwrap_or_else(|e| fail(e))
                })
                .is_err()
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    });
    app.run(|_, event| {
        if let tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } = event
        {
            api.prevent_exit();
        }
    });
    Err("Tauri loop returned without explicit normal exit".into())
}
