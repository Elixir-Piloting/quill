use serde::Serialize;
use std::ptr::null_mut;

#[derive(Debug, Serialize, Clone)]
pub struct AppEntry {
    pub name: String,
    pub exe: String,
}

pub fn get_foreground_exe() -> Option<String> {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::Foundation::{CloseHandle, TRUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };
        use windows_sys::Win32::System::ProcessStatus::GetModuleBaseNameW;
        use windows_sys::Win32::System::Threading::OpenProcess;
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }
        let mut pid: u32 = 0;
        let _ = GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return None;
        }

        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot.is_null() {
            return get_foreground_exe_fallback(pid);
        }

        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            cntUsage: 0,
            th32ProcessID: 0,
            th32DefaultHeapID: 0,
            th32ModuleID: 0,
            cntThreads: 0,
            th32ParentProcessID: 0,
            pcPriClassBase: 0,
            dwFlags: 0,
            szExeFile: [0u16; 260],
        };

        let mut found_exe: Option<String> = None;
        if Process32FirstW(snapshot, &mut entry) == TRUE {
            loop {
                if entry.th32ProcessID == pid {
                    let exe = String::from_utf16_lossy(&entry.szExeFile)
                        .trim_end_matches('\0')
                        .to_string();

                    let hprocess = OpenProcess(0x1000, 0, pid);
                    let module_name = if !hprocess.is_null() {
                        let mut buf = [0u16; 260];
                        let len = GetModuleBaseNameW(hprocess, null_mut(), buf.as_mut_ptr(), buf.len() as u32);
                        CloseHandle(hprocess);
                        if len > 0 {
                            String::from_utf16_lossy(&buf[..len as usize])
                                .trim_end_matches('\0')
                                .to_string()
                        } else {
                            exe
                        }
                    } else {
                        exe
                    };
                    found_exe = Some(module_name.to_lowercase());
                    break;
                }
                if Process32NextW(snapshot, &mut entry) != TRUE {
                    break;
                }
            }
        }
        CloseHandle(snapshot);

        found_exe.or_else(|| get_foreground_exe_fallback(pid))
    }
    #[cfg(not(windows))]
    None
}

#[cfg(windows)]
unsafe fn get_foreground_exe_fallback(pid: u32) -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::ProcessStatus::GetModuleBaseNameW;
    use windows_sys::Win32::System::Threading::OpenProcess;

    let hprocess = OpenProcess(0x1000, 0, pid);
    if hprocess.is_null() {
        return None;
    }
    let mut buf = [0u16; 260];
    let len = GetModuleBaseNameW(hprocess, null_mut(), buf.as_mut_ptr(), buf.len() as u32);
    CloseHandle(hprocess);
    if len == 0 {
        return None;
    }
    let name = String::from_utf16_lossy(&buf[..len as usize]);
    Some(name.to_lowercase())
}

pub fn get_running_apps() -> Vec<AppEntry> {
    #[cfg(windows)]
    unsafe {
        use std::collections::HashSet;
        use windows_sys::Win32::Foundation::{BOOL, TRUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };
        use windows_sys::Win32::System::ProcessStatus::GetModuleBaseNameW;
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            EnumWindows, GetWindowTextLengthW, GetWindowThreadProcessId, IsWindowVisible,
        };

        let mut pids_with_windows: HashSet<u32> = HashSet::new();
        let mut seen_pids: HashSet<u32> = HashSet::new();
        let mut result: Vec<AppEntry> = Vec::new();

        extern "system" fn enum_callback(hwnd: *mut std::ffi::c_void, lparam: isize) -> BOOL {
            unsafe {
                if IsWindowVisible(hwnd) == TRUE {
                    let len = GetWindowTextLengthW(hwnd);
                    if len > 0 {
                        let mut pid: u32 = 0;
                        let _ = GetWindowThreadProcessId(hwnd, &mut pid);
                        if pid > 0 {
                            let set = &mut *(lparam as *mut HashSet<u32>);
                            set.insert(pid);
                        }
                    }
                }
            }
            TRUE
        }

        EnumWindows(Some(enum_callback), &mut pids_with_windows as *mut _ as isize);

        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot.is_null() {
            return result;
        }
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            cntUsage: 0,
            th32ProcessID: 0,
            th32DefaultHeapID: 0,
            th32ModuleID: 0,
            cntThreads: 0,
            th32ParentProcessID: 0,
            pcPriClassBase: 0,
            dwFlags: 0,
            szExeFile: [0u16; 260],
        };
        if Process32FirstW(snapshot, &mut entry) == TRUE {
            loop {
                let pid = entry.th32ProcessID;
                if pids_with_windows.contains(&pid) && !seen_pids.contains(&pid) {
                    seen_pids.insert(pid);
                    let exe = String::from_utf16_lossy(&entry.szExeFile)
                        .trim_end_matches('\0')
                        .to_string();

                    let module_name = {
                        let hprocess = OpenProcess(
                            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
                            0,
                            pid,
                        );
                        if !hprocess.is_null() {
                            let mut buf = [0u16; 260];
                            let len =
                                GetModuleBaseNameW(hprocess, null_mut(), buf.as_mut_ptr(), buf.len() as u32);
                            CloseHandle(hprocess);
                            if len > 0 {
                                String::from_utf16_lossy(&buf[..len as usize])
                                    .trim_end_matches('\0')
                                    .to_string()
                            } else {
                                exe.clone()
                            }
                        } else {
                            exe.clone()
                        }
                    };

                    let name = module_name
                        .trim_end_matches(".exe")
                        .trim_end_matches(".EXE")
                        .to_string();
                    result.push(AppEntry {
                        name,
                        exe: module_name.to_lowercase(),
                    });
                }
                if Process32NextW(snapshot, &mut entry) != TRUE {
                    break;
                }
            }
        }
        CloseHandle(snapshot);
        result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        result
    }
    #[cfg(not(windows))]
    Vec::new()
}
