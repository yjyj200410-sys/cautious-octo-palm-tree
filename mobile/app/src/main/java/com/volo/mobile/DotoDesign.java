package com.volo.mobile;

import android.app.*;
import android.content.*;
import android.content.res.ColorStateList;
import android.graphics.*;
import android.graphics.drawable.*;
import android.view.*;
import android.widget.*;

/** Doto's monochrome materials, controls and motion outside the player canvas. */
final class DotoDesign {
  static final int PAGE_GUTTER = 20;
  static int BG=0xff000000, SURFACE=0xff181818, RAISED=0xff222222,
      INK=0xfffafafa, PAPER=0xffdededb, CARD_INK=0xff202020, CARD_SURFACE=0xffe5e5e1, CARD_RAISED=0xffeeeeea, CARD_MUTED=0xff666666, DARK=0xff202020, MUTED=0xffa0a0a0,
      LINE=0xff303030, SUCCESS=0xff4ade80, FAVORITE=0xffff3438;
  static int dp(Context c,float value){return MobileUi.dp(c,value);}
  static GradientDrawable shape(Context c,int color,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(c,radius));return d;}
  static void floatingHeader(View view){
    Context c=view.getContext();
    GradientDrawable glass=new GradientDrawable(GradientDrawable.Orientation.TL_BR,
      DotoAppearance.light?new int[]{0xeefafaf7,0xccf2f2ef}:new int[]{0xe6333333,0xcc151515});
    glass.setCornerRadius(dp(c,32));glass.setStroke(dp(c,.7f),DotoAppearance.light?0x55ffffff:0x44ffffff);
    view.setBackground(glass);view.setElevation(dp(c,8));view.setPadding(dp(c,12),0,dp(c,10),0);
    GlassUi.rounded(view,32);
  }
  static void roundGlass(View host,View content){
    shapedGlass(host, content, (path, bounds) -> {
      bounds.inset(dp(host.getContext(), 4), dp(host.getContext(), 4));
      path.addRoundRect(bounds, bounds.height() / 2, bounds.height() / 2, Path.Direction.CW);
    }, false);
  }
  static void shapedGlass(View host, View content, java.util.function.BiConsumer<Path, RectF> shape, boolean topBorderOnly) {
    shapedGlass(host, content, shape, topBorderOnly, true);
  }

  static void shapedGlass(View host, View content, java.util.function.BiConsumer<Path, RectF> shape,
      boolean topBorderOnly, boolean gradient) {
    host.setPadding(0,0,0,0);host.setElevation(0);host.setClipToOutline(false);
    host.setBackground(new Drawable(){
      final RenderNode backdrop=new RenderNode("Doto realtime frosted backdrop");
      final Paint paint=new Paint(3);final Path clip=new Path();final int[] a=new int[2],b=new int[2];
      {backdrop.setClipToBounds(true);backdrop.setRenderEffect(RenderEffect.createBlurEffect(dp(host.getContext(),8),dp(host.getContext(),8),Shader.TileMode.CLAMP));}
      public void draw(Canvas canvas){
        RectF circle=new RectF(getBounds());
        int saved=canvas.save();clip.reset();shape.accept(clip, circle);canvas.clipPath(clip);
        if(canvas.isHardwareAccelerated()&&host.getWidth()>0&&host.getHeight()>0){
          host.getLocationOnScreen(a);content.getLocationOnScreen(b);
          backdrop.setPosition(0,0,host.getWidth(),host.getHeight());
          RecordingCanvas recording=backdrop.beginRecording(host.getWidth(),host.getHeight());
          try{
            recording.translate(b[0]-a[0],b[1]-a[1]);
            DotoAppearance.draw(recording,content.getWidth(),content.getHeight());
            content.draw(recording);
          }finally{backdrop.endRecording();}
          canvas.drawRenderNode(backdrop);
        }
        paint.setStyle(Paint.Style.FILL);paint.setColor(DotoAppearance.light?0xaaf6f6f3:0x99262626);canvas.drawPath(clip,paint);
        if (gradient) {
          paint.setShader(new LinearGradient(circle.left,circle.top,circle.right,circle.bottom,0x30ffffff,0x00ffffff,Shader.TileMode.CLAMP));canvas.drawPath(clip,paint);paint.setShader(null);
        }
        canvas.restoreToCount(saved);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(dp(host.getContext(),.7f));paint.setColor(0x55ffffff);
        int border = canvas.save();
        if (topBorderOnly) {
          float edge = paint.getStrokeWidth();
          canvas.clipRect(circle.left + edge, circle.top, circle.right - edge, circle.bottom - edge);
        }
        canvas.drawPath(clip, paint);
        canvas.restoreToCount(border);
      }
      public void setAlpha(int a){}public void setColorFilter(ColorFilter f){}public int getOpacity(){return PixelFormat.TRANSLUCENT;}
    });
    host.getViewTreeObserver().addOnScrollChangedListener(host::invalidate);
    host.getViewTreeObserver().addOnPreDrawListener(()->{if(content.isDirty()&&host.isShown())host.invalidate();return true;});
  }
  static Drawable surface(Context c,int radius){return new Material(c,radius,false);}
  static Drawable paper(Context c,int radius){return new Material(c,radius,true);}
  static void press(View view){
    view.setHapticFeedbackEnabled(false);
    view.setOnTouchListener((v,e)->{
      if(!v.isEnabled())return false;
      boolean down=e.getActionMasked()==MotionEvent.ACTION_DOWN;
      boolean up=e.getActionMasked()==MotionEvent.ACTION_UP||e.getActionMasked()==MotionEvent.ACTION_CANCEL;
      if(down||up){v.animate().cancel();
        v.animate().setStartDelay(0).scaleX(down?.96f:1).scaleY(down?.96f:1)
          .setDuration(android.animation.ValueAnimator.areAnimatorsEnabled()?(down?70:300):0)
          .setInterpolator(down?UiMotion.CURVE:new android.view.animation.OvershootInterpolator(1.8f)).start();
      }return false;
    });
  }
  private static Drawable selectedButton(Context c){GradientDrawable d=shape(c,PAPER,24);d.setStroke(dp(c,1.3f),DotoAppearance.accent);return d;}
  static void button(Button button,String label,boolean primary){
    Context c=button.getContext();button.setAllCaps(false);button.setTextSize(14);
    button.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));
    button.setMinWidth(0);button.setMinimumWidth(0);button.setMinHeight(dp(c,48));button.setMinimumHeight(dp(c,48));
    button.setPadding(dp(c,16),0,dp(c,16),0);button.setStateListAnimator(null);button.setElevation(0);
    button.setTextColor(new ColorStateList(new int[][]{new int[]{-android.R.attr.state_enabled},new int[]{}},new int[]{0xff777777,primary?CARD_INK:INK}));
    button.setBackground(new RippleDrawable(ColorStateList.valueOf(primary?0x16000000:0x22ffffff),primary?selectedButton(c):surface(c,24),null));
    String clean=label.replaceAll("^[‹›▷▶⇄＋⇥✓]+\\s*","");
    button.setText(clean);
    if(!clean.isEmpty()&&clean.length()>1){DotoIcon icon=new DotoIcon(DotoIcon.forLabel(label),primary?CARD_INK:INK);icon.setBounds(0,0,dp(c,19),dp(c,19));button.setCompoundDrawablesRelative(icon,null,null,null);button.setCompoundDrawablePadding(dp(c,8));}
    press(button);
  }
  static void input(EditText input){
    Context c=input.getContext();input.setTextColor(INK);input.setHintTextColor(MUTED);input.setTextSize(15);
    input.setBackground(surface(c,18));input.setPadding(dp(c,16),dp(c,12),dp(c,16),dp(c,12));input.setMinHeight(dp(c,48));
    input.setBackgroundTintList(null);
  }
  static void toggle(CompoundButton toggle){
    toggle.setTextColor(INK);toggle.setMinHeight(dp(toggle.getContext(),48));
    ColorStateList tint=new ColorStateList(new int[][]{new int[]{android.R.attr.state_checked},new int[]{}},new int[]{DotoAppearance.accent,0xff777777});
    toggle.setButtonTintList(tint);
    if(toggle instanceof Switch sw){sw.setThumbTintList(tint);sw.setTrackTintList(ColorStateList.valueOf(0xff555555));sw.setShowText(false);}
    toggle.setHapticFeedbackEnabled(false);
  }
  static void enter(ViewGroup group){
    if(!android.animation.ValueAnimator.areAnimatorsEnabled())return;
    for(int i=0;i<Math.min(8,group.getChildCount());i++){
      View child=group.getChildAt(i);child.animate().cancel();child.setTranslationY(dp(group.getContext(),10));child.setAlpha(.7f);
      child.animate().alpha(1).translationY(0).setStartDelay(i*22L).setDuration(320)
        .setInterpolator(new android.view.animation.OvershootInterpolator(.65f)).withEndAction(()->child.animate().setStartDelay(0)).start();
    }
  }
  static void popup(View panel){
    panel.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener(){
      public void onViewAttachedToWindow(View v){if(!android.animation.ValueAnimator.areAnimatorsEnabled())return;
        v.setPivotX(v.getWidth());v.setPivotY(0);v.setAlpha(0);v.setTranslationY(-dp(v.getContext(),8));
        v.animate().alpha(1).translationY(0).setDuration(240).setInterpolator(UiMotion.CURVE).start();}
      public void onViewDetachedFromWindow(View v){v.animate().cancel();}
    });
  }
  static final class Material extends Drawable {
    private final Paint paint=new Paint(3);private final float radius;private final boolean paper;
    Material(Context c,int radius,boolean paper){this.radius=dp(c,radius);this.paper=paper;}
    public void draw(Canvas canvas){RectF r=new RectF(getBounds());r.inset(.5f,.5f);
      paint.setStyle(Paint.Style.FILL);paint.setColor(paper?PAPER:SURFACE);canvas.drawRoundRect(r,radius,radius,paint);
      paint.setShader(new LinearGradient(r.left,r.top,r.right,r.bottom,
        paper?new int[]{0x00ffffff,0x1cffffff,0x00ffffff}:new int[]{0x08ffffff,0x00ffffff},null,Shader.TileMode.CLAMP));
      canvas.drawRoundRect(r,radius,radius,paint);paint.setShader(null);
      paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(1);paint.setColor(paper?0x30ffffff:LINE);canvas.drawRoundRect(r,radius,radius,paint);paint.setStyle(Paint.Style.FILL);
    }
    public void setAlpha(int a){}public void setColorFilter(ColorFilter f){}public int getOpacity(){return PixelFormat.TRANSLUCENT;}
  }
  static final class DialogBuilder extends AlertDialog.Builder {
    DialogBuilder(Context context){super(new ContextThemeWrapper(context,DotoAppearance.light?android.R.style.Theme_Material_Light_NoActionBar:android.R.style.Theme_Material_NoActionBar));}
    @Override public AlertDialog.Builder setItems(CharSequence[] values,DialogInterface.OnClickListener listener){
      return super.setAdapter(new BaseAdapter(){
        public int getCount(){return values.length;}public Object getItem(int p){return values[p];}public long getItemId(int p){return p;}
        public View getView(int index,View convert,ViewGroup parent){
          Context c=getContext();LinearLayout row=new LinearLayout(c);row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(dp(c,20),dp(c,6),dp(c,20),dp(c,6));row.setMinimumHeight(dp(c,56));
          ImageView icon=new ImageView(c);icon.setImageDrawable(new DotoIcon(DotoIcon.forLabel(values[index].toString()),INK));row.addView(icon,new LinearLayout.LayoutParams(dp(c,22),dp(c,22)));
          TextView label=GlassUi.label(c,values[index].toString(),15,false);label.setPadding(dp(c,16),0,0,0);row.addView(label,new LinearLayout.LayoutParams(0,-2,1));return row;
        }
      },listener);
    }
    @Override public AlertDialog create(){AlertDialog dialog=super.create();dialog.setOnShowListener(d->{
      Window window=dialog.getWindow();if(window==null)return;
      window.setBackgroundDrawable(surface(getContext(),24));window.setDimAmount(.6f);
      window.setLayout(Math.min(dp(getContext(),360),getContext().getResources().getDisplayMetrics().widthPixels-dp(getContext(),32)),-2);
      styleTree(window.getDecorView());
      View decor=window.getDecorView();
      if(android.animation.ValueAnimator.areAnimatorsEnabled()){
        decor.setAlpha(0);decor.setTranslationY(dp(getContext(),12));
        decor.animate().alpha(1).translationY(0).setDuration(280).setInterpolator(UiMotion.CURVE).start();
      }
      for(int id:new int[]{DialogInterface.BUTTON_POSITIVE,DialogInterface.BUTTON_NEGATIVE,DialogInterface.BUTTON_NEUTRAL}){
        Button button=dialog.getButton(id);if(button!=null)DotoDesign.button(button,button.getText().toString(),id==DialogInterface.BUTTON_POSITIVE);
      }
    });return dialog;}
  }
  static void cardTone(View root){
    root.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener(){
      public void onViewAttachedToWindow(View view){applyCardTone(view);view.post(()->applyCardTone(view));}
      public void onViewDetachedFromWindow(View view){}
    });
  }
  private static void applyCardTone(View view){
    if(view instanceof GlassUi.Symbol symbol){view.setBackground((symbol.bare||"moreVertical".equals(symbol.kind)||"more".equals(symbol.kind))?null:surface(view.getContext(),24));if("moreVertical".equals(symbol.kind)){symbol.color=CARD_INK;symbol.invalidate();}}
    if(view instanceof CompoundButton toggle)toggle.setTextColor(CARD_INK);
    else if(view instanceof TextView text&&!(text instanceof Button)&&!(text instanceof EditText)){
      int color=text.getCurrentTextColor();
      if(color==MUTED)text.setTextColor(CARD_MUTED);
      else if(color==INK||color==DARK||color==CARD_INK)text.setTextColor(CARD_INK);
    }
    if(view instanceof ViewGroup group)for(int i=0;i<group.getChildCount();i++)applyCardTone(group.getChildAt(i));
  }
  static Drawable cardSurface(Context context,int radius){
    GradientDrawable drawable=shape(context,CARD_SURFACE,radius);
    drawable.setCornerRadius(dp(context,radius));drawable.setStroke(1,DotoAppearance.light?0xffd3d3ce:0x35ffffff);return drawable;
  }
  static void onPaper(View view){
    if(view instanceof TextView text)text.setTextColor(CARD_INK);
    if(view instanceof ViewGroup group)for(int i=0;i<group.getChildCount();i++)onPaper(group.getChildAt(i));
  }
  static void styleTree(View view){
    if(view instanceof EditText input)input(input);
    else if(view instanceof CompoundButton toggle)toggle(toggle);
    else if(view instanceof TextView text && !(text instanceof Button)){text.setTextColor(INK);text.setHapticFeedbackEnabled(false);}
    if(view instanceof SeekBar seek){seek.setProgressTintList(ColorStateList.valueOf(DotoAppearance.accent));seek.setThumbTintList(ColorStateList.valueOf(DotoAppearance.accent));seek.setMinimumHeight(dp(view.getContext(),48));}
    if(view instanceof ViewGroup group)for(int i=0;i<group.getChildCount();i++)styleTree(group.getChildAt(i));
  }
}
