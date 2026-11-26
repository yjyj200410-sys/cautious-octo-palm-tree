package com.volo.mobile;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.*;
import android.util.Xml;
import android.view.View;
import android.view.accessibility.AccessibilityNodeInfo;
import java.io.InputStream;
import java.util.ArrayList;
import org.xmlpull.v1.XmlPullParser;

/** Native SVG paths: the same editable source is used by the design preview and APK. */
final class SketchActionButton extends View {
  enum Kind {
    REPEAT,
    SHUFFLE,
    DOWNLOAD
  }

  private record Ink(Path path, PathMeasure measure, float width) {}

  private final Kind kind;
  private final ArrayList<Ink> ink = new ArrayList<>();
  private final Path outline = new Path(), inside = new Path(), segment = new Path();
  private final RectF bounds = new RectF();
  private final Paint pen = new Paint(3);
  private Path single, check;
  private PathMeasure checkMeasure;
  private float length, fillProgress, checkProgress, targetFill;
  private boolean initialized, one, complete, busy;
  private ValueAnimator fillAnimation, checkAnimation, motionAnimation;
  private float motion = 1;

  private void animateMotion() {
    if (motionAnimation != null) motionAnimation.cancel();
    if (!ValueAnimator.areAnimatorsEnabled()) { motion = 1; return; }
    motionAnimation = ValueAnimator.ofFloat(0,1);
    motionAnimation.setDuration(340);
    motionAnimation.setInterpolator(t -> t);
    motionAnimation.addUpdateListener(a -> {
      motion = (float)a.getAnimatedValue(); invalidate();
    });
    motionAnimation.start();
  }

  SketchActionButton(Context context, Kind kind) {
    super(context);
    this.kind = kind;
    setFocusable(true);
    setClickable(true);
    pen.setStrokeCap(Paint.Cap.ROUND);
    pen.setStrokeJoin(Paint.Join.ROUND);
    outline.setFillType(Path.FillType.EVEN_ODD);
    inside.setFillType(Path.FillType.EVEN_ODD);
    read(context);
  }

  void mode(boolean active, boolean one, boolean animate) {
    this.one = one;
    state(active ? 1 : 0, false, false, animate);
    setContentDescription(
        kind == Kind.REPEAT
            ? one ? "单曲循环，点击关闭循环" : active ? "列表循环，点击切换为单曲循环" : "循环已关闭，点击开启列表循环"
            : active ? "随机播放已开启，点击关闭" : "随机播放，点击开启");
    setStateDescription(one ? "单曲循环" : active ? "已开启" : "未开启");
  }

  void download(boolean complete, boolean busy, int percent, boolean animate) {
    state(
        complete ? 1 : busy ? Math.max(.08f, Math.min(.95f, percent / 100f)) : 0,
        complete,
        busy,
        animate);
    setContentDescription(complete ? "已下载" : busy ? "正在下载" : "下载当前歌曲");
    setStateDescription(
        complete ? "已下载" : busy ? "下载中" + (percent > 0 ? percent + "%" : "") : "未下载");
    setEnabled(!busy);
  }

  private void state(float target, boolean complete, boolean busy, boolean animate) {
    boolean first = !initialized;
    if (!first && animate && (targetFill != target || this.complete != complete)) animateMotion();
    initialized = true;
    this.busy = busy;
    if (first || targetFill != target) {
      targetFill = target;
      if (fillAnimation != null) fillAnimation.cancel();
      if (!animate || first || !ValueAnimator.areAnimatorsEnabled()) fillProgress = target;
      else {
        fillAnimation = ValueAnimator.ofFloat(fillProgress, target);
        fillAnimation.setDuration(Math.max(1, Math.round(380 * Math.abs(target - fillProgress))));
        fillAnimation.setInterpolator(UiMotion.CURVE);
        fillAnimation.addUpdateListener(
            a -> {
              fillProgress = (Float) a.getAnimatedValue();
              invalidate();
            });
        fillAnimation.start();
      }
    }
    if (first || this.complete != complete) {
      this.complete = complete;
      if (checkAnimation != null) checkAnimation.cancel();
      if (!animate || first || !ValueAnimator.areAnimatorsEnabled())
        checkProgress = complete ? 1 : 0;
      else {
        checkAnimation = ValueAnimator.ofFloat(checkProgress, complete ? 1 : 0);
        checkAnimation.setDuration(210);
        checkAnimation.setInterpolator(UiMotion.CURVE);
        checkAnimation.addUpdateListener(
            a -> {
              checkProgress = (Float) a.getAnimatedValue();
              invalidate();
            });
        checkAnimation.start();
      }
    }
    invalidate();
  }

  float fillProgress() {
    return fillProgress;
  }

  float checkProgress() {
    return checkProgress;
  }

  public void onInitializeAccessibilityNodeInfo(AccessibilityNodeInfo info) {
    super.onInitializeAccessibilityNodeInfo(info);
    info.setClassName(android.widget.Button.class.getName());
    if (kind != Kind.DOWNLOAD) {
      info.setCheckable(true);
      info.setChecked(targetFill == 1);
    }
  }

  protected void onDetachedFromWindow() {
    if (fillAnimation != null) fillAnimation.cancel();
    if (checkAnimation != null) checkAnimation.cancel();
    if (motionAnimation != null) motionAnimation.cancel();
    motion = 1;
    if (pressAnimation != null) pressAnimation.cancel();
    pressScale=1;
    super.onDetachedFromWindow();
  }

  private float pressScale = 1;
  private ValueAnimator pressAnimation;

  @Override public void setPressed(boolean pressed) {
    boolean changed = pressed != isPressed();
    super.setPressed(pressed);
    if (!changed) return;
    if (pressAnimation != null) pressAnimation.cancel();
    if (!ValueAnimator.areAnimatorsEnabled()) { pressScale=1; invalidate(); return; }
    float start=pressScale;
    pressAnimation=ValueAnimator.ofFloat(0,1);
    pressAnimation.setDuration(pressed ? 65 : 310);
    pressAnimation.setInterpolator(t -> t);
    pressAnimation.addUpdateListener(a -> {
      float t=(float)a.getAnimatedValue();
      if (pressed) pressScale=start+(.84f-start)*t*t*(3-2*t);
      else {
        float seconds=t*.40f, offset=start-1;
        float velocity=start>.98f ? -1.3f : 0;
        pressScale=t==1 ? 1 : 1+(float)(Math.exp(-11*seconds)
            *(offset*Math.cos(25*seconds)+(velocity+11*offset)/25*Math.sin(25*seconds)));
      }
      invalidate();
    });
    pressAnimation.start();
  }

  protected void onDraw(Canvas c) {
    super.onDraw(c);
    int saved = c.save();
    c.scale(pressScale,pressScale,getWidth()/2f,getHeight()/2f);
    float scale = Math.min(getWidth()*.76f/100, getHeight()*.70f/100);
    c.translate(getWidth()/2f, getHeight()/2f);
    c.scale(scale,scale); c.translate(-50,-50);
    pen.setColor(0xfffafafa);
    pen.setAlpha(busy ? (int)(210+35*Math.sin(android.os.SystemClock.uptimeMillis()/180.0)) : 255);
    pen.setStyle(Paint.Style.STROKE);
    pen.setStrokeWidth(7 + 2*fillProgress);
    float wave = motion >= 1 ? 0 : (float)(Math.sin(2*Math.PI*motion)*Math.exp(-1.9*motion));
    int glyph = c.save();
    if (kind == Kind.REPEAT) {
      float eased = motion*motion*(3-2*motion);
      c.rotate(motion >= 1 ? 0 : -180*(1-eased) + 12*wave,50,50);
      c.scale(1-.10f*wave,1+.07f*wave,50,50);
      c.drawPath(outline,pen);
    } else if (kind == Kind.SHUFFLE) {
      // Opposite travelling offsets give the crossing paths independent momentum.
      for (int side=0;side<2;side++) {
        int clip=c.save();
        c.clipRect(0,side==0 ? 0 : 50,100,side==0 ? 50 : 100);
        c.translate((side==0 ? 11 : -11)*wave,0);
        c.drawPath(outline,pen); c.restoreToCount(clip);
      }
    } else {
      // Keep the tray anchored while the arrow drops and settles.
      int tray=c.save(); c.clipRect(0,65,100,100);
      c.drawPath(outline,pen); c.restoreToCount(tray);
      int arrow=c.save(); c.clipRect(0,0,100,65);
      c.translate(0,13*wave);
      c.scale(1-.08f*wave,1+.12f*wave,50,45);
      c.drawPath(outline,pen); c.restoreToCount(arrow);
    }
    c.restoreToCount(glyph);
    if (one && single != null) {
      pen.setStrokeWidth(5.5f); c.drawPath(single,pen);
    }
    if (kind != Kind.DOWNLOAD && fillProgress > 0) {
      pen.setStyle(Paint.Style.FILL);
      pen.setAlpha(Math.round(255*fillProgress));
      c.drawCircle(50,94,3,pen);
    }
    if (checkProgress > 0 && check != null) {
      segment.reset();
      checkMeasure.getSegment(0,checkMeasure.getLength()*checkProgress,segment,true);
      pen.setStyle(Paint.Style.STROKE); pen.setAlpha(255);
      pen.setColor(DotoDesign.BG); pen.setStrokeWidth(16); c.drawPath(segment,pen);
      pen.setColor(0xfffafafa); pen.setStrokeWidth(9); c.drawPath(segment,pen);
    }
    c.restoreToCount(saved);
    if (busy && isShown()) postInvalidateDelayed(80);
  }

  private void read(Context context) {
    // Regular geometry, uniform strokes and rounded joins; no texture masks.
    String data = switch (kind) {
      case REPEAT -> "M 19 43 L 19 36 Q 19 25 30 25 L 80 25 M 69 14 L 80 25 L 69 36 "
          + "M 81 57 L 81 64 Q 81 75 70 75 L 20 75 M 31 64 L 20 75 L 31 86";
      case SHUFFLE -> "M 17 27 L 28 27 Q 35 27 42 38 L 58 62 Q 65 73 73 73 L 84 73 "
          + "M 73 62 L 84 73 L 73 84 M 17 73 L 28 73 Q 35 73 42 62 "
          + "M 58 38 Q 65 27 73 27 L 84 27 M 73 16 L 84 27 L 73 38";
      case DOWNLOAD -> "M 50 15 L 50 62 M 33 45 L 50 62 L 67 45 "
          + "M 20 63 L 20 78 Q 20 83 25 83 L 75 83 Q 80 83 80 78 L 80 63";
    };
    outline.set(SketchHeartButton.parsePath(data));
    single = SketchHeartButton.parsePath("M 45 44 L 51 39 L 51 61 M 44 61 L 58 61");
    if (kind == Kind.DOWNLOAD) {
      check = SketchHeartButton.parsePath("M 25 49 L 43 67 L 77 33");
      checkMeasure = new PathMeasure(check,false);
    }
    bounds.set(0,0,100,100);
  }
}
