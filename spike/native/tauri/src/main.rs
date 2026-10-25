use std::{env, fs, path::PathBuf};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("G0r Spike")
                .inner_size(1000.0, 800.0)
                .on_navigation(move |url| {
                    if url.host_str() != Some("g0r-report.invalid") {
                        return true;
                    }
                    let out =
                        PathBuf::from(env::var("G0R_OUT_DIR").unwrap_or_else(|_| "g0r-out".into()));
                    let save = || -> Result<(), Box<dyn std::error::Error>> {
                        fs::create_dir_all(&out)?;
                        match url.path() {
                            "/auto-done" => {
                                fs::write(out.join("auto-done"), b"auto-done\n")?;
                                println!("G0R_SIGNAL auto-done");
                                if env::var("G0R_GESTURE").as_deref() == Ok("eval") {
                                    let handle = handle.clone();
                                    std::thread::spawn(move || {
                                        if let Some(window) = handle.get_webview_window("main") {
                                            if let Err(error) =
                                                window.eval("window.g0rGesture('tauri-eval')")
                                            {
                                                eprintln!("G0R_EVAL_ERROR {error}");
                                            }
                                        }
                                    });
                                }
                            }
                            "/result" => {
                                let json = percent_encoding::percent_decode_str(
                                    url.fragment().ok_or("Missing report fragment")?,
                                )
                                .decode_utf8()?;
                                fs::write(out.join("result.json"), json.as_bytes())?;
                                println!("G0R_RESULT {json}");
                            }
                            _ => return Err("Unexpected G0r navigation".into()),
                        }
                        Ok(())
                    };
                    if let Err(error) = save() {
                        eprintln!("G0R_REPORT_ERROR {error}");
                    }
                    false
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauri harness failed");
}
