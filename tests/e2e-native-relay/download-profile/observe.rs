use crate::{
    protocol::{self, Receipts},
    win::{self, Result},
};
use std::{
    collections::VecDeque,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

struct Deadline(Instant, u64, u64);
impl Deadline {
    fn elapsed(&self) -> u64 {
        self.0.elapsed().as_millis().try_into().unwrap_or(u64::MAX)
    }
    fn remaining(&self, cap: u64, cleanup: bool) -> Result<u64> {
        if self.1 == protocol::TOTAL_MS {
            return protocol::remaining(self.elapsed(), cap, cleanup);
        }
        let end = if cleanup { self.1 } else { self.2 };
        end.checked_sub(self.elapsed())
            .filter(|v| *v > 0)
            .map(|v| v.min(cap))
            .ok_or_else(|| "monotonic deadline expired".into())
    }
    fn until(&self, cap: u64) -> Result<u64> {
        Ok(self.elapsed() + self.remaining(cap, false)?)
    }
    fn poll(&self, end: u64, cleanup: bool) -> Result<()> {
        let left = end
            .checked_sub(self.elapsed())
            .filter(|v| *v > 0)
            .ok_or("subwait deadline expired")?;
        let pause = self.remaining(left.min(10), cleanup)?;
        std::thread::sleep(Duration::from_millis(pause));
        Ok(())
    }
    fn wait(&self, cap: u64, cleanup: bool, mut done: impl FnMut() -> Result<bool>) -> Result<()> {
        let end = self.elapsed() + self.remaining(cap, cleanup)?;
        loop {
            self.remaining(1, cleanup)?;
            if self.elapsed() >= end {
                return Err("subwait deadline expired".into());
            }
            if done()? {
                if self.elapsed() >= end {
                    return Err("subwait deadline expired".into());
                }
                return Ok(());
            }
            self.poll(end, cleanup)?;
        }
    }
}

struct Trace {
    file: File,
    bytes: usize,
}
impl Trace {
    fn add(&mut self, line: impl AsRef<str>) -> Result<()> {
        let line = line.as_ref();
        if line.len() > 8192 || self.bytes + line.len() + 1 > 131072 {
            return Err("parent trace cap".into());
        }
        self.file
            .write_all(line.as_bytes())
            .and_then(|_| self.file.write_all(b"\n"))
            .and_then(|_| self.file.flush())
            .map_err(|e| e.to_string())?;
        self.bytes += line.len() + 1;
        Ok(())
    }
}
#[derive(Default)]
struct Output {
    out: Vec<u8>,
    err: Vec<u8>,
    out_done: bool,
    err_done: bool,
    overflow: bool,
    io_error: bool,
}
struct Capture {
    shared: Arc<Mutex<Output>>,
    threads: Vec<JoinHandle<()>>,
    processed: usize,
    partial: Vec<u8>,
    pending: VecDeque<Vec<String>>,
    parser: Receipts,
}
impl Capture {
    fn new(
        stdout: File,
        stderr: File,
        budget: Arc<AtomicUsize>,
        nonce: &str,
        mode: &str,
        pid: u32,
    ) -> Self {
        let shared = Arc::new(Mutex::new(Output::default()));
        let mut threads = Vec::new();
        for (mut file, error) in [(stdout, false), (stderr, true)] {
            let shared = shared.clone();
            let budget = budget.clone();
            threads.push(std::thread::spawn(move || {
                let mut buf = [0u8; 1024];
                loop {
                    match file.read(&mut buf) {
                        Ok(0) => break,
                        Ok(count) => {
                            let used = budget.fetch_add(count, Ordering::SeqCst);
                            let retain = count.min(protocol::OUTPUT_CAP.saturating_sub(used));
                            let mut state = shared.lock().unwrap();
                            if error {
                                state.err.extend_from_slice(&buf[..retain]);
                            } else {
                                state.out.extend_from_slice(&buf[..retain]);
                            }
                            if retain < count {
                                state.overflow = true;
                                break;
                            }
                        }
                        Err(_) => {
                            shared.lock().unwrap().io_error = true;
                            break;
                        }
                    }
                }
                let mut state = shared.lock().unwrap();
                if error {
                    state.err_done = true;
                } else {
                    state.out_done = true;
                }
            }));
        }
        Self {
            shared,
            threads,
            processed: 0,
            partial: Vec::new(),
            pending: VecDeque::new(),
            parser: Receipts::new(nonce, mode, pid),
        }
    }
    fn pump(&mut self) -> Result<()> {
        let bytes = {
            let state = self.shared.lock().unwrap();
            if state.overflow || state.io_error {
                return Err("receipt overflow/pipe error".into());
            }
            if !state.err.is_empty() {
                return Err("helper stderr is failure evidence".into());
            }
            state.out[self.processed..].to_vec()
        };
        self.processed += bytes.len();
        for byte in bytes {
            self.partial.push(byte);
            if self.partial.len() > 8192 {
                return Err("receipt record cap".into());
            }
            if byte == b'\n' {
                let line = std::str::from_utf8(&self.partial).map_err(|_| "receipt UTF8")?;
                self.pending.push_back(self.parser.accept(line)?);
                self.partial.clear();
            }
        }
        Ok(())
    }
    fn next(&mut self, deadline: &Deadline, end: u64) -> Result<Vec<String>> {
        loop {
            deadline.remaining(1, false)?;
            if deadline.elapsed() >= end {
                return Err("receipt subwait deadline expired".into());
            }
            self.pump()?;
            if deadline.elapsed() >= end {
                return Err("receipt subwait deadline expired".into());
            }
            if let Some(receipt) = self.pending.pop_front() {
                return Ok(receipt);
            }
            if self.shared.lock().unwrap().out_done {
                return Err("early stdout EOF".into());
            }
            deadline.poll(end, false)?;
        }
    }
    fn eof(&mut self, deadline: &Deadline) -> Result<()> {
        deadline.wait(2000, false, || {
            self.pump()?;
            let state = self.shared.lock().unwrap();
            Ok(state.out_done && state.err_done)
        })?;
        self.pump()?;
        if self.parser.next != 4 || !self.partial.is_empty() || !self.pending.is_empty() {
            return Err("incomplete/extra receipt at EOF".into());
        }
        Ok(())
    }
    fn persist(&self, evidence: &Path, mode: &str) -> Result<()> {
        let state = self.shared.lock().unwrap();
        fs::write(evidence.join(format!("{mode}.stdout.tsv")), &state.out)
            .map_err(|e| e.to_string())?;
        fs::write(evidence.join(format!("{mode}.stderr.log")), &state.err)
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    fn join(&mut self, deadline: &Deadline) -> Result<()> {
        deadline.wait(2000, true, || {
            Ok(self.threads.iter().all(JoinHandle::is_finished))
        })?;
        for thread in self.threads.drain(..) {
            thread.join().map_err(|_| "pipe reader panic")?;
        }
        Ok(())
    }
}

#[derive(Clone)]
struct Profile {
    udf: String,
    name: String,
    path: String,
    version: String,
}
fn record_members(trace: &mut Trace, ids: &[win::Identity], mode: &str, stage: &str) -> Result<()> {
    for id in ids {
        trace.add(format!(
            "member\t{mode}\t{stage}\tpid={}\tstart_filetime={}\timage_hex={}\tin_setup_job=true",
            id.pid,
            id.start,
            protocol::hex(&id.image)
        ))?;
    }
    Ok(())
}
fn send(input: &mut File, nonce: &str, mode: &str, verb: &str) -> Result<()> {
    input
        .write_all(format!("NDL0\t1\t{nonce}\t{mode}\t{verb}\n").as_bytes())
        .and_then(|_| input.flush())
        .map_err(|e| e.to_string())
}

fn session(
    exe: &str,
    root: &str,
    evidence: &Path,
    mode: &str,
    prior: Option<&Profile>,
    deadline: &Deadline,
    budget: Arc<AtomicUsize>,
    trace: &mut Trace,
) -> (Result<Profile>, bool) {
    let nonce = match win::nonce() {
        Ok(v) => v,
        Err(e) => return (Err(e), true),
    };
    let startup_end = match deadline.until(15_000) {
        Ok(v) => v,
        Err(e) => return (Err(e), true),
    };
    let job = match win::Job::new() {
        Ok(v) => v,
        Err(e) => return (Err(e), true),
    };
    let child = match win::suspended(exe, root, &nonce, mode) {
        Ok(v) => v,
        Err(e) => {
            let _ = job.close();
            return (Err(e), false);
        }
    };
    let win::Child {
        mut id,
        thread,
        input,
        output,
        error,
        child_pipes,
    } = child;
    let mut input = Some(input);
    let mut capture = Capture::new(output, error, budget, &nonce, mode, id.pid);
    let mut assigned = false;
    let mut empty = false;
    let mut members = Vec::new();
    let mut cleanup_errors = Vec::new();
    let result: Result<Profile> = (|| {
        deadline.remaining(1, false)?;
        for pipe in child_pipes {
            pipe.close()?;
        }
        id.refresh()?;
        if !id.image.eq_ignore_ascii_case(exe) || id.start == 0 {
            return Err("actual suspended helper path/start mismatch".into());
        }
        let (rid, elevated) = win::token(Some(&id.handle))?;
        trace.add(format!("helper\t{mode}\tnonce={nonce}\tpid={}\tstart_filetime={}\timage_hex={}\trid={rid}\televated={elevated}\tsuspended=true",id.pid,id.start,protocol::hex(&id.image)))?;
        if rid != 8192 || elevated {
            return Err("actual helper token must be Medium/non-elevated".into());
        }
        job.assign(&id.handle)?;
        assigned = true;
        trace.add(format!("setup-job\t{mode}\tassigned_before_resume=true\tflags=8192\tno_breakaway=true\tactive={}",job.active()?))?;
        win::resume(&thread)?;
        let identity = capture.next(deadline, startup_end)?;
        let browser = identity[1].parse::<u32>().map_err(|_| "browser PID")?;
        win::validate_profile(root, &identity[2], &identity[3], &identity[4])?;
        let profile = Profile {
            udf: identity[2].clone(),
            name: identity[3].clone(),
            path: identity[4].clone(),
            version: identity[6].clone(),
        };
        if let Some(prior) = prior {
            if profile.udf != prior.udf
                || profile.name != prior.name
                || profile.path != prior.path
                || profile.version != prior.version
            {
                return Err("reopened actual profile/runtime identity changed".into());
            }
        }
        members = win::members(&job, &id, browser)?;
        record_members(trace, &members, mode, "before-permit")?;
        trace.add(format!("identity-validated\t{mode}\tbrowser={browser}\tudf_hex={}\tname_hex={}\tprofile_hex={}\truntime_hex={}\tprivate=false\tparent_ms={}",protocol::hex(&profile.udf),protocol::hex(&profile.name),protocol::hex(&profile.path),protocol::hex(&profile.version),deadline.elapsed()))?;
        let value_end = deadline.until(5000)?;
        send(input.as_mut().unwrap(), &nonce, mode, "permit")?;
        let value = capture.next(deadline, value_end)?;
        let downloads = format!("{root}\\downloads");
        if value[2] != downloads {
            return Err("returned download path differs before filesystem access".into());
        }
        win::canonical_owned(Path::new(&downloads))?;
        trace.add(format!(
            "value-validated\t{mode}\tdownloads_hex={}\tparent_ms={}",
            protocol::hex(&value[2]),
            deadline.elapsed()
        ))?;
        let current = win::members(&job, &id, browser)?;
        record_members(trace, &current, mode, "before-close")?;
        members.extend(current);
        let close_end = deadline.until(15_000)?;
        send(input.as_mut().unwrap(), &nonce, mode, "close")?;
        drop(input.take());
        let closed = capture.next(deadline, close_end)?;
        if closed[0] != "closed" {
            return Err("Close receipt absent".into());
        }
        let event = capture.next(deadline, close_end)?;
        if event[0] != "browser-exited" {
            return Err("normal browser exit absent".into());
        }
        trace.add(format!(
            "normal-browser-exit\t{mode}\tpid={browser}\thelper_ms={}\tparent_ms={}\tforced=false",
            event[3],
            deadline.elapsed()
        ))?;
        let actual_browser = members
            .iter()
            .find(|member| member.pid == browser)
            .ok_or("held actual browser absent")?;
        if !actual_browser.handle.exited()? {
            return Err("normal-exit receipt precedes actual held browser exit".into());
        }
        deadline.wait(5000, false, || id.handle.exited())?;
        if id.handle.code()? != 0 {
            return Err("helper did not exit 0".into());
        }
        trace.add(format!(
            "helper-exit\t{mode}\tcode=0\tparent_ms={}",
            deadline.elapsed()
        ))?;
        deadline.wait(5000, false, || Ok(job.active()? == 0))?;
        empty = true;
        trace.add(format!(
            "normal-job-empty\t{mode}\tactive=0\tparent_ms={}\tforced=false",
            deadline.elapsed()
        ))?;
        capture.eof(deadline)?;
        Ok(profile)
    })();
    // Preserve primary evidence before any fallback kill; cleanup errors have separate trace records.
    if let Err(error) = &result {
        if let Err(e) = trace.add(format!("primary-error\t{mode}\t{}", protocol::hex(error))) {
            cleanup_errors.push(e);
        }
        if let Err(e) = capture.persist(evidence, mode) {
            cleanup_errors.push(e);
        }
        if let Err(e) = trace.add(format!(
            "fallback\t{mode}\tassigned={assigned}\tprofile_reusable=false\tparent_ms={}",
            deadline.elapsed()
        )) {
            cleanup_errors.push(e);
        }
        let killed = if assigned {
            job.kill()
        } else {
            id.handle.kill()
        };
        if let Err(e) = killed {
            cleanup_errors.push(e);
        }
        if let Err(e) = deadline.wait(5000, true, || id.handle.exited()) {
            cleanup_errors.push(e);
        }
        if assigned {
            match deadline.wait(5000, true, || Ok(job.active()? == 0)) {
                Ok(()) => empty = true,
                Err(e) => cleanup_errors.push(e),
            }
        } else {
            empty = id.handle.exited().unwrap_or(false);
        }
    }
    drop(input.take());
    if let Err(e) = capture.join(deadline) {
        cleanup_errors.push(e);
    }
    if let Err(e) = capture.persist(evidence, mode) {
        cleanup_errors.push(e);
    }
    for member in members {
        if let Err(e) = member.handle.close() {
            cleanup_errors.push(e);
        }
    }
    if let Err(e) = thread.close() {
        cleanup_errors.push(e);
    }
    if let Err(e) = id.handle.close() {
        cleanup_errors.push(e);
    }
    if let Err(e) = job.close() {
        cleanup_errors.push(e);
    }
    for e in &cleanup_errors {
        let _ = trace.add(format!("cleanup-error\t{mode}\t{}", protocol::hex(e)));
    }
    let _ = trace.add(format!(
        "session-finished\t{mode}\tempty={empty}\tcleanup_errors={}\tparent_ms={}",
        cleanup_errors.len(),
        deadline.elapsed()
    ));
    if result.is_ok() && !cleanup_errors.is_empty() {
        (
            Err("session cleanup failed; no profile reuse".into()),
            empty,
        )
    } else {
        (result, empty)
    }
}

pub fn run(evidence: &str, parent: &str) -> Result<()> {
    run_inner(evidence, parent, None, protocol::TOTAL_MS)
}

pub fn prepare(evidence: &str, parent: &str, nonce: &str) -> Result<()> {
    if !protocol::valid_nonce(nonce) {
        return Err("prepare caller nonce".into());
    }
    let raw = std::env::var("NDL0_PREPARE_BUDGET_MS").map_err(|_| "prepare budget absent")?;
    let cap = raw.parse::<u64>().map_err(|_| "prepare budget invalid")?;
    if !(10_001..=45_000).contains(&cap) || cap.to_string() != raw {
        return Err("prepare budget outside bounded caller work".into());
    }
    run_inner(evidence, parent, Some(nonce), cap)
}

fn run_inner(
    evidence: &str,
    parent: &str,
    transfer_nonce: Option<&str>,
    total_ms: u64,
) -> Result<()> {
    let deadline = Deadline(Instant::now(), total_ms, total_ms - 10_000);
    if std::env::vars_os().any(|(key, _)| {
        key.to_string_lossy()
            .to_uppercase()
            .starts_with("WEBVIEW2_")
    }) {
        return Err("inherited WebView2 override".into());
    }
    let evidence = Path::new(evidence);
    win::canonical_owned(evidence.parent().ok_or("evidence parent")?)?;
    if !evidence.is_absolute()
        || !protocol::owned_path(&win::text(evidence)?, &win::text(evidence)?, false)
    {
        return Err("evidence path spelling".into());
    }
    fs::create_dir(evidence).map_err(|e| format!("fresh evidence directory: {e}"))?;
    win::canonical_owned(evidence)?;
    let mut trace = Trace {
        file: OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(evidence.join("observation.tsv"))
            .map_err(|e| e.to_string())?,
        bytes: 0,
    };
    let mut root = None;
    let mut safe_remove = true;
    let mut result: Result<()> = (|| {
        let (rid, elevated) = win::token(None)?;
        let outer = win::outer_job()?;
        trace.add(format!("parent\tpid={}\trid={rid}\televated={elevated}\tin_outer_job={outer}\tbudget_ms={}\twork_ms={}\toutput_cap=32768",std::process::id(),deadline.1,deadline.2))?;
        if rid != 8192 || elevated || !outer {
            return Err("parent requires existing Medium/non-elevated outer job".into());
        }
        trace.add(format!(
            "explicit-parent\tpath_hex={}",
            protocol::hex(parent)
        ))?;
        let temp = PathBuf::from(protocol::prepare_temp_parent(parent)?);
        win::canonical_owned(&temp)?;
        let owned = temp.join(format!("qr-crypt-dl0-{}", win::nonce()?));
        fs::create_dir(&owned).map_err(|e| format!("fresh root: {e}"))?;
        root = Some(owned.clone());
        let root_text = win::canonical_owned(&owned)?;
        fs::create_dir(owned.join("profile")).map_err(|e| e.to_string())?;
        fs::create_dir(owned.join("downloads")).map_err(|e| e.to_string())?;
        win::canonical_owned(&owned.join("profile"))?;
        win::canonical_owned(&owned.join("downloads"))?;
        let probe = owned.join("downloads").join("owned-write-probe");
        {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&probe)
                .map_err(|e| e.to_string())?;
            file.write_all(b"owned").map_err(|e| e.to_string())?;
        }
        fs::remove_file(probe).map_err(|e| e.to_string())?;
        trace.add(format!(
            "owned-root\tpath_hex={}\tprofile_and_downloads_only=true",
            protocol::hex(&root_text)
        ))?;
        let exe = win::text(&std::env::current_exe().map_err(|e| e.to_string())?)?;
        let budget = Arc::new(AtomicUsize::new(0));
        let (set, empty) = session(
            &exe,
            &root_text,
            evidence,
            "set",
            None,
            &deadline,
            budget.clone(),
            &mut trace,
        );
        safe_remove = empty;
        let set = set?;
        trace.add(format!(
            "set-barrier-complete\tparent_ms={}\tread_not_started=true",
            deadline.elapsed()
        ))?;
        let (read, empty) = session(
            &exe,
            &root_text,
            evidence,
            "read",
            Some(&set),
            &deadline,
            budget.clone(),
            &mut trace,
        );
        safe_remove = empty;
        read?;
        trace.add(format!(
            "persistence-observed\tcombined_output_bytes={}\tparent_ms={}",
            budget.load(Ordering::SeqCst),
            deadline.elapsed()
        ))?;
        deadline.remaining(1, false)?;
        Ok(())
    })();
    if let Some(nonce) = transfer_nonce {
        if result.is_ok() {
            result = (|| {
                let owned = root.as_ref().ok_or("prepare root absent")?;
                let entries = win::inventory(owned, || deadline.remaining(1, false).map(|_| ()))?;
                let root_text = win::canonical_owned(owned)?;
                if !root_text.starts_with(&format!("{parent}\\qr-crypt-dl0-"))
                    || root_text.len() != parent.len() + 46
                {
                    return Err("prepare root spelling differs from caller parent".into());
                }
                trace.add(format!("handoff-finalizing\tentries={}\troot_removed=false\tjobs_empty=true\thandles_closed=true", entries.len()))?;
                deadline.remaining(1, false)?;
                let line = format!(
                    "NDL0_READY\t1\t{nonce}\t{}\t{}\t{}\n",
                    std::process::id(),
                    protocol::hex(&root_text),
                    deadline.elapsed()
                );
                // This sole <=2200-byte record fits the empty pipe; cleanup stays armed through flush and trace.
                let mut out = std::io::stdout().lock();
                out.write_all(line.as_bytes())
                    .and_then(|_| out.flush())
                    .map_err(|e| e.to_string())?;
                deadline.remaining(1, false)?;
                trace.add(format!(
                    "owned-root-transferred\tpath_hex={}\troot_removed=false\telapsed_ms={}",
                    protocol::hex(&root_text),
                    deadline.elapsed()
                ))?;
                Ok(())
            })();
            if result.is_ok() {
                root.take();
                return Ok(());
            }
        }
    }
    if let Err(error) = &result {
        let _ = trace.add(format!(
            "primary-observation-error\t{}",
            protocol::hex(error)
        ));
    }
    let cleanup: Result<()> = (|| {
        if let Some(root) = root {
            if !safe_remove {
                return Err("owned job drainage unproved; root retained".into());
            }
            let entries = win::inventory(&root, || deadline.remaining(1, true).map(|_| ()))?;
            trace.add(format!(
                "cleanup-inventory\tentries={}\tno_reparse=true",
                entries.len()
            ))?;
            for (path, directory) in entries {
                deadline.remaining(1, true)?;
                if directory {
                    fs::remove_dir(path)
                } else {
                    fs::remove_file(path)
                }
                .map_err(|e| e.to_string())?;
            }
            trace.add("owned-root-removed\ttrue")?;
        }
        deadline.remaining(1, true)?;
        Ok(())
    })();
    if let Err(error) = &cleanup {
        let _ = trace.add(format!(
            "cleanup-observation-error\t{}",
            protocol::hex(error)
        ));
    }
    trace.add(format!(
        "result\tpersistence={}\tcleanup={}\telapsed_ms={}\twindows_runtime_measurement=true",
        result.is_ok(),
        cleanup.is_ok(),
        deadline.elapsed()
    ))?;
    result?;
    cleanup?;
    deadline.remaining(1, true)?;
    if transfer_nonce.is_some() {
        return Err("prepare did not transfer ownership".into());
    }
    println!(
        "TASK0_PERSISTENCE_OBSERVED elapsed_ms={}",
        deadline.elapsed()
    );
    Ok(())
}
