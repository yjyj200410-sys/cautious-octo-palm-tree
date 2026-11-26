package com.volo.mobile;

import android.app.*;
import android.content.*;
import android.content.res.ColorStateList;
import android.graphics.*;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.io.*;

/** A real settings destination: only playback preload and appearance controls. */
public final class SettingsActivity extends Activity {
  private PlaybackService service;
  private boolean bound;
  private final ServiceConnection connection=new ServiceConnection(){
    public void onServiceConnected(ComponentName n,IBinder b){service=((PlaybackService.LocalBinder)b).get();}
    public void onServiceDisconnected(ComponentName n){service=null;}
  };
  private int dp(float n){return MobileUi.dp(this,n);}
  public void onCreate(Bundle state){
    super.onCreate(state);
    if (android.os.Build.VERSION.SDK_INT >= 34) {
      overrideActivityTransition(OVERRIDE_TRANSITION_OPEN, R.anim.settings_enter_left, R.anim.settings_still);
      overrideActivityTransition(OVERRIDE_TRANSITION_CLOSE, R.anim.settings_still, R.anim.settings_exit_left);
    }
    DotoAppearance.load(this);getWindow().setDecorFitsSystemWindows(false);hideStatusBar();
    bound=bindService(new Intent(this,PlaybackService.class),connection,Context.BIND_AUTO_CREATE);
    buildPage();
  }
  private void buildPage(){
    FrameLayout stage=new FrameLayout(this);
    getWindow().setStatusBarColor(Color.TRANSPARENT);getWindow().setNavigationBarColor(Color.TRANSPARENT);
    LinearLayout root=MobileUi.column(this);stage.addView(root,new FrameLayout.LayoutParams(-1,-1));root.setBackgroundColor(Color.TRANSPARENT);root.setClipChildren(false);root.setClipToPadding(false);stage.setClipChildren(false);stage.setClipToPadding(false);
    stage.setOnApplyWindowInsetsListener((v,insets)->{
      android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.ime());
      android.graphics.Insets safe = insets.getInsetsIgnoringVisibility(
          WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
      v.setPadding(dp(20)+safe.left,bars.top,dp(20)+safe.right,bars.bottom);applyBars();return insets;
    });
    LinearLayout header=new LinearLayout(this);header.setGravity(Gravity.CENTER_VERTICAL);
    GlassUi.Symbol back=new GlassUi.Symbol(this,"close","退出设置",this::finish);DotoDesign.roundGlass(back,root);
    header.addView(back,new LinearLayout.LayoutParams(dp(48),dp(48)));
    FrameLayout.LayoutParams hp=new FrameLayout.LayoutParams(-2,dp(48),Gravity.TOP|Gravity.LEFT);hp.topMargin=dp(20);stage.addView(header,hp);
    ThemeSwitch theme = new ThemeSwitch(this, this::refreshAppearance);
    FrameLayout.LayoutParams themeParams = new FrameLayout.LayoutParams(dp(48), dp(48),
        Gravity.TOP | Gravity.RIGHT);
    themeParams.topMargin = dp(20);
    stage.addView(theme, themeParams);

    ScrollView scroll=new ScrollView(this);scroll.setVerticalScrollBarEnabled(false);scroll.setClipToPadding(false);scroll.setClipChildren(false);
    LinearLayout content=MobileUi.column(this);content.setPadding(0,dp(88),0,dp(32));content.setClipChildren(false);content.setClipToPadding(false);scroll.addView(content);
    root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));

    TextView pageTitle = GlassUi.label(this, "设置", 34, true);
    pageTitle.setPadding(dp(2), 0, 0, dp(14));
    content.addView(pageTitle);

    boolean wide = getResources().getConfiguration().orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
        && getResources().getConfiguration().screenWidthDp >= 640;
    LinearLayout playbackColumn = content;
    LinearLayout appearanceColumn = content;
    if (wide) {
      LinearLayout columns = new LinearLayout(this);
      content.addView(columns, new LinearLayout.LayoutParams(-1,-2));
      playbackColumn = MobileUi.column(this);
      appearanceColumn = MobileUi.column(this);
      LinearLayout.LayoutParams left = new LinearLayout.LayoutParams(0,-2,1);
      left.setMarginEnd(dp(16));
      columns.addView(playbackColumn,left);
      columns.addView(appearanceColumn,new LinearLayout.LayoutParams(0,-2,1));
    }
    LinearLayout playback = group(playbackColumn, "播放");
    Switch preload = new Switch(this);
    preload.setText("预加载分轨");
    preload.setTextSize(16);
    preload.setTextColor(DotoDesign.INK);
    DotoDesign.toggle(preload);
    styleSwitch(this, preload);
    preload.setChecked(getSharedPreferences("playback-settings",0).getBoolean("preload-stems",false));
    preload.setOnCheckedChangeListener((b,on)->{if(service!=null)service.stems.setEnabled(on);else getSharedPreferences("playback-settings",0).edit().putBoolean("preload-stems",on).apply();});
    playback.addView(preload,new LinearLayout.LayoutParams(-1,dp(52)));

    TextView detail = GlassUi.label(this, "在后台准备当前和下一首歌的人声、伴奏", 13, false);
    detail.setTextColor(DotoDesign.MUTED);
    playback.addView(detail);
    addToggle(playback, "与其他音频共同播放", PlaybackService.mixAudio(this), on ->
        getSharedPreferences("playback-settings", 0).edit()
            .putBoolean(PlaybackService.MIX_AUDIO, on).apply());
    LinearLayout background = group(appearanceColumn, "壁纸");
    FrameLayout preview = new FrameLayout(this);
    preview.setBackground(DotoDesign.shape(this, DotoDesign.BG, 14));
    preview.setClipToOutline(true);
    View sample = new View(this);
    sample.setBackground(DotoAppearance.background());
    preview.addView(sample, new FrameLayout.LayoutParams(-1, -1));
    String mode = DotoAppearance.prefs(this).getString("background", "default");
    String name = mode.equals("video") ? "视频背景" : mode.equals("image") ? "自定义图片" : mode.equals("color") ? "自定义颜色" : "默认背景";
    TextView current = GlassUi.label(this, name, 12, true);
    current.setTextColor(Color.WHITE);
    current.setBackground(DotoDesign.shape(this, 0xaa161616, 12));
    current.setPadding(dp(10), dp(4), dp(10), dp(4));
    FrameLayout.LayoutParams badge = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.START);
    badge.setMarginStart(dp(10));
    badge.bottomMargin = dp(10);
    preview.addView(current, badge);
    background.addView(preview, new LinearLayout.LayoutParams(-1, dp(78)));
    addButton(background,"选择背景图片",()->startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE),41));
    addButton(background,"自定义背景颜色",()->colorPicker(true));
    addButton(background,"选择背景视频", () -> startActivityForResult(
        new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("video/*").addCategory(Intent.CATEGORY_OPENABLE), 42));
    addButton(background,"恢复默认背景",()->{DotoAppearance.prefs(this).edit().putString("background","default").apply();refreshAppearance();});
    backgroundSlider(background,"模糊","background-blur",stage);
    backgroundSlider(background,"亮度","background-brightness",stage);
    header.bringToFront();theme.bringToFront();setContentView(new WallpaperLayout(this, stage));DotoDesign.enter(content);
  }
  @Override public void finish() {
    super.finish();
    if (android.os.Build.VERSION.SDK_INT < 34)
      overridePendingTransition(R.anim.settings_still, R.anim.settings_exit_left);
  }

  static Switch addToggle(LinearLayout parent, String title, boolean checked,
      java.util.function.Consumer<Boolean> changed) {
    Context context = parent.getContext();
    Switch control = new Switch(context);
    control.setText(title);
    control.setTextSize(16);
    control.setTextColor(DotoDesign.INK);
    DotoDesign.toggle(control);
    styleSwitch(context, control);
    control.setChecked(checked);
    control.setOnCheckedChangeListener((button, on) -> changed.accept(on));
    parent.addView(control, new LinearLayout.LayoutParams(-1, -2));
    control.setMinHeight(MobileUi.dp(context, 52));
    return control;
  }

  private static void styleSwitch(Context context, Switch control){
    android.graphics.drawable.StateListDrawable track=new android.graphics.drawable.StateListDrawable();
    android.graphics.drawable.GradientDrawable on=DotoDesign.shape(context,DotoAppearance.accent,16);on.setSize(MobileUi.dp(context, 51),MobileUi.dp(context, 31));
    android.graphics.drawable.GradientDrawable off=DotoDesign.shape(context,(DotoAppearance.light?0xffbcbcc0:0xff55555a),16);off.setSize(MobileUi.dp(context, 51),MobileUi.dp(context, 31));
    track.addState(new int[]{android.R.attr.state_checked},on);track.addState(new int[]{},off);
    android.graphics.drawable.GradientDrawable knob=DotoDesign.shape(context,Color.WHITE,14);knob.setSize(MobileUi.dp(context, 27),MobileUi.dp(context, 27));knob.setStroke(MobileUi.dp(context, 1),0x18000000);
    control.setTrackTintList(null);control.setThumbTintList(null);control.setTrackDrawable(track);
    android.graphics.drawable.StateListDrawable thumbs=new android.graphics.drawable.StateListDrawable();
    android.graphics.drawable.GradientDrawable activeKnob=DotoDesign.shape(context,DotoAppearance.accentInk,14);activeKnob.setSize(MobileUi.dp(context, 27),MobileUi.dp(context, 27));activeKnob.setStroke(MobileUi.dp(context, 1),0x18000000);
    thumbs.addState(new int[]{android.R.attr.state_checked},new android.graphics.drawable.InsetDrawable(activeKnob,MobileUi.dp(context, 2)));
    thumbs.addState(new int[]{},new android.graphics.drawable.InsetDrawable(knob,MobileUi.dp(context, 2)));
    control.setThumbDrawable(thumbs);
    control.setSwitchMinWidth(MobileUi.dp(context, 51));control.setSwitchPadding(MobileUi.dp(context, 12));control.setSplitTrack(false);control.setShowText(false);
  }
  private void styleSlider(SeekBar slider){
    android.graphics.drawable.GradientDrawable base=DotoDesign.shape(this,(DotoAppearance.light?0xffbcbcc0:0xff55555a),3);
    android.graphics.drawable.ClipDrawable progress=new android.graphics.drawable.ClipDrawable(DotoDesign.shape(this,DotoAppearance.accent,3),Gravity.LEFT,android.graphics.drawable.ClipDrawable.HORIZONTAL);
    android.graphics.drawable.LayerDrawable layers=new android.graphics.drawable.LayerDrawable(new android.graphics.drawable.Drawable[]{base,progress});
    layers.setId(0,android.R.id.background);layers.setId(1,android.R.id.progress);
    for(int i=0;i<2;i++){layers.setLayerHeight(i,dp(5));layers.setLayerGravity(i,Gravity.CENTER_VERTICAL|Gravity.FILL_HORIZONTAL);}
    slider.setProgressTintList(null);slider.setProgressBackgroundTintList(null);slider.setThumbTintList(null);slider.setProgressDrawable(layers);
    android.graphics.drawable.GradientDrawable knob=DotoDesign.shape(this,Color.WHITE,14);knob.setSize(dp(28),dp(28));knob.setStroke(dp(1),0x22000000);slider.setThumb(knob);slider.setThumbOffset(dp(14));slider.setSplitTrack(false);slider.setPadding(dp(16),0,dp(16),0);
  }  private void backgroundSlider(LinearLayout parent,String title,String key,View stage){
    int value=DotoAppearance.prefs(this).getInt(key,50);
    TextView label=GlassUi.label(this,title+" · "+value,14,false);label.setTextColor(DotoDesign.INK);label.setPadding(0,dp(12),0,0);parent.addView(label);
    SeekBar slider=new SeekBar(this);slider.setMax(100);slider.setProgress(value);slider.setContentDescription(title);slider.setProgressTintList(ColorStateList.valueOf(DotoAppearance.accent));slider.setThumbTintList(ColorStateList.valueOf(DotoAppearance.accent));styleSlider(slider);parent.addView(slider,new LinearLayout.LayoutParams(-1,dp(48)));
    slider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){
      public void onStartTrackingTouch(SeekBar b){}
      public void onProgressChanged(SeekBar b,int progress,boolean user){label.setText(title+" · "+progress);}
      public void onStopTrackingTouch(SeekBar b){DotoAppearance.prefs(SettingsActivity.this).edit().putInt(key,b.getProgress()).apply();DotoAppearance.changed(SettingsActivity.this);if (stage.getParent() instanceof WallpaperLayout wallpaper) wallpaper.refresh();parent.invalidate();}
    });
  }
  private void hideStatusBar(){WindowInsetsController controller=getWindow().getDecorView().getWindowInsetsController();if(controller!=null){controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);controller.hide(WindowInsets.Type.statusBars());}}
  public void onWindowFocusChanged(boolean focused){super.onWindowFocusChanged(focused);if(focused)hideStatusBar();}
  private void applyBars(){WindowInsetsController c=getWindow().getInsetsController();if(c!=null)c.setSystemBarsAppearance(DotoAppearance.light?WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS:0,WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);}
  private LinearLayout group(LinearLayout parent, String title) {
    TextView label = GlassUi.label(this, title, 14, true);
    label.setTextColor(DotoDesign.INK);
    label.setPadding(dp(4), dp(8), 0, dp(8));
    parent.addView(label);
    LinearLayout group = MobileUi.column(this);
    group.setPadding(dp(16), dp(12), dp(16), dp(16));
    group.setBackground(DotoDesign.shape(this, DotoDesign.CARD_SURFACE, 20));
    LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
    params.bottomMargin = dp(8);
    parent.addView(group, params);
    return group;
  }

  private void addButton(LinearLayout parent, String title, Runnable action) {
    LinearLayout row = new LinearLayout(this);
    row.setGravity(Gravity.CENTER_VERTICAL);
    TextView text = GlassUi.label(this, title, 15, false);
    row.addView(text, new LinearLayout.LayoutParams(0, -2, 1));
    ImageView arrow = new ImageView(this);
    arrow.setImageDrawable(new DotoIcon("next", DotoDesign.MUTED));
    row.addView(arrow, new LinearLayout.LayoutParams(dp(16), dp(16)));
    row.setContentDescription(title);
    GlassUi.touch(row, action);
    parent.addView(row, new LinearLayout.LayoutParams(-1, dp(48)));
    View divider = new View(this);
    divider.setBackgroundColor(DotoDesign.LINE);
    parent.addView(divider, new LinearLayout.LayoutParams(-1, 1));
  }
  private void refreshAppearance(){
    ViewGroup host=findViewById(android.R.id.content);View old=host.getChildAt(0);
    Bitmap snapshot=null;int scrollY=0;
    if(old!=null&&old.getWidth()>0&&old.getHeight()>0){snapshot=Bitmap.createBitmap(old.getWidth(),old.getHeight(),Bitmap.Config.ARGB_8888);old.draw(new Canvas(snapshot));scrollY=findScroll(old);}
    DotoAppearance.changed(this);sendBroadcast(new Intent("com.volo.mobile.APPEARANCE_CHANGED").setPackage(getPackageName()));buildPage();
    View page=host.getChildAt(0);restoreScroll(page,scrollY);
    if(snapshot!=null&&page instanceof FrameLayout stage){
      Bitmap image=snapshot;ImageView overlay=new ImageView(this);overlay.setScaleType(ImageView.ScaleType.FIT_XY);overlay.setImageBitmap(image);
      android.view.ViewGroupOverlay layer=stage.getOverlay();overlay.layout(0,0,image.getWidth(),image.getHeight());layer.add(overlay);
      overlay.animate().alpha(0).setDuration(420).setInterpolator(new android.view.animation.AccelerateDecelerateInterpolator()).withEndAction(()->{layer.remove(overlay);overlay.setImageDrawable(null);image.recycle();}).start();
    }
  }
  private int findScroll(View view){if(view instanceof ScrollView)return view.getScrollY();if(view instanceof ViewGroup group)for(int i=0;i<group.getChildCount();i++){int value=findScroll(group.getChildAt(i));if(value!=0)return value;}return 0;}
  private void restoreScroll(View view,int y){if(view instanceof ScrollView scroll)scroll.post(()->scroll.scrollTo(0,y));else if(view instanceof ViewGroup group)for(int i=0;i<group.getChildCount();i++)restoreScroll(group.getChildAt(i),y);}

  private void colorPicker(boolean background){
    int initial=background?DotoAppearance.prefs(this).getInt("background-color",DotoDesign.BG):DotoAppearance.accent;
    LinearLayout form=MobileUi.column(this);form.setPadding(dp(20),dp(8),dp(20),dp(12));
    View preview=new View(this);form.addView(preview,new LinearLayout.LayoutParams(-1,dp(48)));
    EditText hex=new EditText(this);DotoDesign.input(hex);hex.setSingleLine();hex.setHint("#RRGGBB");hex.setText(String.format(java.util.Locale.ROOT,"#%06X",initial&0xffffff));
    LinearLayout.LayoutParams hp=new LinearLayout.LayoutParams(-1,dp(48));hp.topMargin=dp(12);form.addView(hex,hp);
    int[] rgb={Color.red(initial),Color.green(initial),Color.blue(initial)};boolean[] updating={false};SeekBar[] sliders=new SeekBar[3];
    String[] names={"红","绿","蓝"};
    for(int i=0;i<3;i++){
      final int channel=i;form.addView(GlassUi.label(this,names[i],12,false));
      SeekBar slider=new SeekBar(this);sliders[i]=slider;slider.setMax(255);slider.setProgress(rgb[i]);slider.setContentDescription(names[i]+"色分量");slider.setProgressTintList(ColorStateList.valueOf(DotoAppearance.accent));slider.setThumbTintList(ColorStateList.valueOf(DotoAppearance.accent));styleSlider(slider);
      form.addView(slider,new LinearLayout.LayoutParams(-1,dp(40)));
      slider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){public void onStartTrackingTouch(SeekBar b){}public void onStopTrackingTouch(SeekBar b){}public void onProgressChanged(SeekBar b,int value,boolean user){if(!user||updating[0])return;rgb[channel]=value;int color=Color.rgb(rgb[0],rgb[1],rgb[2]);hex.setText(String.format(java.util.Locale.ROOT,"#%06X",color&0xffffff));}});
    }
    preview.setBackground(DotoDesign.shape(this,initial,12));
    hex.addTextChangedListener(new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int st,int count,int after){}public void onTextChanged(CharSequence s,int st,int before,int count){if(!s.toString().matches("#[0-9a-fA-F]{6}"))return;int color=Color.parseColor(s.toString());preview.setBackground(DotoDesign.shape(SettingsActivity.this,color,12));updating[0]=true;rgb[0]=Color.red(color);rgb[1]=Color.green(color);rgb[2]=Color.blue(color);for(int i=0;i<3;i++)sliders[i].setProgress(rgb[i]);updating[0]=false;}public void afterTextChanged(android.text.Editable e){}});
    AlertDialog dialog=new DotoDesign.DialogBuilder(this).setTitle(background?"背景颜色":"强调色").setView(form).setNegativeButton("取消",null).setPositiveButton("应用",null).create();
    dialog.show();dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
      if(!hex.getText().toString().matches("#[0-9a-fA-F]{6}")){hex.setError("请输入 #RRGGBB 格式颜色");return;}
      int value=Color.parseColor(hex.getText().toString());
      var edit=DotoAppearance.prefs(this).edit();if(background)edit.putString("background","color").putInt("background-color",value);else edit.putInt("accent",value);edit.apply();dialog.dismiss();refreshAppearance();
    });
  }
  protected void onActivityResult(int request,int result,Intent data){
    super.onActivityResult(request, result, data);
    if (result != RESULT_OK || data == null || data.getData() == null) return;
    if (request == 42) {
      Uri video = data.getData();
      try {
        getContentResolver().takePersistableUriPermission(video, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        DotoAppearance.prefs(this).edit().putString("wallpaper-video-uri", video.toString())
            .putString("background", "video").apply();
        refreshAppearance();
      } catch (SecurityException error) {
        Toast.makeText(this, "无法读取此视频", Toast.LENGTH_SHORT).show();
      }
      return;
    }
    if (request != 41) return;
    Uri uri=data.getData();Toast.makeText(this,"正在准备背景图片",Toast.LENGTH_SHORT).show();
    new Thread(()->{try{
      BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;
      try(InputStream in=getContentResolver().openInputStream(uri)){BitmapFactory.decodeStream(in,null,options);}
      if(options.outWidth<=0||options.outHeight<=0)throw new IOException("无法读取图片");
      options.inSampleSize=1;while(Math.max(options.outWidth,options.outHeight)/options.inSampleSize>1800)options.inSampleSize*=2;options.inJustDecodeBounds=false;
      Bitmap bitmap;try(InputStream in=getContentResolver().openInputStream(uri)){bitmap=BitmapFactory.decodeStream(in,null,options);}
      if(bitmap==null)throw new IOException("图片解码失败");
      File temp=new File(getFilesDir(),"appearance-background.tmp");try(FileOutputStream out=new FileOutputStream(temp)){if(!bitmap.compress(Bitmap.CompressFormat.JPEG,90,out))throw new IOException("图片保存失败");}finally{bitmap.recycle();}
      java.nio.file.Files.move(temp.toPath(),new File(getFilesDir(),"appearance-background.jpg").toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);
      runOnUiThread(()->{if(isFinishing()||isDestroyed())return;DotoAppearance.prefs(this).edit().putString("background","image").putLong("wallpaper-revision",System.currentTimeMillis()).apply();refreshAppearance();});
    }catch(Exception e){android.util.Log.w("DotoBackground","Background import failed",e);runOnUiThread(()->Toast.makeText(this,"无法设置背景："+e.getMessage(),Toast.LENGTH_LONG).show());}},"Doto-background").start();
  }
  protected void onDestroy(){if(bound)unbindService(connection);super.onDestroy();}

  static final class ThemeSwitch extends View {
    private final Paint paint=new Paint(3);
    private final Path shape=new Path();
    private final Runnable onChanged;
    private float position=DotoAppearance.light?0:1;
    private android.animation.ValueAnimator motion;
    ThemeSwitch(Context context,Runnable onChanged){super(context);this.onChanged=onChanged;setFocusable(true);setClickable(true);setContentDescription(DotoAppearance.light?"切换为深色模式":"切换为浅色模式");setOnClickListener(v->choose());}
    private void choose(){
      if(motion!=null&&motion.isRunning())return;
      boolean light=!DotoAppearance.light;float target=light?0:1;
      motion=android.animation.ValueAnimator.ofFloat(position,target);
      motion.setDuration(android.animation.ValueAnimator.areAnimatorsEnabled()?460:0);
      motion.setInterpolator(new android.view.animation.PathInterpolator(.4f,0,.2f,1));
      motion.addUpdateListener(a->{position=(float)a.getAnimatedValue();invalidate();});
      motion.addListener(new android.animation.AnimatorListenerAdapter(){private boolean cancelled; public void onAnimationCancel(android.animation.Animator a){cancelled=true;} public void onAnimationEnd(android.animation.Animator a){if(cancelled)return; var prefs=DotoAppearance.prefs(getContext()); prefs.edit().putBoolean("light",light).putLong("revision",DotoAppearance.revision(getContext())+1).apply();setContentDescription(light?"切换为深色模式":"切换为浅色模式");onChanged.run();}});motion.start();
    }
    protected void onDraw(Canvas canvas){
      super.onDraw(canvas);canvas.save();canvas.translate(getWidth()/2f,getHeight()/2f);float density=getResources().getDisplayMetrics().density;canvas.scale(density,density);
      paint.setColor(DotoDesign.INK);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(1.8f);paint.setStrokeCap(Paint.Cap.ROUND);paint.setStrokeJoin(Paint.Join.ROUND);
      float t=position;canvas.rotate(-25*t);canvas.translate(2.5f*t,0);
      // The right-hand circle contour bends inward to form the crescent.
      float k=4.42f,inner=8-12*t;
      shape.reset();shape.moveTo(0,-8);shape.cubicTo(-k,-8,-8,-k,-8,0);shape.cubicTo(-8,k,-k,8,0,8);
      shape.cubicTo(k*(1-t),8,inner,k,inner,0);shape.cubicTo(inner,-k,k*(1-t),-8,0,-8);shape.close();canvas.drawPath(shape,paint);
      paint.setAlpha(Math.round(255*(1-t)));
      for(int ray=0;ray<8;ray++){double angle=ray*Math.PI/4;float r=10+2*t;canvas.drawLine((float)Math.cos(angle)*r,(float)Math.sin(angle)*r,(float)Math.cos(angle)*(13-1*t),(float)Math.sin(angle)*(13-1*t),paint);}
      paint.setAlpha(255);canvas.restore();
    }
    protected void onDetachedFromWindow(){if(motion!=null)motion.cancel();super.onDetachedFromWindow();}
  }

  enum Kind{ENTRY,BACK,PRELOAD,THEME,ACCENT,BACKGROUND}
  /** Newly drawn settings-only symbols; intentionally independent of DotoIcon. */
  static final class Glyph extends View {
    private final Kind kind;private final Paint p=new Paint(3);private final Path path=new Path();
    Glyph(Context context,Kind kind){super(context);this.kind=kind;}
    private void line(Canvas c,float... v){path.reset();path.moveTo(v[0],v[1]);for(int i=2;i<v.length;i+=2)path.lineTo(v[i],v[i+1]);c.drawPath(path,p);}
    protected void onDraw(Canvas c){int save=c.save();float size=Math.min(getWidth(),getHeight())*(kind==Kind.ENTRY||kind==Kind.BACK?.62f:.9f);c.translate(getWidth()/2f,getHeight()/2f);c.scale(size/28,size/28);p.setColor(DotoAppearance.accent);p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(1.9f);p.setStrokeCap(Paint.Cap.ROUND);p.setStrokeJoin(Paint.Join.ROUND);
      switch(kind){
        case ENTRY->{line(c,-9,-6,9,-6);line(c,-9,0,9,0);line(c,-9,6,9,6);}
        case BACK->{path.reset();path.moveTo(4,-8);path.quadTo(-1,-5,-5,0);path.quadTo(-1,5,4,8);c.drawPath(path,p);}
        case PRELOAD->{c.drawRoundRect(-11,-10,3,10,4,4,p);line(c,-6,-3,-6,3);line(c,-9,0,-3,0);line(c,8,-9,8,1);line(c,5,-2,8,1,11,-2);line(c,5,8,11,8);}
        case THEME->{c.drawCircle(0,0,9,p);path.reset();path.addArc(-9,-9,9,9,-90,180);path.close();p.setStyle(Paint.Style.FILL);c.drawPath(path,p);p.setStyle(Paint.Style.STROKE);line(c,0,-14,0,-12);line(c,12,0,14,0);line(c,0,12,0,14);line(c,-14,0,-12,0);}
        case ACCENT->{path.reset();path.moveTo(0,-12);path.cubicTo(-3,-6,-9,-1,-9,4);path.cubicTo(-9,15,9,15,9,4);path.cubicTo(9,-1,3,-6,0,-12);c.drawPath(path,p);line(c,-4,4,-4,6);}
        case BACKGROUND->{c.drawRoundRect(-12,-10,12,10,4,4,p);c.drawCircle(5,-4,2,p);path.reset();path.moveTo(-10,7);path.lineTo(-4,-1);path.lineTo(1,5);path.lineTo(5,1);path.lineTo(10,7);c.drawPath(path,p);}
      }c.restoreToCount(save);
    }
  }
}
