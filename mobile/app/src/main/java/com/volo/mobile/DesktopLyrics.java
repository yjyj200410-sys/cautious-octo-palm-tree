package com.volo.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.hardware.display.DisplayManager;
import android.hardware.input.InputManager;
import android.provider.Settings;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.TextUtils;
import android.text.style.RelativeSizeSpan;
import android.view.Display;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.widget.TextView;

final class DesktopLyrics {
  static final String LOCKED = "desktop-lyrics-locked";
  static final String FONT = "desktop-lyrics-font";
  static final String SIZE = "desktop-lyrics-size";
  static final String WEIGHT = "desktop-lyrics-weight";
  static final String COLOR = "desktop-lyrics-color";
  static final String[] FONT_NAMES = {"系统默认", "潮玩星球", "潮字社霸王破风手迹", "Cubic 11", "斗鱼字体", "Swei Fist Leg CJKjp"};
  private static final String[] FONT_FILES = {
      "", "shanhai-xingqiu.ttf", "chaozishe-bawang.ttf", "cubic-11.ttf", "douyu.otf", "swei-fist-leg.ttf"};
  private static final String ENABLED = "desktop-lyrics";
  private static final String POSITION = "desktop-lyrics-position";
  private final Context context;
  private final WindowManager windows;
  private static final Typeface[] fonts = new Typeface[FONT_FILES.length];
  private TextView caption;
  private int width, height, dragTop;
  private float dragStart;
  private int startY;

  DesktopLyrics(Context context) {
    Display display = context.getSystemService(DisplayManager.class).getDisplay(Display.DEFAULT_DISPLAY);
    this.context = context.createDisplayContext(display)
        .createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, null);
    windows = this.context.getSystemService(WindowManager.class);
  }

  static SharedPreferences preferences(Context context) {
    return context.getSharedPreferences("player-view", 0);
  }

  static boolean enabled(Context context) {
    return preferences(context).getBoolean(ENABLED, false) && Settings.canDrawOverlays(context);
  }

  static void setEnabled(Context context, boolean enabled) {
    preferences(context).edit().putBoolean(ENABLED, enabled).apply();
  }

  void show(String line, String translation) {
    if (line.isEmpty() || !enabled(context)) {
      hide();
      return;
    }
    var metrics = windows.getCurrentWindowMetrics();
    var safe = metrics.getWindowInsets().getInsetsIgnoringVisibility(
        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
    // Symmetric exclusion keeps the caption centered on the physical display in landscape.
    var bounds = metrics.getBounds();
    int safeWidth = bounds.width() - 2 * Math.max(safe.left, safe.right);
    int top = bounds.width() > bounds.height() ? 0 : safe.top;
    int safeHeight = bounds.height() - top - safe.bottom;
    if (width != safeWidth || height != safeHeight || dragTop != top) {
      hide();
      width = safeWidth;
      height = safeHeight;
      dragTop = top;
    }
    CharSequence text = line;
    if (translation != null && !translation.equals(line)) {
      SpannableStringBuilder bilingual = new SpannableStringBuilder(line);
      bilingual.append('\n');
      bilingual.append(translation);
      bilingual.setSpan(new RelativeSizeSpan(.8f), line.length() + 1, bilingual.length(),
          Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
      text = bilingual;
    }
    if (caption != null) {
      if (!TextUtils.equals(caption.getText(), text)) caption.setText(text);
      return;
    }

    SharedPreferences prefs = preferences(context);
    TextView view = new TextView(context);
    view.setText(text);
    applyStyle(view, prefs);
    view.setGravity(Gravity.CENTER);
    view.setMaxLines(4);
    view.setEllipsize(TextUtils.TruncateAt.END);
    int padding = MobileUi.dp(context, 8);
    view.setPadding(padding, padding, padding, padding);
    int captionWidth = Math.max(1, Math.min(MobileUi.dp(context, 480), safeWidth - 2 * padding));

    boolean locked = prefs.getBoolean(LOCKED, false);
    WindowManager.LayoutParams params = new WindowManager.LayoutParams(
        captionWidth, WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
            | (locked ? WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE : 0),
        PixelFormat.TRANSLUCENT);
    params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
    params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
    params.setFitInsetsTypes(0);
    params.windowAnimations = 0;
    view.measure(android.view.View.MeasureSpec.makeMeasureSpec(captionWidth,
        android.view.View.MeasureSpec.EXACTLY), android.view.View.MeasureSpec.UNSPECIFIED);
    params.y = dragTop + Math.round(maxY(view.getMeasuredHeight()) * prefs.getFloat(POSITION, .84f));
    params.alpha = opacity(context, locked);
    if (!locked) {
      view.setOnTouchListener((target, event) -> drag(view, params, prefs, event));
    }
    try {
      windows.addView(view, params);
      caption = view;
    } catch (WindowManager.BadTokenException | SecurityException error) {
      android.util.Log.d("DotoLyrics", "Overlay unavailable", error);
    }
  }

  static float opacity(Context context, boolean locked) {
    return locked ? context.getSystemService(InputManager.class).getMaximumObscuringOpacityForTouch() : 1f;
  }

  static void applyStyle(TextView view, SharedPreferences prefs) {
    view.setTextColor(prefs.getInt(COLOR, Color.WHITE));
    view.setTextSize(prefs.getInt(SIZE, 18));
    int font = prefs.getInt(FONT, 0);
    int weight = prefs.getInt(WEIGHT, 400);
    view.setTypeface(Typeface.create(fontFace(view.getContext(), font), weight, false));
    view.getPaint().setFakeBoldText(font != 0 && weight >= 600);
    view.setShadowLayer(MobileUi.dp(view.getContext(), 4), 0, MobileUi.dp(view.getContext(), 2), Color.BLACK);
  }

  static Typeface fontFace(Context context, int index) {
    if (index == 0) return Typeface.DEFAULT;
    if (fonts[index] == null)
      fonts[index] = Typeface.createFromAsset(context.getAssets(), "lyric-fonts/" + FONT_FILES[index]);
    return fonts[index];
  }

  private int maxY(int captionHeight) {
    return Math.max(0, height - captionHeight);
  }

  private boolean drag(TextView view, WindowManager.LayoutParams params,
      SharedPreferences prefs, MotionEvent event) {
    switch (event.getActionMasked()) {
      case MotionEvent.ACTION_DOWN:
        dragStart = event.getRawY();
        startY = params.y;
        break;
      case MotionEvent.ACTION_MOVE:
        params.y = Math.max(dragTop, Math.min(dragTop + maxY(view.getHeight()),
            startY + Math.round(event.getRawY() - dragStart)));
        windows.updateViewLayout(view, params);
        break;
      case MotionEvent.ACTION_UP:
      case MotionEvent.ACTION_CANCEL:
        prefs.edit().putFloat(POSITION, (params.y - dragTop) / (float) Math.max(1, maxY(view.getHeight()))).apply();
        break;
    }
    return true;
  }

  void hide() {
    if (caption == null) return;
    if (caption.isAttachedToWindow()) windows.removeViewImmediate(caption);
    caption = null;
  }
}
