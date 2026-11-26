package com.volo.mobile;

import android.app.Activity;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.view.View;
import android.view.WindowMetrics;
import android.widget.FrameLayout;

/** Positions the bottom navigation beneath the centered mini player. */
final class FloatingNavigation extends FrameLayout {
  private final Activity activity;
  private final View navigation;
  private final java.util.function.BooleanSupplier miniVisible;

  FloatingNavigation(Activity activity, View navigation, java.util.function.BooleanSupplier miniVisible) {
    super(activity);
    this.activity = activity;
    this.navigation = navigation;
    this.miniVisible = miniVisible;
    addView(navigation);
    setBackgroundColor(android.graphics.Color.TRANSPARENT);
    setClickable(false);
    setClipChildren(false);
    setClipToPadding(false);
  }

  protected void onMeasure(int width, int height) {
    setMeasuredDimension(MeasureSpec.getSize(width), MeasureSpec.getSize(height));
    WindowMetrics metrics = activity.getWindowManager().getCurrentWindowMetrics();
    Rect screen = metrics.getBounds();
    navigation.measure(
        MeasureSpec.makeMeasureSpec(
            screen.width(),
            MeasureSpec.EXACTLY),
        MeasureSpec.makeMeasureSpec(
            navigationHeight(activity, screen.height()),
            MeasureSpec.EXACTLY));
  }

  protected void onLayout(boolean changed, int l, int t, int r, int b) {
    WindowMetrics metrics = activity.getWindowManager().getCurrentWindowMetrics();
    Rect screen = metrics.getBounds();
    int[] location = new int[2];
    getLocationOnScreen(location);
    int x = screen.left - location[0];
    navigation.invalidate();
    int y = navigationTop(activity, metrics) - location[1];
    navigation.layout(x, y, x + navigation.getMeasuredWidth(), y + navigation.getMeasuredHeight());
  }

  static int navigationHeight(android.content.Context activity, int screenHeight) {
    return GlassUi.dp(activity, 48);
  }

  void glassOutline(Path path, RectF bounds) {
    float x = bounds.centerX();
    float lip = GlassUi.dp(activity, 40);
    float depth = GlassUi.dp(activity, 32);
    path.moveTo(bounds.left, bounds.top);
    if (miniVisible.getAsBoolean()) {
      path.lineTo(x - lip, bounds.top);
      path.cubicTo(x - lip * .66f, bounds.top, x - lip * .76f, bounds.top + depth,
          x, bounds.top + depth);
      path.cubicTo(x + lip * .76f, bounds.top + depth, x + lip * .66f, bounds.top,
          x + lip, bounds.top);
    }
    path.lineTo(bounds.right, bounds.top);
    path.lineTo(bounds.right, bounds.bottom);
    path.lineTo(bounds.left, bounds.bottom);
    path.close();
  }

  static int navigationTop(Activity activity, WindowMetrics metrics) {
    Rect screen = metrics.getBounds();
    return screen.bottom - PlayerMorph.systemBottomInset(metrics)
        - navigationHeight(activity, screen.height());
  }
}
