package com.volo.mobile;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.*;
import android.util.Xml;
import android.view.View;
import android.view.MotionEvent;
import android.widget.FrameLayout;
import java.io.InputStream;
import org.xmlpull.v1.XmlPullParser;

/** Three independent circles, with mode glyphs read from the shipped SVG assets. */
final class StemModeControl extends FrameLayout {
  interface Listener {
    void select(int mode);

    void manage();
  }

  private static final String[] NAMES = {"人声", "原声", "伴奏"};
  private static final String[] FILES = {"vocals", "original", "accompaniment"};

  private record Glyph(Path path, int color, float width, boolean filled) {}

  private final java.util.List<java.util.List<Glyph>> glyphs =
      java.util.List.of(
          new java.util.ArrayList<>(), new java.util.ArrayList<>(), new java.util.ArrayList<>());
  private final ModeButton main, first, second;
  private final ModeButton[] options;
  private final Listener listener;
  private final int[] alternatives = {0, 2};
  private static final float MAIN_X = 140, MAIN_Y = 170, REFERENCE_RADIUS = 150;
  private static final float OPTION_X =
      MAIN_X + REFERENCE_RADIUS * (float) Math.cos(Math.toRadians(25));
  private static final float OPTION_DY = REFERENCE_RADIUS * (float) Math.sin(Math.toRadians(25));
  private int mode = 1;
  private boolean expanded;
  private float expansion;
  private ValueAnimator animator;
  private ValueAnimator swapAnimator;
  private float swapProgress = 1;
  private final float[][] swapFrom = new float[3][4], swapTo = new float[3][4];
  private final float[] swapFrame = new float[4];
  private final Paint swapPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Paint liquidPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Path liquidBridge = new Path();
  private final Paint progressPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private boolean separationReady, separating;
  private float availability, displayedProgress;
  private ValueAnimator availabilityAnimator, progressAnimator;
  private boolean interacting;
  private final Runnable autoCollapse = () -> {
    if (expanded && !interacting) setExpanded(false);
  };

  private void armAutoCollapse() {
    removeCallbacks(autoCollapse);
    if (!expanded || interacting || !isAttachedToWindow()) return;
    postDelayed(autoCollapse, 2000);
  }

  public boolean dispatchTouchEvent(MotionEvent event) {
    int action = event.getActionMasked();
    if (action == MotionEvent.ACTION_DOWN) {
      interacting = true;
      removeCallbacks(autoCollapse);
    }
    boolean handled = super.dispatchTouchEvent(event);
    if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
      interacting = false;
      armAutoCollapse();
    }
    return handled;
  }

  void setSeparation(boolean ready, boolean running, float progress) {
    boolean newTask = running && !separating;
    separating = running;
    if (ready != separationReady) {
      separationReady = ready;
      if (availabilityAnimator != null) availabilityAnimator.cancel();
      availabilityAnimator = ValueAnimator.ofFloat(availability, ready ? 1 : 0);
      availabilityAnimator.setDuration(ValueAnimator.areAnimatorsEnabled() ? 200 : 0);
      availabilityAnimator.addUpdateListener(a -> {
        availability = (float) a.getAnimatedValue();
        redrawButtons();
      });
      availabilityAnimator.start();
    }
    float target = Math.max(0, Math.min(1, progress));
    if (newTask || !running || !ValueAnimator.areAnimatorsEnabled()) {
      if (progressAnimator != null) progressAnimator.cancel();
      displayedProgress = target;
    } else if (Math.abs(target - displayedProgress) > .0001f) {
      if (progressAnimator != null) progressAnimator.cancel();
      progressAnimator = ValueAnimator.ofFloat(displayedProgress, target);
      progressAnimator.setDuration(160);
      progressAnimator.addUpdateListener(a -> {
        displayedProgress = (float) a.getAnimatedValue();
        redrawButtons();
      });
      progressAnimator.start();
    }
    String state = running ? "正在分轨，" + (int) (target * 100) + "%"
        : ready ? "分轨已就绪" : "尚未分轨，点击人声或伴奏开始";
    main.setStateDescription(state);
    first.setStateDescription(state);
    second.setStateDescription(state);
    redrawButtons();
  }

  private void redrawButtons() {
    main.invalidate(); first.invalidate(); second.invalidate(); invalidate();
  }

  private int availableColor(int ready, int idle) {
    return Color.rgb(
        Math.round(Color.red(idle) + (Color.red(ready) - Color.red(idle)) * availability),
        Math.round(Color.green(idle) + (Color.green(ready) - Color.green(idle)) * availability),
        Math.round(Color.blue(idle) + (Color.blue(ready) - Color.blue(idle)) * availability));
  }

  private void drawProgress(Canvas canvas, float x, float y, float radius) {
    if (!separating) return;
    progressPaint.setStyle(Paint.Style.STROKE);
    progressPaint.setStrokeWidth(6);
    progressPaint.setStrokeCap(Paint.Cap.ROUND);
    float r = radius + 3;
    progressPaint.setColor(0x33fafafa);
    canvas.drawCircle(x, y, r, progressPaint);
    progressPaint.setColor(0xfffafafa);
    // The inner edge touches the button; completed work fills clockwise.
    canvas.drawArc(x - r, y - r, x + r, y + r,
        -90, displayedProgress * 360, false, progressPaint);
  }

  StemModeControl(Context context, Listener listener) {
    super(context);
    this.listener = listener;
    setWillNotDraw(false);
    liquidPaint.setColor(0xfffafafa);
    setClipChildren(false);
    setClipToPadding(false);
    for (int i = 0; i < 3; i++) readIcon(context, i);
    main = new ModeButton(context, 75);
    first = new ModeButton(context, 46);
    second = new ModeButton(context, 46);
    options = new ModeButton[] {first, second};
    addView(first);
    addView(second);
    addView(main);
    main.setOnClickListener(v -> setExpanded(!expanded));
    main.setOnLongClickListener(
        v -> {
          listener.manage();
          return true;
        });
    first.setOnClickListener(v -> choose(0));
    second.setOnClickListener(v -> choose(1));
    updateButtons();
    applyExpansion();
  }

  private void readIcon(Context context, int mode) {
    try (InputStream in = context.getAssets().open("stem-" + FILES[mode] + ".svg")) {
      XmlPullParser xml = Xml.newPullParser();
      xml.setInput(in, "UTF-8");
      for (int e = xml.next(); e != XmlPullParser.END_DOCUMENT; e = xml.next()) {
        if (e == XmlPullParser.START_TAG && "path".equals(xml.getName())) {
          boolean filled = !"none".equals(xml.getAttributeValue(null, "fill"));
          String color = xml.getAttributeValue(null, filled ? "fill" : "stroke");
          String width = xml.getAttributeValue(null, "stroke-width");
          glyphs
              .get(mode)
              .add(
                  new Glyph(
                      SketchHeartButton.parsePath(xml.getAttributeValue(null, "d")),
                      Color.parseColor(color),
                      width == null ? 0 : Float.parseFloat(width),
                      filled));
        }
      }
    } catch (Exception error) {
      throw new IllegalStateException("Cannot load stem SVG", error);
    }
  }

  int getMode() {
    return mode;
  }

  boolean isExpanded() {
    return expanded;
  }

  void setMode(int value) {
    if (value < 0 || value > 2 || mode == value) return;
    finishSwap();
    int old = mode;
    for (int i = 0; i < 2; i++) if (alternatives[i] == value) alternatives[i] = old;
    mode = value;
    updateButtons();
  }

  private void choose(int slot) {
    int selected = alternatives[slot];
    // Snapshot each visible icon before retargeting, including interrupted exchanges.
    for (int i = 0; i < 3; i++) {
      if (swapAnimator != null) sampleSwap(i, swapFrom[i]);
      else restingCircle(i, swapFrom[i], expansion);
    }
    setMode(selected);
    if (ValueAnimator.areAnimatorsEnabled() && expansion > .72f) {
      for (int i = 0; i < 3; i++) restingCircle(i, swapTo[i], 1);
      swapProgress = 0;
      swapAnimator = ValueAnimator.ofFloat(0, 1);
      swapAnimator.setDuration(420);
      swapAnimator.setInterpolator(t -> t * t * t * (10 + t * (-15 + 6 * t)));
      swapAnimator.addUpdateListener(a -> {
        swapProgress = (float) a.getAnimatedValue();
        invalidate();
        main.invalidate();
        first.invalidate();
        second.invalidate();
      });
      swapAnimator.addListener(new android.animation.AnimatorListenerAdapter() {
        public void onAnimationEnd(android.animation.Animator animation) {
          if (swapAnimator != animation) return;
          finishSwap();
          main.pulse();
          options[slot].pulse();
        }
      });
      swapAnimator.start();
    } else {
      main.pulse();
      options[slot].pulse();
    }
    listener.select(selected);
    armAutoCollapse();
  }

  private void finishSwap() {
    ValueAnimator previous = swapAnimator;
    swapAnimator = null;
    swapProgress = 1;
    if (previous != null) previous.cancel();
    main.invalidate();
    first.invalidate();
    second.invalidate();
    invalidate();
  }

  private void updateButtons() {
    main.icon = mode;
    first.icon = alternatives[0];
    second.icon = alternatives[1];
    main.setContentDescription(NAMES[mode] + (expanded ? "，收起音轨选择" : "，展开音轨选择"));
    first.setContentDescription(NAMES[alternatives[0]]);
    second.setContentDescription(NAMES[alternatives[1]]);
    main.invalidate();
    first.invalidate();
    second.invalidate();
  }

  private void setExpanded(boolean value) {
    finishSwap();
    removeCallbacks(autoCollapse);
    expanded = value;
    if (animator != null) animator.cancel();
    first.setVisibility(VISIBLE);
    second.setVisibility(VISIBLE);
    animator = ValueAnimator.ofFloat(expansion, value ? 1 : 0);
    animator.setDuration(
        ValueAnimator.areAnimatorsEnabled()
            ? Math.max(100, Math.round((value ? 400 : 340) * Math.abs((value ? 1 : 0) - expansion)))
            : 0);
    animator.setInterpolator(t -> t * t * t * (10 + t * (-15 + 6 * t)));
    animator.addUpdateListener(
        a -> {
          expansion = (float) a.getAnimatedValue();
          applyExpansion();
        });
    animator.start();
    updateButtons();
    armAutoCollapse();
  }

  private void applyExpansion() {
    for (ModeButton button : options) {
      button.setAlpha(1);
      button.setScaleX(1);
      button.setScaleY(1);
      button.setEnabled(expanded && expansion > .72f);
      button.invalidate();
      button.setImportantForAccessibility(
          expanded
              ? IMPORTANT_FOR_ACCESSIBILITY_YES
              : IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
      button.setVisibility(expansion == 0 ? INVISIBLE : VISIBLE);
    }
    first.setTranslationX((MAIN_X - OPTION_X) * (1 - expansion) * getWidth() / 520f);
    first.setTranslationY(OPTION_DY * (1 - expansion) * getHeight() / 290f);
    second.setTranslationX((MAIN_X - OPTION_X) * (1 - expansion) * getWidth() / 520f);
    second.setTranslationY(-OPTION_DY * (1 - expansion) * getHeight() / 290f);
    main.invalidate();
    invalidate();
  }

  private static float mainScale(float progress) {
    return 1.10f * (1 - .12f * progress);
  }

  private static float smooth(float from, float to, float value) {
    float t = Math.max(0, Math.min(1, (value - from) / (to - from)));
    return t * t * (3 - 2 * t);
  }

  protected void onDraw(Canvas canvas) {
    super.onDraw(canvas);
    if (expansion <= 0 || expansion >= 1 || swapAnimator != null) return;
    int save = canvas.save();
    canvas.scale(getWidth() / 520f, getHeight() / 290f);
    liquidPaint.setColor(0xfffafafa);
    drawLiquidBridge(canvas, -OPTION_DY);
    drawLiquidBridge(canvas, OPTION_DY);
    canvas.restoreToCount(save);
  }

  protected void dispatchDraw(Canvas canvas) {
    super.dispatchDraw(canvas);
    if (swapAnimator == null) return;
    int save = canvas.save();
    canvas.scale(getWidth() / 520f, getHeight() / 290f);
    // The selected satellite stays in front throughout the straight exchange.
    for (int i = 0; i < 3; i++) if (i != mode) {
      sampleSwap(i, swapFrame);
      drawSwappingCircle(canvas, i, swapFrame[0], swapFrame[1], swapFrame[2], swapFrame[3]);
    }
    sampleSwap(mode, swapFrame);
    drawSwappingCircle(canvas, mode, swapFrame[0], swapFrame[1], swapFrame[2], swapFrame[3]);
    canvas.restoreToCount(save);
  }

  private void restingCircle(int icon, float[] result, float progress) {
    boolean primary = icon == mode;
    int slot = icon == alternatives[0] ? 0 : 1;
    result[0] = primary ? MAIN_X : MAIN_X + (OPTION_X - MAIN_X) * progress;
    result[1] = primary ? MAIN_Y : MAIN_Y + (slot == 0 ? -OPTION_DY : OPTION_DY) * progress;
    result[2] = primary ? 75 * mainScale(progress) : 46 * (.65f + .35f * progress);
    result[3] = primary ? 96 * mainScale(progress) : 59;
  }

  private void sampleSwap(int icon, float[] result) {
    float[] start = swapFrom[icon], end = swapTo[icon];
    float t = swapProgress;
    float dx = end[0] - start[0], dy = end[1] - start[1];
    // Read the entire start before writing: retargeting may reuse the start array.
    float x = start[0] + dx * t, y = start[1] + dy * t;
    float radius = start[2] + (end[2] - start[2]) * t;
    float size = start[3] + (end[3] - start[3]) * t;
    result[0] = x;
    result[1] = y;
    result[2] = radius;
    result[3] = size;
  }

  private void drawSwappingCircle(Canvas canvas, int icon, float x, float y, float radius, float size) {
    swapPaint.setStyle(Paint.Style.FILL);
    swapPaint.setColor(0xfffafafa);
    canvas.drawCircle(x, y, radius, swapPaint);
    if (icon != 1) drawProgress(canvas, x, y, radius);
    int save = canvas.save();
    canvas.translate(x - size / 2, y - size / 2);
    canvas.scale(size / 64, size / 64);
    swapPaint.setStrokeCap(Paint.Cap.ROUND);
    swapPaint.setStrokeJoin(Paint.Join.ROUND);
    for (Glyph glyph : glyphs.get(icon)) {
      swapPaint.setColor(icon == 1 ? glyph.color() : availableColor(glyph.color(), 0xff9a9a9a));
      swapPaint.setStyle(glyph.filled() ? Paint.Style.FILL : Paint.Style.STROKE);
      swapPaint.setStrokeWidth(glyph.width());
      canvas.drawPath(glyph.path(), swapPaint);
    }
    canvas.restoreToCount(save);
  }

  private void drawLiquidBridge(Canvas canvas, float targetY) {
    float x1 = MAIN_X, y1 = MAIN_Y;
    float x2 = MAIN_X + (OPTION_X - MAIN_X) * expansion;
    float y2 = MAIN_Y + targetY * expansion;
    double distance = Math.hypot(x2 - x1, y2 - y1);
    double r1 = 75 * mainScale(expansion) * main.pressScale, r2 = 46 * (.65 + .35 * expansion);
    if (distance <= Math.abs(r1 - r2) || distance >= 146) return;
    double angle = Math.atan2(y2 - y1, x2 - x1);
    double overlap1 = 0, overlap2 = 0;
    if (distance < r1 + r2) {
      overlap1 =
          Math.acos(
              Math.max(
                  -1,
                  Math.min(1, (r1 * r1 + distance * distance - r2 * r2) / (2 * r1 * distance))));
      overlap2 =
          Math.acos(
              Math.max(
                  -1,
                  Math.min(1, (r2 * r2 + distance * distance - r1 * r1) / (2 * r2 * distance))));
    }
    double spread = Math.acos((r1 - r2) / distance);
    double tension = .5 * (1 - smooth(121, 146, (float) distance));
    double a = angle + overlap1 + (spread - overlap1) * tension;
    double b = angle - overlap1 - (spread - overlap1) * tension;
    double c = angle + Math.PI - overlap2 - (Math.PI - overlap2 - spread) * tension;
    double d = angle - Math.PI + overlap2 + (Math.PI - overlap2 - spread) * tension;
    float ax = (float) (x1 + r1 * Math.cos(a)), ay = (float) (y1 + r1 * Math.sin(a));
    float bx = (float) (x1 + r1 * Math.cos(b)), by = (float) (y1 + r1 * Math.sin(b));
    float cx = (float) (x2 + r2 * Math.cos(c)), cy = (float) (y2 + r2 * Math.sin(c));
    float dx = (float) (x2 + r2 * Math.cos(d)), dy = (float) (y2 + r2 * Math.sin(d));
    double handle = Math.min(tension * 2.4, Math.hypot(cx - ax, cy - ay) / (r1 + r2));
    handle *= Math.min(1, distance * 2 / (r1 + r2));
    double h1 = r1 * handle, h2 = r2 * handle;
    liquidBridge.reset();
    liquidBridge.moveTo(ax, ay);
    liquidBridge.cubicTo(
        (float) (ax + h1 * Math.cos(a - Math.PI / 2)),
        (float) (ay + h1 * Math.sin(a - Math.PI / 2)),
        (float) (cx + h2 * Math.cos(c + Math.PI / 2)),
        (float) (cy + h2 * Math.sin(c + Math.PI / 2)),
        cx,
        cy);
    liquidBridge.lineTo(dx, dy);
    liquidBridge.cubicTo(
        (float) (dx + h2 * Math.cos(d - Math.PI / 2)),
        (float) (dy + h2 * Math.sin(d - Math.PI / 2)),
        (float) (bx + h1 * Math.cos(b + Math.PI / 2)),
        (float) (by + h1 * Math.sin(b + Math.PI / 2)),
        bx,
        by);
    liquidBridge.close();
    canvas.drawPath(liquidBridge, liquidPaint);
  }

  protected void onMeasure(int widthSpec, int heightSpec) {
    int w = MeasureSpec.getSize(widthSpec), h = MeasureSpec.getSize(heightSpec);
    setMeasuredDimension(w, h);
    main.measure(
        MeasureSpec.makeMeasureSpec(Math.round(180 * w / 520f), MeasureSpec.EXACTLY),
        MeasureSpec.makeMeasureSpec(Math.round(180 * h / 290f), MeasureSpec.EXACTLY));
    for (ModeButton b : options)
      b.measure(
          MeasureSpec.makeMeasureSpec(Math.round(114 * w / 520f), MeasureSpec.EXACTLY),
          MeasureSpec.makeMeasureSpec(Math.round(114 * h / 290f), MeasureSpec.EXACTLY));
  }

  private void place(ModeButton button, float x, float y) {
    int left = Math.round(x * getWidth() / 520f - button.getMeasuredWidth() / 2f);
    int top = Math.round(y * getHeight() / 290f - button.getMeasuredHeight() / 2f);
    button.layout(left, top, left + button.getMeasuredWidth(), top + button.getMeasuredHeight());
  }

  protected void onLayout(boolean changed, int l, int t, int r, int b) {
    place(main, MAIN_X, MAIN_Y);
    place(first, OPTION_X, MAIN_Y - OPTION_DY);
    place(second, OPTION_X, MAIN_Y + OPTION_DY);
    applyExpansion();
  }

  protected void onDetachedFromWindow() {
    finishSwap();
    removeCallbacks(autoCollapse);
    interacting = false;
    if (animator != null) animator.cancel();
    if (availabilityAnimator != null) availabilityAnimator.cancel();
    if (progressAnimator != null) progressAnimator.cancel();
    availability = separationReady ? 1 : 0;
    removeCallbacks(autoCollapse);
    super.onDetachedFromWindow();
  }

  private final class ModeButton extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final float radius;
    private float pulse;
    private ValueAnimator pulseAnimator;
    private ValueAnimator pressAnimator;
    private float pressScale = 1;
    int icon;

    void pulse() {
      if (pulseAnimator != null) pulseAnimator.cancel();
      if (!ValueAnimator.areAnimatorsEnabled()) {
        pulse = 0;
        return;
      }
      pulseAnimator = ValueAnimator.ofFloat(0, 1);
      pulseAnimator.setDuration(280);
      pulseAnimator.addUpdateListener(
          a -> {
            pulse = (float) Math.sin(Math.PI * (float) a.getAnimatedValue());
            invalidate();
          });
      pulseAnimator.start();
    }

    protected void onDetachedFromWindow() {
      if (pulseAnimator != null) pulseAnimator.cancel();
      if (pressAnimator != null) pressAnimator.cancel();
      pressScale = 1;
      super.onDetachedFromWindow();
    }

    ModeButton(Context context, float radius) {
      super(context);
      this.radius = radius;
      setFocusable(true);
      setClickable(true);
    }

    public void onInitializeAccessibilityNodeInfo(
        android.view.accessibility.AccessibilityNodeInfo info) {
      super.onInitializeAccessibilityNodeInfo(info);
      info.setClassName("android.widget.Button");
    }

    protected void onDraw(Canvas canvas) {
      if (swapAnimator != null) return;
      float diameter = radius == 75 ? 180 : 114;
      canvas.save();
      canvas.scale(getWidth() / diameter, getHeight() / diameter);
      float center = diameter / 2;
      canvas.scale(pressScale, pressScale, center, center);
      paint.setStyle(Paint.Style.FILL);
      paint.setColor(isPressed() ? 0xffdddddd : 0xfffafafa);
      float growth = radius == 75 ? mainScale(expansion) : .65f + .35f * expansion;
      int shape = canvas.save();
      canvas.translate(center, center);
      if (radius != 75) canvas.rotate(this == first ? -25 : 25);
      // Match the bridge's circular tangent surfaces throughout merging/separation.
      // Selection pulses happen after separation and leave the glyph undeformed.
      canvas.scale(1 + .04f * pulse, 1 - .025f * pulse);
      canvas.drawCircle(0, 0, radius * growth, paint);
      canvas.restoreToCount(shape);
      if (icon != 1) drawProgress(canvas, center, center, radius * growth);
      float size = radius == 75 ? 96 * mainScale(expansion) : 59;
      canvas.translate(center - size / 2, center - size / 2);
      canvas.scale(size / 64, size / 64);
      paint.setStrokeCap(Paint.Cap.ROUND);
      paint.setStrokeJoin(Paint.Join.ROUND);
      for (Glyph glyph : glyphs.get(icon)) {
        paint.setColor(icon == 1 ? glyph.color() : availableColor(glyph.color(), 0xff9a9a9a));
        paint.setAlpha(
            Math.round(
                Color.alpha(glyph.color()) * (radius == 75 ? 1 : smooth(.25f, .85f, expansion))));
        paint.setStyle(glyph.filled() ? Paint.Style.FILL : Paint.Style.STROKE);
        paint.setStrokeWidth(glyph.width());
        canvas.drawPath(glyph.path(), paint);
      }
      canvas.restore();
    }

    public void setPressed(boolean pressed) {
      boolean changed = pressed != isPressed();
      super.setPressed(pressed);
      if (changed && radius == 75) {
        if (pressAnimator != null) pressAnimator.cancel();
        if (!ValueAnimator.areAnimatorsEnabled()) {
          pressScale = 1;
        } else {
          float start = pressScale;
          pressAnimator = ValueAnimator.ofFloat(0, 1);
          pressAnimator.setDuration(pressed ? 90 : 480);
          pressAnimator.setInterpolator(t -> t);
          pressAnimator.addUpdateListener(a -> {
            float t = (float) a.getAnimatedValue();
            if (pressed) {
              pressScale = start + (.90f - start) * t * t * (3 - 2 * t);
            } else {
              // Damped spring: a quick tap also carries a small inward velocity.
              float seconds = t * .48f;
              float offset = start - 1;
              float velocity = start > .995f ? -.7f : 0;
              pressScale = t == 1 ? 1 : 1 + (float) (Math.exp(-12 * seconds)
                  * (offset * Math.cos(24 * seconds)
                      + (velocity + 12 * offset) / 24 * Math.sin(24 * seconds)));
            }
            invalidate();
            StemModeControl.this.invalidate();
          });
          pressAnimator.start();
        }
      }
      invalidate();
    }
  }
}
