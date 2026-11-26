package com.volo.mobile;

import android.content.Context;
import android.view.View;

/** Shared animated playback marker over song artwork. */
final class NowPlayingBars extends View {
    private int dp(float value){return GlassUi.dp(getContext(),value);}
    private final android.graphics.Paint paint=new android.graphics.Paint(3);
    private boolean active,running;
    NowPlayingBars(Context context){super(context);setVisibility(GONE);setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);}
    void state(boolean active,boolean running){if(this.active==active&&this.running==running)return;this.active=active;this.running=running;setVisibility(active?VISIBLE:GONE);invalidate();}
    protected void onDraw(android.graphics.Canvas canvas){
      super.onDraw(canvas);if(!active)return;
      paint.setColor(0x66000000);canvas.drawRoundRect(0,0,getWidth(),getHeight(),dp(9),dp(9),paint);
      paint.setColor(0xfffafafa);float center=getWidth()/2f,bottom=getHeight()/2f+dp(8),width=dp(3.2f);
      boolean animate=running&&android.animation.ValueAnimator.areAnimatorsEnabled();double time=android.os.SystemClock.uptimeMillis()/1000.0;
      for(int i=0;i<4;i++){float wave=animate?(float)(.5+.5*Math.sin(time*(6.0+i*.9)+i*2.1)):(i==1?.7f:.3f);float height=dp(5)+dp(14)*wave,x=center+(i-1.5f)*dp(5.5f);canvas.drawRoundRect(x-width/2,bottom-height,x+width/2,bottom,width/2,width/2,paint);}
      if(animate&&isShown()&&getWindowVisibility()==VISIBLE)postInvalidateOnAnimation();
    }
    @Override protected void onAttachedToWindow(){super.onAttachedToWindow();if(active)invalidate();}
    @Override protected void onWindowVisibilityChanged(int visibility){super.onWindowVisibilityChanged(visibility);if(visibility==VISIBLE&&active)invalidate();}
  }
