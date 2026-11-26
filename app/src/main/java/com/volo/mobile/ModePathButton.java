package com.volo.mobile;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.*;
import android.view.View;
import android.view.accessibility.AccessibilityNodeInfo;

/** Continuous paths shared by repeat, repeat-one and shuffle. */
final class ModePathButton extends View {
  private final Paint paint = new Paint(3);
  private final Path path = new Path();
  private float[][][] points = shape(0);
  private float one;
  private int mode = -1;
  private ValueAnimator animator;
  private static final String[] NAMES = {"列表循环", "单曲循环", "随机播放"};

  ModePathButton(Context context) {
    super(context);
    setClickable(true); setFocusable(true);
    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeCap(Paint.Cap.ROUND); paint.setStrokeJoin(Paint.Join.ROUND);
  }

  void mode(int value, boolean animate) {
    if (value == mode) return;
    boolean first = mode < 0;
    mode = value;
    setContentDescription(NAMES[value] + "，点击切换为" + NAMES[(value+1)%3]);
    setStateDescription(NAMES[value]);
    if (animator != null) animator.cancel();
    float[][][] end = shape(value);
    float targetOne = value == 1 ? 1 : 0;
    if (first || !animate || !ValueAnimator.areAnimatorsEnabled()) {
      points = end; one = targetOne; invalidate(); return;
    }
    float[][][] start = points;
    float startOne = one;
    points = shape(value);
    animator = ValueAnimator.ofFloat(0,1);
    animator.setDuration(420); animator.setInterpolator(t -> t);
    animator.addUpdateListener(a -> {
      float t = (float)a.getAnimatedValue();
      for (int j=0;j<2;j++) for (int i=0;i<=80;i++) {
        float lag = .08f*(float)Math.sin(Math.PI*i/80)*(j==0 ? -1 : 1);
        float local = Math.max(0,Math.min(1,t+lag*(float)Math.sin(Math.PI*t)));
        float s = local*local*(3-2*local)
            + .07f*(float)Math.sin(2*Math.PI*local)*(float)Math.sin(Math.PI*local);
        for (int k=0;k<2;k++) points[j][i][k] = start[j][i][k]+(end[j][i][k]-start[j][i][k])*s;
      }
      float pop;
      if (targetOne == 1) {
        float u=t-1;
        pop=1+2.6f*u*u*u+1.6f*u*u;
      } else pop=t*t*(3-2*t);
      one = startOne+(targetOne-startOne)*pop;
      invalidate();
    });
    animator.start();
  }

  private static float[][][] shape(int mode) {
    float[][] controls = mode == 2
        ? new float[][] {{18,27,48,27,52,73,82,73},{18,73,48,73,52,27,82,27}}
        : new float[][] {{20,44,15,17,60,20,80,25},{80,56,85,83,40,80,20,75}};
    float[][][] result = new float[2][81][2];
    for (int j=0;j<2;j++) for (int i=0;i<=80;i++) {
      float t=i/80f,u=1-t;
      for (int k=0;k<2;k++) result[j][i][k] = u*u*u*controls[j][k]
          +3*u*u*t*controls[j][k+2]+3*u*t*t*controls[j][k+4]+t*t*t*controls[j][k+6];
    }
    return result;
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
    int save=c.save();
    c.scale(pressScale,pressScale,getWidth()/2f,getHeight()/2f);
    float scale=Math.min(getWidth()*.76f/100,getHeight()*.70f/100);
    c.translate(getWidth()/2f,getHeight()/2f); c.scale(scale,scale); c.translate(-50,-50);
    paint.setColor(0xfffafafa); paint.setAlpha(255); paint.setStrokeWidth(7);
    for (float[][] p:points) {
      path.reset(); path.moveTo(p[0][0],p[0][1]);
      for (int i=1;i<=80;i++) path.lineTo(p[i][0],p[i][1]);
      c.drawPath(path,paint);
      float x=p[80][0],y=p[80][1];
      double angle=Math.atan2(y-p[76][1],x-p[76][0]);
      path.reset();
      path.moveTo(x-10*(float)Math.cos(angle-.7),y-10*(float)Math.sin(angle-.7));
      path.lineTo(x,y);
      path.lineTo(x-10*(float)Math.cos(angle+.7),y-10*(float)Math.sin(angle+.7));
      c.drawPath(path,paint);
    }
    if (one>0) {
      int number=c.save();
      c.scale(one,one,51,50);
      paint.setStrokeWidth(5.5f); paint.setAlpha(255);
      path.reset(); path.moveTo(45,44); path.lineTo(51,39); path.lineTo(51,61);
      path.moveTo(44,61); path.lineTo(58,61);
      c.drawPath(path,paint);
      c.restoreToCount(number);
    }
    c.restoreToCount(save);
  }

  public void onInitializeAccessibilityNodeInfo(AccessibilityNodeInfo info) {
    super.onInitializeAccessibilityNodeInfo(info); info.setClassName("android.widget.Button");
  }
  protected void onDetachedFromWindow() {
    if (animator != null) animator.cancel();
    if (mode>=0) { points=shape(mode); one=mode==1?1:0; }
    if (pressAnimation != null) pressAnimation.cancel();
    pressScale=1;
    super.onDetachedFromWindow();
  }
}
