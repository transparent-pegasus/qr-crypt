use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::c_void,
    fs::File,
    mem::{size_of, zeroed},
    os::windows::io::FromRawHandle,
    path::{Path, PathBuf},
    ptr::{null, null_mut},
};

pub type Result<T> = std::result::Result<T, String>;
type Raw = *mut c_void;
#[repr(C)]
struct Security {
    length: u32,
    descriptor: Raw,
    inherit: i32,
}
#[repr(C)]
struct Startup {
    size: u32,
    reserved: *mut u16,
    desktop: *mut u16,
    title: *mut u16,
    x: u32,
    y: u32,
    xs: u32,
    ys: u32,
    xc: u32,
    yc: u32,
    fill: u32,
    flags: u32,
    show: u16,
    reserved_size: u16,
    reserved_ptr: *mut u8,
    input: Raw,
    output: Raw,
    error: Raw,
}
#[repr(C)]
struct StartupEx {
    base: Startup,
    attributes: Raw,
}
#[repr(C)]
struct ProcessInfo {
    process: Raw,
    thread: Raw,
    pid: u32,
    tid: u32,
}
#[repr(C)]
#[derive(Default)]
struct BasicLimits {
    process_time: i64,
    job_time: i64,
    flags: u32,
    min_ws: usize,
    max_ws: usize,
    active_limit: u32,
    affinity: usize,
    priority: u32,
    scheduling: u32,
}
#[repr(C)]
#[derive(Default)]
struct ExtendedLimits {
    basic: BasicLimits,
    io: [u64; 6],
    process_memory: usize,
    job_memory: usize,
    peak_process: usize,
    peak_job: usize,
}
#[repr(C)]
#[derive(Default)]
struct Accounting {
    times: [i64; 4],
    faults: u32,
    total: u32,
    active: u32,
    terminated: u32,
}
#[repr(C)]
#[derive(Default)]
struct Time {
    low: u32,
    high: u32,
}
#[repr(C)]
struct Entry {
    size: u32,
    usage: u32,
    pid: u32,
    heap: usize,
    module: u32,
    threads: u32,
    parent: u32,
    priority: i32,
    flags: u32,
    name: [u16; 260],
}

// These handwritten FFI layouts are limited to the workflow's Windows x64 target.
#[cfg(target_arch = "x86_64")]
const _: () = {
    assert!(size_of::<Security>() == 24);
    assert!(size_of::<Startup>() == 104);
    assert!(size_of::<StartupEx>() == 112);
    assert!(size_of::<ProcessInfo>() == 24);
    assert!(size_of::<BasicLimits>() == 64);
    assert!(size_of::<ExtendedLimits>() == 144);
    assert!(size_of::<Accounting>() == 48);
    assert!(size_of::<Entry>() == 568);
};

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CloseHandle(handle: Raw) -> i32;
    fn GetCurrentProcess() -> Raw;
    fn GetProcessId(handle: Raw) -> u32;
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Raw;
    fn GetProcessTimes(
        process: Raw,
        created: *mut Time,
        exited: *mut Time,
        kernel: *mut Time,
        user: *mut Time,
    ) -> i32;
    fn QueryFullProcessImageNameW(
        process: Raw,
        flags: u32,
        buffer: *mut u16,
        length: *mut u32,
    ) -> i32;
    fn CreateJobObjectW(attributes: Raw, name: *const u16) -> Raw;
    fn SetInformationJobObject(job: Raw, class: i32, info: *const c_void, length: u32) -> i32;
    fn QueryInformationJobObject(
        job: Raw,
        class: i32,
        info: *mut c_void,
        length: u32,
        returned: *mut u32,
    ) -> i32;
    fn AssignProcessToJobObject(job: Raw, process: Raw) -> i32;
    fn IsProcessInJob(process: Raw, job: Raw, answer: *mut i32) -> i32;
    fn TerminateJobObject(job: Raw, code: u32) -> i32;
    fn TerminateProcess(process: Raw, code: u32) -> i32;
    fn WaitForSingleObject(handle: Raw, milliseconds: u32) -> u32;
    fn GetExitCodeProcess(process: Raw, code: *mut u32) -> i32;
    fn ResumeThread(thread: Raw) -> u32;
    fn CreatePipe(read: *mut Raw, write: *mut Raw, security: *const Security, size: u32) -> i32;
    fn SetHandleInformation(handle: Raw, mask: u32, flags: u32) -> i32;
    fn InitializeProcThreadAttributeList(
        list: Raw,
        count: u32,
        flags: u32,
        size: *mut usize,
    ) -> i32;
    fn UpdateProcThreadAttribute(
        list: Raw,
        flags: u32,
        attribute: usize,
        value: Raw,
        size: usize,
        previous: Raw,
        returned: *mut usize,
    ) -> i32;
    fn DeleteProcThreadAttributeList(list: Raw);
    fn CreateProcessW(
        application: *const u16,
        command: *mut u16,
        process_attributes: Raw,
        thread_attributes: Raw,
        inherit: i32,
        flags: u32,
        environment: Raw,
        directory: *const u16,
        startup: *const StartupEx,
        process: *mut ProcessInfo,
    ) -> i32;
    fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> Raw;
    fn Process32FirstW(snapshot: Raw, entry: *mut Entry) -> i32;
    fn Process32NextW(snapshot: Raw, entry: *mut Entry) -> i32;
}
#[link(name = "advapi32")]
unsafe extern "system" {
    fn OpenProcessToken(process: Raw, access: u32, token: *mut Raw) -> i32;
    fn GetTokenInformation(
        token: Raw,
        class: i32,
        data: Raw,
        length: u32,
        returned: *mut u32,
    ) -> i32;
    fn IsValidSid(sid: Raw) -> i32;
}
#[link(name = "bcrypt")]
unsafe extern "system" {
    fn BCryptGenRandom(algorithm: Raw, buffer: *mut u8, length: u32, flags: u32) -> i32;
}

fn check(ok: i32, api: &str) -> Result<()> {
    if ok == 0 {
        Err(format!("{api}: {}", std::io::Error::last_os_error()))
    } else {
        Ok(())
    }
}
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}
pub fn text(path: &Path) -> Result<String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "non-UTF8 path".into())
}
pub fn nonce() -> Result<String> {
    let mut bytes = [0u8; 16];
    // SAFETY: OS RNG receives exactly the writable stack buffer; no algorithm handle.
    if unsafe { BCryptGenRandom(null_mut(), bytes.as_mut_ptr(), 16, 2) } != 0 {
        return Err("BCryptGenRandom failed".into());
    }
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

#[derive(Debug)]
pub struct Handle(Raw);
impl Handle {
    fn new(raw: Raw, api: &str) -> Result<Self> {
        if raw.is_null() || raw as isize == -1 {
            Err(format!("{api}: {}", std::io::Error::last_os_error()))
        } else {
            Ok(Self(raw))
        }
    }
    pub fn close(mut self) -> Result<()> {
        let raw = std::mem::replace(&mut self.0, null_mut());
        unsafe { check(CloseHandle(raw), "CloseHandle") }
    }
    pub fn exited(&self) -> Result<bool> {
        match unsafe { WaitForSingleObject(self.0, 0) } {
            0 => Ok(true),
            258 => Ok(false),
            _ => Err("WaitForSingleObject failed".into()),
        }
    }
    pub fn code(&self) -> Result<u32> {
        let mut code = 0;
        unsafe {
            check(GetExitCodeProcess(self.0, &mut code), "GetExitCodeProcess")?;
        }
        Ok(code)
    }
    pub fn kill(&self) -> Result<()> {
        unsafe {
            check(
                TerminateProcess(self.0, 1),
                "TerminateProcess/held-suspended-child",
            )
        }
    }
    fn into_file(mut self) -> File {
        let raw = std::mem::replace(&mut self.0, null_mut());
        unsafe { File::from_raw_handle(raw) }
    }
}
impl Drop for Handle {
    fn drop(&mut self) {
        if !self.0.is_null() && unsafe { CloseHandle(self.0) } == 0 {
            eprintln!("owned handle close failure");
        }
    }
}

pub struct Job {
    handle: Handle,
}
impl Job {
    pub fn new() -> Result<Self> {
        let handle = Handle::new(
            unsafe { CreateJobObjectW(null_mut(), null()) },
            "CreateJobObjectW",
        )?;
        let mut limits = ExtendedLimits::default();
        limits.basic.flags = 0x2000; // KILL_ON_JOB_CLOSE, neither breakaway flag.
        unsafe {
            check(
                SetInformationJobObject(
                    handle.0,
                    9,
                    &limits as *const _ as _,
                    size_of::<ExtendedLimits>() as _,
                ),
                "SetInformationJobObject",
            )?;
        }
        let mut actual = ExtendedLimits::default();
        let mut returned = 0;
        unsafe {
            check(
                QueryInformationJobObject(
                    handle.0,
                    9,
                    &mut actual as *mut _ as _,
                    size_of::<ExtendedLimits>() as _,
                    &mut returned,
                ),
                "QueryInformationJobObject/limits",
            )?;
        }
        if returned as usize != size_of::<ExtendedLimits>() || actual.basic.flags != 0x2000 {
            return Err("job flags differ/no-breakaway unproved".into());
        }
        Ok(Self { handle })
    }
    pub fn assign(&self, process: &Handle) -> Result<()> {
        unsafe {
            check(
                AssignProcessToJobObject(self.handle.0, process.0),
                "AssignProcessToJobObject/nested",
            )?;
        }
        self.contains(process)
    }
    pub fn contains(&self, process: &Handle) -> Result<()> {
        let mut yes = 0;
        unsafe {
            check(
                IsProcessInJob(process.0, self.handle.0, &mut yes),
                "IsProcessInJob/actual",
            )?;
        }
        if yes != 1 {
            return Err("actual process is outside setup job".into());
        }
        Ok(())
    }
    pub fn active(&self) -> Result<u32> {
        let mut info = Accounting::default();
        let mut returned = 0;
        unsafe {
            check(
                QueryInformationJobObject(
                    self.handle.0,
                    1,
                    &mut info as *mut _ as _,
                    size_of::<Accounting>() as _,
                    &mut returned,
                ),
                "QueryInformationJobObject/accounting",
            )?;
        }
        if returned as usize != size_of::<Accounting>() {
            return Err("job accounting size".into());
        }
        Ok(info.active)
    }
    fn pids(&self) -> Result<BTreeSet<u32>> {
        let mut buf = [0usize; 130];
        let mut returned = 0;
        unsafe {
            check(
                QueryInformationJobObject(
                    self.handle.0,
                    3,
                    buf.as_mut_ptr() as _,
                    size_of_val(&buf) as _,
                    &mut returned,
                ),
                "QueryInformationJobObject/process-list",
            )?;
        }
        let header = unsafe { std::slice::from_raw_parts(buf.as_ptr() as *const u32, 2) };
        let count = header[1] as usize;
        if count == 0
            || count > 128
            || header[0] != header[1]
            || (returned as usize) < 8 + count * size_of::<usize>()
        {
            return Err("incomplete/oversized job process list".into());
        }
        let mut out = BTreeSet::new();
        for pid in &buf[1..=count] {
            let pid = u32::try_from(*pid).map_err(|_| "oversized PID")?;
            if pid == 0 || !out.insert(pid) {
                return Err("invalid/duplicate job PID".into());
            }
        }
        Ok(out)
    }
    pub fn kill(&self) -> Result<()> {
        unsafe {
            check(
                TerminateJobObject(self.handle.0, 1),
                "TerminateJobObject/fallback-only",
            )
        }
    }
    pub fn close(self) -> Result<()> {
        self.handle.close()
    }
}

pub fn outer_job() -> Result<bool> {
    let mut yes = 0;
    unsafe {
        check(
            IsProcessInJob(GetCurrentProcess(), null_mut(), &mut yes),
            "IsProcessInJob/current",
        )?;
    }
    Ok(yes != 0)
}
pub fn token(process: Option<&Handle>) -> Result<(u32, bool)> {
    let raw = process.map_or_else(|| unsafe { GetCurrentProcess() }, |p| p.0);
    let mut raw_token = null_mut();
    unsafe {
        check(
            OpenProcessToken(raw, 8, &mut raw_token),
            "OpenProcessToken/query-only",
        )?;
    }
    let handle = Handle::new(raw_token, "OpenProcessToken")?;
    let measured = (|| {
        let mut needed = 0;
        if unsafe { GetTokenInformation(handle.0, 25, null_mut(), 0, &mut needed) } != 0
            || std::io::Error::last_os_error().raw_os_error() != Some(122)
            || !(24..=65536).contains(&needed)
        {
            return Err("integrity buffer size".into());
        }
        let mut buf = vec![0usize; (needed as usize).div_ceil(size_of::<usize>())];
        let mut received = 0;
        unsafe {
            check(
                GetTokenInformation(handle.0, 25, buf.as_mut_ptr() as _, needed, &mut received),
                "GetTokenInformation/integrity",
            )?;
        }
        if received > needed || received < 24 {
            return Err("integrity buffer length".into());
        }
        let sid = buf[0] as *const u8;
        let offset = (sid as usize)
            .checked_sub(buf.as_ptr() as usize)
            .ok_or("SID before buffer")?;
        if offset < size_of::<usize>() + 4 || offset + 12 > received as usize {
            return Err("SID outside buffer".into());
        }
        let bytes = unsafe { std::slice::from_raw_parts(sid, 12) };
        if bytes[..8] != [1, 1, 0, 0, 0, 0, 0, 16] || unsafe { IsValidSid(sid as _) } == 0 {
            return Err("invalid integrity SID".into());
        }
        let rid = u32::from_le_bytes(bytes[8..12].try_into().unwrap());
        let mut elevated = 0u32;
        unsafe {
            check(
                GetTokenInformation(handle.0, 20, &mut elevated as *mut _ as _, 4, &mut received),
                "GetTokenInformation/elevation",
            )?;
        }
        if received != 4 || elevated > 1 {
            return Err("invalid elevation".into());
        }
        Ok((rid, elevated != 0))
    })();
    handle.close()?;
    measured
}

pub struct Identity {
    pub handle: Handle,
    pub pid: u32,
    pub start: u64,
    pub image: String,
}
impl Identity {
    pub fn refresh(&mut self) -> Result<()> {
        let handle = &self.handle;
        let mut start = Time::default();
        let mut exit = Time::default();
        let mut kernel = Time::default();
        let mut user = Time::default();
        unsafe {
            check(
                GetProcessTimes(handle.0, &mut start, &mut exit, &mut kernel, &mut user),
                "GetProcessTimes",
            )?;
        }
        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        unsafe {
            check(
                QueryFullProcessImageNameW(handle.0, 0, buf.as_mut_ptr(), &mut size),
                "QueryFullProcessImageNameW",
            )?;
        }
        if size == 0 || size as usize >= buf.len() {
            return Err("process image size".into());
        }
        let image = String::from_utf16(&buf[..size as usize]).map_err(|_| "process image UTF16")?;
        let pid = unsafe { GetProcessId(handle.0) };
        if pid == 0 || pid != self.pid {
            return Err("GetProcessId differs from held creation identity".into());
        }
        self.start = (u64::from(start.high) << 32) | u64::from(start.low);
        self.image = image;
        Ok(())
    }
    pub fn open(pid: u32) -> Result<Self> {
        let handle = Handle::new(
            unsafe { OpenProcess(0x101000, 0, pid) },
            "OpenProcess/query+sync",
        )?;
        let mut id = Self {
            handle,
            pid,
            start: 0,
            image: String::new(),
        };
        id.refresh()?;
        Ok(id)
    }
}

pub struct Child {
    pub id: Identity,
    pub thread: Handle,
    pub input: File,
    pub output: File,
    pub error: File,
    pub child_pipes: Vec<Handle>,
}
fn pipe(parent_read: bool) -> Result<(Handle, Handle)> {
    let security = Security {
        length: size_of::<Security>() as _,
        descriptor: null_mut(),
        inherit: 1,
    };
    let (mut read, mut write) = (null_mut(), null_mut());
    unsafe {
        check(
            CreatePipe(&mut read, &mut write, &security, 4096),
            "CreatePipe",
        )?;
    }
    let (read, write) = (
        Handle::new(read, "pipe-read")?,
        Handle::new(write, "pipe-write")?,
    );
    unsafe {
        check(
            SetHandleInformation(if parent_read { read.0 } else { write.0 }, 1, 0),
            "SetHandleInformation/no-parent-inherit",
        )?;
    }
    Ok((read, write))
}
// Result owns the suspended child's handles even if later validation/assignment fails.
pub fn suspended(exe: &str, root: &str, nonce: &str, mode: &str) -> Result<Child> {
    for arg in [exe, root] {
        if arg.contains('"') || arg.chars().any(char::is_control) {
            return Err("unsafe command argument".into());
        }
    }
    if !crate::protocol::valid_nonce(nonce) || !["set", "read"].contains(&mode) {
        return Err("invalid command mode/nonce".into());
    }
    let (input_read, input_write) = pipe(false)?;
    let (output_read, output_write) = pipe(true)?;
    let (error_read, error_write) = pipe(true)?;
    let mut attr_size = 0;
    let sized = unsafe { InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut attr_size) };
    if sized != 0
        || std::io::Error::last_os_error().raw_os_error() != Some(122)
        || attr_size == 0
        || attr_size > 65536
    {
        return Err("attribute list size".into());
    }
    let mut attrs = vec![0usize; attr_size.div_ceil(size_of::<usize>())];
    let attrs_ptr = attrs.as_mut_ptr() as Raw;
    unsafe {
        check(
            InitializeProcThreadAttributeList(attrs_ptr, 1, 0, &mut attr_size),
            "InitializeProcThreadAttributeList",
        )?;
    }
    let created: Result<ProcessInfo> = (|| {
        let mut inherited = [input_read.0, output_write.0, error_write.0];
        unsafe {
            check(
                UpdateProcThreadAttribute(
                    attrs_ptr,
                    0,
                    0x20002,
                    inherited.as_mut_ptr() as _,
                    size_of_val(&inherited),
                    null_mut(),
                    null_mut(),
                ),
                "UpdateProcThreadAttribute/explicit-pipes",
            )?;
        }
        let mut startup: StartupEx = unsafe { zeroed() };
        startup.base.size = size_of::<StartupEx>() as _;
        startup.base.flags = 0x100;
        startup.base.input = input_read.0;
        startup.base.output = output_write.0;
        startup.base.error = error_write.0;
        startup.attributes = attrs_ptr;
        let mut pi: ProcessInfo = unsafe { zeroed() };
        let mut command = wide(&format!("\"{exe}\" {mode} \"{root}\" {nonce}"));
        unsafe {
            check(
                CreateProcessW(
                    wide(exe).as_ptr(),
                    command.as_mut_ptr(),
                    null_mut(),
                    null_mut(),
                    1,
                    0x80004,
                    null_mut(),
                    null(),
                    &startup,
                    &mut pi,
                ),
                "CreateProcessW/suspended-explicit-handles",
            )?;
        }
        Ok(pi)
    })();
    unsafe {
        DeleteProcThreadAttributeList(attrs_ptr);
    }
    let pi: ProcessInfo = created?;
    // No fallible work between successful creation and transferring every handle to the parent.
    let id = Identity {
        handle: Handle(pi.process),
        pid: pi.pid,
        start: 0,
        image: String::new(),
    };
    Ok(Child {
        id,
        thread: Handle(pi.thread),
        input: input_write.into_file(),
        output: output_read.into_file(),
        error: error_read.into_file(),
        child_pipes: vec![input_read, output_write, error_write],
    })
}
pub fn resume(thread: &Handle) -> Result<()> {
    match unsafe { ResumeThread(thread.0) } {
        1 => Ok(()),
        u32::MAX => Err(format!("ResumeThread: {}", std::io::Error::last_os_error())),
        _ => Err("unexpected suspend count".into()),
    }
}

pub fn members(job: &Job, helper: &Identity, browser: u32) -> Result<Vec<Identity>> {
    let pids = job.pids()?;
    if !pids.contains(&helper.pid) || !pids.contains(&browser) || pids.len() < 2 {
        return Err(format!(
            "actual browser/helper absent from setup job: browser={browser} helper={} job_pids={pids:?}",
            helper.pid
        ));
    }
    let snapshot = Handle::new(
        unsafe { CreateToolhelp32Snapshot(2, 0) },
        "CreateToolhelp32Snapshot",
    )?;
    let mut entry: Entry = unsafe { zeroed() };
    entry.size = size_of::<Entry>() as _;
    let mut parents = BTreeMap::new();
    let mut found = unsafe { Process32FirstW(snapshot.0, &mut entry) };
    while found != 0 {
        if parents.len() >= 16384 || parents.insert(entry.pid, entry.parent).is_some() {
            return Err("oversized/duplicate process snapshot".into());
        }
        found = unsafe { Process32NextW(snapshot.0, &mut entry) };
    }
    if std::io::Error::last_os_error().raw_os_error() != Some(18) {
        return Err("process snapshot incomplete".into());
    }
    snapshot.close()?;
    let descends = |mut pid: u32| {
        for _ in 0..32 {
            if pid == helper.pid {
                return true;
            }
            let Some(next) = parents.get(&pid) else {
                return false;
            };
            if *next == pid {
                return false;
            }
            pid = *next;
        }
        false
    };
    for pid in parents.keys().filter(|pid| descends(**pid)) {
        if !pids.contains(pid) {
            return Err(format!("observed descendant outside setup job: pid={pid}"));
        }
    }
    let mut out = Vec::new();
    for pid in pids.into_iter().filter(|pid| *pid != helper.pid) {
        if !descends(pid) {
            return Err(format!(
                "job process ancestry not tied to helper: pid={pid}"
            ));
        }
        let id = Identity::open(pid)?;
        job.contains(&id.handle)?;
        if id.start < helper.start
            || !Path::new(&id.image)
                .file_name()
                .is_some_and(|n| n.eq_ignore_ascii_case("msedgewebview2.exe"))
            || id.handle.exited()?
        {
            return Err("actual WebView process identity/start differs".into());
        }
        out.push(id);
    }
    Ok(out)
}

pub fn canonical_owned(path: &Path) -> Result<String> {
    use std::os::windows::fs::MetadataExt;
    let value = text(path)?;
    if !crate::protocol::owned_path(&value, &value, false) {
        return Err("ambiguous owned path spelling".into());
    }
    for ancestor in path.ancestors() {
        let meta =
            std::fs::symlink_metadata(ancestor).map_err(|e| format!("owned path metadata: {e}"))?;
        if !meta.is_dir() || meta.file_attributes() & 0x400 != 0 {
            return Err("non-directory/reparse owned ancestor".into());
        }
    }
    let actual = text(&std::fs::canonicalize(path).map_err(|e| e.to_string())?)?;
    let actual = actual.strip_prefix(r"\\?\").unwrap_or(&actual);
    if !actual.eq_ignore_ascii_case(&value) {
        return Err("owned path canonical alias".into());
    }
    Ok(actual.into())
}
pub fn validate_profile(root: &str, udf: &str, name: &str, profile: &str) -> Result<()> {
    let expected = format!("{root}\\profile");
    if !crate::protocol::owned_path(&expected, udf, false)
        || !expected.eq_ignore_ascii_case(udf)
        || !crate::protocol::owned_path(&expected, profile, true)
        || name.len() > 128
        || name
            .chars()
            .any(|c| c.is_control() || "\\/:\"<>|?*~".contains(c))
    {
        return Err("foreign UDF/profile/name before filesystem access".into());
    }
    canonical_owned(Path::new(udf))?;
    canonical_owned(Path::new(profile))?;
    Ok(())
}

pub fn inventory(
    root: &Path,
    mut check_deadline: impl FnMut() -> Result<()>,
) -> Result<Vec<(PathBuf, bool)>> {
    use std::os::windows::fs::MetadataExt;
    fn walk(
        root: &Path,
        path: &Path,
        depth: usize,
        out: &mut Vec<(PathBuf, bool)>,
        visited: &mut usize,
        check_deadline: &mut impl FnMut() -> Result<()>,
    ) -> Result<()> {
        check_deadline()?;
        *visited += 1;
        if depth > 16 || *visited > 4096 {
            return Err("owned cleanup inventory cap".into());
        }
        if path != root && !crate::protocol::owned_path(&text(root)?, &text(path)?, true) {
            return Err("cleanup path escaped root".into());
        }
        let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
        if meta.file_attributes() & 0x400 != 0 || !(meta.is_file() || meta.is_dir()) {
            return Err("cleanup reparse/nonregular entry".into());
        }
        if meta.is_dir() {
            for entry in std::fs::read_dir(path).map_err(|e| e.to_string())? {
                walk(
                    root,
                    &entry.map_err(|e| e.to_string())?.path(),
                    depth + 1,
                    out,
                    visited,
                    check_deadline,
                )?;
            }
        }
        out.push((path.into(), meta.is_dir()));
        Ok(())
    }
    canonical_owned(root)?;
    let mut out = Vec::new();
    walk(root, root, 0, &mut out, &mut 0, &mut check_deadline)?;
    Ok(out)
}
