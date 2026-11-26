package com.volo.mobile;

import android.animation.ValueAnimator;
import android.graphics.*;
import android.view.View;

/** Local press feedback shared by the full player and mini player. */
final class PlayFeedback {
  private final View host;
  private final Paint paint = new Paint(3);
  private final Bitmap[] soft = new Bitmap[2];
  private ValueAnimator animation;
  private float amount;

  PlayFeedback(View host) { this.host = host; }

  void press(boolean down) {
    if (animation != null) animation.cancel();
    if (!ValueAnimator.areAnimatorsEnabled()) { amount = 0; host.invalidate(); return; }
    float start = amount;
    animation = down ? ValueAnimator.ofFloat(start, 1) : ValueAnimator.ofFloat(start, -.18f, 0);
    animation.setDuration(down ? 100 : 320);
    animation.setInterpolator(new android.view.animation.AccelerateDecelerateInterpolator());
    animation.addUpdateListener(a -> { amount = (float) a.getAnimatedValue(); host.invalidate(); });
    animation.start();
  }

  void draw(Canvas canvas, boolean playing) {
    int save = canvas.save();
    float cx = 783.5f + PlayerMorph.PLAY_OFFSET_X;
    canvas.scale(1 - .12f * amount, 1 - .12f * amount, cx, 1813.5f);
    float blur = Math.min(1, Math.abs(amount)) * .65f;
    if (blur > 0) {
      int index = playing ? 1 : 0;
      if (soft[index] == null) {
        Bitmap source = Bitmap.createBitmap(130, 150, Bitmap.Config.ARGB_8888);
        Canvas raster = new Canvas(source);
        raster.translate(-cx + 65, -1813.5f + 75);
        PlayerMorph.play(raster, playing);
        Paint mask = new Paint(3);
        mask.setMaskFilter(new BlurMaskFilter(4, BlurMaskFilter.Blur.NORMAL));
        int[] offset = new int[2];
        Bitmap alpha = source.extractAlpha(mask, offset);
        Bitmap result = Bitmap.createBitmap(154, 174, Bitmap.Config.ARGB_8888);
        Paint white = new Paint(3); white.setColor(Color.WHITE);
        new Canvas(result).drawBitmap(alpha, 12 + offset[0], 12 + offset[1], white);
        alpha.recycle(); source.recycle(); soft[index] = result;
      }
      paint.setAlpha(Math.round(255 * blur));
      canvas.drawBitmap(soft[index], cx - 77, 1813.5f - 87, paint);
    }
    int layer = canvas.saveLayerAlpha(cx - 90, 1710, cx + 90, 1920, Math.round(255 * (1 - blur)));
    PlayerMorph.play(canvas, playing);
    canvas.restoreToCount(layer);
    canvas.restoreToCount(save);
  }

  void close() {
    if (animation != null) animation.cancel();
    amount = 0;
    for (int i = 0; i < soft.length; i++) if (soft[i] != null) { soft[i].recycle(); soft[i] = null; }
  }
}
