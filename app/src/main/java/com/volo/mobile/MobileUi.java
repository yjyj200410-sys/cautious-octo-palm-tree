package com.volo.mobile;

import android.app.Activity;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.*;
import android.graphics.drawable.*;
import android.view.*;
import android.widget.*;

final class MobileUi {
  static int BG=DotoDesign.BG,SURFACE=DotoDesign.SURFACE,INK=DotoDesign.INK,
      MUTED=DotoDesign.MUTED,GREEN=DotoDesign.SUCCESS,LINE=DotoDesign.LINE,ACCENT=DotoDesign.PAPER;

  static int dp(Context c, float n) {
    return Math.round(n * c.getResources().getDisplayMetrics().density);
  }

  static GradientDrawable shape(int color, int radius, Context c) {
    GradientDrawable d = new GradientDrawable();
    d.setColor(color);
    d.setCornerRadius(dp(c, radius));
    return d;
  }

  static GradientDrawable panel(Context c) {
    GradientDrawable d =
        new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[] {DotoDesign.CARD_RAISED, DotoDesign.CARD_SURFACE});
    d.setCornerRadius(dp(c, 20));
    d.setStroke(dp(c, 1), LINE);
    return d;
  }

  static TextView text(Context c, String value, int size) {
    TextView v = new TextView(c);
    v.setText(value);
    v.setTextColor(INK);
    v.setTextSize(size);
    v.setPadding(0, dp(c, 6), 0, dp(c, 6));
    v.setLineSpacing(dp(c, 3), 1);
    return v;
  }

  static Button button(LinearLayout parent, String label, Runnable action) {
    Context c = parent.getContext();
    Button b = new Button(c);
    DotoDesign.button(b,label,false);
    b.setOnClickListener(v -> action.run());
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, dp(c, 48));
    p.setMargins(0, dp(c, 5), dp(c, 8), dp(c, 5));
    parent.addView(b, p);
    return b;
  }

  static LinearLayout column(Context c) {
    LinearLayout l = new LinearLayout(c);
    l.setOrientation(LinearLayout.VERTICAL);
    return l;
  }

  static LinearLayout card(Context c) {
    LinearLayout l = column(c);
    l.setPadding(dp(c, 18), dp(c, 14), dp(c, 18), dp(c, 14));
    l.setBackground(panel(c));
    DotoDesign.cardTone(l);
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.setMargins(0, dp(c, 6), 0, dp(c, 10));
    l.setLayoutParams(p);
    return l;
  }

  static void insets(Activity a, LinearLayout root) {
    root.setBackground(DotoAppearance.background());
    root.setOnApplyWindowInsetsListener(
        (v, i) -> {
          Insets bars = i.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
          v.setPadding(dp(a, 20), bars.top, dp(a, 20), bars.bottom);
          WindowInsetsController control = a.getWindow().getInsetsController();
          if (control != null)
            control.setSystemBarsAppearance(
                DotoAppearance.light ? WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS : 0,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
          return i;
        });
  }

  static TextView heading(Context c, String value, int size) {
    TextView t = text(c, value, size);
    t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
    t.setLetterSpacing(-.025f);
    return t;
  }

  /** Abstract studio mark; deliberately not presented as measured audio data. */
  static final class Signal extends View {
    private final Paint p = new Paint(3);
    private final String title;

    Signal(Context c, String title) {
      super(c);
      this.title = title;
      setContentDescription(title);
    }

    protected void onDraw(Canvas canvas) {
      float w = getWidth(), h = getHeight(), d = getResources().getDisplayMetrics().density;
      canvas.drawColor(BG);
      p.setStyle(Paint.Style.FILL);
      p.setColor(MUTED);
      p.setTypeface(Typeface.create("monospace", Typeface.NORMAL));
      p.setTextSize(10 * d);
      canvas.drawText("D O T O   /   A U D I O", 0, 24 * d, p);
      p.setColor(INK);
      p.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
      p.setTextSize(25 * d);
      canvas.drawText(title, 0, 65 * d, p);
      p.setColor(MUTED);
      p.setTextSize(12 * d);
      canvas.drawText("听见细节，留下喜欢。", 0, 92 * d, p);
      float cy = h - 25 * d;
      p.setStrokeWidth(d);
      for (int i = 0; i < 64; i++) {
        float x = i * w / 64f;
        float height = (float) (4 + 14 * Math.pow(Math.sin(i * .18), 2)) * d;
        p.setColor(i < 24 ? ACCENT : 0xff303030);
        canvas.drawLine(x, cy - height, x, cy + height, p);
      }
      p.setStyle(Paint.Style.STROKE);
      p.setStrokeWidth(d);
      p.setColor(ACCENT);
      canvas.drawCircle(w - 30 * d, 40 * d, 23 * d, p);
      canvas.drawOval(w - 42 * d, 17 * d, w - 18 * d, 63 * d, p);
      canvas.drawOval(w - 53 * d, 32 * d, w - 7 * d, 48 * d, p);
      p.setStyle(Paint.Style.FILL);
    }
  }

  static final class Meter extends ProgressBar {
    private final Paint p = new Paint(3);

    Meter(Context c) {
      super(c, null, android.R.attr.progressBarStyleHorizontal);
      setProgressDrawable(new ColorDrawable(Color.TRANSPARENT));
      setIndeterminateDrawable(new ColorDrawable(Color.TRANSPARENT));
      setContentDescription("分轨进度");
    }

    protected synchronized void onDraw(Canvas canvas) {
      int count = 64;
      float phase = (android.os.SystemClock.uptimeMillis() % 1400) / 1400f;
      for (int i = 0; i < count; i++) {
        boolean lit =
            isIndeterminate()
                ? Math.abs(i / (float) count - phase) < .1f
                : i / (float) count < getProgress() / 100f;
        p.setColor(lit ? ACCENT : LINE);
        float x = i * getWidth() / (float) count;
        canvas.drawRoundRect(
            x,
            2,
            x + Math.max(1, getWidth() / (float) count - dp(getContext(), 2)),
            getHeight() - 2,
            1,
            1,
            p);
      }
      if (isIndeterminate() && isShown() && android.animation.ValueAnimator.areAnimatorsEnabled())
        postInvalidateOnAnimation();
    }
  }

  static final class TickSeek extends SeekBar {
    private final Paint p = new Paint(3);

    TickSeek(Context c) {
      super(c);
      setProgressDrawable(new ColorDrawable(Color.TRANSPARENT));
      GradientDrawable thumb = shape(INK, 8, c);
      thumb.setSize(dp(c, 10), dp(c, 18));
      setThumb(thumb);
      setPadding(dp(c, 5), 0, dp(c, 5), 0);
      setSplitTrack(false);
    }

    protected synchronized void onDraw(Canvas canvas) {
      float width = getWidth() - getPaddingLeft() - getPaddingRight();
      for (int i = 0; i < 64; i++) {
        p.setColor(i * getMax() / 64f <= getProgress() ? ACCENT : LINE);
        float x = getPaddingLeft() + i * width / 63;
        p.setStrokeWidth(dp(getContext(), 1));
        float half = dp(getContext(), i % 8 == 0 ? 9 : 6);
        canvas.drawLine(x, getHeight() / 2f - half, x, getHeight() / 2f + half, p);
      }
      super.onDraw(canvas);
    }
  }
}
