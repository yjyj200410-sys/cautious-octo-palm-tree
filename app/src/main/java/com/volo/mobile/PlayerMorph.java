package com.volo.mobile;

import android.content.Context;
import android.graphics.*;
import android.view.WindowInsets;
import android.view.WindowMetrics;

/** Shared screen-space destination for the full player and mini capsule. */
final class PlayerMorph {
  private static final int DOCK_SIZE_DP = 56;
  static final float PLAY_OFFSET_X = -318f;
  private static final float DOCK_BOTTOM = 2048f;
  private static final float DOCK_TOP = DOCK_BOTTOM - 180;
  static final RectF PILL = new RectF(667, DOCK_TOP, 847, DOCK_BOTTOM);
  static final RectF COVER = new RectF(692.5f, DOCK_TOP + 25.5f, 821.5f, DOCK_BOTTOM - 25.5f);
  static final RectF LYRIC_COVER = new RectF(96, 1020, 176, 1100);
  static final RectF LARGE_COVER = new RectF(78, 354, 639, 915);

  static int systemBottomInset(WindowMetrics metrics) {
    return metrics.getWindowInsets().getInsetsIgnoringVisibility(
        WindowInsets.Type.navigationBars() | WindowInsets.Type.displayCutout()).bottom;
  }

  static float dockOffset(Context context, WindowMetrics metrics) {
    float inset = systemBottomInset(metrics)
        + FloatingNavigation.navigationHeight(context, metrics.getBounds().height()) - GlassUi.dp(context, DOCK_SIZE_DP) / 2f;
    return -inset * 2048f / Math.max(1, metrics.getBounds().height());
  }

  static float dockHeightFactor(Context context, WindowMetrics metrics) {
    return GlassUi.dp(context, DOCK_SIZE_DP) * 2048f / (Math.max(1, metrics.getBounds().height()) * PILL.height());
  }

  static float dockScaleX(Context context, WindowMetrics metrics) {
    return GlassUi.dp(context, DOCK_SIZE_DP) / PILL.width();
  }

  static float dockRightOffset(Context context, WindowMetrics metrics) {
    int width = Math.max(1, metrics.getBounds().width());
    return (width / 2f + GlassUi.dp(context, DOCK_SIZE_DP) / 2f) * 931f / width - PILL.right;
  }

  static RectF frame(float progress, float dockX, float dockY) {
    RectF half = new RectF(0, 348.16f, 931, 2396.16f);
    RectF circle = new RectF(296.5f, 1646, 634.5f, 1984);
    if (progress <= .5f) return new RectF(0, progress * 696.32f, 931, 2048 + progress * 696.32f);
    if (progress <= .85f) return between(half, circle, (progress - .5f) / .35f);
    RectF dock = new RectF(PILL);
    dock.offset(dockX, dockY);
    return between(circle, dock, (progress - .85f) / .15f);
  }

  static float radius(float p) {
    if (p <= .5f) return 0;
    if (p <= .85f) return 169 * (p - .5f) / .35f;
    return 169 - 79 * (p - .85f) / .15f;
  }

  static RectF between(RectF a, RectF b, float t) {
    return new RectF(
        a.left + (b.left - a.left) * t,
        a.top + (b.top - a.top) * t,
        a.right + (b.right - a.right) * t,
        a.bottom + (b.bottom - a.bottom) * t);
  }

  static void pill(Canvas c, float alpha) {
    Paint p = new Paint(3);
    p.setColor(Color.BLACK);
    p.setAlpha(Math.round(alpha * 255));
    c.drawRoundRect(PILL, 90, 90, p);
    p.setColor(0xff303030);
    p.setAlpha(Math.round(alpha * 255));
    p.setStyle(Paint.Style.STROKE);
    p.setStrokeWidth(1.2f);
    c.drawRoundRect(PILL, 90, 90, p);
  }

  static void photo(Canvas c, Bitmap bitmap, RectF rect, float rx, float ry) {
    c.save();
    Path clip = new Path();
    clip.addRoundRect(rect, rx, ry, Path.Direction.CW);
    c.clipPath(clip);
    Paint p = new Paint(3);
    p.setColor(0xff353535);
    c.drawRect(rect, p);
    if (bitmap != null && !bitmap.isRecycled()) {
      float scale = Math.max(rect.width() / bitmap.getWidth(), rect.height() / bitmap.getHeight());
      float w = bitmap.getWidth() * scale, h = bitmap.getHeight() * scale;
      c.drawBitmap(
          bitmap,
          null,
          new RectF(
              rect.centerX() - w / 2,
              rect.centerY() - h / 2,
              rect.centerX() + w / 2,
              rect.centerY() + h / 2),
          p);
    }
    c.restore();
  }

  private static Bitmap liquidFrame;
  private static Canvas liquidCanvas;
  private static final Paint liquidComposite = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);

  static void playLiquid(Canvas c, float t) {
    if (t <= 0 || t >= 1) { play(c, t >= 1); return; }
    float[][] from = {{758,1772,791,1791,791,1839,758,1858},
        {791,1791,833,1815,833,1815,791,1839}};
    float[][] to = {{751,1768,771,1768,771,1859,751,1859},
        {796,1768,816,1768,816,1859,796,1859}};
    if (liquidFrame == null) {
      liquidFrame = Bitmap.createBitmap(160, 180, Bitmap.Config.ARGB_8888);
      liquidCanvas = new Canvas(liquidFrame);
    }
    liquidFrame.eraseColor(Color.TRANSPARENT);
    Canvas target = liquidCanvas;
    target.save();
    target.translate(-703.5f, -1723.5f);
    Paint p = new Paint(3); p.setColor(0xfffafafa);
    c.save(); c.translate(PLAY_OFFSET_X, 0);
    // Each half meets exactly on the circle's vertical diameter at the midpoint.
    // Matching cubic contours keep the round intermediate shape continuous.
    float cx = 783.5f, cy = 1813.5f, r = 33, k = .55228475f;
    float[][] circle = {
      {cx,cy-r, cx,cy-r, cx-r*k,cy-r, cx-r,cy-r*k,
       cx-r,cy, cx-r,cy+r*k, cx-r*k,cy+r, cx,cy+r},
      {cx,cy-r, cx+r*k,cy-r, cx+r,cy-r*k, cx+r,cy,
       cx+r,cy+r*k, cx+r*k,cy+r, cx,cy+r, cx,cy+r}
    };
    float phase = t <= .5f ? t*2 : (t-.5f)*2;
    float blend = phase*phase*(3-2*phase);
    float[] innerTop = new float[4], innerBottom = new float[4];
    for (int part=0; part<2; part++) {
      float[] polygon = t <= .5f ? from[part] : to[part];
      // Trace both halves top-to-bottom, with a straight inner closing edge.
      float[] contour = part == 0
          ? new float[] {polygon[2],polygon[3], polygon[0],polygon[1],
              polygon[0],polygon[1],polygon[0],polygon[1],
              polygon[6],polygon[7],polygon[6],polygon[7],
              polygon[6],polygon[7],polygon[4],polygon[5]}
          : new float[] {polygon[0],polygon[1],polygon[2],polygon[3],
              polygon[2],polygon[3],polygon[2],polygon[3],
              polygon[4],polygon[5],polygon[4],polygon[5],
              polygon[4],polygon[5],polygon[6],polygon[7]};
      float[] v = new float[16];
      for (int i=0;i<16;i++) v[i] = t <= .5f
          ? contour[i]+(circle[part][i]-contour[i])*blend
          : circle[part][i]+(contour[i]-circle[part][i])*blend;
      innerTop[part*2] = v[0]; innerTop[part*2+1] = v[1];
      innerBottom[part*2] = v[14]; innerBottom[part*2+1] = v[15];
      Path path = new Path();
      path.moveTo(v[0],v[1]);
      path.cubicTo(v[2],v[3],v[4],v[5],v[6],v[7]);
      path.lineTo(v[8],v[9]);
      path.cubicTo(v[10],v[11],v[12],v[13],v[14],v[15]);
      path.close(); target.drawPath(path,p);
    }
    // Overlap the two inner edges so rasterization cannot expose a hairline.
    // As pause bars separate, the connecting membrane narrows into a liquid neck.
    float release = Math.max(0, Math.min(1, (t-.52f)/.43f));
    float neck = 1 - release*release*(3-2*release);
    if (neck > .001f) {
      float lx = (innerTop[0]+innerBottom[0])*.5f;
      float rx = (innerTop[2]+innerBottom[2])*.5f;
      float ly = (innerTop[1]+innerBottom[1])*.5f;
      float ry = (innerTop[3]+innerBottom[3])*.5f;
      float lh = Math.abs(innerBottom[1]-innerTop[1])*.5f;
      float rh = Math.abs(innerBottom[3]-innerTop[3])*.5f;
      float waist = Math.min(lh,rh)*neck;
      float mid = (lx+rx)*.5f;
      Path bridge = new Path();
      bridge.moveTo(lx-1.5f,ly-lh);
      bridge.cubicTo(mid,ly-waist,mid,ry-waist,rx+1.5f,ry-rh);
      bridge.lineTo(rx+1.5f,ry+rh);
      bridge.cubicTo(mid,ry+waist,mid,ly+waist,lx-1.5f,ly+lh);
      bridge.close();
      p.setAlpha(Math.round(255*Math.min(1,neck*5)));
      target.drawPath(bridge,p);
    }
    target.restore();
    c.drawBitmap(liquidFrame, 703.5f, 1723.5f, liquidComposite);
    c.restore();
  }

  static void play(Canvas c, boolean playing) {
    c.save();
    c.translate(PLAY_OFFSET_X, 0);
    Paint p = new Paint(3);
    p.setColor(0xfffafafa);
    if (playing) {
      c.drawRoundRect(751, 1768, 771, 1859, 7, 7, p);
      c.drawRoundRect(796, 1768, 816, 1859, 7, 7, p);
    } else {
      Path path = new Path();
      path.moveTo(758, 1782);
      path.quadTo(758, 1772, 767, 1777);
      path.lineTo(821, 1808);
      path.quadTo(833, 1815, 821, 1822);
      path.lineTo(767, 1853);
      path.quadTo(758, 1858, 758, 1848);
      path.close();
      c.drawPath(path, p);
    }
    c.restore();
  }
}
