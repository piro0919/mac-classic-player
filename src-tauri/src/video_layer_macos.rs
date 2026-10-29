// macOS: mpv の映像を WebView の「下」に描く
//
// 構成:
//   ウィンドウ
//    └ WKWebView の親ビュー
//       ├ VideoView（CAOpenGLLayer のサブクラス MCPVideoLayer を持つ）← mpv がここに描く
//       └ WKWebView（背景を透明にしてある）← React のUIはこの上
//
// UIの「映像エリア」だけを CSS で透明にしておき、その位置に VideoView を合わせる。
// 描画は Core Animation のスレッドで行う（asynchronous な CAOpenGLLayer）。
// mpv から新しいフレームの通知が来たときだけ実際に描く。
//
// Objective-C は objc2 のマクロを使わず、ランタイム関数を直接呼んでいる
// （メソッドの型を一つずつ明示できるので、ABIの取り違えを避けやすい）。

#![allow(non_upper_case_globals)]

use crate::mpv::render::RenderContext;
use crate::mpv::Player;
use std::ffi::{c_char, c_void, CStr};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

type Id = *mut c_void;
type Sel = *mut c_void;

// Objective-C の BOOL は arm64 では bool、x86_64 では signed char
#[cfg(target_arch = "aarch64")]
type ObjcBool = bool;
#[cfg(not(target_arch = "aarch64"))]
type ObjcBool = i8;

#[cfg(target_arch = "aarch64")]
fn objc_bool(b: bool) -> ObjcBool {
    b
}
#[cfg(not(target_arch = "aarch64"))]
fn objc_bool(b: bool) -> ObjcBool {
    b as i8
}
#[cfg(target_arch = "aarch64")]
fn from_objc_bool(b: ObjcBool) -> bool {
    b
}
#[cfg(not(target_arch = "aarch64"))]
fn from_objc_bool(b: ObjcBool) -> bool {
    b != 0
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct NSRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[cfg_attr(target_os = "macos", link(name = "objc"))]
extern "C" {
    fn objc_getClass(name: *const c_char) -> Id;
    fn sel_registerName(name: *const c_char) -> Sel;
    fn objc_allocateClassPair(superclass: Id, name: *const c_char, extra: usize) -> Id;
    fn objc_registerClassPair(cls: Id);
    fn class_addMethod(cls: Id, sel: Sel, imp: *const c_void, types: *const c_char) -> ObjcBool;
    fn objc_msgSend();
    #[cfg(target_arch = "x86_64")]
    fn objc_msgSend_stret();
}

#[cfg_attr(target_os = "macos", link(name = "OpenGL", kind = "framework"))]
extern "C" {
    fn CGLChoosePixelFormat(attribs: *const i32, pix: *mut *mut c_void, npix: *mut i32) -> i32;
    fn CGLLockContext(ctx: *mut c_void) -> i32;
    fn CGLUnlockContext(ctx: *mut c_void) -> i32;
    fn CGLSetCurrentContext(ctx: *mut c_void) -> i32;
    fn glGetIntegerv(pname: u32, data: *mut i32);
    fn glFlush();
}

// CAOpenGLLayer は QuartzCore にある
#[cfg_attr(target_os = "macos", link(name = "QuartzCore", kind = "framework"))]
extern "C" {}

const GL_DRAW_FRAMEBUFFER_BINDING: u32 = 0x8CA6;
const GL_VIEWPORT: u32 = 0x0BA2;

// CGLPixelFormatAttribute
const kCGLPFADoubleBuffer: i32 = 5;
const kCGLPFAAccelerated: i32 = 73;
const kCGLPFAAllowOfflineRenderers: i32 = 96;
const kCGLPFAOpenGLProfile: i32 = 99;
const kCGLPFASupportsAutomaticGraphicsSwitching: i32 = 101;
const kCGLOGLPVersion_3_2_Core: i32 = 0x3200;

// NSAutoresizingMaskOptions
const NSViewWidthSizable: u64 = 2;
const NSViewHeightSizable: u64 = 16;
// NSWindowOrderingMode
const NSWindowBelow: i64 = -1;

fn sel(name: &CStr) -> Sel {
    unsafe { sel_registerName(name.as_ptr()) }
}

fn class(name: &CStr) -> Id {
    unsafe { objc_getClass(name.as_ptr()) }
}

/// objc_msgSend をメソッドの型に合わせて呼ぶ
macro_rules! send {
    ($obj:expr, $sel:literal $(, $arg:expr => $ty:ty)* ; $ret:ty) => {{
        let f: unsafe extern "C" fn(Id, Sel $(, $ty)*) -> $ret =
            std::mem::transmute(objc_msgSend as *const c_void);
        f($obj, sel($sel) $(, $arg)*)
    }};
}

/// NSRect を返すメソッドを呼ぶ（x86_64 では構造体を返す専用の関数を使う）
unsafe fn send_rect(obj: Id, selector: &CStr) -> NSRect {
    #[cfg(target_arch = "x86_64")]
    {
        let f: unsafe extern "C" fn(*mut NSRect, Id, Sel) =
            std::mem::transmute(objc_msgSend_stret as *const c_void);
        let mut rect = NSRect::default();
        f(&mut rect, obj, sel(selector));
        rect
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        let f: unsafe extern "C" fn(Id, Sel) -> NSRect =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel(selector))
    }
}

// =============================================================================
// 描画の状態（Core Animation のスレッドと共有する）
// =============================================================================

struct LayerState {
    player: Arc<Player>,
    render: Mutex<Option<RenderContext>>,
    /// mpv から「新しいフレームがある」と通知された
    frame_pending: Arc<AtomicBool>,
    /// サイズが変わったなど、フレームが無くても描き直したい
    force_redraw: AtomicBool,
    init_failed: AtomicBool,
}

static STATE: OnceLock<LayerState> = OnceLock::new();

/// メインスレッドでだけ触るビューのポインタ（usize で保持）
struct Views {
    webview: usize,
    video_view: usize,
    layer: usize,
}
static VIEWS: Mutex<Option<Views>> = Mutex::new(None);

/// OpenGL の関数を mpv に渡す
unsafe extern "C" fn get_proc_address(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    static HANDLE: AtomicUsize = AtomicUsize::new(0);
    let mut handle = HANDLE.load(Ordering::Relaxed) as *mut c_void;
    if handle.is_null() {
        handle = libc::dlopen(
            c"/System/Library/Frameworks/OpenGL.framework/OpenGL".as_ptr(),
            libc::RTLD_LAZY | libc::RTLD_GLOBAL,
        );
        HANDLE.store(handle as usize, Ordering::Relaxed);
    }
    if handle.is_null() {
        return std::ptr::null_mut();
    }
    libc::dlsym(handle, name)
}

// =============================================================================
// MCPVideoLayer（CAOpenGLLayer のサブクラス）のメソッド
// =============================================================================

/// OpenGL 3.2 Core のピクセルフォーマットを使う（既定の 2.1 だと mpv の機能が減る）
extern "C" fn copy_pixel_format(_this: Id, _cmd: Sel, _mask: u32) -> *mut c_void {
    let attempts: [&[i32]; 2] = [
        &[
            kCGLPFAOpenGLProfile,
            kCGLOGLPVersion_3_2_Core,
            kCGLPFAAccelerated,
            kCGLPFADoubleBuffer,
            kCGLPFAAllowOfflineRenderers,
            kCGLPFASupportsAutomaticGraphicsSwitching,
            0,
        ],
        &[
            kCGLPFAAccelerated,
            kCGLPFADoubleBuffer,
            kCGLPFAAllowOfflineRenderers,
            0,
        ],
    ];
    for attribs in attempts {
        let mut pix: *mut c_void = std::ptr::null_mut();
        let mut count = 0;
        let err = unsafe { CGLChoosePixelFormat(attribs.as_ptr(), &mut pix, &mut count) };
        if err == 0 && !pix.is_null() {
            return pix;
        }
    }
    std::ptr::null_mut()
}

/// 描く必要があるか（Core Animation が画面のリフレッシュごとに聞いてくる）
extern "C" fn can_draw(
    _this: Id,
    _cmd: Sel,
    _ctx: *mut c_void,
    _pf: *mut c_void,
    _t: f64,
    _ts: *const c_void,
) -> ObjcBool {
    let Some(state) = STATE.get() else {
        return objc_bool(false);
    };
    if state.init_failed.load(Ordering::Relaxed) {
        return objc_bool(false);
    }
    let render = state.render.lock().unwrap_or_else(|p| p.into_inner());
    let Some(render) = render.as_ref() else {
        // まだ render context が無い: 最初の draw で作る
        return objc_bool(true);
    };
    let forced = state.force_redraw.swap(false, Ordering::Relaxed);
    let pending = state.frame_pending.swap(false, Ordering::Relaxed);
    let has_frame = pending && render.needs_frame();
    objc_bool(forced || has_frame)
}

extern "C" fn draw(
    _this: Id,
    _cmd: Sel,
    ctx: *mut c_void,
    _pf: *mut c_void,
    _t: f64,
    _ts: *const c_void,
) {
    let Some(state) = STATE.get() else {
        return;
    };
    unsafe {
        CGLLockContext(ctx);
        CGLSetCurrentContext(ctx);
        let mut render = state.render.lock().unwrap_or_else(|p| p.into_inner());
        if render.is_none() && !state.init_failed.load(Ordering::Relaxed) {
            match RenderContext::new_opengl(
                Arc::clone(&state.player),
                get_proc_address,
                std::ptr::null_mut(),
            ) {
                Ok(mut r) => {
                    let pending = Arc::clone(&state.frame_pending);
                    r.set_update_callback(move || pending.store(true, Ordering::Relaxed));
                    *render = Some(r);
                }
                Err(e) => {
                    eprintln!("[video] mpv render context の作成に失敗: {e}");
                    state.init_failed.store(true, Ordering::Relaxed);
                }
            }
        }
        if let Some(r) = render.as_ref() {
            let mut fbo: i32 = 0;
            glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &mut fbo);
            let mut viewport = [0i32; 4];
            glGetIntegerv(GL_VIEWPORT, viewport.as_mut_ptr());
            if viewport[2] > 0 && viewport[3] > 0 {
                if let Err(e) = r.render_opengl(fbo, viewport[2], viewport[3], true) {
                    eprintln!("[video] 描画エラー: {e}");
                }
            }
            glFlush();
            r.report_swap();
        }
        CGLUnlockContext(ctx);
    }
}

/// MCPVideoLayer クラスを一度だけ登録する
fn layer_class() -> Id {
    static CLASS: OnceLock<usize> = OnceLock::new();
    *CLASS.get_or_init(|| unsafe {
        let cls = objc_allocateClassPair(class(c"CAOpenGLLayer"), c"MCPVideoLayer".as_ptr(), 0);
        #[cfg(target_arch = "aarch64")]
        let bool_types = c"B@:^v^vd^v";
        #[cfg(not(target_arch = "aarch64"))]
        let bool_types = c"c@:^v^vd^v";
        class_addMethod(
            cls,
            sel(c"copyCGLPixelFormatForDisplayMask:"),
            copy_pixel_format as *const c_void,
            c"^v@:I".as_ptr(),
        );
        class_addMethod(
            cls,
            sel(c"canDrawInCGLContext:pixelFormat:forLayerTime:displayTime:"),
            can_draw as *const c_void,
            bool_types.as_ptr(),
        );
        class_addMethod(
            cls,
            sel(c"drawInCGLContext:pixelFormat:forLayerTime:displayTime:"),
            draw as *const c_void,
            c"v@:^v^vd^v".as_ptr(),
        );
        objc_registerClassPair(cls);
        cls as usize
    }) as Id
}

// =============================================================================
// ビューの組み立て（すべてメインスレッドで呼ぶこと）
// =============================================================================

unsafe fn nsstring(s: &CStr) -> Id {
    send!(class(c"NSString"), c"stringWithUTF8String:", s.as_ptr() => *const c_char; Id)
}

unsafe fn window_scale(view: Id) -> f64 {
    let window: Id = send!(view, c"window"; Id);
    if window.is_null() {
        return 2.0;
    }
    send!(window, c"backingScaleFactor"; f64)
}

/// WKWebView の下に映像用のビューを差し込む
///
/// # Safety
/// メインスレッドから呼ぶこと。`webview` は WKWebView のポインタ。
pub unsafe fn attach(webview: *mut c_void, player: Arc<Player>) -> Result<(), String> {
    let mut views = VIEWS.lock().unwrap_or_else(|p| p.into_inner());
    if views.is_some() {
        return Ok(());
    }
    if STATE
        .set(LayerState {
            player,
            render: Mutex::new(None),
            frame_pending: Arc::new(AtomicBool::new(false)),
            force_redraw: AtomicBool::new(true),
            init_failed: AtomicBool::new(false),
        })
        .is_err()
    {
        return Err("video layer already initialized".to_string());
    }

    let webview = webview as Id;
    let superview: Id = send!(webview, c"superview"; Id);
    if superview.is_null() {
        return Err("webview has no superview".to_string());
    }

    // WebView の背景を透明にする（WKWebView の非公開プロパティ。wry も同じ方法を使う）
    let no: Id = send!(class(c"NSNumber"), c"numberWithBool:", objc_bool(false) => ObjcBool; Id);
    let _: () =
        send!(webview, c"setValue:forKey:", no => Id, nsstring(c"drawsBackground") => Id; ());

    // レイヤー
    let layer: Id = send!(layer_class(), c"layer"; Id);
    let _: () = send!(layer, c"setAsynchronous:", objc_bool(true) => ObjcBool; ());
    let _: () = send!(layer, c"setNeedsDisplayOnBoundsChange:", objc_bool(true) => ObjcBool; ());
    let _: () = send!(layer, c"setContentsScale:", window_scale(webview) => f64; ());

    // レイヤーを持つビュー（layer-hosting: setLayer → setWantsLayer の順）
    let view: Id = send!(class(c"NSView"), c"alloc"; Id);
    let view: Id = send!(view, c"initWithFrame:", NSRect::default() => NSRect; Id);
    let _: () = send!(view, c"setLayer:", layer => Id; ());
    let _: () = send!(view, c"setWantsLayer:", objc_bool(true) => ObjcBool; ());
    // 映像エリアはウィンドウの幅・高さに合わせて伸び縮みし、下のコントロールの高さは固定
    let _: () =
        send!(view, c"setAutoresizingMask:", NSViewWidthSizable | NSViewHeightSizable => u64; ());
    let _: () = send!(view, c"setHidden:", objc_bool(true) => ObjcBool; ());
    let _: () = send!(
        superview,
        c"addSubview:positioned:relativeTo:",
        view => Id, NSWindowBelow => i64, webview => Id; ()
    );

    *views = Some(Views {
        webview: webview as usize,
        video_view: view as usize,
        layer: layer as usize,
    });
    Ok(())
}

/// UIの映像エリア（WebView 内の CSS ピクセル座標）に映像ビューを合わせる
///
/// # Safety
/// メインスレッドから呼ぶこと。
pub unsafe fn set_rect(x: f64, y: f64, width: f64, height: f64, visible: bool) {
    let views = VIEWS.lock().unwrap_or_else(|p| p.into_inner());
    let Some(v) = views.as_ref() else {
        return;
    };
    let webview = v.webview as Id;
    let view = v.video_view as Id;
    let layer = v.layer as Id;
    let superview: Id = send!(webview, c"superview"; Id);
    if superview.is_null() {
        return;
    }
    let web_frame = send_rect(webview, c"frame");
    let flipped: ObjcBool = send!(superview, c"isFlipped"; ObjcBool);
    let frame = NSRect {
        x: web_frame.x + x,
        y: if from_objc_bool(flipped) {
            web_frame.y + y
        } else {
            // AppKit は左下が原点
            web_frame.y + web_frame.h - y - height
        },
        w: width.max(0.0),
        h: height.max(0.0),
    };

    // フレームの変更をアニメーションさせない
    let tx = class(c"CATransaction");
    let _: () = send!(tx, c"begin"; ());
    let _: () = send!(tx, c"setDisableActions:", objc_bool(true) => ObjcBool; ());
    let _: () = send!(view, c"setFrame:", frame => NSRect; ());
    let _: () = send!(view, c"setHidden:", objc_bool(!visible) => ObjcBool; ());
    let _: () = send!(layer, c"setContentsScale:", window_scale(webview) => f64; ());
    let _: () = send!(tx, c"commit"; ());

    if let Some(state) = STATE.get() {
        state.force_redraw.store(true, Ordering::Relaxed);
    }
    let _: () = send!(layer, c"setNeedsDisplay"; ());
}
