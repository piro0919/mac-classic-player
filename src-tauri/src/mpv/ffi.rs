// libmpv の C API（client.h / render.h / render_gl.h）の最小限の定義
//
// libmpv はビルド時にリンクせず、起動後に dlopen で読み込む。
// こうすると mpv が入っていない Mac でもアプリ自体は起動でき、
// 「brew install mpv してください」と案内できる。

#![allow(non_camel_case_types)]

use libloading::Library;
use std::ffi::{c_char, c_double, c_int, c_ulong, c_void};
use std::path::PathBuf;
use std::sync::OnceLock;

#[repr(C)]
pub struct mpv_handle {
    _private: [u8; 0],
}

#[repr(C)]
pub struct mpv_render_context {
    _private: [u8; 0],
}

// mpv_format
pub const MPV_FORMAT_NONE: c_int = 0;
pub const MPV_FORMAT_STRING: c_int = 1;
pub const MPV_FORMAT_OSD_STRING: c_int = 2;
pub const MPV_FORMAT_FLAG: c_int = 3;
pub const MPV_FORMAT_INT64: c_int = 4;
pub const MPV_FORMAT_DOUBLE: c_int = 5;
pub const MPV_FORMAT_NODE: c_int = 6;
pub const MPV_FORMAT_NODE_ARRAY: c_int = 7;
pub const MPV_FORMAT_NODE_MAP: c_int = 8;

// mpv_event_id
pub const MPV_EVENT_NONE: c_int = 0;
pub const MPV_EVENT_SHUTDOWN: c_int = 1;
pub const MPV_EVENT_LOG_MESSAGE: c_int = 2;
pub const MPV_EVENT_START_FILE: c_int = 6;
pub const MPV_EVENT_END_FILE: c_int = 7;
pub const MPV_EVENT_FILE_LOADED: c_int = 8;
pub const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;

// mpv_end_file_reason
pub const MPV_END_FILE_REASON_EOF: c_int = 0;
pub const MPV_END_FILE_REASON_STOP: c_int = 2;
pub const MPV_END_FILE_REASON_QUIT: c_int = 3;
pub const MPV_END_FILE_REASON_ERROR: c_int = 4;

// mpv_render_param_type
pub const MPV_RENDER_PARAM_INVALID: c_int = 0;
pub const MPV_RENDER_PARAM_API_TYPE: c_int = 1;
pub const MPV_RENDER_PARAM_OPENGL_INIT_PARAMS: c_int = 2;
pub const MPV_RENDER_PARAM_OPENGL_FBO: c_int = 3;
pub const MPV_RENDER_PARAM_FLIP_Y: c_int = 4;
pub const MPV_RENDER_PARAM_SW_SIZE: c_int = 17;
pub const MPV_RENDER_PARAM_SW_FORMAT: c_int = 18;
pub const MPV_RENDER_PARAM_SW_STRIDE: c_int = 19;
pub const MPV_RENDER_PARAM_SW_POINTER: c_int = 20;

pub const MPV_RENDER_UPDATE_FRAME: u64 = 1;

#[repr(C)]
pub struct mpv_event {
    pub event_id: c_int,
    pub error: c_int,
    pub reply_userdata: u64,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct mpv_event_property {
    pub name: *const c_char,
    pub format: c_int,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct mpv_event_end_file {
    pub reason: c_int,
    pub error: c_int,
    pub playlist_entry_id: i64,
    pub playlist_insert_id: i64,
    pub playlist_insert_num_entries: c_int,
}

#[repr(C)]
pub struct mpv_event_log_message {
    pub prefix: *const c_char,
    pub level: *const c_char,
    pub text: *const c_char,
    pub log_level: c_int,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub union mpv_node_u {
    pub string: *mut c_char,
    pub flag: c_int,
    pub int64: i64,
    pub double_: c_double,
    pub list: *mut mpv_node_list,
    pub ba: *mut c_void,
}

#[repr(C)]
pub struct mpv_node {
    pub u: mpv_node_u,
    pub format: c_int,
}

#[repr(C)]
pub struct mpv_node_list {
    pub num: c_int,
    pub values: *mut mpv_node,
    pub keys: *mut *mut c_char,
}

#[repr(C)]
pub struct mpv_render_param {
    pub type_: c_int,
    pub data: *mut c_void,
}

pub type GetProcAddressFn =
    unsafe extern "C" fn(ctx: *mut c_void, name: *const c_char) -> *mut c_void;

#[repr(C)]
pub struct mpv_opengl_init_params {
    pub get_proc_address: Option<GetProcAddressFn>,
    pub get_proc_address_ctx: *mut c_void,
}

#[repr(C)]
pub struct mpv_opengl_fbo {
    pub fbo: c_int,
    pub w: c_int,
    pub h: c_int,
    pub internal_format: c_int,
}

pub type UpdateCallback = unsafe extern "C" fn(ctx: *mut c_void);

/// 読み込んだ libmpv の関数ポインタ一式
pub struct Api {
    _lib: Library,
    pub client_api_version: unsafe extern "C" fn() -> c_ulong,
    pub error_string: unsafe extern "C" fn(c_int) -> *const c_char,
    pub free: unsafe extern "C" fn(*mut c_void),
    pub create: unsafe extern "C" fn() -> *mut mpv_handle,
    pub initialize: unsafe extern "C" fn(*mut mpv_handle) -> c_int,
    pub terminate_destroy: unsafe extern "C" fn(*mut mpv_handle),
    pub set_option_string:
        unsafe extern "C" fn(*mut mpv_handle, *const c_char, *const c_char) -> c_int,
    pub command: unsafe extern "C" fn(*mut mpv_handle, *mut *const c_char) -> c_int,
    pub set_property_string:
        unsafe extern "C" fn(*mut mpv_handle, *const c_char, *const c_char) -> c_int,
    pub get_property:
        unsafe extern "C" fn(*mut mpv_handle, *const c_char, c_int, *mut c_void) -> c_int,
    pub free_node_contents: unsafe extern "C" fn(*mut mpv_node),
    pub observe_property: unsafe extern "C" fn(*mut mpv_handle, u64, *const c_char, c_int) -> c_int,
    pub request_log_messages: unsafe extern "C" fn(*mut mpv_handle, *const c_char) -> c_int,
    pub wait_event: unsafe extern "C" fn(*mut mpv_handle, c_double) -> *mut mpv_event,
    pub wakeup: unsafe extern "C" fn(*mut mpv_handle),
    pub render_context_create: unsafe extern "C" fn(
        *mut *mut mpv_render_context,
        *mut mpv_handle,
        *mut mpv_render_param,
    ) -> c_int,
    pub render_context_set_update_callback:
        unsafe extern "C" fn(*mut mpv_render_context, Option<UpdateCallback>, *mut c_void),
    pub render_context_update: unsafe extern "C" fn(*mut mpv_render_context) -> u64,
    pub render_context_render:
        unsafe extern "C" fn(*mut mpv_render_context, *mut mpv_render_param) -> c_int,
    pub render_context_report_swap: unsafe extern "C" fn(*mut mpv_render_context),
    pub render_context_free: unsafe extern "C" fn(*mut mpv_render_context),
}

/// libmpv を探す場所
///
/// Finderから起動したアプリにはシェルの環境が渡らないので、Homebrew/MacPortsの
/// 定番の場所を明示的に見る。アプリに同梱した場合に備えて Frameworks も見る。
fn candidates() -> Vec<PathBuf> {
    let mut list = Vec::new();
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
    {
        if cfg!(target_os = "macos") {
            list.push(dir.join("../Frameworks/libmpv.2.dylib"));
        }
        list.push(dir.join(lib_file_name()));
    }
    if cfg!(target_os = "macos") {
        for prefix in ["/opt/homebrew", "/usr/local", "/opt/local"] {
            list.push(PathBuf::from(prefix).join("lib/libmpv.2.dylib"));
            list.push(PathBuf::from(prefix).join("opt/mpv/lib/libmpv.2.dylib"));
        }
    }
    // 最後はOSの検索パスに任せる
    list.push(PathBuf::from(lib_file_name()));
    list
}

fn lib_file_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "libmpv.2.dylib"
    } else if cfg!(windows) {
        "libmpv-2.dll"
    } else {
        "libmpv.so.2"
    }
}

/// 関数ポインタをライブラリから取り出す
macro_rules! sym {
    ($lib:expr, $name:literal) => {{
        let symbol = $lib
            .get(concat!($name, "\0").as_bytes())
            .map_err(|e| format!("{}: {}", $name, e))?;
        *symbol
    }};
}

unsafe fn load_from(lib: Library) -> Result<Api, String> {
    Ok(Api {
        client_api_version: sym!(lib, "mpv_client_api_version"),
        error_string: sym!(lib, "mpv_error_string"),
        free: sym!(lib, "mpv_free"),
        create: sym!(lib, "mpv_create"),
        initialize: sym!(lib, "mpv_initialize"),
        terminate_destroy: sym!(lib, "mpv_terminate_destroy"),
        set_option_string: sym!(lib, "mpv_set_option_string"),
        command: sym!(lib, "mpv_command"),
        set_property_string: sym!(lib, "mpv_set_property_string"),
        get_property: sym!(lib, "mpv_get_property"),
        free_node_contents: sym!(lib, "mpv_free_node_contents"),
        observe_property: sym!(lib, "mpv_observe_property"),
        request_log_messages: sym!(lib, "mpv_request_log_messages"),
        wait_event: sym!(lib, "mpv_wait_event"),
        wakeup: sym!(lib, "mpv_wakeup"),
        render_context_create: sym!(lib, "mpv_render_context_create"),
        render_context_set_update_callback: sym!(lib, "mpv_render_context_set_update_callback"),
        render_context_update: sym!(lib, "mpv_render_context_update"),
        render_context_render: sym!(lib, "mpv_render_context_render"),
        render_context_report_swap: sym!(lib, "mpv_render_context_report_swap"),
        render_context_free: sym!(lib, "mpv_render_context_free"),
        _lib: lib,
    })
}

/// libmpv を一度だけ読み込む。見つからなければ理由を返す
pub fn api() -> Result<&'static Api, String> {
    static API: OnceLock<Result<Api, String>> = OnceLock::new();
    API.get_or_init(|| {
        let mut errors = Vec::new();
        for path in candidates() {
            // 絶対パスは存在するものだけ試す（エラーメッセージを短くするため）
            if path.is_absolute() && !path.exists() {
                continue;
            }
            match unsafe { Library::new(&path) } {
                Ok(lib) => {
                    let api = unsafe { load_from(lib) }?;
                    // libmpv 2.x（mpv 0.35以降）だけを対象にする
                    let version = unsafe { (api.client_api_version)() } >> 16;
                    if version != 2 {
                        return Err(format!(
                            "unsupported libmpv API version {version} at {}",
                            path.display()
                        ));
                    }
                    return Ok(api);
                }
                Err(e) => errors.push(format!("{}: {e}", path.display())),
            }
        }
        Err(format!("libmpv not found ({})", errors.join("; ")))
    })
    .as_ref()
    .map_err(Clone::clone)
}

/// mpv のエラーコードを文字列にする
pub fn error_string(api: &Api, code: c_int) -> String {
    unsafe {
        let ptr = (api.error_string)(code);
        if ptr.is_null() {
            format!("mpv error {code}")
        } else {
            std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned()
        }
    }
}
