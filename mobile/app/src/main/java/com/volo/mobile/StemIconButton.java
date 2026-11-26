package com.volo.mobile;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.*;
import android.view.View;

final class StemIconButton extends View {
  interface Listener { void select(int mode); void manage(); }
  private final Paint paint=new Paint(3);
  private final Path path=new Path();
  private float[][][] points=shape(1);
  private int mode=1;
  private boolean ready,initialized;
  private float progress,extraAlpha=1;
  private ValueAnimator morph,fill;
  private static final String[] NAMES={"人声","原声","伴奏"};

  StemIconButton(Context context,Listener listener) {
    super(context);setClickable(true);setFocusable(true);
    paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(6);
    paint.setStrokeCap(Paint.Cap.ROUND);paint.setStrokeJoin(Paint.Join.ROUND);
    setOnClickListener(v->{int next=mode==1?0:mode==0?2:1;setMode(next);listener.select(next);});
    setOnLongClickListener(v->{listener.manage();return true;});
  }

  void setMode(int value) {
    setContentDescription(NAMES[value]+"，点击切换音轨，长按管理分轨");
    if(value==mode&&initialized)return;
    int previous=mode;mode=value;
    if(morph!=null)morph.cancel();
    float[][][] end=shape(value);
    float targetAlpha=value==1?1:0;
    if(!initialized||!isShown()||!ValueAnimator.areAnimatorsEnabled()) {
      initialized=true;points=end;extraAlpha=targetAlpha;invalidate();return;
    }
    float[][][] start=points;float startAlpha=extraAlpha;
    points=shape(value);
    if(previous!=1&&value!=1)startAlpha=0;
    final float alpha=startAlpha;
    morph=ValueAnimator.ofFloat(0,1);morph.setDuration(440);morph.setInterpolator(t->t);
    morph.addUpdateListener(a->{float t=(float)a.getAnimatedValue();float eased=t*t*(3-2*t);
      for(int j=0;j<5;j++)for(int i=0;i<=64;i++) {
        float u=Math.max(0,Math.min(1,t+.045f*(float)(Math.sin(Math.PI*t)*Math.sin(i*Math.PI/64+j))));
        float s=u*u*(3-2*u);
        for(int k=0;k<2;k++)points[j][i][k]=start[j][i][k]+(end[j][i][k]-start[j][i][k])*s;
      }
      extraAlpha=alpha+(targetAlpha-alpha)*eased;invalidate();
    });morph.start();
  }

  void setSeparation(boolean ready,boolean running,float amount) {
    this.ready=ready;
    float target=ready?1:Math.max(0,Math.min(1,amount));
    if(fill!=null)fill.cancel();
    if(!isShown()||!ValueAnimator.areAnimatorsEnabled()){progress=target;invalidate();return;}
    fill=ValueAnimator.ofFloat(progress,target);fill.setDuration(140);
    fill.addUpdateListener(a->{progress=(float)a.getAnimatedValue();invalidate();});fill.start();
  }

  private static float[][][] shape(int mode) {
    String[] data=mode==1?new String[]{"M22 42 L22 58","M36 28 L36 72","M50 19 L50 81","M64 28 L64 72","M78 42 L78 58"}
      :mode==0?new String[]{"M39 49 L39 29 C39 14 61 14 61 29 L61 49 C61 64 39 64 39 49",
      "M29 45 L29 49 C29 77 71 77 71 49 L71 45","M50 68 L50 82","M39 82 L61 82","M50 38 L50 38.01"}
      :new String[]{"M42 70 L42 25 L76 18 L76 63","M42 36 L76 29",
      "M42 71 C42 80 22 80 22 71 C22 62 42 62 42 71","M76 64 C76 73 56 73 56 64 C56 55 76 55 76 64","M59 23 L59 23.01"};
    float[][][] result=new float[5][65][2];
    for(int j=0;j<5;j++) {
      PathMeasure measure=new PathMeasure(SketchHeartButton.parsePath(data[j]),false);
      for(int i=0;i<=64;i++)measure.getPosTan(measure.getLength()*i/64f,result[j][i],null);
    }return result;
  }

  private void drawPaths(Canvas c,int color) {
    paint.setColor(color);
    for(int j=0;j<5;j++) {
      if(j==4&&extraAlpha<.001f)continue;
      paint.setAlpha(j==4?Math.round(255*extraAlpha):255);
      path.reset();path.moveTo(points[j][0][0],points[j][0][1]);
      for(int i=1;i<=64;i++)path.lineTo(points[j][i][0],points[j][i][1]);
      c.drawPath(path,paint);
    }
  }

  protected void onDraw(Canvas c) {
    int save=c.save();float scale=Math.min(getWidth()*.76f/100,getHeight()*.70f/100);
    c.translate(getWidth()/2f,getHeight()/2f);c.scale(scale,scale);c.translate(-50,-50);
    boolean white=mode==1||ready;
    drawPaths(c,white?0xfffafafa:0xff777777);
    if(!white&&progress>0) {
      int clip=c.save();c.clipRect(0,86-72*progress,100,100);
      drawPaths(c,0xfffafafa);c.restoreToCount(clip);
    }c.restoreToCount(save);
  }

  @Override public void setPressed(boolean pressed) {
    super.setPressed(pressed);
    animate().scaleX(pressed?.84f:1).scaleY(pressed?.84f:1)
      .setDuration(ValueAnimator.areAnimatorsEnabled()?(pressed?65:310):0)
      .setInterpolator(new android.view.animation.OvershootInterpolator(pressed?0:2)).start();
  }
  protected void onDetachedFromWindow() {
    if(morph!=null)morph.cancel();if(fill!=null)fill.cancel();animate().cancel();
    points=shape(mode);extraAlpha=mode==1?1:0;setScaleX(1);setScaleY(1);
    super.onDetachedFromWindow();
  }
  public void onInitializeAccessibilityNodeInfo(android.view.accessibility.AccessibilityNodeInfo info) {
    super.onInitializeAccessibilityNodeInfo(info);info.setClassName("android.widget.Button");
  }
}
