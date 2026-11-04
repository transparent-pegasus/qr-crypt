// Disposable proof only; the protocol was fixed in protocol.md before launch.
pub const TOTAL_MS: u64 = 90_000;
pub const WORK_MS: u64 = 80_000;
pub const OUTPUT_CAP: usize = 32_768;

pub fn remaining(elapsed: u64, cap: u64, cleanup: bool) -> Result<u64, String> {
    let end = if cleanup { TOTAL_MS } else { WORK_MS };
    end.checked_sub(elapsed)
        .filter(|v| *v > 0)
        .map(|v| v.min(cap))
        .ok_or_else(|| "monotonic deadline expired".into())
}

fn plain_path(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() < 4 || b.len() > 1024 || !b[0].is_ascii_alphabetic() || &b[1..3] != b":\\" {
        return false;
    }
    value[3..].split('\\').all(|part| {
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        !part.is_empty()
            && part != "."
            && part != ".."
            && !part.ends_with(['.', ' '])
            && !part
                .chars()
                .any(|c| c.is_control() || "/:\"<>|?*~".contains(c))
            && ![
                "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
                "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8",
                "LPT9",
            ]
            .contains(&stem.as_str())
    })
}

pub fn prepare_temp_parent(raw: &str) -> Result<String, String> {
    let parent = raw.strip_suffix('\\').unwrap_or(raw);
    if !plain_path(parent) {
        return Err("ambiguous temp parent spelling".into());
    }
    Ok(parent.to_owned())
}

pub fn owned_path(base: &str, value: &str, strict_child: bool) -> bool {
    if !plain_path(base) || !plain_path(value) {
        return false;
    }
    let (base, value) = (base.to_lowercase(), value.to_lowercase());
    if !strict_child && base == value {
        return true;
    }
    value
        .strip_prefix(&base)
        .is_some_and(|rest| rest.starts_with('\\'))
}

pub fn hex(value: &str) -> String {
    value
        .as_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
pub fn unhex(value: &str, cap: usize) -> Result<String, String> {
    if value.is_empty()
        || value.len() > cap * 2
        || value.len() % 2 != 0
        || !value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("invalid hex field".into());
    }
    let bytes = (0..value.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&value[i..i + 2], 16).unwrap())
        .collect();
    let text = String::from_utf8(bytes).map_err(|_| "invalid UTF8 field")?;
    if text.chars().any(char::is_control) {
        return Err("control in field".into());
    }
    Ok(text)
}
fn number(value: &str) -> Result<u32, String> {
    let n = value.parse::<u32>().map_err(|_| "invalid PID")?;
    if n == 0 || n.to_string() != value {
        return Err("noncanonical PID".into());
    }
    Ok(n)
}
pub fn valid_nonce(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub struct Receipts {
    pub next: usize,
    nonce: String,
    mode: String,
    pid: u32,
    browser: Option<u32>,
}
impl Receipts {
    pub fn new(nonce: &str, mode: &str, pid: u32) -> Self {
        Self {
            next: 0,
            nonce: nonce.into(),
            mode: mode.into(),
            pid,
            browser: None,
        }
    }
    // Returned identity fields: phase, browserPID, UDF, name, profilePath, private, version.
    pub fn accept(&mut self, line: &str) -> Result<Vec<String>, String> {
        if !valid_nonce(&self.nonce)
            || !["set", "read"].contains(&self.mode.as_str())
            || self.next >= 4
            || line.len() > 8192
            || !line.ends_with('\n')
            || !line.is_ascii()
        {
            return Err("receipt framing/count".into());
        }
        let f: Vec<_> = line[..line.len() - 1].split('\t').collect();
        let phases = ["identity", "value", "closed", "browser-exited"];
        if f.len() != [12, 8, 7, 9][self.next]
            || f[0] != "NDL0"
            || f[1] != "1"
            || f[2] != self.nonce
            || f[3] != self.mode
            || f[4] != phases[self.next]
            || number(f[5])? != self.pid
        {
            return Err("receipt identity/order/fields".into());
        }
        let browser = number(f[6])?;
        if self.browser.is_some_and(|expected| expected != browser) {
            return Err("browser PID changed".into());
        }
        let mut out = vec![f[4].into(), f[6].into()];
        match self.next {
            0 => {
                if f[10] != "0" {
                    return Err("private profile".into());
                }
                out.extend([
                    unhex(f[7], 1024)?,
                    if f[8].is_empty() {
                        String::new()
                    } else {
                        unhex(f[8], 128)?
                    },
                    unhex(f[9], 1024)?,
                    f[10].into(),
                    unhex(f[11], 128)?,
                ]);
            }
            1 => out.push(unhex(f[7], 1024)?),
            3 => {
                let elapsed = f[8].parse::<u64>().map_err(|_| "invalid event time")?;
                if f[7] != "normal" || elapsed > 35_000 || elapsed.to_string() != f[8] {
                    return Err("non-normal/invalid event".into());
                }
                out.extend([f[7].into(), f[8].into()]);
            }
            _ => {}
        }
        self.browser = Some(browser);
        self.next += 1;
        Ok(out)
    }
}

#[cfg(test)]
#[path = "protocol_tests.rs"]
mod tests;
