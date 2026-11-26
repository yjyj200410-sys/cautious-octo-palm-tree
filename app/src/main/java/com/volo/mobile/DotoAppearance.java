package com.volo.mobile;

import android.content.*;
import android.graphics.*;
import android.graphics.drawable.Drawable;
import java.io.File;

/** Persisted appearance, shared by native pages and the player canvas. */
final class DotoAppearance {
  static boolean light;
  static int accent,accentInk;
  private static Bitmap wallpaper;
  private static int backdrop;
  private static int brightness=50;
  static boolean playerCover;
  private static int playerBlur=50,playerBrightness=50;
  private static Bitmap playerSource,playerImage,playerPrevious;
  private static long playerFadeStart;
  private static int playerGeneration;
  private static final java.util.concurrent.ExecutorService playerWorker=java.util.concurrent.Executors.newSingleThreadExecutor();
  private static final android.os.Handler main=new android.os.Handler(android.os.Looper.getMainLooper());
  static android.content.SharedPreferences prefs(Context c){return c.getSharedPreferences("appearance",0);}
  static long revision(Context c){return prefs(c).getLong("revision",0);}
  static void changed(Context c){prefs(c).edit().putLong("revision",System.currentTimeMillis()).apply();load(c);}
  static int contrast(int color){return .2126*Color.red(color)+.7152*Color.green(color)+.0722*Color.blue(color)>155?0xff202020:0xfffafafa;}
  static void load(Context c){
    ArtworkLoader.storage(c);
    var p=prefs(c);light=p.getBoolean("light",false);
    DotoDesign.BG=light?0xfff2f2ef:0xff000000;
    DotoDesign.SURFACE=light?0xffe8e8e4:0xff181818;
    DotoDesign.RAISED=light?0xfffafaf7:0xff222222;
    DotoDesign.INK=light?0xff202020:0xfffafafa;
    DotoDesign.PAPER=light?0xff292929:0xffdededb;
    DotoDesign.CARD_SURFACE=light?0xffdeded9:0xff252528;
    DotoDesign.CARD_RAISED=light?0xffdeded9:0xff252528;
    DotoDesign.CARD_MUTED=light?0xff646464:0xffa0a0a0;
    DotoDesign.SUCCESS=light?0xff4ade80:0xff167a3f;
    DotoDesign.CARD_INK=light?0xff202020:0xfffafafa;
    DotoDesign.MUTED=light?0xff646464:0xffa0a0a0;
    DotoDesign.LINE=light?0xffccccc7:0xff303030;
    accent=light?0xff343434:0xfffafafa;
    accentInk=contrast(accent);
    MobileUi.BG=DotoDesign.BG;MobileUi.SURFACE=DotoDesign.SURFACE;MobileUi.INK=DotoDesign.INK;
    MobileUi.MUTED=DotoDesign.MUTED;MobileUi.LINE=DotoDesign.LINE;MobileUi.ACCENT=accent;MobileUi.GREEN=DotoDesign.SUCCESS;
    GlassUi.INK=DotoDesign.INK;GlassUi.MUTED=DotoDesign.MUTED;GlassUi.WARM=accent;
    brightness=p.getInt("background-brightness",50);
    playerCover=true;
    int nextBlur=90;
    if(nextBlur!=playerBlur){playerSource=null;playerImage=null;playerGeneration++;}playerBlur=nextBlur;
    playerBrightness=50;
    backdrop=DotoDesign.BG;
    if("color".equals(p.getString("background","default"))){int chosen=p.getInt("background-color",DotoDesign.BG);backdrop=mix(DotoDesign.BG,chosen,.3f);}
    // Retain the small decoded bitmap until the selected file changes. No per-frame decoding.
    String key=p.getString("background", "default")+p.getLong("wallpaper-revision",0)+":"+p.getInt("background-blur",50);
    if(!key.equals(wallpaperKey)){
      wallpaperKey=key;wallpaper=null;
      if("image".equals(p.getString("background","default")))wallpaper=BitmapFactory.decodeFile(new File(c.getFilesDir(),"appearance-background.jpg").getPath());
      if(wallpaper!=null)wallpaper=blur(wallpaper,p.getInt("background-blur",50));
      // Old frames may still reference the old bitmap; let GC release it safely.
    }
  }
  private static String wallpaperKey="";
  private static int mix(int a,int b,float t){return Color.rgb(Math.round(Color.red(a)*(1-t)+Color.red(b)*t),Math.round(Color.green(a)*(1-t)+Color.green(b)*t),Math.round(Color.blue(a)*(1-t)+Color.blue(b)*t));}
  static void draw(Canvas canvas,float width,float height){
    canvas.drawColor(backdrop);
    if(wallpaper==null||wallpaper.isRecycled())return;
    float scale=Math.max(width/wallpaper.getWidth(),height/wallpaper.getHeight());
    float w=wallpaper.getWidth()*scale,h=wallpaper.getHeight()*scale;
    Paint paint=new Paint(3);canvas.drawBitmap(wallpaper,null,new RectF((width-w)/2,(height-h)/2,(width+w)/2,(height+h)/2),paint);
    paint.setColor(Color.argb(Math.round(255*(1-brightness/100f)),0,0,0));canvas.drawRect(0,0,width,height,paint);
  }
  static void drawPlayer(Canvas canvas,float width,float height,Bitmap cover,Runnable invalidate){
    
    if(cover!=null&&!cover.isRecycled()&&playerSource!=cover){
      playerSource=cover;int generation=++playerGeneration;int amount=playerBlur;
      playerWorker.submit(()->{Bitmap image=blur(cover,amount);main.post(()->{if(generation==playerGeneration){playerPrevious=playerImage;playerImage=image;playerFadeStart=android.os.SystemClock.uptimeMillis();invalidate.run();}});});
    }
    Bitmap image=playerImage;
    if(image==null){canvas.drawColor(Color.BLACK);return;}
    float t=Math.min(1,(android.os.SystemClock.uptimeMillis()-playerFadeStart)/520f);
    float eased=t*t*(3-2*t);
    if(playerPrevious!=null&&!playerPrevious.isRecycled())drawPlayerImage(canvas,width,height,playerPrevious,255);
    else canvas.drawColor(Color.BLACK);
    drawPlayerImage(canvas,width,height,image,Math.round(255*eased));
    Paint shade=new Paint();shade.setColor(Color.argb(Math.round(255*(1-playerBrightness/100f)),0,0,0));canvas.drawRect(0,0,width,height,shade);
    if(t<1)invalidate.run();else playerPrevious=null;
  }
  private static void drawPlayerImage(Canvas canvas,float width,float height,Bitmap image,int alpha){
    float scale=Math.max(width/image.getWidth(),height/image.getHeight());float w=image.getWidth()*scale,h=image.getHeight()*scale;
    Paint paint=new Paint(3);paint.setAlpha(alpha);canvas.drawBitmap(image,null,new RectF((width-w)/2,(height-h)/2,(width+w)/2,(height+h)/2),paint);
  }
  private static Bitmap blur(Bitmap source,int amount){
    if(amount<=0)return source;
    float scale=Math.min(1,360f/Math.max(source.getWidth(),source.getHeight()));
    Bitmap small=Bitmap.createScaledBitmap(source,Math.max(1,Math.round(source.getWidth()*scale)),Math.max(1,Math.round(source.getHeight()*scale)),true);
    int w=small.getWidth(),h=small.getHeight(),radius=Math.max(1,amount/4);int[] pixels=new int[w*h],temp=new int[w*h];small.getPixels(pixels,0,w,0,0,w,h);
    for(int pass=0;pass<3;pass++){
      for(int y=0;y<h;y++)for(int x=0;x<w;x++){int r=0,g=0,b=0,count=0;for(int k=Math.max(0,x-radius);k<=Math.min(w-1,x+radius);k++){int color=pixels[y*w+k];r+=Color.red(color);g+=Color.green(color);b+=Color.blue(color);count++;}temp[y*w+x]=Color.rgb(r/count,g/count,b/count);}
      for(int y=0;y<h;y++)for(int x=0;x<w;x++){int r=0,g=0,b=0,count=0;for(int k=Math.max(0,y-radius);k<=Math.min(h-1,y+radius);k++){int color=temp[k*w+x];r+=Color.red(color);g+=Color.green(color);b+=Color.blue(color);count++;}pixels[y*w+x]=Color.rgb(r/count,g/count,b/count);}
    }
    return Bitmap.createBitmap(pixels,w,h,Bitmap.Config.ARGB_8888);
  }
  static Drawable background(){return new Drawable(){public void draw(Canvas c){int saved=c.save();c.translate(getBounds().left,getBounds().top);DotoAppearance.draw(c,getBounds().width(),getBounds().height());c.restoreToCount(saved);}public void setAlpha(int a){}public void setColorFilter(ColorFilter f){}public int getOpacity(){return PixelFormat.OPAQUE;}};}
}
