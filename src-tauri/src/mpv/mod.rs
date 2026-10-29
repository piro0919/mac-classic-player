#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

// mpv（libmpv）を再生エンジンとして使う
//
// - Player: mpv のインスタンス。コマンド・プロパティ・イベント
// - RenderContext: 映像をOpenGL（またはテスト用にメモリ）へ描くための mpv render API
//
// 映像を画面に出す部分（macOS の CAOpenGLLayer）は video_layer_macos.rs にある。

pub mod ffi;
pub mod render;

use ffi::*;
use serde_json::{Map, Value};
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::sync::Arc;

/// mpv から受け取ったイベント（所有権のある形に変換したもの）
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Shutdown,
    StartFile,
    FileLoaded,
    EndFile {
        reason: EndReason,
        error: Option<String>,
    },
    PropertyChange {
        name: String,
        value: Value,
    },
    Log {
        level: String,
        prefix: String,
        text: String,
    },
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EndReason {
    Eof,
    Stop,
    Quit,
    Error,
    Other,
}

pub struct Player {
    api: &'static Api,
    handle: *mut mpv_handle,
}

// mpv のクライアントAPIはスレッドセーフ
unsafe impl Send for Player {}
unsafe impl Sync for Player {}

fn cstring(s: &str) -> Result<CString, String> {
    CString::new(s).map_err(|_| format!("invalid string: {s:?}"))
}

impl Player {
    /// mpv を作って初期化する。`options` は mpv_initialize 前に設定するオプション
    pub fn new(options: &[(&str, &str)]) -> Result<Arc<Player>, String> {
        let api = ffi::api()?;

        // libmpv は数値の書式に LC_NUMERIC="C" を要求する
        unsafe {
            libc::setlocale(libc::LC_NUMERIC, c"C".as_ptr());
        }

        let handle = unsafe { (api.create)() };
        if handle.is_null() {
            return Err("mpv_create failed".to_string());
        }
        let player = Player { api, handle };
        for (name, value) in options {
            let (n, v) = (cstring(name)?, cstring(value)?);
            let code = unsafe { (api.set_option_string)(handle, n.as_ptr(), v.as_ptr()) };
            if code < 0 {
                return Err(format!(
                    "option {name}={value}: {}",
                    error_string(api, code)
                ));
            }
        }
        let code = unsafe { (api.initialize)(handle) };
        if code < 0 {
            return Err(format!("mpv_initialize: {}", error_string(api, code)));
        }
        Ok(Arc::new(player))
    }

    pub(crate) fn api(&self) -> &'static Api {
        self.api
    }

    pub(crate) fn raw(&self) -> *mut mpv_handle {
        self.handle
    }

    fn check(&self, code: c_int, what: &str) -> Result<(), String> {
        if code < 0 {
            Err(format!("{what}: {}", error_string(self.api, code)))
        } else {
            Ok(())
        }
    }

    /// mpv のコマンドを実行する（例: ["loadfile", "/path/to/file.mkv"]）
    pub fn command(&self, args: &[&str]) -> Result<(), String> {
        let owned = args
            .iter()
            .map(|a| cstring(a))
            .collect::<Result<Vec<_>, _>>()?;
        let mut ptrs: Vec<*const c_char> = owned.iter().map(|s| s.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        let code = unsafe { (self.api.command)(self.handle, ptrs.as_mut_ptr()) };
        self.check(code, args.first().copied().unwrap_or("command"))
    }

    pub fn set_property(&self, name: &str, value: &str) -> Result<(), String> {
        let (n, v) = (cstring(name)?, cstring(value)?);
        let code = unsafe { (self.api.set_property_string)(self.handle, n.as_ptr(), v.as_ptr()) };
        self.check(code, name)
    }

    /// プロパティを JSON で読む
    pub fn get_property(&self, name: &str) -> Result<Value, String> {
        let n = cstring(name)?;
        let mut node = mpv_node {
            u: mpv_node_u { int64: 0 },
            format: MPV_FORMAT_NONE,
        };
        let code = unsafe {
            (self.api.get_property)(
                self.handle,
                n.as_ptr(),
                MPV_FORMAT_NODE,
                &mut node as *mut mpv_node as *mut c_void,
            )
        };
        self.check(code, name)?;
        let value = unsafe { node_to_json(&node) };
        unsafe { (self.api.free_node_contents)(&mut node) };
        Ok(value)
    }

    /// プロパティの変化を PropertyChange イベントで受け取れるようにする
    pub fn observe(&self, name: &str) -> Result<(), String> {
        let n = cstring(name)?;
        let code =
            unsafe { (self.api.observe_property)(self.handle, 0, n.as_ptr(), MPV_FORMAT_NODE) };
        self.check(code, name)
    }

    pub fn request_log_messages(&self, level: &str) -> Result<(), String> {
        let l = cstring(level)?;
        let code = unsafe { (self.api.request_log_messages)(self.handle, l.as_ptr()) };
        self.check(code, "request_log_messages")
    }

    /// 次のイベントを待つ（timeout 秒。負なら無期限）。タイムアウトなら None
    ///
    /// mpv_wait_event は同時に1つのスレッドからしか呼べない。
    pub fn wait_event(&self, timeout: f64) -> Option<Event> {
        let ev = unsafe { &*(self.api.wait_event)(self.handle, timeout) };
        unsafe { convert_event(self.api, ev) }
    }

    /// wait_event で待っているスレッドを起こす
    pub fn wakeup(&self) {
        unsafe { (self.api.wakeup)(self.handle) }
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        unsafe { (self.api.terminate_destroy)(self.handle) }
    }
}

unsafe fn cstr(ptr: *const c_char) -> String {
    if ptr.is_null() {
        String::new()
    } else {
        CStr::from_ptr(ptr).to_string_lossy().into_owned()
    }
}

unsafe fn convert_event(api: &Api, ev: &mpv_event) -> Option<Event> {
    Some(match ev.event_id {
        MPV_EVENT_NONE => return None,
        MPV_EVENT_SHUTDOWN => Event::Shutdown,
        MPV_EVENT_START_FILE => Event::StartFile,
        MPV_EVENT_FILE_LOADED => Event::FileLoaded,
        MPV_EVENT_END_FILE => {
            let data = &*(ev.data as *const mpv_event_end_file);
            let reason = match data.reason {
                MPV_END_FILE_REASON_EOF => EndReason::Eof,
                MPV_END_FILE_REASON_STOP => EndReason::Stop,
                MPV_END_FILE_REASON_QUIT => EndReason::Quit,
                MPV_END_FILE_REASON_ERROR => EndReason::Error,
                _ => EndReason::Other,
            };
            let error =
                (data.reason == MPV_END_FILE_REASON_ERROR).then(|| error_string(api, data.error));
            Event::EndFile { reason, error }
        }
        MPV_EVENT_PROPERTY_CHANGE => {
            let data = &*(ev.data as *const mpv_event_property);
            let value = if data.format == MPV_FORMAT_NODE && !data.data.is_null() {
                node_to_json(&*(data.data as *const mpv_node))
            } else {
                // 値が取れない（ファイル未読み込みの duration など）
                Value::Null
            };
            Event::PropertyChange {
                name: cstr(data.name),
                value,
            }
        }
        MPV_EVENT_LOG_MESSAGE => {
            let data = &*(ev.data as *const mpv_event_log_message);
            Event::Log {
                level: cstr(data.level),
                prefix: cstr(data.prefix),
                text: cstr(data.text).trim_end().to_string(),
            }
        }
        _ => Event::Other,
    })
}

/// mpv_node を serde_json::Value に変換する
pub(crate) unsafe fn node_to_json(node: &mpv_node) -> Value {
    match node.format {
        MPV_FORMAT_STRING | MPV_FORMAT_OSD_STRING => Value::String(cstr(node.u.string)),
        MPV_FORMAT_FLAG => Value::Bool(node.u.flag != 0),
        MPV_FORMAT_INT64 => Value::from(node.u.int64),
        MPV_FORMAT_DOUBLE => serde_json::Number::from_f64(node.u.double_)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        MPV_FORMAT_NODE_ARRAY | MPV_FORMAT_NODE_MAP => {
            let list = node.u.list;
            if list.is_null() {
                return Value::Null;
            }
            let list = &*list;
            let count = list.num.max(0) as usize;
            // 空のリストでは values / keys が NULL のことがある
            if count == 0 || list.values.is_null() {
                return if node.format == MPV_FORMAT_NODE_ARRAY {
                    Value::Array(Vec::new())
                } else {
                    Value::Object(Map::new())
                };
            }
            let values = std::slice::from_raw_parts(list.values, count);
            if node.format == MPV_FORMAT_NODE_ARRAY {
                Value::Array(values.iter().map(|v| node_to_json(v)).collect())
            } else {
                let keys = std::slice::from_raw_parts(list.keys, count);
                let mut map = Map::new();
                for (k, v) in keys.iter().zip(values) {
                    map.insert(cstr(*k), node_to_json(v));
                }
                Value::Object(map)
            }
        }
        _ => Value::Null,
    }
}

/// JSONの値を mpv のプロパティ文字列にする（true → "yes" など）
pub fn json_to_property_string(value: &Value) -> Option<String> {
    match value {
        Value::Bool(b) => Some(if *b { "yes" } else { "no" }.to_string()),
        Value::Number(n) => Some(n.to_string()),
        Value::String(s) => Some(s.clone()),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
