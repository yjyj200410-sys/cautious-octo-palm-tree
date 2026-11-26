package com.volo.mobile;

import android.animation.ValueAnimator;
import android.app.Activity;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Color;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.LinearInterpolator;

final class LiquidLaunch extends View {
  private static final String[] WORDMARK = {
      "11110001110011111001110",
      "10001010001000100010001",
      "10001010001000100010001",
      "10001010001000100010001",
      "10001010001000100010001",
      "10001010001000100010001",
      "11110001110000100001110"
  };
  private static final int BOARD_COLUMNS = 31;
  private static final int BOARD_ROWS = 9;
  private static final int WORDMARK_LEFT = (BOARD_COLUMNS - WORDMARK[0].length()) / 2;
  private static final int WORDMARK_TOP = (BOARD_ROWS - WORDMARK.length) / 2;
  private final Paint ink = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final ViewGroup host;
  private ValueAnimator animator;
  private float progress;

  private LiquidLaunch(Activity activity, ViewGroup host) {
    super(activity);
    this.host = host;
    setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
  }

  static void show(Activity activity) {
    if (!ValueAnimator.areAnimatorsEnabled()) return;
    ViewGroup decor = (ViewGroup) activity.getWindow().getDecorView();
    decor.post(() -> {
      if (activity.isDestroyed() || activity.isFinishing()) return;
      LiquidLaunch view = new LiquidLaunch(activity, decor);
      view.layout(0, 0, decor.getWidth(), decor.getHeight());
      decor.getOverlay().add(view);
      view.start();
    });
  }

  private void start() {
    animator = ValueAnimator.ofFloat(0f, 1f);
    animator.setDuration(1200);
    animator.setInterpolator(new LinearInterpolator());
    animator.addUpdateListener(animation -> {
      progress = (float) animation.getAnimatedValue();
      invalidate();
    });
    animator.addListener(new android.animation.AnimatorListenerAdapter() {
      @Override public void onAnimationEnd(android.animation.Animator animation) {
        host.getOverlay().remove(LiquidLaunch.this);
      }
    });
    animator.start();
  }

  @Override protected void onDraw(Canvas canvas) {
    int layer = canvas.saveLayerAlpha(0, 0, getWidth(), getHeight(),
        Math.round(255 * (1 - ease((progress - .87f) / .13f))));
    canvas.drawColor(Color.BLACK);
    float pitch = Math.min(getWidth(), getHeight()) * .80f / BOARD_COLUMNS;
    float cx = getWidth() * .5f;
    float cy = getHeight() * .5f;
    float centerColumn = (BOARD_COLUMNS - 1) * .5f;
    float centerRow = (BOARD_ROWS - 1) * .5f;
    float half = pitch * .29f;

    ink.setColor(Color.WHITE);
    for (int row = 0; row < WORDMARK.length; row++) {
      String line = WORDMARK[row];
      for (int column = 0; column < line.length(); column++) {
        if (line.charAt(column) == '0') continue;
        float reveal = ease((progress - column * .008f - row * .005f) / .33f);
        if (reveal == 0) continue;
        float spread = 1 - reveal;
        float targetX = column + WORDMARK_LEFT - centerColumn;
        float targetY = row + WORDMARK_TOP - centerRow;
        float x = cx + pitch * (targetX * (1 + spread * .28f) - spread * 4);
        float y = cy + pitch * (targetY * (1 + spread) + spread * targetX * .32f);
        float scale = half * (.48f + .52f * reveal);
        float corner = scale * (1 - reveal * .72f);
        ink.setAlpha(Math.round(255 * reveal));
        drawPixel(canvas, x, y, scale, corner);
      }
    }

    canvas.restoreToCount(layer);
  }

  private void drawPixel(Canvas canvas, float x, float y, float half, float corner) {
    canvas.drawRoundRect(x - half, y - half, x + half, y + half, corner, corner, ink);
  }

  private static float ease(float value) {
    float t = Math.max(0f, Math.min(1f, value));
    return t * t * (3f - 2f * t);
  }

  @Override protected void onDetachedFromWindow() {
    if (animator != null) {
      animator.removeAllListeners();
      animator.cancel();
    }
    super.onDetachedFromWindow();
  }
}
