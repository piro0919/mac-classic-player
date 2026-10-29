// mpv render API: mpv に映像のフレームを描かせる
//
// mpv 自身にウィンドウを作らせず（vo=libmpv）、こちらが用意した描画先
// （macOS では CAOpenGLLayer の OpenGL コンテキスト）に描いてもらう。
// こうすると WebView のUIを映像の上に重ねられる。

use super::ffi::*;
use super::Player;
use std::ffi::{c_int, c_void};
use std::sync::Arc;

/// 新しいフレームが来たときに呼ぶ関数（mpv の内部スレッドから呼ばれる）
type Callback = Box<dyn Fn() + Send + Sync>;

pub struct RenderContext {
    player: Arc<Player>,
    ctx: *mut mpv_render_context,
    // mpv に渡したポインタの持ち主。RenderContext より先に解放してはいけない
    callback: Option<Box<Callback>>,
}

unsafe impl Send for RenderContext {}

unsafe extern "C" fn on_update(data: *mut c_void) {
    // data は Box<Callback> の中身を指している
    let callback = &*(data as *const Callback);
    callback();
}

impl RenderContext {
    unsafe fn create(player: Arc<Player>, params: &mut [mpv_render_param]) -> Result<Self, String> {
        let api = player.api();
        let mut ctx: *mut mpv_render_context = std::ptr::null_mut();
        let code = (api.render_context_create)(&mut ctx, player.raw(), params.as_mut_ptr());
        if code < 0 {
            return Err(format!(
                "mpv_render_context_create: {}",
                error_string(api, code)
            ));
        }
        Ok(RenderContext {
            player,
            ctx,
            callback: None,
        })
    }

    /// OpenGL で描く render context を作る
    ///
    /// # Safety
    /// 呼び出すスレッドで OpenGL コンテキストが current になっていること。
    /// 以後の render / drop も同じコンテキストが current な状態で呼ぶこと。
    pub unsafe fn new_opengl(
        player: Arc<Player>,
        get_proc_address: GetProcAddressFn,
        get_proc_address_ctx: *mut c_void,
    ) -> Result<Self, String> {
        let mut init = mpv_opengl_init_params {
            get_proc_address: Some(get_proc_address),
            get_proc_address_ctx,
        };
        let mut params = [
            mpv_render_param {
                type_: MPV_RENDER_PARAM_API_TYPE,
                data: c"opengl".as_ptr() as *mut c_void,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
                data: &mut init as *mut _ as *mut c_void,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_INVALID,
                data: std::ptr::null_mut(),
            },
        ];
        Self::create(player, &mut params)
    }

    /// メモリに描く（ソフトウェア）render context を作る。テストで使う
    pub fn new_software(player: Arc<Player>) -> Result<Self, String> {
        let mut params = [
            mpv_render_param {
                type_: MPV_RENDER_PARAM_API_TYPE,
                data: c"sw".as_ptr() as *mut c_void,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_INVALID,
                data: std::ptr::null_mut(),
            },
        ];
        unsafe { Self::create(player, &mut params) }
    }

    /// 新しいフレームが用意できたときに呼ばれる関数を設定する
    ///
    /// 関数は mpv の内部スレッドから呼ばれる。中で mpv の関数を呼んではいけない
    /// （描画スレッドに知らせるだけにする）。
    pub fn set_update_callback(&mut self, f: impl Fn() + Send + Sync + 'static) {
        let boxed: Box<Callback> = Box::new(Box::new(f));
        let data = &*boxed as *const Callback as *mut c_void;
        unsafe {
            (self.player.api().render_context_set_update_callback)(self.ctx, Some(on_update), data);
        }
        // 古いコールバックは mpv が新しい方に切り替えた後で解放する
        self.callback = Some(boxed);
    }

    /// 描くべき新しいフレームがあるか
    pub fn needs_frame(&self) -> bool {
        unsafe {
            (self.player.api().render_context_update)(self.ctx) & MPV_RENDER_UPDATE_FRAME != 0
        }
    }

    /// 現在の OpenGL フレームバッファに描く
    ///
    /// # Safety
    /// new_opengl と同じ OpenGL コンテキストが current であること
    pub unsafe fn render_opengl(
        &self,
        fbo: c_int,
        width: c_int,
        height: c_int,
        flip_y: bool,
    ) -> Result<(), String> {
        let mut target = mpv_opengl_fbo {
            fbo,
            w: width,
            h: height,
            internal_format: 0,
        };
        let mut flip: c_int = flip_y as c_int;
        let mut params = [
            mpv_render_param {
                type_: MPV_RENDER_PARAM_OPENGL_FBO,
                data: &mut target as *mut _ as *mut c_void,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_FLIP_Y,
                data: &mut flip as *mut _ as *mut c_void,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_INVALID,
                data: std::ptr::null_mut(),
            },
        ];
        let api = self.player.api();
        let code = (api.render_context_render)(self.ctx, params.as_mut_ptr());
        if code < 0 {
            return Err(error_string(api, code));
        }
        Ok(())
    }

    /// RGB0（1ピクセル4バイト）でメモリに描く
    pub fn render_software(
        &self,
        width: c_int,
        height: c_int,
        buffer: &mut [u8],
    ) -> Result<(), String> {
        let stride: usize = width as usize * 4;
        if buffer.len() < stride * height as usize {
            return Err("buffer too small".to_string());
        }
        let mut size: [c_int; 2] = [width, height];
        let mut stride_param = stride;
        let mut params = [
            mpv_render_param {
                type_: MPV_RENDER_PARAM_SW_SIZE,
                data: size.as_mut_ptr() as *mut c_void,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_SW_FORMAT,
                data: c"rgb0".as_ptr() as *mut c_void,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_SW_STRIDE,
                data: &mut stride_param as *mut usize as *mut c_void,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_SW_POINTER,
                data: buffer.as_mut_ptr() as *mut c_void,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_INVALID,
                data: std::ptr::null_mut(),
            },
        ];
        let api = self.player.api();
        let code = unsafe { (api.render_context_render)(self.ctx, params.as_mut_ptr()) };
        if code < 0 {
            return Err(error_string(api, code));
        }
        Ok(())
    }

    /// 画面に出したことを mpv に知らせる（フレームのタイミング調整に使われる）
    pub fn report_swap(&self) {
        unsafe { (self.player.api().render_context_report_swap)(self.ctx) }
    }
}

impl Drop for RenderContext {
    fn drop(&mut self) {
        // 先にコールバックを外してから解放する
        unsafe {
            let api = self.player.api();
            (api.render_context_set_update_callback)(self.ctx, None, std::ptr::null_mut());
            (api.render_context_free)(self.ctx);
        }
    }
}
