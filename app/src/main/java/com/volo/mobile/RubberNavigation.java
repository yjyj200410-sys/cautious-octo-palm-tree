package com.volo.mobile;

import android.animation.*;
import android.content.Context;
import android.graphics.*;
import android.view.*;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.animation.PathInterpolator;
import android.widget.FrameLayout;

/** Native adaptation of the user-supplied React Bits RubberSegment motion reference. */
final class RubberNavigation extends FrameLayout {
  interface Listener { void select(int index); }

  private final Listener listener;
  private final View[] tabs = new View[2];
  private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Path sparkle = new Path(), shoulders = new Path();
  private final float density, inset;
  private final float[] historyX = new float[8];
  private final long[] historyTime = new long[8];
  private float edgeL, edgeR, innerWidth, leftVelocity, rightVelocity;
  private float downX, downY, dragOffset, dragWidth;
  private int selected, pointer = -1, downSlot, historyCount, generation;
  private boolean onThumb, dragging, abandoned;
  private ValueAnimator leftAnimator, rightAnimator;
  private Runnable handoff;

  RubberNavigation(Context context, Listener listener) {
    super(context);
    this.listener = listener;
    density = getResources().getDisplayMetrics().density;
    inset = 5 * density;
    setWillNotDraw(false);
    setClipChildren(false);
    setContentDescription("主页导航");
    setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    // Variant 2: four-point sparkle and a rounded profile badge, on a 24-unit grid.
    sparkle.moveTo(-2, -9);
    sparkle.quadTo(-.8f, .8f, 7, 2);
    sparkle.quadTo(-.8f, 3.2f, -2, 11);
    sparkle.quadTo(-3.2f, 3.2f, -11, 2);
    sparkle.quadTo(-3.2f, .8f, -2, -9);
    sparkle.close();
    sparkle.moveTo(7.5f, -11.5f);
    sparkle.quadTo(8, -8.5f, 11, -8);
    sparkle.quadTo(8, -7.5f, 7.5f, -4.5f);
    sparkle.quadTo(7, -7.5f, 4, -8);
    sparkle.quadTo(7, -8.5f, 7.5f, -11.5f);
    sparkle.close();
    shoulders.moveTo(-6, 7);
    shoulders.cubicTo(-6, .5f, 6, .5f, 6, 7);
    for (int i = 0; i < 2; i++) {
      final int index = i;
      View tab = new View(context);
      tabs[i] = tab;
      tab.setFocusable(true);
      tab.setClickable(true);
      tab.setContentDescription(i == 0 ? "发现" : "个人");
      tab.setOnClickListener(v -> tap(index));
      tab.setOnKeyListener((v, key, event) -> {
        if (event.getAction() != KeyEvent.ACTION_DOWN || !isEnabled()) return false;
        int next;
        if (key == KeyEvent.KEYCODE_DPAD_RIGHT || key == KeyEvent.KEYCODE_DPAD_DOWN || key == KeyEvent.KEYCODE_MOVE_END) next = 1;
        else if (key == KeyEvent.KEYCODE_DPAD_LEFT || key == KeyEvent.KEYCODE_DPAD_UP || key == KeyEvent.KEYCODE_MOVE_HOME) next = 0;
        else return false;
        stopMotion();
        commit(next);
        jump();
        tabs[next].requestFocus();
        return true;
      });
      tab.setAccessibilityDelegate(new View.AccessibilityDelegate() {
        public void onInitializeAccessibilityNodeInfo(View host, AccessibilityNodeInfo info) {
          super.onInitializeAccessibilityNodeInfo(host, info);
          info.setClassName("android.widget.RadioButton");
          info.setCheckable(true);
          info.setChecked(selected == index);
        }
      });
      addView(tab);
    }
    updateSelection();
  }

  int selectedIndex() { return selected; }

  void setSelectedIndex(int value) {
    if (value < 0 || value > 1 || selected == value) return;
    selected = value;
    pointer = -1;
    stopMotion();
    updateSelection();
    jump();
  }

  private void updateSelection() {
    for (int i = 0; i < 2; i++) tabs[i].setSelected(i == selected);
    invalidate();
  }

  private void commit(int index) {
    if (selected == index) return;
    selected = index;
    updateSelection();
    listener.select(index);
  }

  private float slotL(int index) { return innerWidth * index / 2; }
  private float slotR(int index) { return innerWidth * (index + 1) / 2; }
  private float clamp(float x, float min, float max) { return Math.max(min, Math.min(max, x)); }

  private void jump() {
    edgeL = slotL(selected);
    edgeR = slotR(selected);
    leftVelocity = rightVelocity = 0;
    invalidate();
  }

  private void stopMotion() {
    generation++;
    if (handoff != null) removeCallbacks(handoff);
    if (leftAnimator != null) leftAnimator.cancel();
    if (rightAnimator != null) rightAnimator.cancel();
  }

  private void tap(int index) {
    if (!isEnabled() || index == selected) return;
    stopMotion();
    commit(index);
    if (!ValueAnimator.areAnimatorsEnabled()) { jump(); return; }
    // Dilation precedes handoff: the leading edge reaches toward the new slot,
    // then the trailing edge catches up, rather than translating a rigid pill.
    int token = generation;
    float fromL = edgeL, fromR = edgeR;
    float toL = Math.min(fromL, slotL(index)), toR = Math.max(fromR, slotR(index));
    ValueAnimator dilate = ValueAnimator.ofFloat(0, 1);
    leftAnimator = rightAnimator = dilate;
    dilate.setDuration(190);
    dilate.setInterpolator(new PathInterpolator(.23f, 1, .32f, 1));
    final long[] previousTime = {0};
    dilate.addUpdateListener(a -> {
      if (token != generation) return;
      float t = (float) a.getAnimatedValue();
      long now = android.os.SystemClock.uptimeMillis();
      float l = fromL + (toL - fromL) * t, r = fromR + (toR - fromR) * t;
      if (previousTime[0] != 0 && now > previousTime[0]) {
        leftVelocity = (l - edgeL) * 1000 / (now - previousTime[0]);
        rightVelocity = (r - edgeR) * 1000 / (now - previousTime[0]);
      }
      previousTime[0] = now;
      edgeL = l; edgeR = r;
      invalidate();
    });
    dilate.start();
    handoff = () -> { if (token == generation) land(index, null, false, true); };
    postDelayed(handoff, 150);
  }

  private void land(int index, Float releaseVelocity, boolean flick, boolean squash) {
    float lv = releaseVelocity == null ? leftVelocity : releaseVelocity;
    float rv = releaseVelocity == null ? rightVelocity : releaseVelocity;
    stopMotion();
    if (!ValueAnimator.areAnimatorsEnabled()) { jump(); return; }
    int token = generation;
    float dir = Math.signum((slotL(index) + slotR(index) - edgeL - edgeR) / 2);
    if (dir == 0) dir = 1;
    boolean leftTrails = dir > 0;
    float overshoot = squash ? dir * 3 * density : 0;
    spring(true, slotL(index) + (leftTrails ? overshoot : 0), lv, flick ? 400 : 300,
        flick, token, leftTrails && squash ? () -> spring(true, slotL(index), 0, 160, false, token, null) : null);
    spring(false, slotR(index) + (!leftTrails ? overshoot : 0), rv, flick ? 400 : 300,
        flick, token, !leftTrails && squash ? () -> spring(false, slotR(index), 0, 160, false, token, null) : null);
  }

  private void spring(boolean left, float target, float velocity, int duration, boolean bounce, int token, Runnable after) {
    float start = left ? edgeL : edgeR;
    float initialVelocity = clamp(velocity, -2000 * density, 2000 * density);
    ValueAnimator animation = ValueAnimator.ofFloat(0, 1);
    if (left) leftAnimator = animation; else rightAnimator = animation;
    animation.setDuration(duration);
    animation.setInterpolator(t -> t);
    final long[] previousTime = {0};
    animation.addUpdateListener(a -> {
      if (token != generation) return;
      float fraction = (float) a.getAnimatedValue();
      double t = fraction * duration / 1000.0, offset = start - target;
      double value;
      if (bounce) {
        value = target + Math.exp(-16 * t) * (offset * Math.cos(26 * t)
            + (initialVelocity + 16 * offset) / 26 * Math.sin(26 * t));
      } else {
        double omega = duration < 200 ? 65 : 36;
        value = target + (offset + (initialVelocity + omega * offset) * t) * Math.exp(-omega * t);
      }
      float next = fraction == 1 ? target : (float) value;
      long now = android.os.SystemClock.uptimeMillis();
      if (previousTime[0] != 0 && now > previousTime[0]) {
        float speed = (next - (left ? edgeL : edgeR)) * 1000 / (now - previousTime[0]);
        if (left) leftVelocity = speed; else rightVelocity = speed;
      }
      previousTime[0] = now;
      if (left) edgeL = next; else edgeR = next;
      invalidate();
    });
    animation.addListener(new AnimatorListenerAdapter() {
      boolean cancelled;
      public void onAnimationCancel(Animator a) { cancelled = true; }
      public void onAnimationEnd(Animator a) {
        if (!cancelled && token == generation && after != null) after.run();
      }
    });
    animation.start();
  }

  protected void onMeasure(int width, int height) {
    setMeasuredDimension(MeasureSpec.getSize(width), MeasureSpec.getSize(height));
    int tabW = Math.max(0, Math.round((getMeasuredWidth() - 2 * inset) / 2));
    int tabH = Math.max(0, Math.round(getMeasuredHeight() - 2 * inset));
    for (View tab : tabs) tab.measure(MeasureSpec.makeMeasureSpec(tabW, MeasureSpec.EXACTLY),
        MeasureSpec.makeMeasureSpec(tabH, MeasureSpec.EXACTLY));
  }

  protected void onLayout(boolean changed, int l, int t, int r, int b) {
    float width = Math.max(0, getWidth() - 2 * inset);
    if (innerWidth != width || changed) { innerWidth = width; stopMotion(); jump(); }
    for (int i = 0; i < 2; i++) {
      int x = Math.round(inset + slotL(i));
      tabs[i].layout(x, Math.round(inset), x + tabs[i].getMeasuredWidth(), Math.round(inset) + tabs[i].getMeasuredHeight());
    }
  }

  protected void onDraw(Canvas canvas) {
    super.onDraw(canvas);
    float glowX = inset + (slotL(selected) + slotR(selected)) / 2;
    float glowY = getHeight() / 2f;
    float glowRadius = density * 23;
    paint.setStyle(Paint.Style.FILL);
    paint.setShader(new RadialGradient(glowX, glowY, glowRadius,
        DotoAppearance.light ? 0x55405c80 : 0x75c2e1ff, Color.TRANSPARENT, Shader.TileMode.CLAMP));
    canvas.drawCircle(glowX, glowY, glowRadius, paint);
    paint.setShader(null);
    drawIcons(canvas);
    for (View tab : tabs) if (tab.isFocused()) {
      paint.setColor(Color.WHITE); paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(density);
      canvas.drawRoundRect(tab.getLeft() + density, inset + density, tab.getRight() - density,
          getHeight() - inset - density, density * 8, density * 8, paint);
    }
  }

  private void drawIcons(Canvas canvas) {
    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeWidth(1.8f); paint.setStrokeCap(Paint.Cap.ROUND); paint.setStrokeJoin(Paint.Join.ROUND);
    for (int i = 0; i < 2; i++) {
      paint.setColor(DotoAppearance.light
          ? (i == selected ? 0xff172d4a : 0xff515151)
          : (i == selected ? 0xfff2faff : 0xffb9b9b9));
      int save = canvas.save();
      canvas.translate(inset + (slotL(i) + slotR(i)) / 2, getHeight() / 2f);
      float size = Math.min(28 * density, Math.min(innerWidth / 2 * .56f, (getHeight() - 2 * inset) * .58f));
      float scale = pointer >= 0 && !dragging && downSlot == i && !onThumb ? .96f : 1;
      canvas.scale(size / 24 * scale, size / 24 * scale);
      if (i == 0) canvas.drawPath(sparkle, paint);
      else {
        canvas.drawRoundRect(-10, -11, 10, 11, 5.5f, 5.5f, paint);
        canvas.drawCircle(0, -3.5f, 3.5f, paint);
        canvas.drawPath(shoulders, paint);
      }
      canvas.restoreToCount(save);
    }
  }

  public boolean onInterceptTouchEvent(MotionEvent event) { return isEnabled(); }

  private void record(float x, long time) {
    if (historyCount == 8) {
      System.arraycopy(historyX, 1, historyX, 0, 7);
      System.arraycopy(historyTime, 1, historyTime, 0, 7);
      historyCount--;
    }
    historyX[historyCount] = x; historyTime[historyCount++] = time;
  }

  private float velocity(long now) {
    int first = 0;
    while (first < historyCount - 1 && now - historyTime[first] > 100) first++;
    int last = historyCount - 1;
    if (last <= first || historyTime[last] - historyTime[first] < 8) return 0;
    return clamp((historyX[last] - historyX[first]) * 1000 / (historyTime[last] - historyTime[first]), -2000 * density, 2000 * density);
  }

  private float rubber(float over, float size) { return over * size * .55f / (size + .55f * Math.abs(over)); }

  public boolean onTouchEvent(MotionEvent event) {
    if (!isEnabled()) return false;
    int action = event.getActionMasked();
    if (action == MotionEvent.ACTION_DOWN) {
      pointer = event.getPointerId(0); downX = event.getX() - inset; downY = event.getY();
      downSlot = downX < innerWidth / 2 ? 0 : 1;
      onThumb = downX >= edgeL && downX <= edgeR;
      dragging = abandoned = false;
      historyCount = 0; record(downX, event.getEventTime());
      if (onThumb) { stopMotion(); leftVelocity = rightVelocity = 0; }
      getParent().requestDisallowInterceptTouchEvent(true);
      invalidate(); return true;
    }
    if (pointer < 0) return false;
    int index = event.findPointerIndex(pointer);
    if (index < 0 || action == MotionEvent.ACTION_CANCEL
        || (action == MotionEvent.ACTION_POINTER_UP && event.getPointerId(event.getActionIndex()) == pointer)) {
      pointer = -1; dragging = false;
      land(selected, 0f, false, false);
      getParent().requestDisallowInterceptTouchEvent(false);
      return true;
    }
    float x = event.getX(index) - inset, y = event.getY(index);
    if (action == MotionEvent.ACTION_MOVE) {
      record(x, event.getEventTime());
      if (!dragging && Math.abs(y - downY) > 10 * density && Math.abs(y - downY) > Math.abs(x - downX)) abandoned = true;
      if (!abandoned && onThumb && !dragging && Math.abs(x - downX) >= 4 * density) {
        dragging = true; dragOffset = x - edgeL; dragWidth = edgeR - edgeL;
      }
      if (dragging && !abandoned) {
        float l = x - dragOffset, maxL = innerWidth - dragWidth;
        if (!ValueAnimator.areAnimatorsEnabled()) {
          edgeL = clamp(l, 0, maxL); edgeR = edgeL + dragWidth;
        } else if (l < 0) { edgeL = 0; edgeR = dragWidth - rubber(-l, dragWidth); }
        else if (l > maxL) { edgeR = innerWidth; edgeL = maxL + rubber(l - maxL, dragWidth); }
        else { edgeL = l; edgeR = l + dragWidth; }
        invalidate();
      }
      if (abandoned) getParent().requestDisallowInterceptTouchEvent(false);
      return true;
    }
    if (action == MotionEvent.ACTION_UP) {
      boolean wasDragging = dragging;
      pointer = -1; dragging = false;
      getParent().requestDisallowInterceptTouchEvent(false);
      if (abandoned) { land(selected, 0f, false, false); return true; }
      if (!wasDragging) {
        if (Math.abs(x - downX) <= 10 * density && Math.abs(y - downY) <= 10 * density) {
          if (downSlot != selected) tap(downSlot); else land(selected, 0f, false, false);
        } else land(selected, 0f, false, false);
      } else {
        record(x, event.getEventTime());
        float v = velocity(event.getEventTime());
        boolean flick = Math.abs(v) > 110 * density;
        double d = 1 - .1 * Math.pow(.05, .75);
        float projected = (edgeL + edgeR) / 2 + (float) ((v / 1000) * d / (1 - d));
        int to = projected < innerWidth / 2 ? 0 : 1;
        if (flick && to == selected) to = (int) clamp(to + Math.signum(v), 0, 1);
        commit(to); land(to, v, flick, flick);
      }
      invalidate(); return true;
    }
    return true;
  }

  public void setEnabled(boolean enabled) {
    super.setEnabled(enabled);
    if (tabs != null) for (View tab : tabs) if (tab != null) tab.setEnabled(enabled);
    setAlpha(enabled ? 1 : .5f);
    if (!enabled) { pointer = -1; stopMotion(); jump(); }
  }

  protected void onDetachedFromWindow() {
    pointer = -1; dragging = false;
    stopMotion(); jump();
    super.onDetachedFromWindow();
  }
}
