package com.volo.mobile;

import android.app.Activity;
import android.graphics.*;
import android.view.*;
import android.view.accessibility.AccessibilityNodeInfo;

/** A non-modal mini player. Touches outside the capsule pass through to the page. */
final class CompactPlayerView extends View {
  interface ExpansionDrag {
    boolean begin(boolean horizontal);

    void update(float fraction);

    void end(float openingVelocity, boolean cancelled);
  }

  private final Activity activity;
  private final Runnable open, toggle;
  private Bitmap cover;
  private boolean playing, tracking;
  private float downX, downY;
  private ExpansionDrag expansionDrag;
  private boolean dragging, horizontal;
  private VelocityTracker velocity;

  void setExpansionDrag(ExpansionDrag drag) {
    expansionDrag = drag;
  }

  CompactPlayerView(Activity activity, Runnable open, Runnable toggle) {
    super(activity);
    this.activity = activity;
    this.open = open;
    this.toggle = toggle;
    // Keep the capsule above homepage cards while the dialog's transparent
    // first/last frame is being handed over between windows.
    setTranslationZ(32 * getResources().getDisplayMetrics().density);
    setFocusable(true);
    setContentDescription("迷你播放器，点击封面或向左、向上滑动展开");
  }

  void state(Bitmap cover, boolean playing) {
    this.cover = cover;
    this.playing = playing;
    invalidate();
  }

  protected void onDraw(Canvas c) {
    int[] location = new int[2];
    getLocationOnScreen(location);
    WindowMetrics metrics = activity.getWindowManager().getCurrentWindowMetrics();
    Rect screen = metrics.getBounds();
    c.save();
    c.translate(screen.left - location[0], screen.top - location[1]);
    float scaleX = PlayerMorph.dockScaleX(activity, metrics);
    c.translate(dockRight(metrics)-screen.left-PlayerMorph.PILL.right*scaleX, 0);
    c.scale(scaleX, screen.height()/2048f);
    c.translate(0, PlayerMorph.dockOffset(activity, metrics));
    c.scale(1, PlayerMorph.dockHeightFactor(activity, metrics), 0, PlayerMorph.PILL.bottom);
    PlayerMorph.pill(c, 1);
    PlayerMorph.photo(c, cover, PlayerMorph.COVER, 64.5f, 64.5f);
    c.restore();
  }

  public boolean onTouchEvent(MotionEvent event) {
    WindowMetrics metrics = activity.getWindowManager().getCurrentWindowMetrics();
    Rect screen = metrics.getBounds();
    float x = PlayerMorph.PILL.right
        + (event.getRawX()-dockRight(metrics))/PlayerMorph.dockScaleX(activity, metrics);
    float y = (event.getRawY() - screen.top) * 2048 / screen.height()
        - PlayerMorph.dockOffset(activity, metrics);
    y = PlayerMorph.PILL.bottom + (y-PlayerMorph.PILL.bottom)/PlayerMorph.dockHeightFactor(activity, metrics);
    if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
      if (velocity != null) velocity.recycle();
      velocity = VelocityTracker.obtain();
    }
    if (velocity != null) {
      MotionEvent raw = MotionEvent.obtain(event);
      raw.offsetLocation(event.getRawX() - event.getX(), event.getRawY() - event.getY());
      velocity.addMovement(raw);
      raw.recycle();
    }
    float dx = event.getRawX() - downX, dy = event.getRawY() - downY;
    switch (event.getActionMasked()) {
      case MotionEvent.ACTION_DOWN:
        dragging = false;
        tracking = PlayerMorph.PILL.contains(x, y);
        downX = event.getRawX();
        downY = event.getRawY();
        if (!tracking) recycleVelocity();
        return tracking;
      case MotionEvent.ACTION_MOVE:
        if (!tracking) return false;
        float slop = ViewConfiguration.get(getContext()).getScaledTouchSlop();
        if (!dragging
            && expansionDrag != null
            && ((dx < -slop && Math.abs(dx) >= Math.abs(dy))
                || (dy < -slop && Math.abs(dy) > Math.abs(dx)))) {
          horizontal = Math.abs(dx) >= Math.abs(dy);
          dragging = expansionDrag.begin(horizontal);
        }
        if (dragging) expansionDrag.update(openFraction(dx, dy, screen));
        return true;
      case MotionEvent.ACTION_UP:
        if (!tracking) return false;
        tracking = false;
        if (dragging) {
          expansionDrag.update(openFraction(dx, dy, screen));
          velocity.computeCurrentVelocity(1000);
          float speed = horizontal ? velocity.getXVelocity() : velocity.getYVelocity();
          dragging = false;
          recycleVelocity();
          expansionDrag.end(-speed / dragRange(screen), false);
          return true;
        }
        recycleVelocity();
        float threshold = 24 * getResources().getDisplayMetrics().density;
        if ((dx < -threshold && Math.abs(dx) >= Math.abs(dy))
            || (dy < -threshold && Math.abs(dy) > Math.abs(dx))) {
          performClick();
          return true;
        }
        if (Math.hypot(event.getRawX() - downX, event.getRawY() - downY)
                < ViewConfiguration.get(getContext()).getScaledTouchSlop()
            && PlayerMorph.PILL.contains(x, y)) {
          performClick();
        }
        return true;
      case MotionEvent.ACTION_CANCEL:
        tracking = false;
        recycleVelocity();
        if (dragging) {
          dragging = false;
          expansionDrag.end(0, true);
        }
        return true;
    }
    return tracking;
  }

  private float dockRight(WindowMetrics metrics) {
    Rect screen = metrics.getBounds();
    return screen.left + (PlayerMorph.PILL.right + PlayerMorph.dockRightOffset(activity,metrics))
        * screen.width()/931f;
  }

  private float dragRange(Rect screen) {
    return horizontal ? screen.width() * .48f : screen.height() * .34f;
  }

  private float openFraction(float dx, float dy, Rect screen) {
    return Math.max(0, Math.min(1, -(horizontal ? dx : dy) / dragRange(screen)));
  }

  private void recycleVelocity() {
    if (velocity != null) velocity.recycle();
    velocity = null;
  }

  protected void onDetachedFromWindow() {
    recycleVelocity();
    super.onDetachedFromWindow();
  }

  public boolean performClick() {
    super.performClick();
    open.run();
    return true;
  }

  public void onInitializeAccessibilityNodeInfo(AccessibilityNodeInfo info) {
    super.onInitializeAccessibilityNodeInfo(info);
    info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_CLICK);
    info.addAction(
        new AccessibilityNodeInfo.AccessibilityAction(0x01020001, playing ? "暂停" : "播放"));
  }

  public boolean performAccessibilityAction(int action, android.os.Bundle args) {
    if (action == 0x01020001) {
      toggle.run();
      return true;
    }
    return super.performAccessibilityAction(action, args);
  }
}
