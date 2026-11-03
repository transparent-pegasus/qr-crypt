param(
  [Parameter(Mandatory)][string]$EncodedCommand,
  [Parameter(Mandatory)][string]$TimeoutSeconds
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
try {
  if (!$IsWindows) { throw 'The Medium launcher requires Windows' }
  $seconds = 0
  if (![int]::TryParse($TimeoutSeconds, [Globalization.NumberStyles]::None, [Globalization.CultureInfo]::InvariantCulture, [ref]$seconds) -or $seconds -lt 1 -or $seconds -gt 3600) {
    throw 'TimeoutSeconds must be an integer from 1 through 3600'
  }
  $bytes = [Convert]::FromBase64String($EncodedCommand)
  if ($bytes.Length -eq 0 -or $bytes.Length % 2 -ne 0 -or [Convert]::ToBase64String($bytes) -cne $EncodedCommand) {
    throw 'EncodedCommand must be canonical UTF16LE/Base64'
  }
  $null = [Text.UnicodeEncoding]::new($false, $false, $true).GetString($bytes)
  $application = $env:NATIVE_RELAY_PWSH
  if (!$application -or ![IO.Path]::IsPathFullyQualified($application) -or ![IO.File]::Exists($application) -or [IO.Path]::GetFileName($application) -ine 'pwsh.exe' -or $application.Contains('"')) {
    throw 'NATIVE_RELAY_PWSH must select an absolute existing pwsh.exe'
  }
  $location = Get-Location
  if ($location.Provider.Name -ne 'FileSystem') { throw 'The launcher requires the checkout filesystem directory' }
  $commandLine = '"' + $application + '" -NoProfile -NonInteractive -EncodedCommand ' + $EncodedCommand
  if ($commandLine.Length -ge 32767) { throw 'The encoded command exceeds the Win32 command-line limit' }

  Add-Type @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class NativeMediumLauncher
{
    [StructLayout(LayoutKind.Sequential)]
    struct Label { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct StartupInfo
    {
        public uint Size;
        public string Reserved, Desktop, Title;
        public uint X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
        public ushort ShowWindow, Reserved2;
        public IntPtr Reserved2Buffer, StdInput, StdOutput, StdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits
    {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits
    {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct Accounting
    {
        public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
        public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }

    [DllImport("kernel32.dll", ExactSpelling = true)]
    static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool CreateRestrictedToken(IntPtr source, uint flags, uint disableCount, IntPtr disableSids, uint deleteCount, IntPtr deletePrivileges, uint restrictCount, IntPtr restrictSids, out IntPtr token);
    [DllImport("advapi32.dll", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool SetTokenInformation(IntPtr token, int infoClass, IntPtr buffer, uint length);
    [DllImport("advapi32.dll", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetTokenInformation(IntPtr token, int infoClass, IntPtr buffer, uint length, out uint returned);
    [DllImport("advapi32.dll", EntryPoint = "GetTokenInformation", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetTokenDword(IntPtr token, int infoClass, out uint value, uint length, out uint returned);
    [DllImport("advapi32.dll", ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool IsValidSid(IntPtr sid);
    [DllImport("advapi32.dll", ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool EqualSid(IntPtr first, IntPtr second);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool CreateProcessAsUserW(IntPtr token, [MarshalAs(UnmanagedType.LPWStr)] string application, [In, Out] StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint flags, IntPtr environment, [MarshalAs(UnmanagedType.LPWStr)] string directory, ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
    static extern IntPtr CreateJobObjectW(IntPtr attributes, [MarshalAs(UnmanagedType.LPWStr)] string name);
    [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits limits, uint length);
    [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out Accounting accounting, uint length, out uint returned);
    [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool CloseHandle(IntPtr handle);

    static void Check(bool success, string api)
    {
        if (!success) throw new Win32Exception(Marshal.GetLastWin32Error(), api);
    }
    static bool Valid(IntPtr handle) { return handle != IntPtr.Zero && handle != new IntPtr(-1); }
    static void RequireHandle(IntPtr handle, string api)
    {
        if (!Valid(handle)) throw new InvalidOperationException(api + " returned an invalid handle");
    }
    static void PrepareToken(IntPtr token)
    {
        IntPtr label = IntPtr.Zero, observed = IntPtr.Zero;
        try
        {
            int header = Marshal.SizeOf<Label>();
            byte[] mediumSid = { 1, 1, 0, 0, 0, 0, 0, 16, 0, 32, 0, 0 };
            label = Marshal.AllocHGlobal(header + mediumSid.Length);
            IntPtr sid = IntPtr.Add(label, header);
            Marshal.Copy(mediumSid, 0, sid, mediumSid.Length);
            if (!IsValidSid(sid)) throw new InvalidOperationException("Invalid owned Medium SID");
            Marshal.StructureToPtr(new Label { Sid = sid, Attributes = 0x20 }, label, false);
            Check(SetTokenInformation(token, 25, label, (uint)(header + mediumSid.Length)), "SetTokenInformation/Medium");
            uint needed;
            bool sized = GetTokenInformation(token, 25, IntPtr.Zero, 0, out needed);
            int error = Marshal.GetLastWin32Error();
            if (sized || error != 122) throw new Win32Exception(error, "Size TokenIntegrityLevel");
            if (needed < header + mediumSid.Length || needed > 65536) throw new InvalidOperationException("Invalid integrity buffer size");
            observed = Marshal.AllocHGlobal((int)needed);
            uint returned;
            Check(GetTokenInformation(token, 25, observed, needed, out returned), "GetTokenInformation/Medium");
            if (returned < header + mediumSid.Length || returned > needed) throw new InvalidOperationException("Invalid integrity buffer length");
            IntPtr actualSid = Marshal.ReadIntPtr(observed);
            if (actualSid == IntPtr.Zero || !IsValidSid(actualSid) || !EqualSid(actualSid, sid))
                throw new InvalidOperationException("The new token must have Medium integrity");
            uint elevated;
            Check(GetTokenDword(token, 20, out elevated, 4, out returned), "GetTokenInformation/Elevation");
            if (returned != 4 || elevated != 0) throw new InvalidOperationException("The new token must not be elevated");
        }
        finally
        {
            if (observed != IntPtr.Zero) Marshal.FreeHGlobal(observed);
            if (label != IntPtr.Zero) Marshal.FreeHGlobal(label);
        }
    }
    static void WaitForExit(IntPtr process, uint milliseconds)
    {
        uint wait = WaitForSingleObject(process, milliseconds);
        if (wait == 0xFFFFFFFF) Check(false, "WaitForSingleObject/cleanup");
        if (wait != 0) throw new InvalidOperationException("Owned process cleanup did not finish");
    }
    static void EmptyJob(IntPtr job)
    {
        var deadline = Stopwatch.StartNew();
        while (true)
        {
            Accounting accounting;
            uint returned, size = (uint)Marshal.SizeOf<Accounting>();
            Check(QueryInformationJobObject(job, 1, out accounting, size, out returned), "QueryInformationJobObject/cleanup");
            if (returned != size) throw new InvalidOperationException("Invalid job accounting length");
            if (accounting.ActiveProcesses == 0) return;
            if (deadline.ElapsedMilliseconds >= 10000) throw new InvalidOperationException("Owned job tree cleanup did not finish");
            Thread.Sleep(10);
        }
    }
    static void Close(IntPtr handle, string resource, List<Exception> errors)
    {
        if (Valid(handle) && !CloseHandle(handle))
            errors.Add(new Win32Exception(Marshal.GetLastWin32Error(), "CloseHandle/" + resource));
    }

    public static int Run(string application, string commandLine, string directory, int seconds)
    {
        IntPtr original = IntPtr.Zero, token = IntPtr.Zero, job = IntPtr.Zero;
        ProcessInfo process = new ProcessInfo();
        bool assigned = false;
        int exitCode = 1;
        Exception failure = null;
        var cleanupErrors = new List<Exception>();
        var deadline = Stopwatch.StartNew();
        try
        {
            // Derived handles retain these rights; the original token is never modified.
            Check(OpenProcessToken(GetCurrentProcess(), 0x1 | 0x2 | 0x8 | 0x80, out original), "OpenProcessToken/current");
            RequireHandle(original, "OpenProcessToken");
            Check(CreateRestrictedToken(original, 0x5, 0, IntPtr.Zero, 0, IntPtr.Zero, 0, IntPtr.Zero, out token), "CreateRestrictedToken/LUA_TOKEN|DISABLE_MAX_PRIVILEGE");
            RequireHandle(token, "CreateRestrictedToken");
            if (token == original) { token = IntPtr.Zero; throw new InvalidOperationException("Only a new owned token may be lowered"); }
            PrepareToken(token);
            job = CreateJobObjectW(IntPtr.Zero, null);
            Check(job != IntPtr.Zero, "CreateJobObjectW");
            RequireHandle(job, "CreateJobObjectW");
            var limits = new ExtendedLimits { Basic = new BasicLimits { Flags = 0x2000 } }; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, no breakaway.
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>()), "SetInformationJobObject");
            var startup = new StartupInfo { Size = (uint)Marshal.SizeOf<StartupInfo>() };
            // Suspend before job assignment; inherit the same user's environment and desktop, no handles.
            Check(CreateProcessAsUserW(token, application, new StringBuilder(commandLine, commandLine.Length + 1), IntPtr.Zero, IntPtr.Zero, false, 0x4, IntPtr.Zero, directory, ref startup, out process), "CreateProcessAsUserW");
            RequireHandle(process.Process, "CreateProcessAsUserW/process");
            RequireHandle(process.Thread, "CreateProcessAsUserW/thread");
            if (process.ProcessId == 0 || process.ThreadId == 0) throw new InvalidOperationException("Invalid child process identity");
            Check(AssignProcessToJobObject(job, process.Process), "AssignProcessToJobObject");
            assigned = true;
            if (deadline.ElapsedMilliseconds >= seconds * 1000L) throw new TimeoutException("NATIVE_RELAY_LAUNCH_TIMEOUT: Medium launch deadline expired");
            uint resumed = ResumeThread(process.Thread);
            if (resumed == 0xFFFFFFFF) Check(false, "ResumeThread");
            if (resumed != 1) throw new InvalidOperationException("Unexpected child suspend count");
            long remaining = seconds * 1000L - deadline.ElapsedMilliseconds;
            if (remaining <= 0) throw new TimeoutException("NATIVE_RELAY_LAUNCH_TIMEOUT: Medium launch deadline expired");
            uint wait = WaitForSingleObject(process.Process, (uint)remaining);
            if (wait == 0xFFFFFFFF) Check(false, "WaitForSingleObject");
            if (wait == 258) throw new TimeoutException("NATIVE_RELAY_LAUNCH_TIMEOUT: Medium child deadline expired");
            if (wait != 0) throw new InvalidOperationException("Unexpected child wait result");
            uint code;
            Check(GetExitCodeProcess(process.Process, out code), "GetExitCodeProcess");
            exitCode = unchecked((int)code);
        }
        catch (Exception error) { failure = error; }
        finally
        {
            if (Valid(process.Process))
            {
                try
                {
                    if (assigned)
                    {
                        Check(TerminateJobObject(job, 1), "TerminateJobObject/cleanup");
                        EmptyJob(job);
                    }
                    else
                    {
                        // A failed assignment leaves only the held, still-suspended child.
                        Check(TerminateProcess(process.Process, 1), "TerminateProcess/unassigned-child");
                    }
                    WaitForExit(process.Process, 10000);
                }
                catch (Exception error) { cleanupErrors.Add(error); }
            }
            Close(process.Thread, "thread", cleanupErrors);
            Close(process.Process, "process", cleanupErrors);
            Close(job, "job", cleanupErrors);
            Close(token, "restricted-token", cleanupErrors);
            Close(original, "original-token", cleanupErrors);
        }
        if (cleanupErrors.Count != 0)
        {
            if (failure != null) cleanupErrors.Insert(0, failure);
            throw new AggregateException("Medium launcher failed; cleanup errors retained", cleanupErrors);
        }
        if (failure is TimeoutException) { Console.Error.WriteLine(failure.Message); return 124; }
        if (failure != null) throw failure;
        return exitCode;
    }
}
'@
  exit ([NativeMediumLauncher]::Run($application, $commandLine, $location.ProviderPath, $seconds))
} catch {
  [Console]::Error.WriteLine('NATIVE_RELAY_LAUNCH_ERROR: ' + $_.Exception.ToString())
  exit 1
}
