package com.volo.mobile;

import android.app.Instrumentation;
import android.content.*;
import android.net.Uri;
import android.os.*;
import java.io.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import org.json.*;

/** Device integration checks against the real service/MediaPlayer, without changing screens. */
public final class PlaybackInstrumentation extends Instrumentation {
  private PlaybackService service;
  private int checks;
  private Uri sample;
  private boolean streamOnly,
      photoOnly,
      heartOnly,
      favoriteProbe,
      morphOnly,
      playIconOnly,
      pullSettleOnly,
      capsuleDragOnly;
  private boolean capsuleDirectOnly;
  private boolean blankFavoriteOnly;
  private boolean sketchControlsOnly;
  private boolean capsuleIdleOnly;
  private boolean artworkOnly;
  private boolean layoutOnly;
  private boolean capsuleSidesOnly,
      trackDepthOnly,
      trackProfileOnly,
      trackAutoOnly,
      trackRoundtripOnly;
  private boolean railSelectionOnly, lyricFlipOnly, stemControlOnly, stemHandoffOnly, stemPreloadOnly;
  private String requestedStemMode = "unset";
  private int railQueueSelection = -1;
  private boolean railScrollProbe;
  private String trackProfileLabel = "baseline";
  private final java.util.concurrent.atomic.AtomicInteger swipeNext =
      new java.util.concurrent.atomic.AtomicInteger();
  private final java.util.concurrent.atomic.AtomicInteger swipePrevious =
      new java.util.concurrent.atomic.AtomicInteger();
  private boolean fullPullOnly;
  private boolean rubberNavigationOnly;
  private boolean poseOnly, spatialHoldOnly;
  private String poseCadence = "";
  private android.view.View capsulePointerTarget;
  private android.app.Activity testActivity;
  private ServiceConnection connection;

  private boolean playbackRecovery,designReview,appearanceSettings;

  private boolean discoveryProbe,discoveryParser,likedCoverProbe,favoriteRouting,selectionLayout,playingCover,queueSheetCheck,queueDragCheck,accountLayoutCheck;
  private boolean sourceProbe;
  public void onCreate(Bundle args) {
    super.onCreate(args);
    accountLayoutCheck=args!=null&&"account-layout".equals(args.getString("suite"));
    queueDragCheck=args!=null&&"queue-drag".equals(args.getString("suite"));
    queueSheetCheck=args!=null&&"queue-sheet".equals(args.getString("suite"));
    playingCover=args!=null&&"playing-cover".equals(args.getString("suite"));
    selectionLayout=args!=null&&"selection-layout".equals(args.getString("suite"));
    favoriteRouting=args!=null&&"favorite-routing".equals(args.getString("suite"));
    likedCoverProbe=args!=null&&"liked-cover".equals(args.getString("suite"));
    discoveryParser=args!=null&&"discovery-parser".equals(args.getString("suite"));
    discoveryProbe=args!=null&&"discovery-probe".equals(args.getString("suite"));
    sourceProbe=args!=null&&"source-probe".equals(args.getString("suite"));
    appearanceSettings=args!=null&&"appearance-settings".equals(args.getString("suite"));
    designReview=args!=null&&"design-review".equals(args.getString("suite"));
    playbackRecovery=args!=null&&"playback-recovery".equals(args.getString("suite"));
    streamOnly = args != null && "stream".equals(args.getString("suite"));
    photoOnly = args != null && "photo".equals(args.getString("suite"));
    heartOnly = args != null && "heart".equals(args.getString("suite"));
    favoriteProbe = args != null && "favorite-probe".equals(args.getString("suite"));
    morphOnly = args != null && "morph".equals(args.getString("suite"));
    playIconOnly = args != null && "play-icon".equals(args.getString("suite"));
    pullSettleOnly = args != null && "pull-settle".equals(args.getString("suite"));
    capsuleDragOnly = args != null && "capsule-drag".equals(args.getString("suite"));
    capsuleDirectOnly = args != null && "capsule-drag-native".equals(args.getString("suite"));
    capsuleDragOnly |= capsuleDirectOnly;
    blankFavoriteOnly = args != null && "blank-favorite".equals(args.getString("suite"));
    sketchControlsOnly = args != null && "sketch-controls".equals(args.getString("suite"));
    capsuleIdleOnly = args != null && "capsule-idle".equals(args.getString("suite"));
    artworkOnly = args != null && "rail-artwork".equals(args.getString("suite"));
    layoutOnly = args != null && "true".equals(args.getString("layout-only"));
    capsuleSidesOnly = args != null && "capsule-sides".equals(args.getString("suite"));
    trackDepthOnly = args != null && "track-depth".equals(args.getString("suite"));
    trackProfileOnly = args != null && "track-profile".equals(args.getString("suite"));
    if (args != null) trackProfileLabel = args.getString("profile-label", "baseline");
    trackAutoOnly = args != null && "track-auto".equals(args.getString("suite"));
    trackRoundtripOnly = args != null && "track-roundtrip".equals(args.getString("suite"));
    trackDepthOnly |= trackProfileOnly || trackAutoOnly || trackRoundtripOnly;
    railSelectionOnly = args != null && "rail-selection".equals(args.getString("suite"));
    lyricFlipOnly = args != null && "lyric-flip".equals(args.getString("suite"));
    stemControlOnly = args != null && "stem-control".equals(args.getString("suite"));
    stemHandoffOnly = args != null && "stem-handoff".equals(args.getString("suite"));
    stemPreloadOnly = args != null && "stem-preload".equals(args.getString("suite"));
    capsuleSidesOnly |= trackDepthOnly || railSelectionOnly || lyricFlipOnly || stemControlOnly;
    fullPullOnly = args != null && "full-pull".equals(args.getString("suite"));
    rubberNavigationOnly = args != null && "rubber-navigation".equals(args.getString("suite"));
    poseOnly = args != null && "pose-smoothing".equals(args.getString("suite"));
    spatialHoldOnly = args != null && "spatial-hold".equals(args.getString("suite"));
    start();
  }

  private String probeSources(Context target) throws Exception {
    NeteaseClient client = new NeteaseClient();
    client.cookie = new SessionStore(target).load();
    if (client.cookie.isEmpty()) return "No signed-in session";
    JSONArray daily = client.dailySongs();
    JSONArray home = client.discoverySections(false);
    JSONArray freeVip = new JSONArray();
    for (int i = 0; i < home.length(); i++) {
      JSONObject block = home.getJSONObject(i);
      if (block.optString("code").contains("VIP_RCMD") && "songs".equals(block.optString("kind"))) {
        freeVip = block.getJSONArray("items");
        break;
      }
    }
    StringBuilder summary = new StringBuilder();
    JSONObject fullDaily = null;
    for (JSONArray group : new JSONArray[]{daily, freeVip}) {
      summary.append(group == daily ? "Daily: " : "Free VIP: ");
      JSONArray ids = new JSONArray();
      for (int i = 0; i < group.length() && ids.length() < 4; i++) {
        JSONObject song = group.getJSONObject(i);
        if (group == freeVip || song.optInt("fee") > 0) ids.put(song.getLong("id"));
      }
      summary.append(ids.length()).append(" sample(s). ");
      if (ids.length() == 0) continue;
      for (boolean legacy : new boolean[]{false, true}) {
        JSONArray sources = client.request("/api/song/enhance/player/url" + (legacy ? "" : "/v1"),
            legacy ? NeteaseClient.json("ids", ids.toString(), "br", 128000)
                : NeteaseClient.json("ids", ids.toString(), "level", "standard", "encodeType", "mp3"),
            false).getJSONArray("data");
        summary.append(legacy ? "legacy " : "v1 ");
        for (int i = 0; i < sources.length(); i++) {
          JSONObject item = sources.getJSONObject(i);
          summary.append(item.isNull("url") ? "no URL" : "URL")
              .append('/').append(NeteaseClient.isTrial(item) ? "trial" : "full")
              .append('/').append(item.optInt("time")).append("ms ");
          if (!legacy && group == daily && fullDaily == null
              && !item.isNull("url") && !NeteaseClient.isTrial(item)) {
            for (int j = 0; j < daily.length(); j++) {
              JSONObject song = daily.getJSONObject(j);
              if (song.optLong("id") == item.optLong("id")) {
                fullDaily = song;
                break;
              }
            }
          }
        }
      }
    }
    if (fullDaily != null) {
      OnlineAudio first = OnlineAudio.resolve(client, fullDaily);
      if (first.trial() || first.thirdParty()) throw new AssertionError("Full official source lost priority");
      summary.append(" Resolver kept full daily source. ");
    }
    // Use a nonexistent official ID to exercise fallback without assuming a real song's rights.
    JSONObject fixture = NeteaseClient.json("id", 999999999999L, "name", "起风了", "dt", 325000,
        "ar", new JSONArray().put(NeteaseClient.json("name", "买辣椒也用券")));
    OnlineAudio selected = OnlineAudio.resolve(new NeteaseClient(), fixture);
    if (!selected.thirdParty()) throw new AssertionError("Expected a third-party fallback");
    android.media.MediaPlayer audio = new android.media.MediaPlayer();
    try {
      audio.setDataSource(selected.url());
      audio.prepare();
      summary.append("Fallback sample: third-party ").append(audio.getDuration()).append("ms.");
      if (!selected.matchesDuration(audio.getDuration()))
        throw new AssertionError("Third-party source length does not match the song");
    } finally {
      audio.release();
    }
    return summary.toString();
  }

  public void onStart() {
    Bundle result = new Bundle();
    try {
      Context target = getTargetContext();
      if (sourceProbe) {
        String summary = probeSources(target);
        result.putString("result", summary);
        finish(-1, result);
        return;
      }
      if(accountLayoutCheck){
        MusicActivity activity=(MusicActivity)startActivitySync(new Intent(target,MusicActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));java.lang.reflect.Method personal=MusicActivity.class.getDeclaredMethod("showAccount"),menu=MusicActivity.class.getDeclaredMethod("accountMenu"),login=MusicActivity.class.getDeclaredMethod("loginDialog");personal.setAccessible(true);menu.setAccessible(true);login.setAccessible(true);AtomicReference<Throwable> failure=new AtomicReference<>();
        runOnMainSync(()->{try{personal.invoke(activity);}catch(Throwable error){failure.set(error);}});SystemClock.sleep(400);
        runOnMainSync(()->{try{java.lang.reflect.Field avatarField=MusicActivity.class.getDeclaredField("avatar"),accountField=MusicActivity.class.getDeclaredField("account");avatarField.setAccessible(true);accountField.setAccessible(true);android.view.View avatar=(android.view.View)avatarField.get(activity);android.widget.TextView account=(android.widget.TextView)accountField.get(activity);android.view.View profile=(android.view.View)avatar.getParent();if(Math.abs(avatar.getLeft()+avatar.getWidth()/2f-profile.getWidth()/2f)>2)throw new AssertionError("Avatar not centered");if(account.getTop()<avatar.getBottom()||(account.getGravity()&android.view.Gravity.HORIZONTAL_GRAVITY_MASK)!=android.view.Gravity.CENTER_HORIZONTAL)throw new AssertionError("Nickname not below avatar and centered");menu.invoke(activity);}catch(Throwable error){failure.set(error);}});if(failure.get()!=null)throw new AssertionError(failure.get());SystemClock.sleep(250);
        android.graphics.Bitmap shot=getUiAutomation().takeScreenshot();if(shot!=null)try(FileOutputStream output=target.openFileOutput("account-menu-preview.png",0)){shot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output);}sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);
        runOnMainSync(()->{try{login.invoke(activity);}catch(Throwable error){failure.set(error);}});SystemClock.sleep(1000);
        runOnMainSync(()->{try{java.lang.reflect.Field dialogField=MusicActivity.class.getDeclaredField("qrDialog"),imageField=MusicActivity.class.getDeclaredField("qrImage");dialogField.setAccessible(true);imageField.setAccessible(true);android.app.Dialog dialog=(android.app.Dialog)dialogField.get(activity);android.widget.ImageView image=(android.widget.ImageView)imageField.get(activity);if(!image.getClipToOutline()||image.getWidth()>=MobileUi.dp(target,220))throw new AssertionError("QR not smaller and rounded");java.util.ArrayList<android.view.View> close=new java.util.ArrayList<>();dialog.getWindow().getDecorView().findViewsWithText(close,"关闭扫码登录",android.view.View.FIND_VIEWS_WITH_CONTENT_DESCRIPTION);if(close.size()!=1||close.get(0).getBackground()!=null)throw new AssertionError("QR close should be a single unfilled control");}catch(Throwable error){failure.set(error);}});
        shot=getUiAutomation().takeScreenshot();if(shot!=null)try(FileOutputStream output=target.openFileOutput("qr-red-preview.png",0)){shot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output);}runOnMainSync(()->{try{java.lang.reflect.Field field=MusicActivity.class.getDeclaredField("qrDialog");field.setAccessible(true);((android.app.Dialog)field.get(activity)).dismiss();}catch(Throwable error){failure.set(error);}});if(failure.get()!=null)throw new AssertionError(failure.get());result.putString("result","PASS: centered avatar/nickname, compact rounded QR, unfilled close; preview screenshots saved, no login confirmation/account writes");finish(-1,result);return;
      }
      if(queueDragCheck){
        MusicActivity activity=(MusicActivity)startActivitySync(new Intent(target,MusicActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));AtomicReference<QueueSheet> ref=new AtomicReference<>();java.util.concurrent.atomic.AtomicInteger from=new java.util.concurrent.atomic.AtomicInteger(-1),to=new java.util.concurrent.atomic.AtomicInteger(-1);AtomicReference<Throwable> failure=new AtomicReference<>();
        runOnMainSync(()->{QueueSheet sheet=new QueueSheet(activity,new QueueSheet.Actions(){public void play(int index){}public void remove(int index){}public void move(int a,int b){from.set(a);to.set(b);}});sheet.state(new String[]{"Drag first","Second","Drop third"},new String[]{"A","B","C"},1);sheet.show();ref.set(sheet);});SystemClock.sleep(350);
        int[] points=new int[3];runOnMainSync(()->{try{java.lang.reflect.Field field=QueueSheet.class.getDeclaredField("list");field.setAccessible(true);android.widget.ListView list=(android.widget.ListView)field.get(ref.get());android.view.View first=list.getChildAt(0),third=list.getChildAt(2);if(first==null||third==null)throw new AssertionError("Queue rows not laid out");int[] start=new int[2],end=new int[2];first.getLocationOnScreen(start);third.getLocationOnScreen(end);points[0]=start[0]+MobileUi.dp(target,36);points[1]=start[1]+first.getHeight()/2;points[2]=end[1]+third.getHeight()/2;}catch(Throwable error){failure.set(error);}});if(failure.get()!=null)throw new AssertionError(failure.get());
        long down=SystemClock.uptimeMillis();android.view.MotionEvent event=android.view.MotionEvent.obtain(down,down,android.view.MotionEvent.ACTION_DOWN,points[0],points[1],0);if(!getUiAutomation().injectInputEvent(event,true))throw new AssertionError("Queue drag input rejected");event.recycle();SystemClock.sleep(android.view.ViewConfiguration.getLongPressTimeout()+180);
        for(int step=1;step<=8;step++){float y=points[1]+(points[2]-points[1])*step/8f;event=android.view.MotionEvent.obtain(down,SystemClock.uptimeMillis(),android.view.MotionEvent.ACTION_MOVE,points[0],y,0);if(!getUiAutomation().injectInputEvent(event,true))throw new AssertionError("Queue drag input rejected");event.recycle();SystemClock.sleep(45);}
        event=android.view.MotionEvent.obtain(down,SystemClock.uptimeMillis(),android.view.MotionEvent.ACTION_UP,points[0],points[2],0);if(!getUiAutomation().injectInputEvent(event,true))throw new AssertionError("Queue drag input rejected");event.recycle();SystemClock.sleep(300);runOnMainSync(()->ref.get().dismiss());if(from.get()!=0||to.get()!=2)throw new AssertionError("Native queue drag expected 0 -> 2, got "+from.get()+" -> "+to.get());result.putString("result","PASS: native long-press drag first to third row; synthetic queue callback only");finish(-1,result);return;
      }
      if(queueSheetCheck){
        QueueOrderChecks.check();MusicActivity activity=(MusicActivity)startActivitySync(new Intent(target,MusicActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));AtomicReference<Throwable> failure=new AtomicReference<>();java.util.concurrent.atomic.AtomicInteger removed=new java.util.concurrent.atomic.AtomicInteger(-1),played=new java.util.concurrent.atomic.AtomicInteger(-1);
        runOnMainSync(()->{QueueSheet sheet=null;try{sheet=new QueueSheet(activity,new QueueSheet.Actions(){public void play(int index){played.set(index);}public void remove(int index){removed.set(index);}public void move(int from,int to){}});sheet.state(new String[]{"First song","Current song","Third song"},new String[]{"A","B","C"},1);sheet.show();java.lang.reflect.Field listField=QueueSheet.class.getDeclaredField("list");listField.setAccessible(true);android.widget.ListView list=(android.widget.ListView)listField.get(sheet);if(list.getAdapter().getCount()!=3)throw new AssertionError("Queue size");android.view.View current=list.getAdapter().getView(1,null,list),other=list.getAdapter().getView(0,null,list);if(!current.isSelected()||other.isSelected())throw new AssertionError("Current highlight");if(!current.isLongClickable())throw new AssertionError("Long-press sorting missing");android.view.ViewGroup row=(android.view.ViewGroup)current;row.getChildAt(row.getChildCount()-1).performClick();if(removed.get()!=1||played.get()!=-1)throw new AssertionError("Remove callback must not play song");sheet.state(new String[]{"First song","Third song"},new String[]{"A","C"},0);if(list.getAdapter().getCount()!=2)throw new AssertionError("Live removal refresh");sheet.state(new String[0],new String[0],-1);if(list.getVisibility()!=android.view.View.GONE)throw new AssertionError("Empty queue state");}catch(Throwable error){failure.set(error);}finally{if(sheet!=null)sheet.dismiss();}});if(failure.get()!=null)throw new AssertionError(failure.get());result.putString("result","PASS: queue drawer, current highlight, remove callback, long-press enabled, empty/live state and shuffle reorder; synthetic callbacks only");finish(-1,result);return;
      }
      if(playingCover){
        AtomicReference<SongListPanel> panelRef=new AtomicReference<>();AtomicReference<android.view.View> barsRef=new AtomicReference<>();AtomicReference<Throwable> error=new AtomicReference<>();ArtworkLoader loader=new ArtworkLoader();JSONArray songs=new JSONArray().put(new JSONObject().put("id",101).put("name","Synthetic current song")).put(new JSONObject().put("id",102).put("name","Synthetic next song"));
        runOnMainSync(()->{try{SongListPanel panel=new SongListPanel(target,"Render check",new JSONObject(),songs,loader,java.util.Collections.emptySet(),java.util.Collections.emptySet(),new SongListPanel.Actions(){public void play(int i,boolean shuffle){}public void next(int i){}public void append(int i){}public void download(int[] indices){}public void player(int i){}});panel.updateCurrent("101",true);panel.measure(android.view.View.MeasureSpec.makeMeasureSpec(900,android.view.View.MeasureSpec.EXACTLY),android.view.View.MeasureSpec.makeMeasureSpec(1800,android.view.View.MeasureSpec.AT_MOST));panel.layout(0,0,panel.getMeasuredWidth(),panel.getMeasuredHeight());panel.updateCurrent("101",true);panelRef.set(panel);java.lang.reflect.Field rendered=SongListPanel.class.getDeclaredField("rendered");rendered.setAccessible(true);java.util.List<?> rows=(java.util.List<?>)rendered.get(panel);java.lang.reflect.Field bars=rows.get(0).getClass().getDeclaredField("bars");bars.setAccessible(true);android.view.View first=(android.view.View)bars.get(rows.get(0)),second=(android.view.View)bars.get(rows.get(1));if(first.getVisibility()!=android.view.View.VISIBLE||second.getVisibility()!=android.view.View.GONE)throw new AssertionError("Indicator not limited to current cover");barsRef.set(first);}catch(Throwable failure){error.set(failure);}});if(error.get()!=null)throw new AssertionError(error.get());
        java.util.function.Supplier<android.graphics.Bitmap> frame=()->{AtomicReference<android.graphics.Bitmap> bitmap=new AtomicReference<>();runOnMainSync(()->{android.view.View view=barsRef.get();android.graphics.Bitmap image=android.graphics.Bitmap.createBitmap(Math.max(1,view.getWidth()),Math.max(1,view.getHeight()),android.graphics.Bitmap.Config.ARGB_8888);view.draw(new android.graphics.Canvas(image));bitmap.set(image);});return bitmap.get();};
        android.graphics.Bitmap first=frame.get();SystemClock.sleep(180);android.graphics.Bitmap moving=frame.get();if(android.animation.ValueAnimator.areAnimatorsEnabled()&&first.sameAs(moving))throw new AssertionError("Playing bars did not animate");runOnMainSync(()->panelRef.get().updateCurrent("101",false));android.graphics.Bitmap paused=frame.get();SystemClock.sleep(150);android.graphics.Bitmap still=frame.get();if(!paused.sameAs(still))throw new AssertionError("Paused bars still move");loader.close();result.putString("result","PASS: current cover only, animated while playing, static while paused; no playback actions invoked");finish(-1,result);return;
      }
      if(selectionLayout){
        MusicActivity activity=(MusicActivity)startActivitySync(new Intent(target,MusicActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        java.lang.reflect.Method open=MusicActivity.class.getDeclaredMethod("openSongs",String.class,JSONArray.class,Runnable.class);open.setAccessible(true);java.lang.reflect.Field panelField=MusicActivity.class.getDeclaredField("songListPanel");panelField.setAccessible(true);AtomicReference<Throwable> failure=new AtomicReference<>();JSONArray songs=new JSONArray().put(new JSONObject().put("id",999999999999L).put("name","Selection layout check"));
        runOnMainSync(()->{try{open.invoke(activity,"Selection layout check",songs,(Runnable)()->{});}catch(Throwable e){failure.set(e);}});waitForIdleSync();if(failure.get()!=null)throw new AssertionError(failure.get());SongListPanel panel=(SongListPanel)panelField.get(activity);java.lang.reflect.Field buttonField=SongListPanel.class.getDeclaredField("selectButton"),drawerField=SongListPanel.class.getDeclaredField("selectionDrawer");buttonField.setAccessible(true);drawerField.setAccessible(true);
        runOnMainSync(()->{try{((android.view.View)buttonField.get(panel)).performClick();}catch(Throwable e){failure.set(e);}});waitForIdleSync();
        runOnMainSync(() -> {
          try {
            android.widget.FrameLayout drawer = (android.widget.FrameLayout) drawerField.get(panel);
            android.view.View bar = drawer.getChildAt(0);
            int[] location = new int[2];
            bar.getLocationOnScreen(location);
            android.view.WindowMetrics metrics = activity.getWindowManager().getCurrentWindowMetrics();
            int capsuleTop = FloatingNavigation.navigationTop(activity, metrics);
            int height = MobileUi.dp(target, 52);
            int barBottom = location[1] + bar.getHeight();
            if (bar.getHeight() != height || barBottom > capsuleTop)
              throw new AssertionError("Selection bar overlaps bottom chrome");
            ((android.view.View) buttonField.get(panel)).performClick();
            if (drawerField.get(panel) != null) throw new AssertionError("Drawer should dismiss on Done");
          } catch (Throwable error) {
            failure.set(error);
          }
        });
        if (failure.get() != null) throw new AssertionError(failure.get());
        result.putString("result", "PASS: selection actions remain 52dp high and clear of capsules");
        finish(-1, result);
        return;
      }
      if(favoriteRouting){
        MusicActivity activity=(MusicActivity)startActivitySync(new Intent(target,MusicActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));java.lang.reflect.Field owner=MusicActivity.class.getDeclaredField("userId");owner.setAccessible(true);long deadline=SystemClock.uptimeMillis()+15000;while(owner.getLong(activity)==0&&SystemClock.uptimeMillis()<deadline)SystemClock.sleep(100);if(owner.getLong(activity)==0)throw new AssertionError("Account not ready");
        java.lang.reflect.Method choose=MusicActivity.class.getDeclaredMethod("chooseFavorite",JSONObject.class,boolean.class,Boolean.class),isLiked=MusicActivity.class.getDeclaredMethod("isFavorite",String.class),reset=MusicActivity.class.getDeclaredMethod("resetFavoriteRequests");java.lang.reflect.Field writes=MusicActivity.class.getDeclaredField("favoriteWrites");choose.setAccessible(true);isLiked.setAccessible(true);reset.setAccessible(true);writes.setAccessible(true);JSONObject song=new JSONObject().put("id",999999999999L).put("name","Synthetic routing check");AtomicReference<Throwable> failure=new AtomicReference<>();
        runOnMainSync(()->{try{
          choose.invoke(activity,song,true,Boolean.FALSE);if(!(Boolean)isLiked.invoke(activity,"999999999999"))throw new AssertionError("Add must update desired favorite immediately");
          choose.invoke(activity,song,false,Boolean.TRUE);if((Boolean)isLiked.invoke(activity,"999999999999"))throw new AssertionError("Reverse choice must update immediately");reset.invoke(activity);
          choose.invoke(activity,song,false,Boolean.TRUE);if((Boolean)isLiked.invoke(activity,"999999999999"))throw new AssertionError("Known liked deletion must update immediately even before IDs load");
          java.util.Map<?,?> map=(java.util.Map<?,?>)writes.get(activity);Object pending=map.get("999999999999");java.lang.reflect.Field toggleField=pending.getClass().getDeclaredField("toggle");toggleField.setAccessible(true);FavoriteToggle toggle=(FavoriteToggle)toggleField.get(pending);if(!Boolean.FALSE.equals(toggle.begin()))throw new AssertionError("Delete should issue unlike intent");if(!toggle.complete(false)||!(Boolean)isLiked.invoke(activity,"999999999999"))throw new AssertionError("Failed removal must revert");
        }catch(Throwable error){failure.set(error);}finally{try{reset.invoke(activity);}catch(Exception ignored){}}});if(failure.get()!=null)throw new AssertionError(failure.get());result.putString("result","PASS: 4 shared favorite state checks; all synthetic writes cancelled before dispatch");finish(-1,result);return;
      }
      if(likedCoverProbe){MusicActivity active=(MusicActivity)startActivitySync(new Intent(target,MusicActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        NeteaseClient client=new NeteaseClient();client.cookie=new SessionStore(target).load();JSONObject profile=client.profile();long owner=profile.getLong("userId");JSONArray lists=client.playlists(owner);JSONObject liked=null;for(int i=0;i<lists.length();i++)if(lists.getJSONObject(i).optInt("specialType")==5)liked=lists.getJSONObject(i);if(liked==null)throw new AssertionError("Missing liked playlist");
        JSONObject detail=client.request("/api/v6/playlist/detail",NeteaseClient.json("id",liked.getLong("id"),"n",1,"s",0),false).getJSONObject("playlist");JSONObject first=detail.getJSONArray("tracks").getJSONObject(0);long song=first.getLong("id");JSONObject album=first.optJSONObject("al");if(album==null)album=first.optJSONObject("album");String expected=album==null?"":album.optString("picUrl");if(expected.isEmpty())throw new AssertionError("Missing latest song artwork");
        long deadline=SystemClock.uptimeMillis()+20000;android.content.SharedPreferences cache=target.getSharedPreferences("liked-cover-"+owner,0);while(SystemClock.uptimeMillis()<deadline&&(cache.getLong("song",0)!=song||!expected.equals(cache.getString("url",""))))SystemClock.sleep(200);
        if(cache.getLong("song",0)!=song||!expected.equals(cache.getString("url","")))throw new AssertionError("Liked cover differs from newest song");java.lang.reflect.Method showPersonal=MusicActivity.class.getDeclaredMethod("showAccount"),updateCover=MusicActivity.class.getDeclaredMethod("updateLikedCover",long.class,String.class,boolean.class),render=MusicActivity.class.getDeclaredMethod("renderPersonal");java.lang.reflect.Field coverField=MusicActivity.class.getDeclaredField("likedPersonalCover"),keyField=MusicActivity.class.getDeclaredField("personalRenderKey");showPersonal.setAccessible(true);updateCover.setAccessible(true);render.setAccessible(true);coverField.setAccessible(true);keyField.setAccessible(true);
        AtomicReference<Throwable> stabilityFailure=new AtomicReference<>();runOnMainSync(()->{try{showPersonal.invoke(active);}catch(Throwable e){stabilityFailure.set(e);}});
        runOnMainSync(()->{try{android.widget.ImageView cover=(android.widget.ImageView)coverField.get(active);if(cover==null)throw new AssertionError("Liked cover not rendered");android.view.ViewParent parent=cover.getParent();android.graphics.drawable.Drawable bitmap=cover.getDrawable();updateCover.invoke(active,song,expected,false);if(coverField.get(active)!=cover||cover.getParent()!=parent)throw new AssertionError("Unchanged cover rebuilt row");keyField.set(active,null);render.invoke(active);if(coverField.get(active)!=cover)throw new AssertionError("Personal rerender replaced liked cover view");if(bitmap!=null&&cover.getDrawable()==null)throw new AssertionError("Existing artwork cleared during rerender");}catch(Throwable e){stabilityFailure.set(e);}});if(stabilityFailure.get()!=null)throw new AssertionError(stabilityFailure.get());
        result.putString("result","PASS: latest liked cover correct; unchanged sync preserves row; personal rerender reuses cover and keeps artwork; no like/unlike requests");finish(-1,result);return;
      }
      if(discoveryParser){result.putString("result",DiscoverySectionsChecks.run());finish(-1,result);return;}
      if(discoveryProbe){NeteaseClient client=new NeteaseClient();client.cookie=new SessionStore(target).load();JSONObject page=client.request("/api/homepage/block/page",NeteaseClient.json("refresh",false),true);JSONObject data=page.getJSONObject("data");JSONArray blocks=data.getJSONArray("blocks"),summary=new JSONArray();for(int i=0;i<blocks.length();i++){JSONObject block=blocks.getJSONObject(i);JSONObject entry=new JSONObject().put("blockCode",block.optString("blockCode")).put("uiElement",block.optJSONObject("uiElement"));JSONArray creatives=block.optJSONArray("creatives");if(creatives!=null&&creatives.length()>0)entry.put("sample",creatives.getJSONObject(0));summary.put(entry);}try(FileOutputStream out=target.openFileOutput("discovery-schema.json",0)){out.write(summary.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}result.putString("result","Homepage blocks: "+blocks.length());finish(-1,result);return;}

      if(appearanceSettings){testAppearanceSettings(target);result.putString("result","PASS: "+checks+" dedicated settings, persistence, theme, accent and wallpaper checks; original preferences restored");finish(-1,result);return;}
      if(designReview){testDesignReview(target);result.putString("result","PASS: "+checks+" page, popup and navigation checks; screenshots saved; no queue/account writes");finish(-1,result);return;}
      if(playbackRecovery) {
        connection=new ServiceConnection(){
          public void onServiceConnected(ComponentName n,IBinder b){service=((PlaybackService.LocalBinder)b).get();}
          public void onServiceDisconnected(ComponentName n){service=null;}
        };
        runOnMainSync(()->target.bindService(new Intent(target,PlaybackService.class),connection,Context.BIND_AUTO_CREATE));
        await(()->service!=null,"bind recovery service");
        runOnMainSync(service::play);
        await(()->service.prepared&&service.playing(),"real song starts on restored playback chain");
        int before=service.position();Thread.sleep(850);
        check(()->service.playing()&&service.position()>before+250,"real playback position advances");
        result.putString("result","PASS: real song prepared, playing and advancing; error="+service.error);
        finish(-1,result);return;
      }
      if (favoriteProbe) {
        NeteaseClient probe = new NeteaseClient();
        probe.cookie = new SessionStore(target).load();
        result.putString("sessionPresent", Boolean.toString(!probe.cookie.isEmpty()));
        try {
          JSONObject profile = probe.profile();
          result.putString(
              "webProfile", profile == null ? "no authenticated profile" : "authenticated");
          if (profile != null) {
            probe.likedIds(profile.optLong("userId"));
            result.putString("likedList", "read succeeded");
          }
        } catch (Exception error) {
          result.putString(
              "probeError", error.getClass().getSimpleName() + ": " + error.getMessage());
        }
        result.putString("scope", "read-only session/profile/liked-list; no favorite writes");
        finish(-1, result);
        return;
      }
      testActivity =
          startActivitySync(
              new Intent(target, MusicActivity.class)
                  .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
      if (rubberNavigationOnly) {
        testRubberNavigation();
        result.putString("result", "PASS: " + checks + " native rubber navigation checks; no account/queue writes");
        finish(-1, result);
        return;
      }
      if (artworkOnly) {
        int live = testRailArtwork();
        result.putString(
            "result",
            "PASS: "
                + checks
                + " focused artwork checks; live CDN covers="
                + live
                + "; no account/queue mutation");
        finish(-1, result);
        return;
      }
      if (morphOnly
          || playIconOnly
          || pullSettleOnly
          || capsuleDragOnly
          || sketchControlsOnly
          || capsuleIdleOnly
          || capsuleSidesOnly
          || fullPullOnly
          || poseOnly
          || spatialHoldOnly) {
        testPlayerMorph();
        if (poseOnly) result.putString("poseCadence", poseCadence);
        result.putString(
            "result",
            "PASS: " + checks + " focused player morph checks; no account/queue mutation");
        finish(-1, result);
        return;
      }
      if (heartOnly || blankFavoriteOnly) {
        testNativeHeart();
        result.putString(
            "result",
            "PASS: " + checks + " focused native heart checks; no account/queue mutation");
        finish(-1, result);
        return;
      }
      if (!stemHandoffOnly && !stemPreloadOnly) testAccountStore(target);
      File file = new File(target.getFilesDir(), "playback-regression.wav");
      try (InputStream in = target.getAssets().open("benchmark.wav");
          OutputStream out = new FileOutputStream(file)) {
        in.transferTo(out);
      }
      sample = Uri.fromFile(file);
      connection =
          new ServiceConnection() {
            public void onServiceConnected(ComponentName name, IBinder binder) {
              service = ((PlaybackService.LocalBinder) binder).get();
            }

            public void onServiceDisconnected(ComponentName name) {
              service = null;
            }
          };
      runOnMainSync(
          () ->
              target.bindService(
                  new Intent(target, PlaybackService.class), connection, Context.BIND_AUTO_CREATE));
      await(() -> service != null, "bind");
      runOnMainSync(() -> service.observer = null);
      if (stemPreloadOnly) {
        testStemPreload(target);
        runOnMainSync(service::stop);
        cleanupPreloadFixtures(target);
        result.putString("result", "PASS: " + checks + " real stem-preload checks; local model and PCM fixtures");
        finish(-1, result);
        return;
      }
      if (stemHandoffOnly) {
        testStemHandoff(target);
        runOnMainSync(service::stop);
        result.putString("result", "PASS: " + checks + " real audio handoff checks; synthetic local audio");
        finish(-1, result);
        return;
      }
      if (photoOnly) {
        testPhotoPlayer();
        result.putString("result", "PASS: " + checks + " photo player interaction/geometry checks");
        finish(-1, result);
        return;
      }
      if (streamOnly) {
        for (int n = 0; n < 3; n++) testProgressiveStream(target);
        runOnMainSync(() -> service.stop());
        result.putString("result", "PASS: three progressive playback runs; " + checks + " checks");
        finish(-1, result);
        return;
      }
      JSONArray items = items();
      runOnMainSync(
          () -> {
            service.setMode(PlaybackOrder.Mode.LIST_LOOP);
            service.startQueue(items, 0);
            service.pause();
          });
      await(() -> service.prepared && !service.loading, "prepare paused");
      check(() -> !service.playing(), "pause during preparation must survive callback");
      items.getJSONObject(0).put("name", "mutated");
      check(() -> !service.current().optString("name").equals("mutated"), "queue snapshot");
      runOnMainSync(() -> service.play());
      await(() -> service.playing(), "resume");
      runOnMainSync(() -> service.seek(4200));
      await(() -> Math.abs(service.position() - 4200) < 350, "seek");
      runOnMainSync(
          () -> {
            service.pause();
            service.switchTrack(sample, "vocals.wav");
            service.switchTrack(sample, "accompaniment.wav");
            service.pause();
          });
      await(() -> service.prepared && !service.loading && !service.switchingTrack(), "rapid stem switch");
      check(
          () -> !service.playing() && Math.abs(service.position() - 4200) < 500,
          "stem switch preserves paused position");
      check(() -> "accompaniment.wav".equals(service.mode), "last stem selection wins");
      runOnMainSync(() -> service.persist());
      check(
          () ->
              "accompaniment.wav"
                  .equals(target.getSharedPreferences("playback", 0).getString("mode", "")),
          "persist selected stem");
      runOnMainSync(
          () -> {
            service.startQueue(items(), 1);
            service.pause();
          });
      await(() -> service.prepared && !service.loading, "queue editing setup");
      Object player = service.player;
      runOnMainSync(
          () -> {
            service.move(1, 2);
            service.remove(0);
          });
      check(
          () ->
              service.index == 1
                  && service.current().optString("id").equals("b")
                  && service.player == player,
          "reorder/remove other entries retain player");
      runOnMainSync(() -> service.remove(service.index));
      await(() -> service.prepared && !service.loading, "remove active item");
      check(
          () -> service.queue.length() == 1 && !service.playing(),
          "remove active retains pause intent");
      runOnMainSync(
          () ->
              service.local(
                  Uri.fromFile(new File(target.getFilesDir(), "missing-audio.wav")), "missing"));
      await(() -> !service.error.isEmpty(), "missing file error");
      check(() -> !service.prepared && !service.loading, "error releases player");
      runOnMainSync(
          () -> {
            service.setMode(PlaybackOrder.Mode.SEQUENTIAL);
            service.startQueue(items(), 2);
          });
      await(() -> service.playing(), "recover from failure");
      runOnMainSync(() -> service.seek(service.duration() - 200));
      await(() -> !service.playing(), "sequential end stops");
      check(() -> service.index == 2, "sequential end does not wrap");
      runOnMainSync(
          () -> {
            service.setMode(PlaybackOrder.Mode.SINGLE_LOOP);
            service.play();
          });
      await(() -> service.playing(), "replay completed item");
      runOnMainSync(() -> service.seek(service.duration() - 200));
      Thread.sleep(450);
      await(
          () -> service.playing() && service.position() < 2500,
          "single repeat restarts current item");
      check(() -> service.index == 2, "repeat keeps index");
      runOnMainSync(() -> service.step(1));
      await(() -> service.playing() && service.index == 0, "manual next bypasses single repeat");
      testProgressiveStream(target);
      testRealSeparationPreview(target);
      runOnMainSync(
          () -> {
            service.pause();
            service.stop();
          });
      check(() -> service.queue.length() == 0 && service.player == null, "clear playback");
      result.putString("result", "PASS: " + checks + " service integration checks");
      finish(-1, result);
    } catch (Throwable failure) {
      result.putString(
          "result",
          "FAIL after " + checks + " checks: " + android.util.Log.getStackTraceString(failure));
      finish(0, result);
    } finally {
      if (connection != null)
        try {
          getTargetContext().unbindService(connection);
        } catch (Exception ignored) {
        }
    }
  }

  private void saveNavigationImage(String name) throws Exception {
    android.graphics.Bitmap bitmap = getUiAutomation().takeScreenshot();
    try (OutputStream out = new FileOutputStream(new File(getTargetContext().getFilesDir(), name))) {
      bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out);
    }
    bitmap.recycle();
  }

  private void navigationTouch(RubberNavigation nav, float x, float y, int action) {
    long now = SystemClock.uptimeMillis();
    if (action == android.view.MotionEvent.ACTION_DOWN) pointerDownTime = now;
    android.view.MotionEvent event = android.view.MotionEvent.obtain(pointerDownTime, now, action, x, y, 0);
    runOnMainSync(() -> nav.dispatchTouchEvent(event));
    event.recycle();
    SystemClock.sleep(20);
  }

  private void testRubberNavigation() throws Exception {
    java.lang.reflect.Field field = MusicActivity.class.getDeclaredField("navigation");
    java.lang.reflect.Field page = MusicActivity.class.getDeclaredField("mainTab");
    field.setAccessible(true); page.setAccessible(true);
    RubberNavigation nav = (RubberNavigation) field.get(testActivity);
    java.lang.reflect.Field l = RubberNavigation.class.getDeclaredField("edgeL"),
        r = RubberNavigation.class.getDeclaredField("edgeR"),
        width = RubberNavigation.class.getDeclaredField("innerWidth"),
        animation = RubberNavigation.class.getDeclaredField("leftAnimator"),
        handoff = RubberNavigation.class.getDeclaredField("handoff");
    for (java.lang.reflect.Field f : new java.lang.reflect.Field[] {l, r, width, animation, handoff}) f.setAccessible(true);
    java.lang.reflect.Method land = RubberNavigation.class.getDeclaredMethod("land", int.class, Float.class, boolean.class, boolean.class);
    java.lang.reflect.Method showHome = MusicActivity.class.getDeclaredMethod("showHome");
    java.lang.reflect.Method showPersonal = MusicActivity.class.getDeclaredMethod("showAccount");
    land.setAccessible(true); showHome.setAccessible(true); showPersonal.setAccessible(true);
    Thread.sleep(300);
    float d = testActivity.getResources().getDisplayMetrics().density;
    float slot = readFloat(width, nav) / 2, inset = 5 * d, y = nav.getHeight() / 2f;
    float x0 = inset + slot / 2, x1 = inset + slot * 1.5f;
    check(() -> nav.selectedIndex() == 0 && nav.getChildCount() == 2, "discovery selected initially");
    check(() -> !(nav.getChildAt(0) instanceof android.widget.TextView)
        && "发现".contentEquals(nav.getChildAt(0).getContentDescription())
        && "个人".contentEquals(nav.getChildAt(1).getContentDescription()), "icon-only items retain accessible names");
    check(() -> nav.getChildAt(0).getWidth() / d >= 48 && nav.getChildAt(0).getHeight() / d >= 48,
        "navigation retains minimum 48dp touch targets");
    saveNavigationImage("rubber-navigation-discover.png");
    runOnMainSync(() -> {
      nav.getChildAt(1).performClick();
      try {
        android.animation.ValueAnimator a = (android.animation.ValueAnimator) animation.get(nav);
        a.pause(); a.setCurrentPlayTime(110);
        nav.removeCallbacks((Runnable) handoff.get(nav));
      } catch (Exception e) { throw new RuntimeException(e); }
    });
    Thread.sleep(120);
    check(() -> nav.selectedIndex() == 1, "tap commits personal page immediately");
    check(() -> {
      try { return page.getInt(testActivity) == 1; }
      catch (Exception e) { throw new RuntimeException(e); }
    }, "navigation calls the existing personal route");
    check(() -> readFloat(r, nav) - readFloat(l, nav) > slot * 1.5f, "tap stretches thumb across both slots");
    saveNavigationImage("rubber-navigation-stretch.png");
    runOnMainSync(() -> {
      try { land.invoke(nav, 1, null, false, true); }
      catch (Exception e) { throw new RuntimeException(e); }
    });
    Thread.sleep(650);
    check(() -> Math.abs(readFloat(l, nav) - slot) < .2f && Math.abs(readFloat(r, nav) - 2 * slot) < .2f,
        "handoff and squash relax to exact personal slot");
    saveNavigationImage("rubber-navigation-personal.png");
    runOnMainSync(() -> nav.getChildAt(0).performClick());
    Thread.sleep(80);
    final boolean[] continuous = {false};
    runOnMainSync(() -> {
      float oldL = readFloat(l, nav), oldR = readFloat(r, nav);
      nav.getChildAt(1).performClick();
      continuous[0] = Math.abs(readFloat(l, nav) - oldL) < .01f && Math.abs(readFloat(r, nav) - oldR) < .01f;
    });
    check(() -> continuous[0], "rapid reversal starts at current thumb geometry");
    Thread.sleep(650);
    check(() -> nav.selectedIndex() == 1 && Math.abs(readFloat(l, nav) - slot) < .2f, "rapid reversal settles at latest selection");
    runOnMainSync(() -> {
      try { showHome.invoke(testActivity); }
      catch (Exception e) { throw new RuntimeException(e); }
    });
    check(() -> nav.selectedIndex() == 0 && readFloat(l, nav) == 0, "external page changes jump to current selection");
    navigationTouch(nav, x0, y, 0);
    navigationTouch(nav, x0 + 6 * d, y, 2);
    navigationTouch(nav, x1, y, 2);
    check(() -> nav.selectedIndex() == 0 && readFloat(l, nav) > slot * .5f,
        "held drag moves thumb without navigating");
    navigationTouch(nav, x1, y, 3);
    Thread.sleep(350);
    check(() -> nav.selectedIndex() == 0 && Math.abs(readFloat(l, nav)) < .2f,
        "cancel restores committed page without navigation");
    navigationTouch(nav, x0, y, 0);
    navigationTouch(nav, x0 + 6 * d, y, 2);
    navigationTouch(nav, x1, y, 2);
    navigationTouch(nav, x1, y, 1);
    Thread.sleep(650);
    check(() -> nav.selectedIndex() == 1 && Math.abs(readFloat(l, nav) - slot) < .2f, "drag release snaps and commits personal");
    runOnMainSync(() -> nav.setSelectedIndex(0));
    navigationTouch(nav, x0, y, 0);
    navigationTouch(nav, x0 + 6 * d, y, 2);
    navigationTouch(nav, x0 + 12 * d, y, 2);
    navigationTouch(nav, x0 + 12 * d, y, 1);
    Thread.sleep(650);
    check(() -> nav.selectedIndex() == 1, "short fast flick advances to adjacent slot");
    runOnMainSync(() -> nav.setSelectedIndex(0));
    navigationTouch(nav, x0, y, 0);
    navigationTouch(nav, x0 - 6 * d, y, 2);
    navigationTouch(nav, x0 - 50 * d, y, 2);
    check(() -> readFloat(l, nav) == 0 && readFloat(r, nav) < slot, "edge overdrag compresses with rubber resistance");
    navigationTouch(nav, x0 - 50 * d, y, 3);
    Thread.sleep(350);
    runOnMainSync(() -> {
      nav.setEnabled(false);
      nav.getChildAt(1).performClick();
    });
    check(() -> nav.selectedIndex() == 0, "disabled control ignores selection");
    runOnMainSync(() -> {
      nav.setEnabled(true);
      nav.getChildAt(0).dispatchKeyEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_DPAD_RIGHT));
    });
    check(() -> nav.selectedIndex() == 1 && Math.abs(readFloat(l, nav) - slot) < .2f, "keyboard navigation commits and jumps without motion");
    runOnMainSync(() -> {
      android.view.accessibility.AccessibilityNodeInfo node = nav.getChildAt(1).createAccessibilityNodeInfo();
      continuous[0] = node.isChecked() && node.isCheckable() && "android.widget.RadioButton".contentEquals(node.getClassName());
    });
    check(() -> continuous[0], "selected item exposes checked radio semantics");
    runOnMainSync(() -> {
      RubberNavigation compact = new RubberNavigation(testActivity, index -> {});
      int w = Math.round(106 * d), h = Math.round(58 * d);
      compact.measure(android.view.View.MeasureSpec.makeMeasureSpec(w, android.view.View.MeasureSpec.EXACTLY),
          android.view.View.MeasureSpec.makeMeasureSpec(h, android.view.View.MeasureSpec.EXACTLY));
      compact.layout(0, 0, w, h);
      continuous[0] = compact.getChildAt(0).getWidth() / d >= 48 && compact.getChildAt(0).getHeight() / d >= 48;
    });
    check(() -> continuous[0], "compact layout preserves touch target dimensions");
    runOnMainSync(() -> {
      try { showHome.invoke(testActivity); }
      catch (Exception e) { throw new RuntimeException(e); }
      nav.getChildAt(0).clearFocus(); nav.getChildAt(1).clearFocus();
    });
  }

  private JSONArray preloadItems(String prefix) throws Exception {
    JSONArray items = new JSONArray();
    for (String id : new String[] {"a", "b", "c"})
      items.put(new JSONObject().put("id", prefix + id).put("name", "Preload " + id).put("uri", sample.toString()));
    return items;
  }

  private void testStemPreload(Context target) throws Exception {
    String prefix = "preload-regression-" + System.nanoTime() + "-";
    runOnMainSync(() -> target.getSharedPreferences("playback-settings", 0).edit().remove("preload-stems").commit());
    check(() -> !service.stems.enabled(), "preload defaults off when preference is absent");
    JSONArray queue = preloadItems(prefix);
    runOnMainSync(() -> {
      service.setMode(PlaybackOrder.Mode.SEQUENTIAL);
      service.setShuffle(false);
      service.startQueue(queue, 0);
    });
    await(() -> service.playing() && !service.loading, "preload fixture starts original");
    Thread.sleep(150);
    check(() -> service.stems.workingKey().isEmpty() && service.stems.cached(prefix + "a") == null,
        "default playback does not start separation");
    java.lang.reflect.Method showSetting = MusicActivity.class.getDeclaredMethod("showStemPreloadSetting");
    showSetting.setAccessible(true);
    runOnMainSync(() -> {
      try { showSetting.invoke(testActivity); }
      catch (Exception e) { throw new RuntimeException(e); }
    });
    Thread.sleep(250);
    android.graphics.Bitmap screenshot = getUiAutomation().takeScreenshot();
    try (OutputStream out = new FileOutputStream(new File(target.getFilesDir(), "stem-preload-setting-off.png"))) {
      screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out);
    }
    screenshot.recycle();
    android.view.accessibility.AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
    boolean toggled = false;
    for (android.view.accessibility.AccessibilityNodeInfo node : root.findAccessibilityNodeInfosByText("预加载分轨")) {
      if ("android.widget.Switch".contentEquals(node.getClassName())) {
        check(() -> !node.isChecked(), "settings switch initially unchecked");
        toggled = node.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK);
        break;
      }
    }
    final boolean clicked = toggled;
    check(() -> clicked, "native settings switch can enable preloading");
    await(() -> service.stems.enabled(), "settings enable persists");
    getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
    await(() -> service.stems.running(), "enabled setting starts current song");
    check(() -> service.mode == null && service.playing(), "automatic generation leaves original audio playing");
    await(() -> service.stems.cached(prefix + "a") != null, "current song finishes separation");
    await(() -> service.stems.workingKey().equals(prefix + "b") || service.stems.cached(prefix + "b") != null,
        "next-song preload starts after current completes");
    check(() -> service.stems.progress() == 1, "next-song job does not replace current-song progress");
    await(() -> service.stems.cached(prefix + "b") != null, "next song finishes separation");
    check(() -> service.stems.cached(prefix + "c") == null && service.stems.workingKey().isEmpty(),
        "preload stops after one future song");
    File ready = service.stems.cached(prefix + "b");
    runOnMainSync(() -> {
      service.stems.setEnabled(false);
      service.select(1);
    });
    await(() -> service.playing() && !service.loading, "cached next song becomes current");
    check(() -> ready.equals(service.stems.cached(prefix + "b")) && !service.stems.running(),
        "cached results are reused without regenerating");
    check(() -> !target.getSharedPreferences("playback-settings", 0).getBoolean("preload-stems", true),
        "disabled setting persists");

    String manualPrefix = prefix + "manual-";
    JSONArray manualQueue = preloadItems(manualPrefix);
    runOnMainSync(() -> { service.startQueue(manualQueue, 0); service.pause(); });
    await(() -> service.prepared && !service.loading, "manual fixture prepared paused");
    runOnMainSync(() -> service.stems.requestCurrent(false));
    check(service.stems::running, "manual click starts separation while preload is off");
    runOnMainSync(() -> { service.stems.setEnabled(true); service.stems.setEnabled(false); });
    check(service.stems::running, "turning preload off preserves explicit separation");
    await(() -> service.stems.cached(manualPrefix + "a") != null, "explicit separation completes");
    check(() -> !service.playing(), "separation preserves paused intent");

    String promotedPrefix = prefix + "promoted-";
    JSONArray promotedQueue = preloadItems(promotedPrefix);
    runOnMainSync(() -> {
      service.startQueue(promotedQueue, 0);
      service.stems.setEnabled(true);
    });
    await(() -> service.stems.cached(promotedPrefix + "a") != null, "promotion fixture current completes");
    await(() -> service.stems.workingKey().equals(promotedPrefix + "b"), "promotion fixture next starts");
    StemStream nextStream = service.stems.streamFor(promotedPrefix + "b");
    runOnMainSync(() -> service.select(1));
    check(() -> service.stems.stream() == nextStream, "switching to preloading song preserves its task and prefix");
    runOnMainSync(() -> service.stems.setEnabled(false));
    check(() -> service.stems.workingKey().isEmpty(), "disabling cancels automatic work");
    check(() -> service.stems.progress() == 0, "cancelled unfinished song resets progress");
    Thread.sleep(200);
    check(() -> service.stems.cached(promotedPrefix + "b") == null, "cancelled task cannot publish cache");

    PlaybackOrder order = new PlaybackOrder(new java.util.Random(15));
    order.setRepeat(PlaybackOrder.Mode.SEQUENTIAL);
    check(() -> order.peekAutomatic(3, 2) == -1, "sequential end has no preload target");
    order.setRepeat(PlaybackOrder.Mode.SINGLE_LOOP);
    check(() -> order.peekAutomatic(3, 1) == 1, "single repeat does not preload unrelated song");
    order.setRepeat(PlaybackOrder.Mode.LIST_LOOP);
    check(() -> order.peekAutomatic(3, 2) == 0, "list loop preloads wrapped next song");
    order.setShuffle(true);
    int next = order.peekAutomatic(3, 0);
    check(() -> next == order.peekAutomatic(3, 0) && next == order.next(3, 0, true),
        "shuffle reservation matches real next without consuming playback");

    JSONArray clickedQueue = preloadItems(prefix + "clicked-");
    runOnMainSync(() -> { service.startQueue(clickedQueue, 0); service.pause(); });
    await(() -> service.prepared && !service.loading, "manual button fixture prepared");
    java.lang.reflect.Method sync = MusicActivity.class.getDeclaredMethod("syncPlayback", boolean.class);
    java.lang.reflect.Method showPlayer = MusicActivity.class.getDeclaredMethod("showStemControls");
    java.lang.reflect.Field spatialField = MusicActivity.class.getDeclaredField("spatial");
    java.lang.reflect.Field actionsField = SpatialPlayer.class.getDeclaredField("actions");
    sync.setAccessible(true); showPlayer.setAccessible(true);
    spatialField.setAccessible(true); actionsField.setAccessible(true);
    runOnMainSync(() -> {
      service.observer = changed -> {
        try { sync.invoke(testActivity, changed); }
        catch (Exception e) { throw new RuntimeException(e); }
      };
      try {
        sync.invoke(testActivity, true);
        showPlayer.invoke(testActivity);
        SpatialPlayer dialog = (SpatialPlayer) spatialField.get(testActivity);
        ((SpatialPlayer.Actions) actionsField.get(dialog)).mode("vocals.wav");
      } catch (Exception e) { throw new RuntimeException(e); }
    });
    check(service.stems::running, "real player vocals action starts explicit separation");
    SpatialPlayer liveDialog = (SpatialPlayer) spatialField.get(testActivity);
    java.lang.reflect.Field sourceField = SpatialPlayer.class.getDeclaredField("source");
    sourceField.setAccessible(true);
    StemModeControl liveControl = (StemModeControl) sourceField.get(liveDialog);
    check(() -> liveControl.getMode() == 0, "unready vocals selection is reflected immediately");
    java.lang.reflect.Field progressField = StemModeControl.class.getDeclaredField("displayedProgress");
    java.lang.reflect.Field readyField = StemModeControl.class.getDeclaredField("separationReady");
    progressField.setAccessible(true); readyField.setAccessible(true);
    await(() -> service.stems.progress() > 0 && service.stems.progress() < 1
            && readFloat(progressField, liveControl) >= .25f,
        "actual processed frames reach the button progress ring");
    saveNativePlayerImage(liveDialog, "stem-progress-live.png");
    await(() -> "vocals.wav".equals(service.mode) && !service.switchingTrack(),
        "manual player action switches to first generated prefix");
    check(() -> !service.playing(), "manual prefix switch respects paused playback");
    await(() -> service.stems.cached(prefix + "clicked-a") != null, "manual player action saves full result");
    check(() -> {
      try { return readyField.getBoolean(liveControl) && service.stems.progress() == 1; }
      catch (Exception e) { throw new RuntimeException(e); }
    }, "completed separation restores the ready button state");
    Thread.sleep(250);
    saveNativePlayerImage(liveDialog, "stem-progress-complete.png");
    runOnMainSync(() -> {
      try { ((SpatialPlayer) spatialField.get(testActivity)).dismiss(); }
      catch (Exception e) { throw new RuntimeException(e); }
      service.observer = null;
    });
  }

  private void cleanupPreloadFixtures(Context target) {
    android.content.SharedPreferences cache = target.getSharedPreferences("stems", 0);
    for (java.util.Map.Entry<String, ?> entry : cache.getAll().entrySet()) {
      if (!entry.getKey().startsWith("preload-regression-")) continue;
      File folder = new File(entry.getValue().toString());
      if (folder.getParentFile().equals(target.getFilesDir()) && folder.getName().startsWith("preload-stems-")) {
        for (String name : new String[] {"vocals.wav", "accompaniment.wav"}) new File(folder, name).delete();
        folder.delete();
      }
      cache.edit().remove(entry.getKey()).commit();
      target.getSharedPreferences("stem-names", 0).edit().remove(entry.getKey()).commit();
    }
  }

  private void testStemHandoff(Context target) throws Exception {
    File folder = new File(target.getFilesDir(), "handoff-regression");
    folder.mkdirs();
    byte[] bytes = java.nio.file.Files.readAllBytes(new File(sample.getPath()).toPath());
    for (String name : new String[] {"vocals.wav", "accompaniment.wav"})
      java.nio.file.Files.write(new File(folder, name).toPath(), bytes);
    Uri vocals = Uri.fromFile(new File(folder, "vocals.wav"));
    Uri accompaniment = Uri.fromFile(new File(folder, "accompaniment.wav"));
    runOnMainSync(() -> service.local(sample, "handoff fixture"));
    await(() -> service.playing() && !service.loading, "handoff original starts");
    int duration = service.duration();
    runOnMainSync(() -> service.seek(1500));
    await(() -> service.position() >= 1500, "handoff fixture seeks");
    org.json.JSONArray trace = new org.json.JSONArray();
    for (int n = 0; n < 6; n++) {
      int mode = n % 3;
      runOnMainSync(() -> service.switchTrack(mode == 0 ? vocals : mode == 1 ? accompaniment : sample,
          mode == 0 ? "vocals.wav" : mode == 1 ? "accompaniment.wav" : null));
      long start = SystemClock.uptimeMillis(), lastTime = start;
      int last = service.position();
      boolean continuous = true, stableDuration = true, stablePosition = true;
      do {
        Thread.sleep(10);
        final int[] frame = new int[2];
        final boolean[] state = new boolean[1];
        runOnMainSync(() -> {
          frame[0] = service.position(); frame[1] = service.duration();
          state[0] = service.playing() && service.prepared && !service.loading;
        });
        long now = SystemClock.uptimeMillis();
        continuous &= state[0];
        stableDuration &= frame[1] == duration;
        stablePosition &= frame[0] >= last - 5 && frame[0] - last <= now - lastTime + 55;
        trace.put(new JSONObject().put("switch", n).put("elapsed", now - start)
            .put("position", frame[0]).put("duration", frame[1]).put("playing", state[0]));
        last = frame[0]; lastTime = now;
      } while ((read(service::switchingTrack) || SystemClock.uptimeMillis() - start < 250)
          && SystemClock.uptimeMillis() - start < 5000);
      final boolean playingContinuous = continuous, durationStable = stableDuration, positionStable = stablePosition;
      check(() -> playingContinuous, "old output keeps playing throughout handoff " + n);
      check(() -> durationStable && positionStable, "timeline has no reset, reversal or jump " + n);
      check(() -> !service.switchingTrack() && service.error.isEmpty(), "handoff completes " + n);
    }
    runOnMainSync(() -> {
      service.switchTrack(vocals, "vocals.wav");
      service.switchTrack(accompaniment, "accompaniment.wav");
      service.switchTrack(vocals, "vocals.wav");
    });
    await(() -> !service.switchingTrack(), "latest rapid request completes");
    check(() -> "vocals.wav".equals(service.mode) && service.playing(), "latest request wins without stopping");
    runOnMainSync(() -> {
      service.switchTrack(accompaniment, "accompaniment.wav");
      service.pause();
    });
    int paused = service.position();
    await(() -> !service.switchingTrack(), "pause during handoff completes");
    check(() -> !service.playing() && Math.abs(service.position() - paused) <= 5,
        "pause intent and position survive preparation");
    runOnMainSync(service::play);
    Object active = service.player;
    String oldMode = service.mode;
    runOnMainSync(() -> service.switchTrack(Uri.fromFile(new File(folder, "missing.wav")), "vocals.wav"));
    await(() -> !service.switchingTrack(), "failed candidate cancels");
    check(() -> service.player == active && service.playing() && java.util.Objects.equals(oldMode, service.mode),
        "failed preparation preserves active audio and restores mode");
    runOnMainSync(() -> {
      service.switchTrack(vocals, "vocals.wav");
      service.seek(500);
    });
    await(() -> service.position() >= 500 && service.position() < 1000, "seek cancels stale handoff");
    check(() -> !service.switchingTrack() && service.playing(), "seek cannot commit stale incoming source");
    java.nio.file.Files.write(new File(target.getFilesDir(), "stem-handoff-trace.json").toPath(),
        trace.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    // Growing PCM and return to the original use the same handoff path.
    StemStream stream = new StemStream(folder);
    stream.commit(48000, (bytes.length - 44) / 4);
    runOnMainSync(() -> service.preview(stream, "vocals.wav"));
    await(() -> !service.switchingTrack() && service.previewing(stream), "live PCM handoff completes");
    check(() -> service.playing() && service.duration() == duration, "live PCM retains playing state and duration");
    java.lang.reflect.Field liveField = PlaybackService.class.getDeclaredField("livePlayer");
    liveField.setAccessible(true);
    LiveStemPlayer frontierPlayer = (LiveStemPlayer) liveField.get(service);
    await(() -> frontierPlayer.position() >= 1000, "live PCM reaches producer frontier");
    runOnMainSync(() -> service.cancelPreview(stream));
    await(() -> !service.switchingTrack() && service.mode == null, "live PCM returns to original");
    check(service::playing, "return to original retains playing state");
    StemStream cancelled = new StemStream(folder);
    cancelled.commit((bytes.length - 44) / 4, (bytes.length - 44) / 4);
    runOnMainSync(() -> service.preview(cancelled, "vocals.wav"));
    await(() -> !service.switchingTrack() && service.previewing(cancelled), "cancel fixture enters live PCM");
    runOnMainSync(() -> {
      cancelled.cancel();
      service.cancelPreview(cancelled);
    });
    await(() -> !service.switchingTrack() && service.mode == null, "cancelled producer returns to original");
    check(() -> service.playing() && service.error.isEmpty(), "stale live failure cannot abort return handoff");
    runOnMainSync(() -> {
      service.preview(stream, "vocals.wav");
      service.step(1);
    });
    await(() -> service.playing() && !service.loading && !service.switchingTrack(), "queue step cancels incoming source");
  }

  private void testProgressiveStream(Context target) throws Exception {
    File folder = new File(target.getFilesDir(), "progressive-regression");
    folder.mkdirs();
    File source = new File(target.getFilesDir(), "playback-regression.wav");
    byte[] bytes = java.nio.file.Files.readAllBytes(source.toPath());
    int first = 44 + 192000 * 2;
    try (FileOutputStream out = new FileOutputStream(new File(folder, "vocals.wav.part"))) {
      out.write(bytes, 0, first);
    }
    StemStream stream = new StemStream(folder);
    stream.commit(96000, (bytes.length - 44) / 4);
    runOnMainSync(
        () -> {
          service.startQueue(items(), 0);
          service.pause();
        });
    await(() -> service.prepared && !service.loading, "progressive original ready");
    runOnMainSync(
        () -> {
          service.seek(0);
          service.preview(stream, "vocals.wav");
          service.play();
        });
    await(() -> service.playing(), "partial stem starts before producer finishes");
    check(
        () -> stream.milliseconds() == 2000 && service.mode.equals("vocals.wav"),
        "playing committed 2s prefix of 10s stem");
    // The consumer must wait instead of interpreting the frontier as end-of-track.
    Thread.sleep(2300);
    check(
        () -> service.index == 0 && service.error.isEmpty() && service.position() <= 2100,
        "producer frontier does not skip song or report decode error");
    try (FileOutputStream out = new FileOutputStream(new File(folder, "vocals.wav.part"), true)) {
      out.write(bytes, first, bytes.length - first);
    }
    stream.commit((bytes.length - 44) / 4, (bytes.length - 44) / 4);
    stream.finish();
    await(
        () -> service.playing() && service.position() > 2100,
        "consumer continues after producer advances");
    runOnMainSync(() -> service.cancelPreview(stream));
    await(
        () -> service.prepared && !service.loading && service.mode == null,
        "cancel preview returns to original");
  }

  private void testRealSeparationPreview(Context target) throws Exception {
    File folder =
        new File(target.getFilesDir(), "real-stem-regression-" + System.currentTimeMillis());
    folder.mkdirs();
    StemStream stream = new StemStream(folder);
    runOnMainSync(
        () -> {
          service.startQueue(items(), 0);
          service.pause();
        });
    await(() -> service.prepared && !service.loading, "real separation source");
    final boolean[] heard = {false};
    AudioJob.run(
        target,
        sample,
        folder,
        new AudioJob.Progress() {
          public boolean cancelled() {
            return false;
          }

          public void update(String text) {}

          public void partial(long frames, long total) {
            stream.commit(frames, total);
            if (!heard[0] && frames >= 48000 && frames < total) {
              runOnMainSync(
                  () -> {
                    service.seek(0);
                    service.preview(stream, "vocals.wav");
                    service.play();
                  });
              check(() -> service.playing(), "real model output plays before full separation");
              heard[0] = true;
            }
          }
        });
    stream.finish();
    check(
        () -> heard[0] && new File(folder, "vocals.wav").isFile(),
        "partial playback survives final rename");
    runOnMainSync(() -> service.cancelPreview(stream));
    await(() -> service.prepared && !service.loading, "return from real preview");
  }

  private void testAccountStore(Context target) throws Exception {
    Context isolated =
        new android.content.ContextWrapper(target) {
          public android.content.SharedPreferences getSharedPreferences(String name, int mode) {
            return super.getSharedPreferences("account-regression-" + name, mode);
          }
        };
    isolated.getSharedPreferences("account", 0).edit().clear().commit();
    isolated.getSharedPreferences("accounts", 0).edit().clear().commit();
    SessionStore store = new SessionStore(isolated);
    store.save("test-session-one");
    store.remember(new JSONObject().put("userId", 1001).put("nickname", "Test One"));
    store.save("test-session-two");
    store.remember(new JSONObject().put("userId", 1002).put("nickname", "Test Two"));
    if (store.accounts().length() != 2) throw new AssertionError("remember both accounts");
    checks++;
    store.activate(1001);
    if (!store.load().equals("test-session-one"))
      throw new AssertionError("switch encrypted session");
    checks++;
    store.clear();
    if (store.accounts().length() != 1 || !store.load().isEmpty())
      throw new AssertionError("logout only active account");
    checks++;
    store.activate(1002);
    if (!store.load().equals("test-session-two"))
      throw new AssertionError("other account retained");
    checks++;
    if (isolated
        .getSharedPreferences("account", 0)
        .getString("session", "")
        .contains("test-session")) throw new AssertionError("plaintext session stored");
    checks++;
    isolated.getSharedPreferences("account", 0).edit().clear().commit();
    isolated.getSharedPreferences("accounts", 0).edit().clear().commit();
  }

  private void invokeActivity(String name, Class<?>[] types, Object... values) {
    try {
      java.lang.reflect.Method method = MusicActivity.class.getDeclaredMethod(name, types);
      method.setAccessible(true);
      method.invoke(testActivity, values);
    } catch (Exception e) {
      throw new RuntimeException(e);
    }
  }

  private SpatialPlayer photoPlayer() {
    try {
      java.lang.reflect.Field field = MusicActivity.class.getDeclaredField("spatial");
      field.setAccessible(true);
      return (SpatialPlayer) field.get(testActivity);
    } catch (Exception e) {
      throw new RuntimeException(e);
    }
  }

  private void testPlayerMorph() throws Exception {
    AtomicReference<SpatialPlayer> shown = new AtomicReference<>();
    AtomicReference<CompactPlayerView> compact = new AtomicReference<>();
    java.util.concurrent.atomic.AtomicInteger toggles =
        new java.util.concurrent.atomic.AtomicInteger();
    java.util.concurrent.atomic.AtomicBoolean playState =
        new java.util.concurrent.atomic.AtomicBoolean();
    PlaybackOrder sampleOrder = new PlaybackOrder(new java.util.Random(12));
    java.util.concurrent.atomic.AtomicInteger touchActions =
        new java.util.concurrent.atomic.AtomicInteger();
    java.util.concurrent.atomic.AtomicInteger downloadClicks =
        new java.util.concurrent.atomic.AtomicInteger();
    Runnable reopen =
        () -> {
          if (compact.get() != null && !capsuleDragOnly)
            compact.get().setVisibility(android.view.View.GONE);
          SpatialPlayer dialog =
              new SpatialPlayer(
                  testActivity,
                  "收起动画预览",
                  "本地动效检查",
                  "",
                  new String[] {"预览"},
                  new String[] {""},
                  new String[] {"本地动效检查"},
                  new String[] {""},
                  0,
                  new SpatialPlayer.Actions() {
                    public void toggle() {
                      toggles.incrementAndGet();
                      playState.set(!playState.get());
                      shown.get().playback(0, 180000, playState.get());
                    }

                    public void seek(int v) {
                      touchActions.incrementAndGet();
                    }

                    public void previous() {
                      swipePrevious.incrementAndGet();
                      if (trackDepthOnly) updateSwipeTrack(shown.get());
                    }

                    public void next() {
                      swipeNext.incrementAndGet();
                      if (trackDepthOnly) updateSwipeTrack(shown.get());
                    }

                    public void split() {}

                    public void mode(String v) {
                      requestedStemMode = v == null ? "original" : v;
                      touchActions.incrementAndGet();
                    }

                    public void export() {}

                    public void queue(int v) {
                      railQueueSelection = v;
                      if (railScrollProbe) setRailScrollTrack(shown.get(), v);
                    }

                    public void favorite(boolean v) {
                      touchActions.incrementAndGet();
                    }

                    public void order(PlaybackOrder.Mode value) {
                      sampleOrder.setRepeat(value);
                    }

                    public void shuffle(boolean enabled) {
                      sampleOrder.setShuffle(enabled);
                    }

                    public void download() {
                      downloadClicks.incrementAndGet();
                    }
                  });
          shown.set(dialog);
          if (capsuleDragOnly)
            dialog
                .getWindow()
                .addFlags(
                    android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
          dialog.show();
          dialog.playback(0, 180000, playState.get());
        };
    runOnMainSync(reopen);
    if (spatialHoldOnly) {
      testSpatialHold(shown.get());
      return;
    }
    if (poseOnly) {
      testPoseSmoothing(shown.get());
      return;
    }
    if (fullPullOnly) {
      testFullScreenPull(reopen, shown, touchActions, toggles);
      return;
    }
    if (capsuleSidesOnly) {
      if (stemControlOnly) testStemControl(shown.get(), touchActions);
      else if (lyricFlipOnly) testLyricFlip(shown.get());
      else if (railSelectionOnly) testRailSelection(shown.get());
      else if (trackRoundtripOnly) testTrackRoundtrip(shown.get());
      else if (trackAutoOnly) testAutomaticTrackCard(shown.get());
      else if (trackProfileOnly) profileTrackMotion(shown.get());
      else if (trackDepthOnly) testTrackDepth(shown.get());
      else testCapsuleSides(shown.get());
      return;
    }
    if (capsuleIdleOnly) {
      testCapsuleIdle(shown.get());
      return;
    }
    if (sketchControlsOnly) {
      testSketchControls(shown.get(), sampleOrder, downloadClicks);
      return;
    }
    if (capsuleDragOnly) {
      testReversibleCapsule(reopen, shown, compact);
      return;
    }
    if (playIconOnly || pullSettleOnly) {
      // A local, recognisable artwork fixture makes the morph visible in captures.
      android.graphics.Bitmap cover =
          android.graphics.Bitmap.createBitmap(640, 640, android.graphics.Bitmap.Config.ARGB_8888);
      android.graphics.Canvas art = new android.graphics.Canvas(cover);
      android.graphics.Paint ink = new android.graphics.Paint(3);
      art.drawColor(0xff18294f);
      ink.setColor(0xffe2a75e);
      art.drawCircle(320, 320, 215, ink);
      ink.setColor(0xff4c7193);
      art.drawRect(0, 400, 640, 640, ink);
      ink.setColor(0xff18294f);
      art.drawCircle(320, 320, 65, ink);
      runOnMainSync(() -> shown.get().artwork(cover));
      if (pullSettleOnly) {
        java.lang.reflect.Field rootField = SpatialPlayer.class.getDeclaredField("root");
        rootField.setAccessible(true);
        android.view.View root = (android.view.View) rootField.get(shown.get());
        long downTime = SystemClock.uptimeMillis();
        java.util.function.BiConsumer<Integer, Float> send =
            (action, y) ->
                runOnMainSync(
                    () -> {
                      android.view.MotionEvent event =
                          android.view.MotionEvent.obtain(
                              downTime,
                              SystemClock.uptimeMillis(),
                              action,
                              500 * root.getWidth() / 931f,
                              y * root.getHeight() / 2048f,
                              0);
                      root.dispatchTouchEvent(event);
                      event.recycle();
                    });
        send.accept(0, 1250f);
        Thread.sleep(30);
        send.accept(2, 1360f);
        Thread.sleep(30);
        send.accept(2, 1510f);
        check(() -> shown.get().collapseProgress() > .3f, "drag follows the finger");
        savePlayerImage("pull-settle-following.png");
        // Re-establish a real downward release velocity after the capture.
        send.accept(2, 1530f);
        Thread.sleep(25);
        send.accept(2, 1570f);
        Thread.sleep(25);
        send.accept(1, 1610f);
        java.lang.reflect.Field animationField = root.getClass().getDeclaredField("pullAnimation");
        animationField.setAccessible(true);
        android.animation.ValueAnimator animation =
            (android.animation.ValueAnimator) animationField.get(root);
        check(
            () -> animation.getInterpolator().getInterpolation(.01f) > .005f,
            "release animation starts moving immediately");
        check(
            () -> animation.getDuration() < 480,
            "remaining animation scales to remaining travel and velocity");
        float previous = shown.get().collapseProgress();
        long deadline = SystemClock.uptimeMillis() + 1500;
        while (shown.get().isShowing() && SystemClock.uptimeMillis() < deadline) {
          Thread.sleep(12);
          final float lower = previous;
          check(() -> shown.get().collapseProgress() >= lower, "settle stays monotone");
          previous = shown.get().collapseProgress();
        }
        check(() -> !shown.get().isShowing(), "gesture finishes closing the page");
        return;
      }
      runOnMainSync(() -> shown.get().expandFromCapsule());
      waitForHeart(
          () -> shown.get().collapseProgress() > .35f && shown.get().collapseProgress() < .65f,
          "expansion has a visible intermediate frame");
      savePlayerImage("capsule-expanding-midpoint.png");
      waitForHeart(() -> shown.get().collapseProgress() == 0, "full player finishes expanding");
      java.lang.reflect.Field button = SpatialPlayer.class.getDeclaredField("playButton");
      button.setAccessible(true);
      android.view.View control = (android.view.View) button.get(shown.get());
      runOnMainSync(control::performClick);
      waitForIdleSync();
      Thread.sleep(120);
      android.graphics.Bitmap pause = getUiAutomation().takeScreenshot();
      int x = Math.round((790 + PlayerMorph.PLAY_OFFSET_X) * pause.getWidth() / 931f),
          y = Math.round(1815 * pause.getHeight() / 2048f);
      int pausePixel = pause.getPixel(x, y);
      pause.recycle();
      check(
          () -> android.graphics.Color.red(pausePixel) < 50,
          "expanded play icon changes to pause bars");
      runOnMainSync(control::performClick);
      waitForIdleSync();
      Thread.sleep(120);
      android.graphics.Bitmap triangle = getUiAutomation().takeScreenshot();
      int trianglePixel = triangle.getPixel(x, y);
      triangle.recycle();
      check(
          () -> android.graphics.Color.red(trianglePixel) > 240,
          "expanded pause icon changes to triangle");
      savePlayerImage("expanded-play-icon-fixed.png");
      runOnMainSync(() -> shown.get().dismiss());
      java.util.concurrent.atomic.AtomicInteger opens =
          new java.util.concurrent.atomic.AtomicInteger();
      CompactPlayerView mini =
          new CompactPlayerView(testActivity, opens::incrementAndGet, () -> {});
      float sw =
          testActivity.getWindowManager().getCurrentWindowMetrics().getBounds().width() / 931f;
      float sh =
          testActivity.getWindowManager().getCurrentWindowMetrics().getBounds().height() / 2048f;
      float[][] moves = {
        {700, 1815, 610, 1815},
        {700, 1815, 700, 1710},
        {700, 1815, 800, 1815},
        {700, 1815, 700, 1920}
      };
      for (int i = 0; i < moves.length; i++) {
        float[] m = moves[i];
        runOnMainSync(
            () -> {
              long time = SystemClock.uptimeMillis();
              android.view.MotionEvent down =
                  android.view.MotionEvent.obtain(time, time, 0, m[0] * sw, m[1] * sh, 0);
              android.view.MotionEvent up =
                  android.view.MotionEvent.obtain(time, time + 200, 1, m[2] * sw, m[3] * sh, 0);
              mini.onTouchEvent(down);
              mini.onTouchEvent(up);
              down.recycle();
              up.recycle();
            });
        final int expected = i < 2 ? i + 1 : 2;
        check(() -> opens.get() == expected, "left/up swipes expand; right/down do not");
      }
      return;
    }
    runOnMainSync(
        () ->
            shown
                .get()
                .setOnCollapsed(
                    bitmap -> {
                      CompactPlayerView mini =
                          new CompactPlayerView(
                              testActivity,
                              () -> {
                                reopen.run();
                                shown.get().expandFromCapsule();
                              },
                              () -> {
                                toggles.incrementAndGet();
                                playState.set(!playState.get());
                                compact.get().state(bitmap, playState.get());
                              });
                      compact.set(mini);
                      mini.state(bitmap, false);
                      testActivity.addContentView(
                          mini, new android.view.ViewGroup.LayoutParams(-1, -1));
                    }));
    waitForIdleSync();
    Thread.sleep(300);
    touch(500, 1250, android.view.MotionEvent.ACTION_DOWN);
    touch(500, 1380, android.view.MotionEvent.ACTION_MOVE);
    waitForHeart(() -> shown.get().collapseProgress() > .1f, "page follows the initial pull");
    savePlayerImage("morph-first-half.png");
    android.graphics.Bitmap shot = getUiAutomation().takeScreenshot();
    int pixel =
        shot.getPixel(
            Math.round(775 * shot.getWidth() / 931f), Math.round(1815 * shot.getHeight() / 2048f));
    shot.recycle();
    check(
        () -> android.graphics.Color.red(pixel) > 240,
        "play triangle remains at its original screen location");
    touch(500, 1700, android.view.MotionEvent.ACTION_MOVE);
    waitForHeart(
        () -> shown.get().collapseProgress() > .5f, "circular cropping starts in second half");
    savePlayerImage("morph-cropping.png");
    touch(500, 1840, android.view.MotionEvent.ACTION_MOVE);
    Thread.sleep(100);
    savePlayerImage("morph-circle.png");
    touch(500, 1840, android.view.MotionEvent.ACTION_UP);
    waitForHeart(
        () -> !shown.get().isShowing() && compact.get() != null,
        "page finishes as an interactive capsule");
    Thread.sleep(100);
    savePlayerImage("morph-mini-capsule.png");
    touch(781, 1815, android.view.MotionEvent.ACTION_DOWN);
    touch(781, 1815, android.view.MotionEvent.ACTION_UP);
    waitForHeart(() -> toggles.get() == 1, "mini capsule play button responds");
    touch(653, 1815, android.view.MotionEvent.ACTION_DOWN);
    touch(653, 1815, android.view.MotionEvent.ACTION_UP);
    waitForHeart(
        () -> shown.get().isShowing() && shown.get().collapseProgress() == 0,
        "round cover expands the full player");
    touch(781, 1815, android.view.MotionEvent.ACTION_DOWN);
    touch(781, 1815, android.view.MotionEvent.ACTION_UP);
    Thread.sleep(80);
    android.graphics.Bitmap triangle = getUiAutomation().takeScreenshot();
    int tx = Math.round((790 + PlayerMorph.PLAY_OFFSET_X) * triangle.getWidth() / 931f),
        ty = Math.round(1815 * triangle.getHeight() / 2048f);
    int trianglePixel = triangle.getPixel(tx, ty);
    triangle.recycle();
    check(
        () -> android.graphics.Color.red(trianglePixel) > 240,
        "expanded button repaints as play triangle");
    touch(781, 1815, android.view.MotionEvent.ACTION_DOWN);
    touch(781, 1815, android.view.MotionEvent.ACTION_UP);
    Thread.sleep(80);
    android.graphics.Bitmap pause = getUiAutomation().takeScreenshot();
    int pausePixel = pause.getPixel(tx, ty);
    pause.recycle();
    check(
        () -> android.graphics.Color.red(pausePixel) < 50,
        "expanded button repaints as pause bars");

    touch(500, 1250, android.view.MotionEvent.ACTION_DOWN);
    touch(500, 1310, android.view.MotionEvent.ACTION_MOVE);
    Thread.sleep(200);
    touch(500, 1310, android.view.MotionEvent.ACTION_UP);
    waitForHeart(
        () -> shown.get().isShowing() && shown.get().collapseProgress() == 0,
        "short pull rebounds");
    touch(500, 1250, android.view.MotionEvent.ACTION_DOWN);
    touch(500, 1700, android.view.MotionEvent.ACTION_MOVE);
    touch(500, 1700, android.view.MotionEvent.ACTION_CANCEL);
    waitForHeart(
        () -> shown.get().isShowing() && shown.get().collapseProgress() == 0,
        "cancel reverses circular cropping");
    runOnMainSync(
        () -> {
          shown.get().dismiss();
          if (compact.get() != null)
            ((android.view.ViewGroup) compact.get().getParent()).removeView(compact.get());
        });
    java.lang.reflect.Field scrollField = MusicActivity.class.getDeclaredField("pageScroll");
    scrollField.setAccessible(true);
    android.widget.ScrollView scroll = (android.widget.ScrollView) scrollField.get(testActivity);
    int before = scroll.getScrollY();
    float gapX = (PlayerMorph.NAVIGATION.right + PlayerMorph.PILL.left) / 2;
    touch(gapX, 1900, android.view.MotionEvent.ACTION_DOWN);
    touch(gapX, 1600, android.view.MotionEvent.ACTION_MOVE);
    touch(gapX, 1400, android.view.MotionEvent.ACTION_MOVE);
    touch(gapX, 1400, android.view.MotionEvent.ACTION_UP);
    waitForHeart(
        () -> scroll.getScrollY() > before,
        "floating parents pass outside touches to home scrolling");
    savePlayerImage("floating-capsules-scroll-through.png");
  }

  private int testRailArtwork() throws Exception {
    String prefix = "https://artwork-test.invalid/" + java.util.UUID.randomUUID() + "/";
    java.util.concurrent.atomic.AtomicInteger calls =
        new java.util.concurrent.atomic.AtomicInteger();
    ArtworkLoader fixtures =
        new ArtworkLoader(
            (url, size) -> {
              calls.incrementAndGet();
              android.graphics.Bitmap image =
                  android.graphics.Bitmap.createBitmap(
                      48, 48, android.graphics.Bitmap.Config.ARGB_8888);
              image.eraseColor(
                  android.graphics.Color.HSVToColor(
                      new float[] {Math.floorMod(url.hashCode(), 360), .65f, .85f}));
              return image;
            });
    String[] urls = new String[16];
    java.util.concurrent.CountDownLatch warm =
        new java.util.concurrent.CountDownLatch(urls.length * 2);
    for (int i = 0; i < urls.length; i++) {
      urls[i] = prefix + i;
      fixtures.load(urls[i], 256, image -> warm.countDown());
      fixtures.load(urls[i], 960, image -> warm.countDown());
    }
    if (!warm.await(4, java.util.concurrent.TimeUnit.SECONDS))
      throw new AssertionError("fixture warm-up timed out");
    fixtures.close();
    ArtworkLoader reopened =
        new ArtworkLoader(
            (url, size) -> {
              throw new IOException("cache miss after close");
            });
    java.util.concurrent.CountDownLatch reused = new java.util.concurrent.CountDownLatch(1);
    reopened.load(urls[0], 256, image -> reused.countDown());
    check(() -> reused.getCount() == 0, "closing an image loader preserves shared thumbnails");
    reopened.close();

    java.util.concurrent.atomic.AtomicInteger attempts =
        new java.util.concurrent.atomic.AtomicInteger();
    ArtworkLoader flaky =
        new ArtworkLoader(
            (url, size) -> {
              if (attempts.incrementAndGet() == 1)
                throw new IOException("temporary fixture failure");
              Thread.sleep(80);
              return android.graphics.Bitmap.createBitmap(
                  32, 32, android.graphics.Bitmap.Config.ARGB_8888);
            });
    java.util.concurrent.CountDownLatch retry = new java.util.concurrent.CountDownLatch(1);
    String failedUrl = prefix + "retry";
    flaky.load(
        failedUrl, 256, image -> {}, () -> flaky.load(failedUrl, 256, image -> retry.countDown()));
    if (!retry.await(4, java.util.concurrent.TimeUnit.SECONDS))
      throw new AssertionError("failure retry listeners lost");
    check(
        () -> attempts.get() == 2,
        "failed request unlocks and its immediate retry callback survives cleanup");
    flaky.close();
    android.net.Uri address =
        android.net.Uri.parse(
            ArtworkLoader.address("http://p1.music.126.net/test.jpg?param=32y32&extra=1", 256));
    check(
        () ->
            address.getQueryParameters("param").size() == 1
                && "256y256".equals(address.getQueryParameter("param"))
                && "1".equals(address.getQueryParameter("extra")),
        "CDN thumbnail sizing replaces existing dimensions instead of duplicating them");

    SpatialPlayer dialog = artworkDialog(urls);
    runOnMainSync(dialog::show);
    waitForIdleSync();
    java.lang.reflect.Field thumbField = SpatialPlayer.class.getDeclaredField("thumbnails");
    java.lang.reflect.Field rootField = SpatialPlayer.class.getDeclaredField("root");
    thumbField.setAccessible(true);
    rootField.setAccessible(true);
    android.util.LruCache<?, ?> thumbs = (android.util.LruCache<?, ?>) thumbField.get(dialog);
    check(
        () -> thumbs.snapshot().containsKey(urls[3]) && thumbs.snapshot().containsKey(urls[4]),
        "first visible five covers include positions previously outside plus/minus-two preloading");
    String[] labels = new String[urls.length],
        artists = new String[urls.length],
        albums = new String[urls.length];
    java.util.Arrays.fill(labels, "封面检查");
    java.util.Arrays.fill(artists, "");
    java.util.Arrays.fill(albums, "");
    runOnMainSync(() -> dialog.track("封面检查", "", "", labels, urls, artists, albums, 15));
    check(
        () -> thumbs.snapshot().containsKey(urls[11]) && thumbs.snapshot().containsKey(urls[14]),
        "last visible five covers are preloaded at the queue boundary");
    runOnMainSync(() -> dialog.track("封面检查", "", "", labels, urls, artists, albums, 0));
    check(
        () -> thumbs.snapshot().containsKey(urls[0]) && thumbs.snapshot().containsKey(urls[4]),
        "scroll away and back retains the original thumbnails");
    check(() -> calls.get() == urls.length * 2, "returning to cached artwork does not fetch again");
    showArtworkRail(dialog, rootField);
    saveNativePlayerImage(dialog, "rail-artwork-cache.png");
    runOnMainSync(dialog::dismiss);

    // Read public image URLs from the existing queue, without changing playback.
    JSONArray saved =
        new JSONArray(
            getTargetContext().getSharedPreferences("playback", 0).getString("queue", "[]"));
    java.lang.reflect.Method coverUrl =
        MusicActivity.class.getDeclaredMethod("coverUrl", JSONObject.class);
    coverUrl.setAccessible(true);
    java.util.LinkedHashSet<String> live = new java.util.LinkedHashSet<>();
    for (int i = 0; i < saved.length() && live.size() < 5; i++) {
      String url = (String) coverUrl.invoke(null, saved.optJSONObject(i));
      if (!url.isEmpty()) live.add(url);
    }
    if (!live.isEmpty()) {
      ArtworkLoader network = new ArtworkLoader();
      java.util.concurrent.CountDownLatch loaded =
          new java.util.concurrent.CountDownLatch(live.size());
      java.util.concurrent.atomic.AtomicInteger success =
          new java.util.concurrent.atomic.AtomicInteger();
      for (String url : live)
        network.load(
            url,
            256,
            image -> {
              success.incrementAndGet();
              loaded.countDown();
            },
            loaded::countDown);
      if (!loaded.await(20, java.util.concurrent.TimeUnit.SECONDS))
        throw new AssertionError("live cover timeout");
      check(
          () -> success.get() == live.size(),
          "real queued CDN thumbnails load successfully on the device");
      SpatialPlayer liveDialog = artworkDialog(live.toArray(new String[0]));
      runOnMainSync(liveDialog::show);
      waitForIdleSync();
      showArtworkRail(liveDialog, rootField);
      saveNativePlayerImage(liveDialog, "rail-artwork-live.png");
      runOnMainSync(liveDialog::dismiss);
      network.close();
    }
    return live.size();
  }

  private SpatialPlayer artworkDialog(String[] covers) {
    String[] labels = new String[covers.length],
        artists = new String[covers.length],
        albums = new String[covers.length];
    java.util.Arrays.fill(labels, "封面检查");
    java.util.Arrays.fill(artists, "");
    java.util.Arrays.fill(albums, "");
    AtomicReference<SpatialPlayer> result = new AtomicReference<>();
    runOnMainSync(
        () ->
            result.set(
                new SpatialPlayer(
                    testActivity,
                    "封面检查",
                    "",
                    "",
                    labels,
                    covers,
                    artists,
                    albums,
                    0,
                    new SpatialPlayer.Actions() {
                      public void toggle() {}

                      public void seek(int value) {}

                      public void previous() {}

                      public void next() {}

                      public void split() {}

                      public void mode(String name) {}

                      public void export() {}

                      public void queue(int index) {}

                      public void favorite(boolean value) {}
                    })));
    return result.get();
  }

  private void showArtworkRail(SpatialPlayer dialog, java.lang.reflect.Field rootField)
      throws Exception {
    android.widget.FrameLayout root = (android.widget.FrameLayout) rootField.get(dialog);
    java.lang.reflect.Field fraction = SpatialPlayer.class.getDeclaredField("capsuleFraction");
    fraction.setAccessible(true);
    runOnMainSync(
        () ->
            root.getChildAt(1)
                .performAccessibilityAction(
                    android.view.accessibility.AccessibilityNodeInfo.ACTION_EXPAND, null));
    waitForHeart(
        () -> {
          try {
            return fraction.getFloat(dialog) == 0;
          } catch (IllegalAccessException e) {
            throw new RuntimeException(e);
          }
        },
        "loaded artwork rail expands");
    capsuleDirectOnly = true;
    capsulePointerTarget = root;
    touch(465, 740, 0); // Hold the card so the one-second idle timer does not hide the capture.
  }

  private void testSpatialHold(SpatialPlayer dialog) throws Exception {
    java.lang.reflect.Field manager = SpatialPlayer.class.getDeclaredField("motion");
    java.lang.reflect.Field listener = SpatialPlayer.class.getDeclaredField("orientationListener");
    java.lang.reflect.Field x = SpatialPlayer.class.getDeclaredField("tiltX");
    java.lang.reflect.Field y = SpatialPlayer.class.getDeclaredField("tiltY");
    java.lang.reflect.Method matrix = SpatialPlayer.class.getDeclaredMethod("cardMatrix");
    for (java.lang.reflect.Field field : new java.lang.reflect.Field[] {manager, listener, x, y})
      field.setAccessible(true);
    matrix.setAccessible(true);
    runOnMainSync(
        () -> {
          try {
            ((android.hardware.SensorManager) manager.get(dialog))
                .unregisterListener((android.hardware.SensorEventListener) listener.get(dialog));
            x.setFloat(dialog, -12);
            y.setFloat(dialog, 20);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    float[] center = {358, 743};
    ((android.graphics.Matrix) matrix.invoke(dialog)).mapPoints(center);
    check(
        () ->
            Math.abs(center[0] - (465.5f + 20 * 110f / 45)) < .01f
                && Math.abs(center[1] - (743 + 12 * 110f / 45)) < .01f,
        "translation follows card tilt direction on both axes");
    runOnMainSync(
        () -> {
          try {
            x.setFloat(dialog, 0);
            y.setFloat(dialog, 0);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    float[] neutral = {358, 743};
    ((android.graphics.Matrix) matrix.invoke(dialog)).mapPoints(neutral);
    check(
        () -> Math.abs(neutral[0] - 465.5f) < .01f && Math.abs(neutral[1] - 743) < .01f,
        "neutral tilt immediately removes translation with no position retention");
    Thread.sleep(100);
    float[] later = {358, 743};
    ((android.graphics.Matrix) matrix.invoke(dialog)).mapPoints(later);
    check(
        () -> java.util.Arrays.equals(later, neutral),
        "no independent inertia or delayed position drift remains");
    runOnMainSync(dialog::dismiss);
  }

  private void testPoseSmoothing(SpatialPlayer dialog) throws Exception {
    java.lang.reflect.Method update =
        SpatialPlayer.class.getDeclaredMethod("updateOrientation", float.class, float.class);
    update.setAccessible(true);
    java.lang.reflect.Field manager = SpatialPlayer.class.getDeclaredField("motion");
    java.lang.reflect.Field listener = SpatialPlayer.class.getDeclaredField("orientationListener");
    java.lang.reflect.Field ready = SpatialPlayer.class.getDeclaredField("orientationReady");
    java.lang.reflect.Field x = SpatialPlayer.class.getDeclaredField("tiltX");
    java.lang.reflect.Field y = SpatialPlayer.class.getDeclaredField("tiltY");
    java.lang.reflect.Field frames = SpatialPlayer.class.getDeclaredField("poseRenderedFrames");
    java.lang.reflect.Field dragging = SpatialPlayer.class.getDeclaredField("cardDragging");
    java.lang.reflect.Field scheduled = SpatialPlayer.class.getDeclaredField("poseFrameScheduled");
    for (java.lang.reflect.Field field :
        new java.lang.reflect.Field[] {manager, listener, ready, x, y, frames, dragging, scheduled})
      field.setAccessible(true);
    runOnMainSync(
        () -> {
          try {
            android.hardware.SensorManager sensors =
                (android.hardware.SensorManager) manager.get(dialog);
            if (sensors != null)
              sensors.unregisterListener(
                  (android.hardware.SensorEventListener) listener.get(dialog));
            ready.setBoolean(dialog, false);
            x.setFloat(dialog, 0);
            y.setFloat(dialog, 0);
            update.invoke(dialog, 0f, 0f);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    runOnMainSync(
        () -> {
          try {
            update.invoke(dialog, (float) Math.toRadians(1), (float) Math.toRadians(1));
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    Thread.sleep(50);
    check(
        () -> readFloat(x, dialog) == 0 && readFloat(y, dialog) == 0,
        "enhanced dead zone filters small hand tremors");
    long start = SystemClock.uptimeMillis();
    float[] previous = {0};
    for (int i = 0; i < 10; i++) {
      float pitch = .15f + i * .025f;
      runOnMainSync(
          () -> {
            try {
              update.invoke(dialog, pitch, -pitch * .5f);
            } catch (Exception e) {
              throw new RuntimeException(e);
            }
          });
      Thread.sleep(35);
      check(
          () -> readFloat(x, dialog) >= previous[0] && readFloat(x, dialog) <= 45,
          "display-frame interpolation follows increasing target without overshoot");
      previous[0] = x.getFloat(dialog);
    }
    check(
        () -> readFloat(x, dialog) > 0 && readFloat(y, dialog) > 0,
        "pitch and yaw both follow the restored sensor direction");
    long elapsed = SystemClock.uptimeMillis() - start;
    int rendered = frames.getInt(dialog);
    poseCadence =
        rendered
            + " interpolation callbacks / "
            + elapsed
            + "ms; display="
            + testActivity.getDisplay().getRefreshRate()
            + "Hz; callback rate="
            + Math.round(rendered * 1000f / elapsed)
            + "Hz (not measured presented FPS)";
    check(
        () -> rendered > 10,
        "sensor targets produce additional screen-synchronous intermediate frames");
    saveNativePlayerImage(dialog, "pose-smoothing-native.png");
    runOnMainSync(
        () -> {
          try {
            dragging.setBoolean(dialog, true);
            update.invoke(dialog, .6f, .4f);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    float held = x.getFloat(dialog);
    Thread.sleep(100);
    check(() -> readFloat(x, dialog) == held, "dragging freezes interpolated pose too");
    runOnMainSync(
        () -> {
          try {
            dragging.setBoolean(dialog, false);
            update.invoke(dialog, 2f, 2f);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    waitForHeart(
        () -> readFloat(x, dialog) > 35 && readFloat(x, dialog) <= 45,
        "resumed interpolation retains the 45-degree limit");
    runOnMainSync(dialog::dismiss);
    check(
        () -> {
          try {
            return !scheduled.getBoolean(dialog);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        },
        "closing removes the display frame callback");
  }

  private void testFullScreenPull(
      Runnable reopen,
      AtomicReference<SpatialPlayer> shown,
      java.util.concurrent.atomic.AtomicInteger actions,
      java.util.concurrent.atomic.AtomicInteger toggles)
      throws Exception {
    java.lang.reflect.Field rootField = SpatialPlayer.class.getDeclaredField("root");
    java.lang.reflect.Field capsule = SpatialPlayer.class.getDeclaredField("capsuleFraction");
    rootField.setAccessible(true);
    capsule.setAccessible(true);
    float[][] starts = {{450, 700}, {300, 1425}, {145, 1608}, {763, 1815}, {300, 1800}, {801, 620}};
    capsuleDirectOnly = true;
    for (int i = 0; i < starts.length; i++) {
      if (i > 0) runOnMainSync(reopen);
      waitForIdleSync();
      android.widget.FrameLayout root = (android.widget.FrameLayout) rootField.get(shown.get());
      capsulePointerTarget = root;
      if (i == starts.length - 1) {
        runOnMainSync(
            () ->
                root.getChildAt(1)
                    .performAccessibilityAction(
                        android.view.accessibility.AccessibilityNodeInfo.ACTION_EXPAND, null));
        waitForHeart(
            () -> readFloat(capsule, shown.get()) == 0,
            "reveal rail for full-screen dismissal check");
      }
      float x = starts[i][0], y = starts[i][1];
      touch(x, y, 0);
      touch(x, y + 180, 2);
      if (i == starts.length - 1) {
        check(
            () -> shown.get().collapseProgress() == 0,
            "right rail downward gesture is excluded from dismissal");
        touch(x, y + 180, 3);
        runOnMainSync(() -> shown.get().dismiss());
        continue;
      }
      check(
          () -> shown.get().collapseProgress() > .2f,
          "downward drag follows from card, seek, favorite, play, source or rail");
      if (i == 0) saveNativePlayerImage(shown.get(), "full-screen-pull-following.png");
      touch(x, y + 180, 1);
      waitForHeart(
          () -> !shown.get().isShowing(), "downward gesture closes from this control area");
    }
    check(
        () -> actions.get() == 0 && toggles.get() == 0,
        "intercepted drags do not click controls or commit seek/source/favorite");
    runOnMainSync(reopen);
    waitForIdleSync();
    capsulePointerTarget = (android.view.View) rootField.get(shown.get());
    touch(300, 1425, 0);
    touch(480, 1425, 2);
    touch(480, 1425, 1);
    check(
        () -> actions.get() == 1 && shown.get().collapseProgress() == 0,
        "horizontal seeking retains control ownership");
    touch(450, 700, 0);
    touch(450, 710, 2);
    touch(450, 710, 3);
    waitForHeart(
        () -> shown.get().collapseProgress() == 0, "cancelled short pull restores full player");
    touch(450, 700, 0);
    touch(740, 700, 2);
    touch(740, 700, 1);
    waitForHeart(
        () -> readFloat(capsule, shown.get()) == 0, "reveal left rail for exclusion check");
    touch(129, 620, 0);
    touch(129, 800, 2);
    check(() -> shown.get().collapseProgress() == 0, "left rail downward gesture is excluded too");
    touch(129, 800, 3);
    runOnMainSync(() -> shown.get().dismiss());
  }

  private void updateSwipeTrack(SpatialPlayer dialog) {
    String[] titles = {"手势测试一", "手势测试二", "手势测试三", "手势测试四", "手势测试五"};
    String[] empty = {"", "", "", "", ""};
    int index = Math.floorMod(swipeNext.get() - swipePrevious.get(), titles.length);
    dialog.track(titles[index], "隔离手势测试", "", titles, empty, empty, empty, index);
  }

  private void checkHardwareCardVisible(String name) throws Exception {
    android.graphics.Bitmap screen = getUiAutomation().takeScreenshot();
    int white = 0;
    for (int y = screen.getHeight() * 300 / 2048; y < screen.getHeight() * 1210 / 2048; y += 8)
      for (int x = 0; x < screen.getWidth(); x += 8) {
        int pixel = screen.getPixel(x, y);
        if (android.graphics.Color.red(pixel) > 220
            && android.graphics.Color.green(pixel) > 220
            && android.graphics.Color.blue(pixel) > 220) white++;
      }
    try (OutputStream out =
        new FileOutputStream(new File(getTargetContext().getFilesDir(), name + ".png"))) {
      screen.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out);
    }
    screen.recycle();
    final int visiblePixels = white;
    check(() -> visiblePixels > 400, "GPU window contains the visible song card: " + name);
  }

  private void testAutomaticTrackCard(SpatialPlayer dialog) throws Exception {
    java.lang.reflect.Field animation = SpatialPlayer.class.getDeclaredField("trackAnimation");
    java.lang.reflect.Field fraction = SpatialPlayer.class.getDeclaredField("capsuleFraction");
    java.lang.reflect.Field progress = SpatialPlayer.class.getDeclaredField("trackProgress");
    for (java.lang.reflect.Field field :
        new java.lang.reflect.Field[] {animation, fraction, progress}) field.setAccessible(true);
    String[] titles = {"自动播放一", "自动播放二", "自动播放三", "自动播放四"};
    String[] empty = {"", "", "", ""};
    android.graphics.Bitmap lateCover =
        android.graphics.Bitmap.createBitmap(640, 640, android.graphics.Bitmap.Config.ARGB_8888);
    lateCover.eraseColor(0xff335b85);
    for (int index = 0; index < 12; index++) {
      final int selected = index % 2;
      runOnMainSync(
          () ->
              dialog.track(titles[selected], "自动续播测试", "", titles, empty, empty, empty, selected));
      Object active = animation.get(dialog);
      check(
          () -> active != null, "external track callback starts a card transition without a swipe");
      runOnMainSync(
          () ->
              dialog.track(titles[selected], "自动续播测试", "", titles, empty, empty, empty, selected));
      check(
          () -> {
            try {
              return animation.get(dialog) == active;
            } catch (Exception e) {
              throw new RuntimeException(e);
            }
          },
          "repeated metadata update does not restart automatic transition");
      Thread.sleep(120);
      checkHardwareCardVisible("auto-card-mid-" + index);
      runOnMainSync(() -> dialog.artwork(lateCover));
      Thread.sleep(450);
      check(
          () -> readFloat(progress, dialog) == 0,
          "automatic track transition clears outgoing state");
      checkHardwareCardVisible("auto-card-settled-" + index);
      check(() -> readFloat(fraction, dialog) == 1, "automatic track keeps hidden rail hidden");
    }
    check(
        () -> swipeNext.get() == 0 && swipePrevious.get() == 0,
        "automatic updates never dispatch a duplicate playback command");
    runOnMainSync(dialog::dismiss);
    lateCover.recycle();
  }

  private void testTrackRoundtrip(SpatialPlayer dialog) throws Exception {
    java.lang.reflect.Field root = SpatialPlayer.class.getDeclaredField("root");
    java.lang.reflect.Field spring = SpatialPlayer.class.getDeclaredField("capsuleSpring");
    java.lang.reflect.Field fraction = SpatialPlayer.class.getDeclaredField("capsuleFraction");
    for (java.lang.reflect.Field field : new java.lang.reflect.Field[] {root, spring, fraction})
      field.setAccessible(true);
    capsuleDirectOnly = true;
    capsulePointerTarget = (android.view.View) root.get(dialog);
    runOnMainSync(() -> updateSwipeTrack(dialog));
    BooleanSupplier resting =
        () -> {
          try {
            return spring.get(dialog) == null;
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        };
    for (int round = 0; round < 6; round++) {
      for (int direction : new int[] {-1, 1}) {
        touch(465, 740, 0);
        touch(direction < 0 ? 190 : 740, 740, 2);
        touch(direction < 0 ? 190 : 740, 740, 1);
        waitForHeart(resting, "roundtrip rail revealed");
        float x = direction < 0 ? 340 : 600;
        touch(x, 740, 0);
        touch(x + direction * 180, 740, 2);
        touch(x + direction * 180, 740, 1);
        Thread.sleep(480);
        checkHardwareCardVisible("roundtrip-card-" + round + "-" + direction);
        touch(x, 740, 0);
        touch(x - direction * 90, 740, 2);
        touch(x - direction * 90, 740, 1);
        waitForHeart(resting, "roundtrip reverse closes rail");
        check(() -> readFloat(fraction, dialog) == 1, "roundtrip reverse only closes capsule");
      }
      final int count = round + 1;
      check(
          () -> swipeNext.get() == count && swipePrevious.get() == count,
          "repeated next/previous roundtrip remains operational");
    }
    runOnMainSync(dialog::dismiss);
  }

  private void setRailScrollTrack(SpatialPlayer dialog, int selected) {
    String[] names = {"滚动一", "滚动二", "滚动三", "滚动四", "滚动五", "滚动六", "滚动七", "滚动八"};
    String[] empty = {"", "", "", "", "", "", "", ""};
    dialog.track(names[selected], "列表滚动测试", "", names, empty, empty, empty, selected);
  }

  private void testStemControl(
      SpatialPlayer dialog, java.util.concurrent.atomic.AtomicInteger actions) throws Exception {
    java.lang.reflect.Field root = SpatialPlayer.class.getDeclaredField("root");
    java.lang.reflect.Field source = SpatialPlayer.class.getDeclaredField("source");
    root.setAccessible(true);
    source.setAccessible(true);
    capsuleDirectOnly = true;
    capsulePointerTarget = (android.view.View) root.get(dialog);
    StemModeControl control = (StemModeControl) source.get(dialog);
    check(
        () -> control.getMode() == 1 && !control.isExpanded(),
        "single original-audio button is the default");
    tap(198, 1845);
    java.lang.reflect.Field animationField = StemModeControl.class.getDeclaredField("animator");
    java.lang.reflect.Field expansionField = StemModeControl.class.getDeclaredField("expansion");
    animationField.setAccessible(true);
    expansionField.setAccessible(true);
    runOnMainSync(
        () -> {
          try {
            android.animation.ValueAnimator animation =
                (android.animation.ValueAnimator) animationField.get(control);
            animation.pause();
            animation.setCurrentPlayTime(280);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    check(
        () -> readFloat(expansionField, control) > .7f && readFloat(expansionField, control) < 1,
        "liquid opening retains intermediate separation geometry");
    saveNativePlayerImage(dialog, "stem-liquid-opening.png");
    float heldExpansion = readFloat(expansionField, control);
    runOnMainSync(() -> control.getChildAt(2).performClick());
    check(
        () -> Math.abs(readFloat(expansionField, control) - heldExpansion) < .001f,
        "liquid animation reverses from current geometry without jumping");
    runOnMainSync(
        () -> {
          try {
            android.animation.ValueAnimator animation =
                (android.animation.ValueAnimator) animationField.get(control);
            animation.pause();
            animation.setCurrentPlayTime(animation.getDuration() / 3);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    saveNativePlayerImage(dialog, "stem-liquid-closing.png");
    runOnMainSync(
        () -> {
          try {
            ((android.animation.ValueAnimator) animationField.get(control)).end();
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    check(
        () -> !control.isExpanded() && readFloat(expansionField, control) == 0,
        "liquid merge ends fully collapsed");
    runOnMainSync(
        () -> {
          control.getChildAt(2).performClick();
          try {
            ((android.animation.ValueAnimator) animationField.get(control)).end();
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    check(
        () -> control.isExpanded() && readFloat(expansionField, control) == 1,
        "liquid opening settles at exact reference-circle endpoints");

    check(
        () ->
            control.isExpanded()
                && control.getChildAt(0).getVisibility() == android.view.View.VISIBLE
                && control.getChildAt(1).getVisibility() == android.view.View.VISIBLE,
        "main click opens both satellite circles");
    check(
        () ->
            control.getChildAt(0).getLeft() == control.getChildAt(1).getLeft()
                && control.getChildAt(0).getBottom() < control.getChildAt(1).getTop(),
        "satellites form a compact right-side vertical column with distinct hit areas");
    android.view.View main = control.getChildAt(2),
        first = control.getChildAt(0),
        second = control.getChildAt(1);
    float mx = main.getLeft() + main.getWidth() / 2f, my = main.getTop() + main.getHeight() / 2f;
    double radiusOne =
        Math.hypot(
            first.getLeft() + first.getWidth() / 2f - mx,
            first.getTop() + first.getHeight() / 2f - my);
    double radiusTwo =
        Math.hypot(
            second.getLeft() + second.getWidth() / 2f - mx,
            second.getTop() + second.getHeight() / 2f - my);
    check(
        () ->
            Math.abs(radiusOne - radiusTwo) < 2
                && Math.abs(radiusOne - 150 * control.getWidth() / 520f) < 2,
        "satellites lie on one reference circle concentric with the main button");
    saveNativePlayerImage(dialog, "stem-circles-expanded.png");
    tap(348, 1780);
    java.lang.reflect.Field swapField = StemModeControl.class.getDeclaredField("swapAnimator");
    swapField.setAccessible(true);
    runOnMainSync(() -> {
      try {
        android.animation.ValueAnimator swap = (android.animation.ValueAnimator) swapField.get(control);
        swap.pause();
        swap.setCurrentPlayTime(210);
      } catch (Exception e) { throw new RuntimeException(e); }
    });
    saveNativePlayerImage(dialog, "stem-swap-midpoint.png");
    java.lang.reflect.Method sample = StemModeControl.class.getDeclaredMethod("sampleSwap", int.class, float[].class);
    java.lang.reflect.Field fromField = StemModeControl.class.getDeclaredField("swapFrom");
    sample.setAccessible(true);
    fromField.setAccessible(true);
    float[] held = new float[4];
    runOnMainSync(() -> {
      try { sample.invoke(control, 0, held); }
      catch (Exception e) { throw new RuntimeException(e); }
      second.performClick();
    });
    check(() -> control.getMode() == 2 && requestedStemMode.equals("accompaniment.wav"),
        "rapid mode selection commits immediately during exchange");
    float[][] starts = (float[][]) fromField.get(control);
    check(() -> Math.abs(starts[0][0] - held[0]) < .001f && Math.abs(starts[0][1] - held[1]) < .001f,
        "exchange retargets from visible icon position without jumping");
    runOnMainSync(() -> second.performClick());
    Thread.sleep(430);
    check(
        () -> control.getMode() == 0 && requestedStemMode.equals("vocals.wav"),
        "microphone selects actual vocals mode");
    check(control::isExpanded, "mode selection remains expanded before idle timeout");
    saveNativePlayerImage(dialog, "stem-circles-vocals.png");
    // Capturing a native frame can cross the idle boundary.
    runOnMainSync(() -> { if (control.isExpanded()) main.performClick(); });
    Thread.sleep(450);
    check(
        () ->
            !control.isExpanded()
                && control.getChildAt(0).getVisibility() == android.view.View.INVISIBLE,
        "manual or idle collapse hides satellite hit targets");
    check(() -> control.getMode() == 0, "collapse preserves the chosen main-button mode");
    tap(198, 1845);
    Thread.sleep(450);
    tap(348, 1780);
    check(
        () -> control.getMode() == 1 && requestedStemMode.equals("original"),
        "swapped option switches back to original audio");
    tap(348, 1910);
    check(
        () -> control.getMode() == 2 && requestedStemMode.equals("accompaniment.wav"),
        "notes select actual accompaniment mode");
    int before = actions.get();
    touch(348, 1780, 0);
    touch(348, 1880, 2);
    touch(348, 1880, 3);
    Thread.sleep(500);
    check(() -> actions.get() == before, "page drag cancellation never selects a stem mode");
    runOnMainSync(() -> control.setMode(0));
    check(() -> control.getMode() == 0, "playback state can synchronize the control externally");
    runOnMainSync(() -> {
      if (control.isExpanded()) main.performClick();
      main.performClick();
    });
    Thread.sleep(450);
    touch(348, 1780, 0);
    Thread.sleep(2200);
    check(control::isExpanded, "held touch suspends automatic collapse");
    touch(348, 1780, 1);
    Thread.sleep(2100);
    check(() -> !control.isExpanded(), "idle two seconds after release collapses options");
    Thread.sleep(400);
    check(() -> first.getVisibility() == android.view.View.INVISIBLE && !first.isEnabled(),
        "automatic liquid close removes hidden hit targets");
    runOnMainSync(dialog::dismiss);
  }

  private void testRailSelection(SpatialPlayer dialog) throws Exception {
    java.lang.reflect.Field railField = SpatialPlayer.class.getDeclaredField("rail");
    railField.setAccessible(true);
    android.view.View rail = (android.view.View) railField.get(dialog);
    java.lang.reflect.Method selected = rail.getClass().getDeclaredMethod("selectedIndex");
    selected.setAccessible(true);
    runOnMainSync(() -> updateSwipeTrack(dialog));
    Thread.sleep(500);
    java.lang.reflect.Method reveal =
        SpatialPlayer.class.getDeclaredMethod("settleCapsule", boolean.class);
    reveal.setAccessible(true);
    runOnMainSync(
        () -> {
          try {
            reveal.invoke(dialog, false);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    Thread.sleep(500);
    capsuleDirectOnly = true;
    capsulePointerTarget = rail;
    touch(60, 618, 0);
    saveNativePlayerImage(dialog, "rail-finger-preview-3.png");
    check(
        () -> {
          try {
            return (int) selected.invoke(rail) == 3;
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        },
        "finger down emphasizes touched cover before playback changes");
    check(() -> railQueueSelection == -1, "press alone does not play a different track");
    touch(60, 618, 1);
    check(() -> railQueueSelection == 3, "release plays exactly the finger-selected cover");
    railQueueSelection = -1;
    touch(60, 322, 0);
    touch(60, 322, 3);
    check(() -> railQueueSelection == -1, "cancel never plays a selected cover");
    touch(60, 618, 0);
    touch(60, 470, 2);
    Thread.sleep(100);
    saveNativePlayerImage(dialog, "rail-finger-preview-2.png");
    java.lang.reflect.Field cardPreview = SpatialPlayer.class.getDeclaredField("preview");
    cardPreview.setAccessible(true);
    check(
        () -> {
          try {
            return cardPreview.getInt(dialog) == 0;
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        },
        "large card stays on playing track while finger moves across capsule");
    check(
        () -> {
          try {
            return (int) selected.invoke(rail) == 2;
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        },
        "drag selects the cover under the finger, not the scrub cursor or capsule center");
    runOnMainSync(
        () -> {
          try {
            int expected = (int) selected.invoke(rail);
            android.view.MotionEvent up =
                android.view.MotionEvent.obtain(
                    SystemClock.uptimeMillis(),
                    SystemClock.uptimeMillis(),
                    1,
                    60 * getTargetContext().getResources().getDisplayMetrics().widthPixels / 931f,
                    470
                        * getTargetContext().getResources().getDisplayMetrics().heightPixels
                        / 2048f,
                    0);
            rail.dispatchTouchEvent(up);
            up.recycle();
            if (expected != 0 && railQueueSelection != expected)
              throw new AssertionError("drag release must play the emphasized cover");
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    checks++;
    railQueueSelection = -1;
    touch(60, 618, 0);
    touch(60, 470, 2);
    touch(-30, 470, 2);
    java.lang.reflect.Field dragging = SpatialPlayer.class.getDeclaredField("draggingRail");
    dragging.setAccessible(true);
    check(
        () -> {
          try {
            return !dragging.getBoolean(dialog);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        },
        "leaving capsule immediately exits selection");
    java.lang.reflect.Field cancelAmount = rail.getClass().getDeclaredField("cancelAmount");
    cancelAmount.setAccessible(true);
    Thread.sleep(100);
    check(
        () -> readFloat(cancelAmount, rail) > 0 && readFloat(cancelAmount, rail) < 1,
        "canceled selection fades through intermediate visual states");
    saveNativePlayerImage(dialog, "rail-cancel-midpoint.png");

    touch(60, 470, 2);
    touch(60, 470, 1);
    check(
        () -> railQueueSelection == -1,
        "returning inside and releasing after exit never plays the canceled selection");
    Thread.sleep(350);
    check(
        () -> readFloat(cancelAmount, rail) == 0,
        "cancel transition fully clears preview emphasis");

    railScrollProbe = true;
    runOnMainSync(() -> setRailScrollTrack(dialog, 0));
    Thread.sleep(500);
    java.lang.reflect.Method offset = SpatialPlayer.class.getDeclaredMethod("railOffset");
    offset.setAccessible(true);
    touch(60, 766, 0);
    touch(60, 766, 1);
    Thread.sleep(100);
    check(
        () -> {
          try {
            float value = (float) offset.invoke(dialog);
            return value > 0 && value < 2;
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        },
        "clicking a distant song scrolls list through intermediate positions");
    Thread.sleep(450);
    check(
        () -> {
          try {
            return (float) offset.invoke(dialog) == 2 && railQueueSelection == 4;
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        },
        "clicked song plays and list settles at its new position");
    touch(60, 174, 0);
    touch(60, 174, 1);
    Thread.sleep(90);
    float beforeTouch = (float) offset.invoke(dialog);
    touch(60, 470, 0);
    float afterTouch = (float) offset.invoke(dialog);
    check(
        () -> Math.abs(beforeTouch - afterTouch) < .05,
        "touching during smooth scroll preserves visible list position");
    touch(60, 470, 3);
    railScrollProbe = false;
    runOnMainSync(dialog::dismiss);
  }

  private void testLyricFlip(SpatialPlayer dialog) throws Exception {
    java.lang.reflect.Field root = SpatialPlayer.class.getDeclaredField("root");
    java.lang.reflect.Field flip = SpatialPlayer.class.getDeclaredField("flipProgress");
    java.lang.reflect.Field times = SpatialPlayer.class.getDeclaredField("lyricTimes");
    for (java.lang.reflect.Field field : new java.lang.reflect.Field[] {root, flip, times})
      field.setAccessible(true);
    capsuleDirectOnly = true;
    capsulePointerTarget = (android.view.View) root.get(dialog);
    runOnMainSync(
        () -> {
          dialog.lyrics(
              "[00:00.00]风从窗边轻轻经过我们走过很长很长的街道一直走到远方的灯火慢慢亮起仍然没有停下脚步\n"
                  + "[00:03.50]远处的灯慢慢亮起\n"
                  + "[00:07.00]我们沿着晚风向前\n"
                  + "[00:10.00]把今天留在歌里\n"
                  + "[00:13.00]云影掠过安静街道\n"
                  + "[00:16.00]下一站仍有新的风景");
          dialog.playback(4000, 180000, true);
        });
    check(
        () -> {
          try {
            return ((java.util.List<?>) times.get(dialog)).size() == 6;
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        },
        "timed lyric parser retains lines and timestamps");
    touch(465, 740, 0);
    Thread.sleep(650);
    check(() -> readFloat(flip, dialog) == 0, "long press no longer flips card");
    touch(465, 740, 1);
    Thread.sleep(350);
    tap(465, 740);
    check(() -> readFloat(flip, dialog) == 0, "single tap does not flip card");
    Thread.sleep(70);
    tap(465, 740);
    Thread.sleep(100);
    check(() -> readFloat(flip, dialog) > 0, "double tap starts perspective flip");
    Thread.sleep(500);
    check(() -> readFloat(flip, dialog) == 1, "double tap finishes on lyrics back");
    saveNativePlayerImage(dialog, "lyrics-card-back.png");
    Object layoutRoot = root.get(dialog);
    java.lang.reflect.Method prepareCover = layoutRoot.getClass().getDeclaredMethod("prepareCover");
    java.lang.reflect.Field coverSource = layoutRoot.getClass().getDeclaredField("coverSource");
    java.lang.reflect.Field coverStart = layoutRoot.getClass().getDeclaredField("coverStart");
    prepareCover.setAccessible(true);
    coverSource.setAccessible(true);
    coverStart.setAccessible(true);
    runOnMainSync(
        () -> {
          try {
            prepareCover.invoke(layoutRoot);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    check(
        () -> {
          try {
            return PlayerMorph.LYRIC_COVER.equals(coverSource.get(layoutRoot));
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        },
        "lyrics collapse uses footer cover bounds rather than front artwork bounds");
    java.lang.reflect.Method cardMatrix = SpatialPlayer.class.getDeclaredMethod("cardMatrix");
    cardMatrix.setAccessible(true);
    float[] expectedCover = {96, 1040, 176, 1120};
    float[] actualCover = expectedCover.clone();
    ((android.graphics.Matrix) cardMatrix.invoke(dialog)).mapPoints(expectedCover);
    ((android.graphics.Matrix) coverStart.get(layoutRoot)).mapPoints(actualCover);
    check(
        () -> java.util.Arrays.equals(expectedCover, actualCover),
        "collapse cover origin includes the actual lyrics card perspective and placement");
    java.lang.reflect.Method setMorph =
        layoutRoot.getClass().getDeclaredMethod("setMorph", float.class);
    setMorph.setAccessible(true);
    runOnMainSync(
        () -> {
          try {
            setMorph.invoke(layoutRoot, .16f);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    saveNativePlayerImage(dialog, "lyrics-footer-collapse.png");
    runOnMainSync(
        () -> {
          try {
            setMorph.invoke(layoutRoot, 0f);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    check(
        () -> readFloat(flip, dialog) == 1,
        "canceled collapse keeps the lyrics face without auto-flipping");

    java.lang.reflect.Field rows = SpatialPlayer.class.getDeclaredField("lyricRows");
    rows.setAccessible(true);
    android.text.StaticLayout longRow =
        (android.text.StaticLayout) ((java.util.List<?>) rows.get(dialog)).get(0);
    check(
        () -> longRow.getLineCount() > 2 && longRow.getHeight() <= 100,
        "long sentence wraps beyond two lines within its allotted height");
    check(
        () ->
            longRow.getText().toString().endsWith("仍然没有停下脚步")
                && longRow.getEllipsisCount(longRow.getLineCount() - 1) == 0,
        "long sentence keeps its ending without ellipsis");

    java.lang.reflect.Field window = SpatialPlayer.class.getDeclaredField("lyricWindow");
    java.lang.reflect.Field focus = SpatialPlayer.class.getDeclaredField("lyricFocus");
    window.setAccessible(true);
    focus.setAccessible(true);
    runOnMainSync(() -> dialog.playback(14000, 180000, true));
    Thread.sleep(100);
    check(
        () -> readFloat(window, dialog) > 0 && readFloat(window, dialog) < 1,
        "lyric window moves through intermediate positions instead of jumping");
    saveNativePlayerImage(dialog, "lyrics-motion-midpoint.png");
    runOnMainSync(
        () -> {
          float before = readFloat(focus, dialog);
          dialog.playback(7000, 180000, true);
          if (Math.abs(readFloat(focus, dialog) - before) > .02f)
            throw new AssertionError("lyric animation must retarget from current focus");
        });
    checks++;
    Thread.sleep(650);
    check(
        () -> readFloat(focus, dialog) == 2 && readFloat(window, dialog) == 0,
        "lyric seek finishes at exact focus and window positions");

    tap(465, 740);
    Thread.sleep(70);
    tap(465, 740);
    Thread.sleep(500);
    check(() -> readFloat(flip, dialog) == 0, "another double tap flips back to cover");
    touch(465, 740, 0);
    touch(260, 740, 2);
    Thread.sleep(560);
    touch(260, 740, 1);
    check(() -> readFloat(flip, dialog) == 0, "horizontal drag cancels long press");
    touch(340, 740, 0);
    touch(340, 740, 3);
    Thread.sleep(550);
    check(() -> readFloat(flip, dialog) == 0, "canceled touch never flips later");
    runOnMainSync(() -> dialog.restoreLyricsFace(true));
    check(
        () -> dialog.isLyricsFace() && readFloat(flip, dialog) == 1,
        "restored back face is immediately ready before expansion");
    runOnMainSync(
        () -> {
          try {
            prepareCover.invoke(layoutRoot);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    check(
        () -> {
          try {
            return PlayerMorph.LYRIC_COVER.equals(coverSource.get(layoutRoot));
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        },
        "restored lyrics expansion targets the footer cover position");
    runOnMainSync(() -> dialog.restoreLyricsFace(false));
    check(
        () -> !dialog.isLyricsFace() && readFloat(flip, dialog) == 0,
        "restored front face stays on cover without flip animation");

    java.lang.reflect.Field reveal = SpatialPlayer.class.getDeclaredField("lyricReveal");
    reveal.setAccessible(true);
    runOnMainSync(
        () -> {
          dialog.restoreLyricsFace(true);
          dialog.lyrics("歌词加载中…");
        });
    check(() -> readFloat(reveal, dialog) == 0, "pending lyrics keep song metadata visible");
    runOnMainSync(() -> dialog.lyrics("[00:00.00]新的歌词柔和浮现\n[00:04.00]底部歌曲信息保持稳定"));
    Thread.sleep(140);
    check(
        () -> readFloat(reveal, dialog) > 0 && readFloat(reveal, dialog) < 1,
        "ready lyrics crossfade through intermediate opacity");
    saveNativePlayerImage(dialog, "lyrics-reveal-midpoint.png");
    Thread.sleep(500);
    check(() -> readFloat(reveal, dialog) == 1, "lyric reveal lands at fully visible content");
    JSONObject response =
        new NeteaseClient()
            .request(
                "/api/song/lyric", NeteaseClient.json("id", "347230", "lv", -1, "tv", -1), true);
    JSONObject lrc = response.optJSONObject("lrc");
    check(
        () -> lrc != null && !lrc.optString("lyric").isEmpty(),
        "live read-only lyric endpoint returns real lyrics");
    runOnMainSync(dialog::dismiss);
  }

  private void profileTrackMotion(SpatialPlayer dialog) throws Exception {
    java.lang.reflect.Field rootField = SpatialPlayer.class.getDeclaredField("root");
    rootField.setAccessible(true);
    capsuleDirectOnly = true;
    capsulePointerTarget = (android.view.View) rootField.get(dialog);
    runOnMainSync(() -> updateSwipeTrack(dialog));
    android.os.HandlerThread worker = new android.os.HandlerThread("track-frame-metrics");
    worker.start();
    java.util.List<double[]> frames =
        java.util.Collections.synchronizedList(new java.util.ArrayList<>());
    android.view.Window.OnFrameMetricsAvailableListener listener =
        (window, metrics, dropped) -> {
          frames.add(
              new double[] {
                metrics.getMetric(android.view.FrameMetrics.TOTAL_DURATION) / 1e6,
                metrics.getMetric(android.view.FrameMetrics.DRAW_DURATION) / 1e6,
                metrics.getMetric(android.view.FrameMetrics.DEADLINE) / 1e6,
                dropped,
                metrics.getMetric(android.view.FrameMetrics.UNKNOWN_DELAY_DURATION) / 1e6,
                metrics.getMetric(android.view.FrameMetrics.SYNC_DURATION) / 1e6,
                metrics.getMetric(android.view.FrameMetrics.COMMAND_ISSUE_DURATION) / 1e6,
                metrics.getMetric(android.view.FrameMetrics.SWAP_BUFFERS_DURATION) / 1e6,
                metrics.getMetric(android.view.FrameMetrics.GPU_DURATION) / 1e6
              });
        };
    runOnMainSync(
        () ->
            dialog
                .getWindow()
                .addOnFrameMetricsAvailableListener(
                    listener, new android.os.Handler(worker.getLooper())));
    touch(465, 740, 0);
    touch(190, 740, 2);
    touch(190, 740, 1);
    Thread.sleep(650);
    frames.clear();
    for (int i = 0; i < 8; i++) {
      touch(340, 740, 0);
      for (int move = 1; move <= 8; move++) touch(340 - move * 27, 740, 2);
      touch(124, 740, 1);
      Thread.sleep(550);
    }
    runOnMainSync(() -> dialog.getWindow().removeOnFrameMetricsAvailableListener(listener));
    worker.quitSafely();
    worker.join();
    java.util.List<double[]> copy;
    synchronized (frames) {
      copy = new java.util.ArrayList<>(frames);
    }
    JSONArray samples = new JSONArray();
    int missed = 0;
    for (double[] frame : copy) {
      samples.put(new JSONArray(frame));
      if (frame[2] > 0 && frame[0] > frame[2]) missed++;
    }
    double[] total = copy.stream().mapToDouble(frame -> frame[0]).sorted().toArray();
    double[] draw = copy.stream().mapToDouble(frame -> frame[1]).sorted().toArray();
    JSONObject report =
        new JSONObject()
            .put("frames", copy.size())
            .put("missedDeadline", missed)
            .put("totalP50Ms", total[total.length / 2])
            .put("totalP95Ms", total[(int) (total.length * .95)])
            .put("totalMaxMs", total[total.length - 1])
            .put("drawP95Ms", draw[(int) (draw.length * .95)])
            .put("drawMaxMs", draw[draw.length - 1])
            .put("samplesTotalDrawDeadlineDropped", samples)
            .put(
                "sampleColumns",
                "total,draw,deadline,dropped,unknownDelay,sync,commandIssue,swapBuffers,gpu;"
                    + " duration in ms")
            .put(
                "scope",
                "8 isolated same-direction swipes; actual Window FrameMetrics; synthetic queue"
                    + " metadata; no audio/network queue mutation");
    try (java.io.FileWriter output =
        new java.io.FileWriter(
            new java.io.File(
                getTargetContext().getFilesDir(),
                "track-profile-" + trackProfileLabel + ".json"))) {
      output.write(report.toString(2));
    }
    check(
        () -> copy.size() > 30 && swipeNext.get() == 8,
        "frame profile captures eight consecutive track transitions");
    // Capture the actual GPU-backed window after measured work; screenshots never enter frame
    // statistics.
    touch(340, 740, 0);
    touch(255, 740, 2);
    android.graphics.Bitmap screen = getUiAutomation().takeScreenshot();
    try (OutputStream output =
        new FileOutputStream(
            new File(
                getTargetContext().getFilesDir(),
                "track-hardware-" + trackProfileLabel + ".png"))) {
      screen.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output);
    }
    screen.recycle();
    touch(255, 740, 1);
    runOnMainSync(dialog::dismiss);
  }

  private void testTrackDepth(SpatialPlayer dialog) throws Exception {
    java.lang.reflect.Field rootField = SpatialPlayer.class.getDeclaredField("root");
    java.lang.reflect.Field animField = SpatialPlayer.class.getDeclaredField("trackAnimation");
    java.lang.reflect.Field progressField = SpatialPlayer.class.getDeclaredField("trackProgress");
    java.lang.reflect.Field springField = SpatialPlayer.class.getDeclaredField("capsuleSpring");
    java.lang.reflect.Field fractionField = SpatialPlayer.class.getDeclaredField("capsuleFraction");
    java.lang.reflect.Field framesField =
        SpatialPlayer.class.getDeclaredField("trackRenderedFrames");
    java.lang.reflect.Field currentField = SpatialPlayer.class.getDeclaredField("current");
    java.lang.reflect.Method matrix =
        SpatialPlayer.class.getDeclaredMethod("trackCardMatrix", boolean.class);
    for (java.lang.reflect.Field field :
        new java.lang.reflect.Field[] {
          rootField, animField, progressField, springField, fractionField, framesField, currentField
        }) field.setAccessible(true);
    matrix.setAccessible(true);
    capsuleDirectOnly = true;
    capsulePointerTarget = (android.view.View) rootField.get(dialog);
    runOnMainSync(
        () -> {
          updateSwipeTrack(dialog);
          dialog.restoreLyricsFace(true);
          dialog.lyrics("[00:00.00]当前歌曲的歌词只属于这一张卡片\n[00:03.00]下一张卡片应显示歌名和歌手");
        });
    BooleanSupplier resting =
        () -> {
          try {
            return springField.get(dialog) == null;
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        };
    for (int direction : new int[] {-1, 1}) {
      int initialNext = swipeNext.get(), initialPrevious = swipePrevious.get();
      touch(465, 740, 0);
      touch(direction < 0 ? 190 : 740, 740, 2);
      touch(direction < 0 ? 190 : 740, 740, 1);
      waitForHeart(resting, "reveal settles before second swipe");
      check(
          () -> swipeNext.get() == initialNext && swipePrevious.get() == initialPrevious,
          "revealing capsule never skips a song");
      float x = direction < 0 ? 340 : 600;
      for (int step = 1; step <= 4; step++) {
        final int expected = step;
        touch(x, 740, 0);
        if (step == 1) {
          touch(x + direction * 60, 740, 2);
          saveNativePlayerImage(
              dialog, direction < 0 ? "track-early-next.png" : "track-early-previous.png");
          java.lang.reflect.Field candidate =
              SpatialPlayer.class.getDeclaredField("dragTrackIndex");
          java.lang.reflect.Field draws =
              SpatialPlayer.class.getDeclaredField("trackIncomingDraws");
          candidate.setAccessible(true);
          draws.setAccessible(true);
          check(
              () -> {
                try {
                  return candidate.getInt(dialog) >= 0 && draws.getInt(dialog) > 0;
                } catch (Exception e) {
                  throw new RuntimeException(e);
                }
              },
              "adjacent card is already drawn during a short held drag");
          check(
              () -> swipeNext.get() == initialNext && swipePrevious.get() == initialPrevious,
              "early visual preview never commits playback before release");
        }
        touch(x + direction * 150, 740, 2);
        if (step == 1) {
          float shortProgress = readFloat(progressField, dialog);
          touch(x + direction * 330, 740, 2);
          float mediumProgress = readFloat(progressField, dialog);
          touch(x + direction * 440, 740, 2);
          check(
              () ->
                  mediumProgress > .5f
                      && mediumProgress > shortProgress
                      && readFloat(progressField, dialog) > mediumProgress,
              "long drag continues past former cap with progressive end resistance");
        }
        touch(x + direction * (step == 1 ? 440 : 150), 740, 1);
        check(
            () ->
                swipeNext.get() == initialNext + (direction < 0 ? expected : 0)
                    && swipePrevious.get() == initialPrevious + (direction > 0 ? expected : 0),
            "every consecutive same-direction swipe dispatches one new track action");
        check(
            () -> {
              try {
                return currentField.getInt(dialog)
                    == Math.floorMod(swipeNext.get() - swipePrevious.get(), 5);
              } catch (Exception e) {
                throw new RuntimeException(e);
              }
            },
            "updated track metadata preserves gesture handling");
        if (step <= 2) {
          // Hold the animation mid-flight, then issue a fresh swipe without waiting for completion.
          runOnMainSync(
              () -> {
                try {
                  android.animation.ValueAnimator animator =
                      (android.animation.ValueAnimator) animField.get(dialog);
                  animator.pause();
                  animator.setCurrentPlayTime(100);
                } catch (Exception e) {
                  throw new RuntimeException(e);
                }
              });
          if (step == 1) {
            float[] values = new float[9];
            ((android.graphics.Matrix) matrix.invoke(dialog, false)).getValues(values);
            check(
                () -> Math.abs(values[android.graphics.Matrix.MPERSP_0]) > .000001f,
                "outgoing card retains real perspective");
            saveNativePlayerImage(
                dialog, direction < 0 ? "track-depth-next.png" : "track-depth-previous.png");
            verifyTrackLanding(dialog, animField, matrix);
          }
        } else if (step == 3) {
          int frames = framesField.getInt(dialog);
          Thread.sleep(160);
          check(
              () -> {
                try {
                  return framesField.getInt(dialog) > frames + 2;
                } catch (Exception e) {
                  throw new RuntimeException(e);
                }
              },
              "scene redraws across successive animation frames");
          Thread.sleep(600);
          check(
              () -> readFloat(progressField, dialog) == 0,
              "settled transition resets for next swipe");
        }
      }
      int next = swipeNext.get(), previous = swipePrevious.get();
      // Reverse during the fourth transition: close the capsule, never scrub the old animation.
      touch(x, 740, 0);
      touch(x - direction * 90, 740, 2);
      touch(x - direction * 90, 740, 1);
      waitForHeart(resting, "reverse swipe closes capsule even during track animation");
      check(
          () -> readFloat(fractionField, dialog) == 1,
          "short reverse swipe closes capsule rather than reversing card progress");
      check(
          () -> swipeNext.get() == next && swipePrevious.get() == previous,
          "reverse swipe never changes the track");
      check(
          () -> readFloat(progressField, dialog) == 0,
          "reverse close clears previous transition state");
    }
    runOnMainSync(dialog::dismiss);
  }

  private void verifyTrackLanding(
      SpatialPlayer dialog,
      java.lang.reflect.Field animationField,
      java.lang.reflect.Method incomingMatrix)
      throws Exception {
    java.lang.reflect.Method restingMatrix = SpatialPlayer.class.getDeclaredMethod("cardMatrix");
    java.lang.reflect.Field returning = SpatialPlayer.class.getDeclaredField("returningToPlane");
    restingMatrix.setAccessible(true);
    returning.setAccessible(true);
    final float[][] nearEnd = {null}, landed = {null};
    runOnMainSync(
        () -> {
          try {
            android.animation.ValueAnimator animation =
                (android.animation.ValueAnimator) animationField.get(dialog);
            animation.setCurrentPlayTime(animation.getDuration() - 1);
            nearEnd[0] = new float[] {49, 318, 667, 1168};
            ((android.graphics.Matrix) incomingMatrix.invoke(dialog, true)).mapPoints(nearEnd[0]);
            animation.end();
            landed[0] = new float[] {49, 318, 667, 1168};
            ((android.graphics.Matrix) restingMatrix.invoke(dialog)).mapPoints(landed[0]);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    float maxJump = 0;
    for (int i = 0; i < 4; i++) maxJump = Math.max(maxJump, Math.abs(nearEnd[0][i] - landed[0][i]));
    final float jump = maxJump;
    check(() -> jump < .08f, "last animation frame and resting card share the exact destination");
    Thread.sleep(650);
    float[] later = {49, 318, 667, 1168};
    ((android.graphics.Matrix) restingMatrix.invoke(dialog)).mapPoints(later);
    float laterDrift = 0;
    for (int i = 0; i < 4; i++)
      laterDrift = Math.max(laterDrift, Math.abs(later[i] - landed[0][i]));
    final float drift = laterDrift;
    check(() -> drift < .08f, "card does not move a second time after landing");
    check(
        () -> {
          try {
            return !returning.getBoolean(dialog);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        },
        "no delayed pose-return animation starts after the track transition");
  }

  private void testCapsuleSides(SpatialPlayer dialog) throws Exception {
    java.lang.reflect.Field rootField = SpatialPlayer.class.getDeclaredField("root");
    java.lang.reflect.Field railField = SpatialPlayer.class.getDeclaredField("rail");
    java.lang.reflect.Field fraction = SpatialPlayer.class.getDeclaredField("capsuleFraction");
    java.lang.reflect.Field dragging = SpatialPlayer.class.getDeclaredField("draggingRail");
    rootField.setAccessible(true);
    railField.setAccessible(true);
    fraction.setAccessible(true);
    dragging.setAccessible(true);
    android.view.View root = (android.view.View) rootField.get(dialog);
    android.view.View rail = (android.view.View) railField.get(dialog);
    capsuleDirectOnly = true;
    capsulePointerTarget = root;
    java.util.function.DoubleSupplier amount =
        () -> {
          try {
            return fraction.getFloat(dialog);
          } catch (IllegalAccessException error) {
            throw new RuntimeException(error);
          }
        };
    waitForIdleSync();
    java.lang.reflect.Field springField = SpatialPlayer.class.getDeclaredField("capsuleSpring");
    springField.setAccessible(true);
    BooleanSupplier resting =
        () -> {
          try {
            return springField.get(dialog) == null;
          } catch (IllegalAccessException error) {
            throw new RuntimeException(error);
          }
        };
    touch(465, 740, 0);
    touch(740, 740, 2);
    touch(740, 740, 1);
    waitForHeart(resting, "left reveal spring naturally comes to rest");
    check(
        () -> amount.getAsDouble() == 0 && rail.getX() < root.getWidth() / 2,
        "right swipe reveals the track capsule on the left");
    touch(600, 740, 0);
    saveNativePlayerImage(dialog, "capsule-left-revealed.png");
    touch(600, 740, 1);
    touch(129, 620, 0);
    touch(129, 660, 2);
    check(
        () -> {
          try {
            return dragging.getBoolean(dialog);
          } catch (IllegalAccessException error) {
            throw new RuntimeException(error);
          }
        },
        "left capsule hit area follows its actual screen position");
    touch(129, 660, 1);
    touch(600, 740, 0);
    touch(320, 740, 2);
    touch(320, 740, 1);
    waitForHeart(resting, "reverse swipe spring naturally comes to rest");
    check(() -> amount.getAsDouble() == 1, "reverse leftward swipe hides the left capsule");
    touch(465, 740, 0);
    touch(190, 740, 2);
    touch(190, 740, 1);
    waitForHeart(resting, "right reveal spring naturally comes to rest");
    check(
        () -> amount.getAsDouble() == 0 && rail.getX() > root.getWidth() / 2,
        "left swipe still reveals the track capsule on the right");
    touch(400, 740, 0);
    saveNativePlayerImage(dialog, "capsule-right-revealed.png");
    touch(400, 740, 1);
    waitForHeart(
        () -> amount.getAsDouble() == 1, "two-second idle still hides the revealed capsule");
    waitForHeart(resting, "idle spring finishes");
    touch(300, 740, 0);
    touch(880, 740, 2);
    java.lang.reflect.Field extra = SpatialPlayer.class.getDeclaredField("cardOverdrag");
    java.lang.reflect.Field raw = SpatialPlayer.class.getDeclaredField("capsulePull");
    java.lang.reflect.Field tilt = SpatialPlayer.class.getDeclaredField("tiltX");
    extra.setAccessible(true);
    raw.setAccessible(true);
    tilt.setAccessible(true);
    java.lang.reflect.Method matrixMethod = SpatialPlayer.class.getDeclaredMethod("cardMatrix");
    java.lang.reflect.Method orientation =
        SpatialPlayer.class.getDeclaredMethod("updateOrientation", float.class, float.class);
    matrixMethod.setAccessible(true);
    orientation.setAccessible(true);
    float[] pose = new float[9];
    ((android.graphics.Matrix) matrixMethod.invoke(dialog)).getValues(pose);
    check(
        () ->
            Math.abs(readFloat(extra, dialog)) > 40
                && Math.abs(readFloat(extra, dialog)) < 80
                && pose[0] < .99f,
        "overtravel adds bounded movement and recedes in scale");
    saveNativePlayerImage(dialog, "capsule-overtravel-depth.png");
    float beforeTilt = tilt.getFloat(dialog);
    runOnMainSync(
        () -> {
          try {
            orientation.invoke(dialog, .2f, .2f);
          } catch (Exception error) {
            throw new RuntimeException(error);
          }
        });
    check(() -> readFloat(tilt, dialog) == beforeTilt, "gyro cannot fight a held card drag");
    touch(880, 740, 1);
    Thread.sleep(30);
    touch(650, 740, 0);
    float held = raw.getFloat(dialog);
    Thread.sleep(60);
    check(
        () -> resting.getAsBoolean() && readFloat(raw, dialog) == held,
        "regrabbing stops spring at the current frame without a jump");
    touch(650, 740, 1);
    waitForHeart(resting, "overtravel and scale return together");
    runOnMainSync(dialog::dismiss);
  }

  private float readFloat(java.lang.reflect.Field field, Object owner) {
    try {
      return field.getFloat(owner);
    } catch (IllegalAccessException error) {
      throw new RuntimeException(error);
    }
  }

  private void testCapsuleIdle(SpatialPlayer dialog) throws Exception {
    java.lang.reflect.Field fraction = SpatialPlayer.class.getDeclaredField("capsuleFraction");
    java.lang.reflect.Field rootField = SpatialPlayer.class.getDeclaredField("root");
    java.lang.reflect.Field railField = SpatialPlayer.class.getDeclaredField("rail");
    fraction.setAccessible(true);
    rootField.setAccessible(true);
    railField.setAccessible(true);
    java.util.function.DoubleSupplier amount =
        () -> {
          try {
            return fraction.getFloat(dialog);
          } catch (IllegalAccessException error) {
            throw new RuntimeException(error);
          }
        };
    android.widget.FrameLayout root = (android.widget.FrameLayout) rootField.get(dialog);
    android.view.View rail = (android.view.View) railField.get(dialog);
    android.view.View card = root.getChildAt(1);
    capsuleDirectOnly = true;
    capsulePointerTarget = root;
    waitForIdleSync();
    check(
        () -> amount.getAsDouble() == 1 && rail.getVisibility() == android.view.View.INVISIBLE,
        "track capsule starts hidden and does not intercept touches");
    saveNativePlayerImage(dialog, "capsule-default-hidden.png");
    Runnable expand =
        () ->
            card.performAccessibilityAction(
                android.view.accessibility.AccessibilityNodeInfo.ACTION_EXPAND, null);
    runOnMainSync(expand);
    waitForHeart(() -> amount.getAsDouble() == 0, "capsule can still be expanded");
    Thread.sleep(250);
    check(() -> amount.getAsDouble() == 0, "capsule does not hide before idle timeout");
    waitForHeart(() -> amount.getAsDouble() == 1, "idle capsule hides automatically");
    touch(465, 740, 0);
    touch(230, 740, 2);
    Thread.sleep(2200);
    check(() -> amount.getAsDouble() == 0, "held horizontal reveal is not auto-hidden");
    touch(230, 740, 1);
    waitForHeart(() -> amount.getAsDouble() == 1, "release starts a new idle countdown");
    runOnMainSync(expand);
    waitForHeart(() -> amount.getAsDouble() == 0, "reopen after idle still works");
    touch(800, 620, 0);
    touch(800, 660, 2);
    Thread.sleep(2200);
    check(
        () -> amount.getAsDouble() == 0 && rail.getVisibility() == android.view.View.VISIBLE,
        "active track selection stays visible beyond two seconds");
    touch(800, 660, 1);
    Thread.sleep(1700);
    check(() -> amount.getAsDouble() == 0, "selection release keeps its full idle grace period");
    waitForHeart(() -> amount.getAsDouble() == 1, "selection idle eventually hides");
    runOnMainSync(expand);
    waitForHeart(() -> amount.getAsDouble() == 0, "reopen for activity-reset check");
    Thread.sleep(1350);
    tap(500, 1250);
    Thread.sleep(450);
    check(() -> amount.getAsDouble() == 0, "another page interaction resets the idle countdown");
    waitForHeart(() -> amount.getAsDouble() == 1, "new idle period also hides correctly");
    runOnMainSync(expand);
    runOnMainSync(dialog::dismiss);
    java.lang.reflect.Field handler = SpatialPlayer.class.getDeclaredField("capsuleIdle");
    java.lang.reflect.Field callback = SpatialPlayer.class.getDeclaredField("hideIdleCapsule");
    handler.setAccessible(true);
    callback.setAccessible(true);
    android.os.Handler idle = (android.os.Handler) handler.get(dialog);
    Runnable hide = (Runnable) callback.get(dialog);
    check(() -> !idle.hasCallbacks(hide), "closing page clears the pending auto-hide task");
  }

  private void testSketchControls(
      SpatialPlayer dialog,
      PlaybackOrder order,
      java.util.concurrent.atomic.AtomicInteger downloads)
      throws Exception {
    java.lang.reflect.Field rf = SpatialPlayer.class.getDeclaredField("repeatButton");
    java.lang.reflect.Field sf = SpatialPlayer.class.getDeclaredField("shuffleButton");
    java.lang.reflect.Field df = SpatialPlayer.class.getDeclaredField("downloadButton");
    java.lang.reflect.Field hf = SpatialPlayer.class.getDeclaredField("heartButton");
    rf.setAccessible(true);
    sf.setAccessible(true);
    df.setAccessible(true);
    hf.setAccessible(true);
    SketchActionButton repeat = (SketchActionButton) rf.get(dialog);
    SketchActionButton shuffle = (SketchActionButton) sf.get(dialog);
    SketchActionButton download = (SketchActionButton) df.get(dialog);
    android.view.View heart = (android.view.View) hf.get(dialog);
    waitForIdleSync();
    check(
        () ->
            heart.getTop() == repeat.getTop()
                && repeat.getTop() == shuffle.getTop()
                && shuffle.getTop() == download.getTop()
                && heart.getRight() < repeat.getLeft()
                && repeat.getRight() < shuffle.getLeft()
                && shuffle.getRight() < download.getLeft(),
        "SVG actions form one aligned non-overlapping row beside the heart");
    if (layoutOnly) {
      saveNativePlayerImage(dialog, "sketch-controls-layout.png");
      runOnMainSync(dialog::dismiss);
      return;
    }
    runOnMainSync(repeat::performClick);
    check(
        () ->
            order.mode == PlaybackOrder.Mode.SINGLE_LOOP
                && order.next(3, 1, true) == 1
                && repeat.getContentDescription().toString().contains("单曲"),
        "single repeat reaches queue traversal");
    runOnMainSync(repeat::performClick);
    check(
        () -> order.mode == PlaybackOrder.Mode.SEQUENTIAL && order.next(3, 2, true) == -1,
        "sequential mode stops at the end");
    runOnMainSync(repeat::performClick);
    check(
        () -> order.mode == PlaybackOrder.Mode.LIST_LOOP && order.next(3, 2, true) == 0,
        "list repeat wraps the queue");
    waitForHeart(() -> repeat.fillProgress() == 1, "repeat white hatching completes");
    saveNativePlayerImage(dialog, "sketch-controls-loop.png");
    runOnMainSync(shuffle::performClick);
    check(
        () ->
            order.isShuffled()
                && order.mode == PlaybackOrder.Mode.LIST_LOOP
                && order.next(4, 1, false) != 1,
        "shuffle reaches queue traversal");
    waitForHeart(
        () -> shuffle.fillProgress() == 1 && repeat.fillProgress() == 1,
        "shuffle and list repeat can both show white hatching");
    java.lang.reflect.Field inside = SketchActionButton.class.getDeclaredField("inside");
    inside.setAccessible(true);
    android.graphics.Region shuffleFill = new android.graphics.Region();
    shuffleFill.setPath(
        (android.graphics.Path) inside.get(shuffle), new android.graphics.Region(0, 0, 256, 256));
    check(
        () -> shuffleFill.contains(180, 165), "lower-right shuffle arrow belongs to the fill mask");
    saveNativePlayerImage(dialog, "sketch-controls-shuffle.png");
    runOnMainSync(shuffle::performClick);
    check(
        () -> !order.isShuffled() && order.mode == PlaybackOrder.Mode.LIST_LOOP,
        "turning shuffle off preserves list repeat");
    runOnMainSync(repeat::performClick);
    runOnMainSync(shuffle::performClick);
    runOnMainSync(shuffle::performClick);
    check(
        () -> !order.isShuffled() && order.mode == PlaybackOrder.Mode.SINGLE_LOOP,
        "turning shuffle off preserves single repeat");
    runOnMainSync(shuffle::performClick);
    check(
        () ->
            order.isShuffled()
                && order.mode == PlaybackOrder.Mode.SINGLE_LOOP
                && order.next(4, 1, true) == 1
                && order.next(4, 1, false) != 1,
        "single repeat with shuffle repeats automatically but manual next is random");
    runOnMainSync(download::performClick);
    check(() -> downloads.get() == 1, "download SVG calls the host download action");
    runOnMainSync(() -> dialog.download(false, true, 45));
    check(
        () -> !download.isEnabled() && download.checkProgress() == 0,
        "in-progress download disables duplicate taps and never shows a completion check");
    java.lang.reflect.Field root = SpatialPlayer.class.getDeclaredField("root");
    root.setAccessible(true);
    capsulePointerTarget = (android.view.View) root.get(dialog);
    capsuleDirectOnly = true;
    tap(
        (download.getLeft() + download.getWidth() / 2f) * 931 / capsulePointerTarget.getWidth(),
        (download.getTop() + download.getHeight() / 2f) * 2048 / capsulePointerTarget.getHeight());
    check(
        () -> downloads.get() == 1,
        "busy download consumes real view touches without another request");
    runOnMainSync(() -> dialog.download(true, false, 100));
    waitForHeart(
        () -> download.checkProgress() == 1 && download.fillProgress() == 1,
        "download completion fills white hatching and draws the centered large check");
    check(
        () -> download.isEnabled() && download.getContentDescription().toString().equals("已下载"),
        "completion is exposed to accessibility");
    saveNativePlayerImage(dialog, "sketch-controls-downloaded.png");
    runOnMainSync(
        () ->
            dialog.track(
                "下一首",
                "测试",
                "",
                new String[] {"下一首"},
                new String[] {""},
                new String[] {"测试"},
                new String[] {""},
                0));
    check(
        () -> download.checkProgress() == 0,
        "track change removes previous song completion immediately");

    String[] columns = {
      android.app.DownloadManager.COLUMN_ID,
      android.app.DownloadManager.COLUMN_LOCAL_URI,
      android.app.DownloadManager.COLUMN_STATUS,
      android.app.DownloadManager.COLUMN_TOTAL_SIZE_BYTES,
      android.app.DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR
    };
    try (android.database.MatrixCursor rows = new android.database.MatrixCursor(columns)) {
      rows.addRow(
          new Object[] {
            1L, "file:///music/42-a.mp3", android.app.DownloadManager.STATUS_RUNNING, 100L, 45L
          });
      PlayerDownloadStatus state =
          PlayerDownloadStatus.fromRows(rows, java.util.Map.of("1", "42"), "42");
      check(
          () -> state.busy() && !state.complete() && state.percent() == 45,
          "system running status reports progress without a false check");
    }
    try (android.database.MatrixCursor rows = new android.database.MatrixCursor(columns)) {
      rows.addRow(
          new Object[] {
            2L, "file:///music/42-a.mp3", android.app.DownloadManager.STATUS_SUCCESSFUL, 100L, 100L
          });
      PlayerDownloadStatus state = PlayerDownloadStatus.fromRows(rows, java.util.Map.of(), "42");
      check(
          () -> state.complete() && !state.busy(),
          "legacy download filename maps successful completion");
    }
    try (android.database.MatrixCursor rows = new android.database.MatrixCursor(columns)) {
      rows.addRow(new Object[] {3L, null, android.app.DownloadManager.STATUS_FAILED, 100L, 5L});
      PlayerDownloadStatus state =
          PlayerDownloadStatus.fromRows(rows, java.util.Map.of("3", "42"), "42");
      check(() -> !state.complete() && !state.busy(), "failed system download can be retried");
    }
    try (android.database.MatrixCursor rows = new android.database.MatrixCursor(columns)) {
      rows.addRow(
          new Object[] {
            4L, "file:///music/99-a.mp3", android.app.DownloadManager.STATUS_SUCCESSFUL, 100L, 100L
          });
      PlayerDownloadStatus state =
          PlayerDownloadStatus.fromRows(rows, java.util.Map.of("4", "99"), "42");
      check(() -> !state.complete(), "another song never inherits the completed check");
    }
    runOnMainSync(dialog::dismiss);
  }

  private void saveNativePlayerImage(SpatialPlayer dialog, String name) throws Exception {
    java.lang.reflect.Field field = SpatialPlayer.class.getDeclaredField("root");
    field.setAccessible(true);
    android.view.View root = (android.view.View) field.get(dialog);
    AtomicReference<android.graphics.Bitmap> image = new AtomicReference<>();
    runOnMainSync(
        () -> {
          android.graphics.Bitmap bitmap =
              android.graphics.Bitmap.createBitmap(
                  root.getWidth(), root.getHeight(), android.graphics.Bitmap.Config.ARGB_8888);
          root.draw(new android.graphics.Canvas(bitmap));
          image.set(bitmap);
        });
    try (OutputStream out =
        new FileOutputStream(new File(getTargetContext().getFilesDir(), name))) {
      image.get().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out);
    }
    image.get().recycle();
  }

  private void testReversibleCapsule(
      Runnable reopen,
      AtomicReference<SpatialPlayer> shown,
      AtomicReference<CompactPlayerView> compact)
      throws Exception {
    android.graphics.Bitmap fixture =
        android.graphics.Bitmap.createBitmap(160, 160, android.graphics.Bitmap.Config.ARGB_8888);
    android.graphics.Canvas artwork = new android.graphics.Canvas(fixture);
    artwork.drawColor(0xff314f76);
    android.graphics.Paint mark = new android.graphics.Paint(3);
    mark.setColor(0xffe2a75e);
    artwork.drawCircle(80, 80, 54, mark);
    runOnMainSync(
        () -> {
          shown.get().dismiss();
          CompactPlayerView mini = new CompactPlayerView(testActivity, () -> {}, () -> {});
          compact.set(mini);
          mini.state(fixture, false);
          mini.setExpansionDrag(
              new CompactPlayerView.ExpansionDrag() {
                public boolean begin(boolean horizontal) {
                  reopen.run();
                  shown.get().artwork(fixture);
                  shown
                      .get()
                      .setOnCollapsed(
                          bitmap -> {
                            mini.setAlpha(1);
                            mini.setVisibility(android.view.View.VISIBLE);
                          });
                  shown.get().beginCapsuleDrag(horizontal);
                  return true;
                }

                public void update(float fraction) {
                  shown.get().dragFromCapsule(fraction);
                }

                public void end(float speed, boolean cancelled) {
                  shown.get().endCapsuleDrag(speed, cancelled);
                }
              });
          testActivity.addContentView(mini, new android.view.ViewGroup.LayoutParams(-1, -1));
        });
    waitForIdleSync();
    Thread.sleep(200);
    capsulePointerTarget = compact.get();
    touch(650, 1815, 0);
    touch(480, 1815, 2);
    waitForHeart(
        () -> shown.get().isShowing() && shown.get().collapseProgress() < .8f,
        "left drag opens before finger release across dialog windows");
    float horizontalProgress = shown.get().collapseProgress();
    check(
        () -> compact.get().isShown() && compact.get().getAlpha() == 1,
        "underlying capsule remains rendered during expansion handoff");
    java.lang.reflect.Field rootField = SpatialPlayer.class.getDeclaredField("root");
    rootField.setAccessible(true);
    AtomicReference<android.graphics.Bitmap> rendered = new AtomicReference<>();
    runOnMainSync(
        () -> {
          try {
            android.view.View view = (android.view.View) rootField.get(shown.get());
            android.graphics.Bitmap image =
                android.graphics.Bitmap.createBitmap(
                    view.getWidth(), view.getHeight(), android.graphics.Bitmap.Config.ARGB_8888);
            view.draw(new android.graphics.Canvas(image));
            rendered.set(image);
          } catch (IllegalAccessException error) {
            throw new RuntimeException(error);
          }
        });
    try (OutputStream out =
        new FileOutputStream(
            new File(getTargetContext().getFilesDir(), "capsule-opening-following.png"))) {
      rendered.get().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out);
    }
    rendered.get().recycle();
    touch(615, 1815, 2);
    check(
        () -> shown.get().collapseProgress() > horizontalProgress + .15f,
        "rightward reversal restores the capsule while still touching");
    touch(635, 1815, 1);
    waitForHeart(() -> !shown.get().isShowing(), "reversed left drag returns to mini player");
    check(
        () -> compact.get().isShown() && compact.get().getAlpha() == 1,
        "underlying capsule survives the closing window handoff");
    touch(650, 1815, 0);
    touch(650, 1530, 2);
    waitForHeart(
        () -> shown.get().collapseProgress() < .7f,
        "up drag also controls expansion before release");
    touch(650, 1530, 1);
    android.view.View root = (android.view.View) rootField.get(shown.get());
    capsulePointerTarget = root;
    java.lang.reflect.Field animationField = root.getClass().getDeclaredField("pullAnimation");
    animationField.setAccessible(true);
    touch(500, 1300, 0);
    android.animation.ValueAnimator animation =
        (android.animation.ValueAnimator) animationField.get(root);
    check(() -> !animation.isRunning(), "touch interrupts the automatic expansion");
    float held = shown.get().collapseProgress();
    Thread.sleep(50);
    check(
        () -> Math.abs(shown.get().collapseProgress() - held) < .001f,
        "held frame does not continue its old animation");
    touch(500, 1690, 2);
    check(
        () -> shown.get().collapseProgress() > held,
        "interrupted expansion follows the returning finger");
    touch(500, 1750, 1);
    waitForHeart(() -> !shown.get().isShowing(), "interrupted expansion can close again");
    capsulePointerTarget = compact.get();
    touch(650, 1815, 0);
    touch(650, 1650, 2);
    touch(650, 1650, 3);
    waitForHeart(() -> !shown.get().isShowing(), "cancelled opening restores mini player");
    touch(650, 1815, 0);
    touch(650, 1170, 2);
    touch(650, 1170, 1);
    waitForHeart(
        () -> shown.get().isShowing() && shown.get().collapseProgress() == 0,
        "uninterrupted up drag finishes fully expanded");
    check(
        () ->
            (shown.get().getWindow().getAttributes().flags
                    & (android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE))
                == 0,
        "expanded dialog restores normal touch and focus");
    runOnMainSync(() -> shown.get().dismiss());
    runOnMainSync(() -> testActivity.getWindow().getDecorView().invalidate());
  }

  private void waitForHeart(BooleanSupplier condition, String name) throws Exception {
    long until = SystemClock.uptimeMillis() + 4000;
    while (SystemClock.uptimeMillis() < until) {
      if (read(condition)) {
        checks++;
        return;
      }
      Thread.sleep(30);
    }
    throw new AssertionError(name);
  }

  private void testNativeHeart() throws Exception {
    AtomicReference<SpatialPlayer> shown = new AtomicReference<>();
    java.util.concurrent.atomic.AtomicInteger clicks =
        new java.util.concurrent.atomic.AtomicInteger();
    java.util.concurrent.atomic.AtomicInteger removals =
        new java.util.concurrent.atomic.AtomicInteger();
    runOnMainSync(
        () -> {
          SpatialPlayer dialog =
              new SpatialPlayer(
                  testActivity,
                  "收藏按钮预览",
                  "本地动效检查",
                  "",
                  new String[] {"收藏按钮预览"},
                  new String[] {""},
                  new String[] {"本地动效检查"},
                  new String[] {""},
                  0,
                  new SpatialPlayer.Actions() {
                    public void toggle() {}

                    public void seek(int value) {}

                    public void previous() {}

                    public void next() {}

                    public void split() {}

                    public void mode(String value) {}

                    public void export() {}

                    public void queue(int index) {}

                    public void favorite(boolean value) {
                      clicks.incrementAndGet();
                      if (!value) removals.incrementAndGet();
                      shown.get().favorite(value, true);
                    }
                  });
          shown.set(dialog);
          dialog.show();
          dialog.favorite(false);
        });
    java.lang.reflect.Field field = SpatialPlayer.class.getDeclaredField("heartButton");
    field.setAccessible(true);
    SketchHeartButton heart = (SketchHeartButton) field.get(shown.get());
    if (blankFavoriteOnly) {
      testBlankFavorite(shown.get(), heart, clicks, removals);
      return;
    }
    waitForIdleSync();
    Thread.sleep(250);
    check(() -> heart.fillProgress() == 0, "new SVG starts as a white hollow outline");
    clickHeart(heart);
    waitForHeart(
        () -> clicks.get() == 1 && heart.fillProgress() > 0 && heart.fillProgress() < 1,
        "actual native button click starts sequential fill");
    Thread.sleep(220);
    check(
        () -> heart.fillAnimating() && heart.fillProgress() > 0 && heart.fillProgress() < 1,
        "red hatching has an intermediate drawing state");
    savePlayerImage("native-heart-filling.png");
    float beforeSync = heart.fillProgress();
    runOnMainSync(() -> shown.get().favorite(true));
    check(
        () -> heart.fillAnimating() && heart.fillProgress() >= beforeSync,
        "playback state refresh does not interrupt fill");
    waitForHeart(
        () -> heart.fillProgress() == 1 && !heart.fillAnimating(), "red hatching completes");
    savePlayerImage("native-heart-filled.png");
    clickHeart(heart);
    waitForHeart(
        () -> clicks.get() == 2 && heart.fillProgress() < 1 && heart.fillProgress() > 0,
        "second native click erases hatching");
    runOnMainSync(() -> shown.get().favorite(true, true));
    waitForHeart(() -> heart.fillProgress() == 1, "in-flight erase reverses without resetting");
    runOnMainSync(() -> shown.get().favorite(false));
    check(
        () -> heart.fillProgress() == 0 && !heart.fillAnimating(),
        "new-song state can snap to hollow");
    for (int i = 0; i < 8; i++) clickHeart(heart);
    waitForHeart(() -> clicks.get() == 10, "eight rapid native taps all dispatch");
    waitForHeart(
        () -> heart.fillProgress() == 0 && !heart.fillAnimating(),
        "rapid alternating taps finish at the last choice");
    runOnMainSync(() -> shown.get().favorite(true, true));
    waitForHeart(heart::fillAnimating, "animation restarted");
    runOnMainSync(() -> shown.get().dismiss());
    check(() -> !heart.fillAnimating(), "closing page cancels heart animation");
  }

  private android.view.View findText(android.view.View view,String text) {
    if(view instanceof android.widget.TextView label&&text.contentEquals(label.getText()))return view;
    if(view instanceof android.view.ViewGroup group)for(int i=0;i<group.getChildCount();i++){
      android.view.View found=findText(group.getChildAt(i),text);if(found!=null)return found;
    }return null;
  }
  private android.view.accessibility.AccessibilityNodeInfo findEditable(android.view.accessibility.AccessibilityNodeInfo node){
    if(node==null)return null;if("android.widget.EditText".contentEquals(node.getClassName()))return node;
    for(int i=0;i<node.getChildCount();i++){var found=findEditable(node.getChild(i));if(found!=null)return found;}return null;
  }
  private void restorePreferences(SharedPreferences prefs,java.util.Map<String,?> original){
    var edit=prefs.edit().clear();for(var e:original.entrySet()){
      Object v=e.getValue();if(v instanceof String x)edit.putString(e.getKey(),x);else if(v instanceof Integer x)edit.putInt(e.getKey(),x);
      else if(v instanceof Boolean x)edit.putBoolean(e.getKey(),x);else if(v instanceof Long x)edit.putLong(e.getKey(),x);
    }edit.commit();
  }
  private void testAppearanceSettings(Context target) throws Exception {
    SharedPreferences preferences=DotoAppearance.prefs(target);java.util.Map<String,?> backup=new java.util.HashMap<>(preferences.getAll());
    java.io.File wallpaper=new java.io.File(target.getFilesDir(),"appearance-background.jpg");
    byte[] originalImage=wallpaper.isFile()?java.nio.file.Files.readAllBytes(wallpaper.toPath()):null;
    java.io.File fixture=new java.io.File(target.getCacheDir(),"appearance-ui-fixture.jpg");
    android.app.Activity activity=null;
    java.util.concurrent.atomic.AtomicReference<SettingsActivity> currentSettings=new java.util.concurrent.atomic.AtomicReference<>();
    android.app.Application application=(android.app.Application)target.getApplicationContext();
    android.app.Application.ActivityLifecycleCallbacks lifecycle=new android.app.Application.ActivityLifecycleCallbacks(){
      public void onActivityResumed(android.app.Activity a){if(a instanceof SettingsActivity settings)currentSettings.set(settings);}
      public void onActivityCreated(android.app.Activity a,Bundle b){}public void onActivityStarted(android.app.Activity a){}
      public void onActivityPaused(android.app.Activity a){}public void onActivityStopped(android.app.Activity a){}
      public void onActivitySaveInstanceState(android.app.Activity a,Bundle b){}public void onActivityDestroyed(android.app.Activity a){}
    };
    application.registerActivityLifecycleCallbacks(lifecycle);
    try {
      preferences.edit().putBoolean("light",false).commit();DotoAppearance.changed(target);
      activity=startActivitySync(new Intent(target,SettingsActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      Thread.sleep(450);saveDesignImage(target,"settings-dedicated-dark");
      final android.app.Activity first=activity;
      for(String name:new String[]{"预加载分轨","深浅色","强调色","背景"})check(()->findText(first.getWindow().getDecorView(),name)!=null,"settings contains "+name);
      check(()->findText(first.getWindow().getDecorView(),"刷新推荐")==null,"old settings entries removed");
      // Drain the initial launch before waiting for an actual UI-triggered recreation.

      runOnMainSync(()->((android.widget.Button)findText(first.getWindow().getDecorView(),"浅色")).performClick());
      await(()->currentSettings.get()!=null&&currentSettings.get()!=first,"light activity recreation");
      activity=currentSettings.get();
      Thread.sleep(400);check(()->preferences.getBoolean("light",false)&&DotoAppearance.light,"light theme persisted and applied");
      check(()->DotoDesign.PAPER==0xff292929&&DotoDesign.CARD_INK==0xfffafafa,"cards and card text follow light mode");
      saveDesignImage(target,"settings-dedicated-light");
      final android.app.Activity light=activity;
      runOnMainSync(()->findText(light.getWindow().getDecorView(),"自定义强调色").performClick());
      Thread.sleep(250);saveDesignImage(target,"settings-color-picker");
      var editable=findEditable(getUiAutomation().getRootInActiveWindow());
      check(()->editable!=null,"custom color input visible");
      Bundle input=new Bundle();input.putCharSequence(android.view.accessibility.AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,"#86C5A8");
      editable.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_SET_TEXT,input);
      var apply=getUiAutomation().getRootInActiveWindow().findAccessibilityNodeInfosByText("应用");
      check(()->!apply.isEmpty(),"custom color apply button visible");
      apply.get(0).performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK);
      await(()->currentSettings.get()!=null&&currentSettings.get()!=light,"accent activity recreation");
      activity=currentSettings.get();
      Thread.sleep(300);check(()->preferences.getInt("accent",0)==0xff86c5a8&&DotoAppearance.accent==0xff86c5a8,"custom accent applied through dialog");
      saveDesignImage(target,"settings-custom-accent");
      android.graphics.Bitmap bitmap=android.graphics.Bitmap.createBitmap(400,600,android.graphics.Bitmap.Config.ARGB_8888);
      android.graphics.Canvas canvas=new android.graphics.Canvas(bitmap);android.graphics.Paint paint=new android.graphics.Paint();
      paint.setShader(new android.graphics.LinearGradient(0,0,400,600,0xff716b9c,0xff83b99d,android.graphics.Shader.TileMode.CLAMP));canvas.drawRect(0,0,400,600,paint);
      try(java.io.FileOutputStream out=new java.io.FileOutputStream(fixture)){bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG,90,out);}bitmap.recycle();
      java.lang.reflect.Method result=SettingsActivity.class.getDeclaredMethod("onActivityResult",int.class,int.class,Intent.class);result.setAccessible(true);
      final android.app.Activity active=activity;
      runOnMainSync(()->{try{result.invoke(active,41,android.app.Activity.RESULT_OK,new Intent().setData(android.net.Uri.fromFile(fixture)));}catch(Exception e){throw new RuntimeException(e);}});
      await(()->"image".equals(preferences.getString("background","")),"image background saved");
      await(()->currentSettings.get()!=null&&currentSettings.get()!=active,"wallpaper activity recreation");
      activity=currentSettings.get();
      check(()->"image".equals(preferences.getString("background",""))&&wallpaper.isFile(),"selected image copied and background persisted");
      Thread.sleep(350);saveDesignImage(target,"settings-custom-background");
      final android.app.Activity last=activity;
      runOnMainSync(()->findText(last.getWindow().getDecorView(),"恢复默认背景").performClick());
      await(()->"default".equals(preferences.getString("background","")),"background reset saved");
      check(()->"default".equals(preferences.getString("background","")),"background reset works");
      android.app.Activity music=startActivitySync(new Intent(target,MusicActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      Thread.sleep(900);saveDesignImage(target,"appearance-light-home");
      java.lang.reflect.Field engine=MusicActivity.class.getDeclaredField("engine");engine.setAccessible(true);
      PlaybackService playing=(PlaybackService)engine.get(music);
      if(playing!=null&&playing.index>=0){
        java.lang.reflect.Method show=MusicActivity.class.getDeclaredMethod("showStemControls");show.setAccessible(true);
        runOnMainSync(()->{try{show.invoke(music);}catch(Exception e){throw new RuntimeException(e);}});
        Thread.sleep(1100);saveDesignImage(target,"appearance-light-player");
        check(()->DotoDesign.INK==0xff202020,"player uses light foreground palette");
      }
    } finally {
      application.unregisterActivityLifecycleCallbacks(lifecycle);fixture.delete();
      if(originalImage!=null)java.nio.file.Files.write(wallpaper.toPath(),originalImage);else wallpaper.delete();
      restorePreferences(preferences,backup);DotoAppearance.changed(target);
    }
  }

  private void testDesignReview(Context target) throws Exception {
    testActivity=startActivitySync(new Intent(target,MusicActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    Thread.sleep(900);
    String[] pages={"showHome","showAccount","showSearch","showDownloads","showStemLibrary"};
    for(String name:pages){
      java.lang.reflect.Method method=MusicActivity.class.getDeclaredMethod(name);method.setAccessible(true);
      runOnMainSync(()->{try{method.invoke(testActivity);}catch(Exception e){throw new RuntimeException(e);}});
      Thread.sleep(550);
      runOnMainSync(()->((android.view.inputmethod.InputMethodManager)target.getSystemService(Context.INPUT_METHOD_SERVICE))
          .hideSoftInputFromWindow(testActivity.getWindow().getDecorView().getWindowToken(),0));
      Thread.sleep(200);
      saveDesignImage(target,name);
      check(()->testActivity.getWindow().getDecorView().isShown(),name+" renders");
    }
    java.util.concurrent.atomic.AtomicReference<android.app.AlertDialog> dialog=new java.util.concurrent.atomic.AtomicReference<>();
    runOnMainSync(()->dialog.set(new DotoDesign.DialogBuilder(testActivity).setTitle("歌曲操作")
        .setItems(new String[]{"播放","下一首播放","加入队列","下载","导出"},(d,n)->{}).show()));
    Thread.sleep(350);saveDesignImage(target,"song-menu");
    runOnMainSync(()->dialog.get().dismiss());
    java.lang.reflect.Method accountMenu=MusicActivity.class.getDeclaredMethod("accountMenu");accountMenu.setAccessible(true);
    runOnMainSync(()->{try{accountMenu.invoke(testActivity);}catch(Exception e){throw new RuntimeException(e);}});
    Thread.sleep(300);saveDesignImage(target,"account-popup");sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);
    java.lang.reflect.Method login=MusicActivity.class.getDeclaredMethod("loginDialog");login.setAccessible(true);
    runOnMainSync(()->{try{login.invoke(testActivity);}catch(Exception e){throw new RuntimeException(e);}});
    Thread.sleep(450);saveDesignImage(target,"login-dialog");sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);
    org.json.JSONArray songs=new org.json.JSONArray();
    for(int i=0;i<8;i++)songs.put(new org.json.JSONObject().put("id","design-fixture-"+i)
        .put("name",i==0?"很长的歌曲名称与不同语言 Long Song Title for Layout Review":"设计验收歌曲 "+(i+1))
        .put("ar",new org.json.JSONArray().put(new org.json.JSONObject().put("name","歌手名称 / Artist"))));
    runOnMainSync(()->{
      android.widget.ScrollView scroll=new android.widget.ScrollView(testActivity);
      SongListPanel list=new SongListPanel(testActivity,"长标题歌单 · 布局检查",new org.json.JSONObject(),songs,new ArtworkLoader(),new java.util.HashSet<>(),new java.util.HashSet<>(),new SongListPanel.Actions(){
        public void play(int i,boolean s){}public void next(int i){}public void append(int i){}public void download(int[] i){}public void player(int i){}
      });
      scroll.setPadding(MobileUi.dp(target,20),MobileUi.dp(target,48),MobileUi.dp(target,20),MobileUi.dp(target,32));
      scroll.setBackgroundColor(DotoDesign.BG);scroll.addView(list);testActivity.setContentView(scroll);
    });
    Thread.sleep(350);saveDesignImage(target,"playlist-long-title");
    check(()->true,"long-title playlist renders without runtime failure");
  }
  private void saveDesignImage(Context target,String name) throws Exception {
    java.io.File folder=new java.io.File(target.getExternalFilesDir(null),"design-review");folder.mkdirs();
    android.graphics.Bitmap bitmap=getUiAutomation().takeScreenshot();
    try(java.io.FileOutputStream out=new java.io.FileOutputStream(new java.io.File(folder,name+".png"))){bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}
    bitmap.recycle();
  }

  private void testBlankFavorite(SpatialPlayer dialog,SketchHeartButton heart,
      java.util.concurrent.atomic.AtomicInteger clicks,
      java.util.concurrent.atomic.AtomicInteger removals) throws Exception {
    java.lang.reflect.Field field=SpatialPlayer.class.getDeclaredField("root");
    field.setAccessible(true);capsulePointerTarget=(android.view.View)field.get(dialog);
    capsuleDirectOnly=true;
    int before=clicks.get();
    tap(500,1250);Thread.sleep(60);tap(500,1250);Thread.sleep(500);
    check(()->clicks.get()==before&&removals.get()==0,"blank double tap does not write favorites");
    check(dialog::isLyricsFace,"blank double tap flips to lyrics");
  }


  private void clickHeart(SketchHeartButton heart) {
    int[] point = new int[2];
    runOnMainSync(
        () -> {
          heart.getLocationOnScreen(point);
          point[0] += heart.getWidth() / 2;
          point[1] += heart.getHeight() / 2;
        });
    long time = SystemClock.uptimeMillis();
    android.view.MotionEvent down =
        android.view.MotionEvent.obtain(
            time, time, android.view.MotionEvent.ACTION_DOWN, point[0], point[1], 0);
    sendPointerSync(down);
    down.recycle();
    SystemClock.sleep(20);
    android.view.MotionEvent up =
        android.view.MotionEvent.obtain(
            time,
            SystemClock.uptimeMillis(),
            android.view.MotionEvent.ACTION_UP,
            point[0],
            point[1],
            0);
    sendPointerSync(up);
    up.recycle();
  }

  private Object playerField(String name) {
    try {
      java.lang.reflect.Field f = SpatialPlayer.class.getDeclaredField(name);
      f.setAccessible(true);
      return f.get(photoPlayer());
    } catch (Exception e) {
      throw new RuntimeException(e);
    }
  }

  private double railCursor() {
    AtomicReference<Double> value = new AtomicReference<>();
    runOnMainSync(() -> value.set(((ElasticScrub) playerField("scrub")).cursor()));
    return value.get();
  }

  private void savePlayerImage(String name) throws Exception {
    android.graphics.Bitmap image = getUiAutomation().takeScreenshot();
    try (OutputStream out =
        new FileOutputStream(new File(getTargetContext().getFilesDir(), name))) {
      image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out);
    }
    image.recycle();
  }

  private void testElasticRail() throws Exception {
    JSONArray many = new JSONArray();
    for (int i = 0; i < 60; i++)
      many.put(
          new JSONObject()
              .put("id", "rail-test-" + i)
              .put("name", "Rail " + i)
              .put("uri", sample.toString()));
    runOnMainSync(
        () -> {
          service.startQueue(many, 20);
          service.pause();
        });
    await(() -> service.prepared && !service.loading, "long rail queue prepared");
    SpatialPlayer sameDialog = photoPlayer();
    runOnMainSync(() -> service.play());
    await(() -> service.playing(), "original playing before pull");
    int beforePull = service.position();
    touch(800, 770, android.view.MotionEvent.ACTION_DOWN);
    touch(800, 880, android.view.MotionEvent.ACTION_MOVE);
    Thread.sleep(300);
    check(
        () -> service.index == 20 && service.playing() && service.position() > beforePull,
        "original keeps playing throughout preview");
    touch(800, 880, android.view.MotionEvent.ACTION_CANCEL);
    runOnMainSync(() -> service.pause());
    touch(800, 770, android.view.MotionEvent.ACTION_DOWN);
    touch(800, 825, android.view.MotionEvent.ACTION_MOVE);
    Thread.sleep(350);
    double first = railCursor();
    Thread.sleep(350);
    double second = railCursor();
    check(() -> first > 20 && second > first, "holding a fixed pull keeps scrolling upward");
    runOnMainSync(() -> invokeActivity("updatePlayerTrack", new Class<?>[0]));
    check(() -> playerField("scrub") != null, "same-track metadata refresh preserves pull");
    savePlayerImage("elastic-rail-small-pull.png");
    check(() -> service.index == 20 && !service.playing(), "preview preserves paused source");
    touch(800, 825, android.view.MotionEvent.ACTION_CANCEL);
    check(
        () -> service.index == 20 && ((Integer) playerField("preview")) == 20,
        "cancel restores current selection");
    touch(800, 770, android.view.MotionEvent.ACTION_DOWN);
    touch(800, 990, android.view.MotionEvent.ACTION_MOVE);
    Thread.sleep(350);
    double fast = railCursor();
    check(() -> fast - 20 > (first - 20) * 3, "larger pull scrolls substantially faster");
    check(
        () -> ((ElasticScrub) playerField("scrub")).strength() == 1,
        "fully straightened wave corresponds to maximum speed");
    savePlayerImage("elastic-rail-full-pull.png");
    touch(800, 990, android.view.MotionEvent.ACTION_CANCEL);
    touch(800, 770, android.view.MotionEvent.ACTION_DOWN);
    touch(800, 550, android.view.MotionEvent.ACTION_MOVE);
    Thread.sleep(250);
    check(
        () -> ((ElasticScrub) playerField("scrub")).cursor() < 20,
        "upward pull reverses scrolling");
    touch(800, 550, android.view.MotionEvent.ACTION_CANCEL);
    touch(800, 770, android.view.MotionEvent.ACTION_DOWN);
    touch(800, 880, android.view.MotionEvent.ACTION_MOVE);
    Thread.sleep(350);
    touch(800, 770, android.view.MotionEvent.ACTION_MOVE);
    Thread.sleep(80);
    int chosen = (int) Math.round(railCursor());
    check(
        () -> chosen > 20 && service.index == 20, "release target previews before playback change");
    touch(800, 770, android.view.MotionEvent.ACTION_UP);
    await(
        () -> service.index == chosen && service.prepared && !service.loading,
        "release snaps to nearest song in long queue");
    check(() -> sameDialog == photoPlayer(), "long queue switch keeps player open");
    touch(800, 770, android.view.MotionEvent.ACTION_DOWN);
    runOnMainSync(
        () -> {
          service.startQueue(items(), 1);
          service.pause();
        });
    await(() -> service.prepared && !service.loading, "external selection during gesture");
    touch(800, 920, android.view.MotionEvent.ACTION_MOVE);
    touch(800, 920, android.view.MotionEvent.ACTION_UP);
    check(
        () -> service.index == 1 && sameDialog.isShowing(),
        "stale motion after external track change safely ignored");
  }

  private void feedCardOrientation(float pitch, float roll, int repeats) {
    runOnMainSync(
        () -> {
          try {
            java.lang.reflect.Method m =
                SpatialPlayer.class.getDeclaredMethod(
                    "updateOrientation", float.class, float.class);
            m.setAccessible(true);
            for (int i = 0; i < repeats; i++) m.invoke(photoPlayer(), pitch, roll);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
  }

  private void testCapsuleGesture() throws Exception {
    int index = service.index;
    tap(300, 700);
    Thread.sleep(450);
    check(() -> (Float) playerField("capsuleFraction") == 0, "card tap no longer toggles capsule");
    touch(300, 700, android.view.MotionEvent.ACTION_DOWN);
    touch(470, 700, android.view.MotionEvent.ACTION_MOVE);
    Thread.sleep(100);
    check(
        () ->
            (Float) playerField("capsuleFraction") > .2f
                && (Float) playerField("capsuleFraction") < .9f,
        "capsule follows horizontal finger before release");
    savePlayerImage("player-capsule-follow.png");
    Thread.sleep(200);
    touch(470, 700, android.view.MotionEvent.ACTION_UP);
    await(() -> (Float) playerField("capsuleFraction") == 1, "right swipe hides capsule");
    check(
        () ->
            ((android.view.View) playerField("rail")).getVisibility() == android.view.View.INVISIBLE
                && service.index == index,
        "hidden capsule cannot intercept touches or change songs");
    runOnMainSync(
        () -> {
          try {
            java.lang.reflect.Method m = SpatialPlayer.class.getDeclaredMethod("cardMatrix");
            m.setAccessible(true);
            android.graphics.Matrix matrix = (android.graphics.Matrix) m.invoke(photoPlayer());
            float[] points = {358, 743, 49, 743, 667, 743};
            matrix.mapPoints(points);
            if (Math.abs(points[0] - 465.5f) > 1
                || Math.abs(points[4] - points[2] - 618 * 1.08f) > 1)
              throw new AssertionError("hidden card must center and enlarge by eight percent");
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    checks++;
    savePlayerImage("player-capsule-hidden.png");
    touch(500, 700, android.view.MotionEvent.ACTION_DOWN);
    touch(650, 700, android.view.MotionEvent.ACTION_MOVE);
    Thread.sleep(120);
    check(
        () ->
            (Float) playerField("capsuleFraction") == 1
                && (Float) playerField("cardOverdrag") > 10
                && (Float) playerField("cardOverdrag") < 60,
        "overpull beyond hidden state has bounded rubber resistance");
    savePlayerImage("player-capsule-rubber.png");
    touch(650, 700, android.view.MotionEvent.ACTION_UP);
    await(
        () ->
            (Float) playerField("cardOverdrag") == 0 && (Float) playerField("capsuleFraction") == 1,
        "overpull springs back to hidden boundary");
    tap(500, 700);
    Thread.sleep(450);
    check(() -> (Float) playerField("capsuleFraction") == 1, "tap stays hidden");
    touch(500, 700, android.view.MotionEvent.ACTION_DOWN);
    touch(430, 700, android.view.MotionEvent.ACTION_MOVE);
    touch(150, 700, android.view.MotionEvent.ACTION_MOVE);
    Thread.sleep(200);
    touch(150, 700, android.view.MotionEvent.ACTION_UP);
    await(() -> (Float) playerField("capsuleFraction") == 0, "left swipe restores capsule");
    touch(300, 700, android.view.MotionEvent.ACTION_DOWN);
    touch(500, 700, android.view.MotionEvent.ACTION_MOVE);
    touch(500, 700, android.view.MotionEvent.ACTION_UP);
    Thread.sleep(60);
    touch(400, 700, android.view.MotionEvent.ACTION_DOWN);
    touch(50, 700, android.view.MotionEvent.ACTION_MOVE);
    touch(50, 700, android.view.MotionEvent.ACTION_UP);
    await(
        () -> (Float) playerField("capsuleFraction") == 0,
        "swipe reverses an unfinished transition");
    touch(300, 700, android.view.MotionEvent.ACTION_DOWN);
    touch(335, 700, android.view.MotionEvent.ACTION_MOVE);
    touch(335, 700, android.view.MotionEvent.ACTION_CANCEL);
    await(() -> (Float) playerField("capsuleFraction") == 0, "cancel returns to expanded state");
    check(
        () ->
            ((android.view.View) playerField("rail")).getVisibility() == android.view.View.VISIBLE,
        "restored capsule accepts its own gestures");
    touch(300, 700, android.view.MotionEvent.ACTION_DOWN);
    touch(180, 700, android.view.MotionEvent.ACTION_MOVE);
    Thread.sleep(100);
    check(
        () ->
            (Float) playerField("cardOverdrag") < -10 && (Float) playerField("cardOverdrag") > -60,
        "expanded boundary also resists overpull");
    check(
        () -> ((android.view.View) playerField("rail")).getTranslationX() < -10,
        "capsule also follows left overpull beyond expanded boundary");
    savePlayerImage("player-capsule-left-overpull.png");
    touch(180, 700, android.view.MotionEvent.ACTION_UP);
    await(
        () ->
            (Float) playerField("cardOverdrag") == 0 && (Float) playerField("capsuleFraction") == 0,
        "expanded overpull rebounds");
    check(
        () -> ((android.view.View) playerField("rail")).getTranslationX() == 0,
        "capsule and its touch target rebound together");
  }

  private void testCardTilt() throws Exception {
    runOnMainSync(
        () -> {
          try {
            java.lang.reflect.Field ready =
                SpatialPlayer.class.getDeclaredField("orientationReady");
            ready.setAccessible(true);
            ready.set(photoPlayer(), false);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        });
    feedCardOrientation(0, 0, 1);
    feedCardOrientation((float) Math.toRadians(.8), (float) Math.toRadians(.5), 35);
    check(
        () -> (Float) playerField("tiltX") == 0 && (Float) playerField("tiltY") == 0,
        "small hand tremors no longer move the card");
    feedCardOrientation(.4f, .4f, 35);
    check(
        () ->
            (Float) playerField("tiltX") > 22
                && (Float) playerField("tiltX") < 23.5
                && (Float) playerField("tiltY") < -22,
        "physical-angle tilt follows the restored pitch and yaw directions");
    Thread.sleep(60);
    runOnMainSync(() -> ((android.view.View) playerField("scene")).invalidate());
    waitForIdleSync();
    Thread.sleep(100);
    savePlayerImage("player-counter-tilt.png");
    feedCardOrientation(1f, 1f, 35);
    check(
        () ->
            (Float) playerField("tiltX") > 44.9
                && (Float) playerField("tiltX") <= 45
                && (Float) playerField("tiltY") < -44.9
                && (Float) playerField("tiltY") >= -45,
        "higher tilt limit clamps both axes at 45 degrees");
    Thread.sleep(250);
    feedCardOrientation(1.1f, 1.1f, 10);
    Thread.sleep(200);
    check(
        () -> !(Boolean) playerField("returningToPlane") && (Float) playerField("tiltX") > 20,
        "new motion restarts half-second stillness delay");
    // Stationary sensor samples keep arriving; they must not postpone the reset.
    for (int i = 0; i < 4; i++) {
      feedCardOrientation(1.1f, 1.1f, 1);
      Thread.sleep(40);
    }
    check(
        () -> !(Boolean) playerField("returningToPlane"),
        "no early restoration before half a second");
    await(
        () -> (Boolean) playerField("returningToPlane"),
        "automatic restoration starts after stillness");
    Thread.sleep(220);
    check(
        () ->
            (Boolean) playerField("returningToPlane")
                && Math.abs((Float) playerField("tiltX")) > .1f
                && Math.abs((Float) playerField("tiltX")) < 45,
        "slower curved restoration has a visible intermediate state");
    await(
        () -> (Float) playerField("tiltX") == 0 && (Float) playerField("tiltY") == 0,
        "card smoothly restores without more sensor events");
    feedCardOrientation(1.1f, 1.1f, 25);
    check(
        () -> (Float) playerField("tiltX") == 0 && (Float) playerField("tiltY") == 0,
        "rebased stationary phone does not tilt again");
    feedCardOrientation(1.1f + (float) Math.toRadians(.4), 1.1f - (float) Math.toRadians(.3), 35);
    check(
        () -> (Float) playerField("tiltX") == 0 && (Float) playerField("tiltY") == 0,
        "tiny motion after restoration does not restart tilt");
    savePlayerImage("player-restored-plane.png");
    feedCardOrientation(.9f, .9f, 35);
    check(
        () -> (Float) playerField("tiltX") < -11 && (Float) playerField("tiltY") > 11,
        "new rotation responds relative to rebased plane");
    await(
        () -> (Float) playerField("tiltX") == 0 && (Float) playerField("tiltY") == 0,
        "subsequent motion also restores");
  }

  private void testPullDismiss() throws Exception {
    SpatialPlayer dialog = photoPlayer();
    android.view.View root = (android.view.View) playerField("root");
    check(
        () ->
            getUiAutomation()
                .getRootInActiveWindow()
                .findAccessibilityNodeInfosByText("查看专辑")
                .isEmpty(),
        "album entry removed");
    float[] observedMotion = new float[2];
    runOnMainSync(
        () ->
            root.setOnTouchListener(
                (v, event) -> {
                  if (event.getActionMasked() == android.view.MotionEvent.ACTION_DOWN)
                    observedMotion[0] = event.getRawY();
                  if (event.getActionMasked() == android.view.MotionEvent.ACTION_MOVE)
                    observedMotion[1] = event.getRawY() - observedMotion[0];
                  return false;
                }));
    touch(690, 1240, android.view.MotionEvent.ACTION_DOWN);
    touch(690, 1310, android.view.MotionEvent.ACTION_MOVE);
    Thread.sleep(150);
    check(
        () ->
            observedMotion[1] > 60
                && Math.abs(dialog.collapseProgress() * root.getHeight() * .34f - observedMotion[1])
                    < 2,
        "page translation matches delivered finger displacement one to one");
    check(() -> dialog.isShowing(), "blank-space pull stays open until release");
    savePlayerImage("player-pull-following.png");
    Thread.sleep(300);
    touch(690, 1310, android.view.MotionEvent.ACTION_UP);
    try {
      await(() -> dialog.collapseProgress() == 0 && dialog.isShowing(), "short pull rebounds");
    } catch (Exception | AssertionError error) {
      throw new AssertionError(
          "short pull: translation=" + root.getTranslationY() + " showing=" + dialog.isShowing(),
          error);
    }
    touch(690, 1240, android.view.MotionEvent.ACTION_DOWN);
    touch(690, 1420, android.view.MotionEvent.ACTION_MOVE);
    touch(690, 1420, android.view.MotionEvent.ACTION_CANCEL);
    await(() -> dialog.collapseProgress() == 0 && dialog.isShowing(), "cancelled pull rebounds");
    touch(400, 1240, android.view.MotionEvent.ACTION_DOWN);
    touch(650, 1240, android.view.MotionEvent.ACTION_MOVE);
    touch(650, 1240, android.view.MotionEvent.ACTION_UP);
    check(
        () -> dialog.collapseProgress() == 0 && dialog.isShowing(),
        "horizontal blank swipe ignored");
    touch(300, 600, android.view.MotionEvent.ACTION_DOWN);
    touch(300, 800, android.view.MotionEvent.ACTION_MOVE);
    touch(300, 800, android.view.MotionEvent.ACTION_UP);
    check(
        () -> dialog.collapseProgress() == 0 && dialog.isShowing(),
        "cover card is excluded from blank gesture");
    int index = service.index;
    touch(690, 1240, android.view.MotionEvent.ACTION_DOWN);
    touch(690, 1440, android.view.MotionEvent.ACTION_MOVE);
    Thread.sleep(300);
    touch(690, 1440, android.view.MotionEvent.ACTION_UP);
    await(() -> !dialog.isShowing(), "shorter pull now exceeds the lowered dismiss threshold");
    check(() -> service.index == index && !service.playing(), "collapse preserves playback state");
    runOnMainSync(() -> invokeActivity("showStemControls", new Class<?>[0]));
    await(
        () -> photoPlayer() != dialog && photoPlayer().isShowing(),
        "player reopens after collapse");
    check(
        () ->
            getUiAutomation()
                .getRootInActiveWindow()
                .findAccessibilityNodeInfosByText("收起播放器")
                .isEmpty(),
        "top exit control removed");
    savePlayerImage("player-no-top-button.png");
    tap(150, 35);
    check(() -> photoPlayer().isShowing(), "old top button location no longer closes page");
    sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);
    await(() -> !photoPlayer().isShowing(), "system back remains available");
  }

  private void testPhotoPlayer() throws Exception {
    runOnMainSync(
        () -> {
          service.observer =
              changed -> invokeActivity("syncPlayback", new Class<?>[] {boolean.class}, changed);
          service.startQueue(items(), 1);
          service.pause();
        });
    await(() -> service.prepared && !service.loading, "photo source prepared");
    runOnMainSync(() -> invokeActivity("showStemControls", new Class<?>[0]));
    await(() -> photoPlayer() != null && photoPlayer().isShowing(), "photo dialog shown");
    SpatialPlayer original = photoPlayer();
    check(
        () -> Boolean.TRUE.equals(playerField("motionRegistered")),
        "device orientation sensor registered");
    runOnMainSync(
        () -> {
          ((android.hardware.SensorManager) playerField("motion"))
              .unregisterListener(
                  (android.hardware.SensorEventListener) playerField("orientationListener"));
        });
    waitForIdleSync();
    Thread.sleep(800);
    android.graphics.Bitmap shot = getUiAutomation().takeScreenshot();
    try (OutputStream out =
        new FileOutputStream(
            new File(getTargetContext().getFilesDir(), "photo-player-before-check.png"))) {
      shot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out);
    }
    int[][] samples = {
      {65, 500, 0xFFFFFF},
      {730, 700, 0x777777},
      {900, 1200, 0x000000},
      {120, 1425, 0xFFFFFF},
      {100, 1800, 0xFFFFFF},
      {690, 1815, 0x000000}
    };
    for (int[] sample : samples) {
      int pixel =
          shot.getPixel(
                  Math.round(sample[0] * shot.getWidth() / 931f),
                  Math.round(sample[1] * shot.getHeight() / 2048f))
              & 0xFFFFFF;
      if (pixel != sample[2])
        throw new AssertionError(
            "reference color at "
                + sample[0]
                + ","
                + sample[1]
                + " expected="
                + Integer.toHexString(sample[2])
                + " got="
                + Integer.toHexString(pixel));
      checks++;
    }
    File image = new File(getTargetContext().getFilesDir(), "photo-player-geometry.png");
    try (OutputStream out = new FileOutputStream(image)) {
      shot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out);
    }
    shot.recycle();
    testCapsuleGesture();
    testElasticRail();
    touch(305, 1800, android.view.MotionEvent.ACTION_DOWN);
    Thread.sleep(750);
    touch(305, 1800, android.view.MotionEvent.ACTION_UP);
    await(
        () -> {
          android.view.accessibility.AccessibilityNodeInfo root =
              getUiAutomation().getRootInActiveWindow();
          return root != null && !root.findAccessibilityNodeInfosByText("人声与伴奏").isEmpty();
        },
        "long press opens stem management without switching source");
    sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);
    check(() -> service.mode == null, "stem menu does not change active source");
    touch(800, 770, android.view.MotionEvent.ACTION_DOWN);
    touch(800, 920, android.view.MotionEvent.ACTION_MOVE);
    Thread.sleep(300);
    check(() -> service.index == 1, "rail drag previews without switching");
    touch(800, 920, android.view.MotionEvent.ACTION_UP);
    await(
        () -> service.index == 2 && service.prepared && !service.loading,
        "rail release commits next selection");
    check(
        () -> photoPlayer() == original && original.isShowing(), "switch stays inside same player");
    tap(781, 1815);
    await(() -> !service.playing(), "play control pauses");
    tap(600, 1425);
    await(() -> service.position() > 6000, "dashed seek scrubs");
    tap(305, 1800);
    await(
        () -> service.prepared && !service.loading && service.mode == null,
        "middle selects original");
    tap(65, 1800);
    await(
        () -> service.mode != null && service.mode.equals("vocals.wav") && service.prepared,
        "left starts separation then selects partial vocal");
    check(() -> !service.playing(), "automatic stem selection preserves pause");
    testCardTilt();
    testPullDismiss();
    runOnMainSync(
        () -> {
          original.dismiss();
          service.stop();
        });
  }

  private void tap(float x, float y) {
    touch(x, y, android.view.MotionEvent.ACTION_DOWN);
    touch(x, y, android.view.MotionEvent.ACTION_UP);
  }

  private long pointerDownTime;

  private void touch(float x, float y, int action) {
    android.util.DisplayMetrics metrics = getTargetContext().getResources().getDisplayMetrics();
    long time = SystemClock.uptimeMillis();
    if (action == android.view.MotionEvent.ACTION_DOWN) pointerDownTime = time;
    android.view.MotionEvent event =
        android.view.MotionEvent.obtain(
            pointerDownTime,
            time,
            action,
            x * metrics.widthPixels / 931f,
            y * metrics.heightPixels / 2048f,
            0);
    if (capsuleDirectOnly) runOnMainSync(() -> capsulePointerTarget.dispatchTouchEvent(event));
    else sendPointerSync(event);
    event.recycle();
    // Give injected moves a frame interval, avoiding device input prediction from zero-time jumps.
    if (action == android.view.MotionEvent.ACTION_DOWN
        || action == android.view.MotionEvent.ACTION_MOVE) SystemClock.sleep(20);
  }

  private JSONArray items() {
    JSONArray list = new JSONArray();
    try {
      for (String id : new String[] {"a", "b", "c"})
        list.put(
            new JSONObject()
                .put("id", id)
                .put("name", "Regression " + id)
                .put("uri", sample.toString()));
    } catch (Exception e) {
      throw new RuntimeException(e);
    }
    return list;
  }

  private boolean read(BooleanSupplier condition) {
    AtomicReference<Boolean> value = new AtomicReference<>(false);
    runOnMainSync(() -> value.set(condition.getAsBoolean()));
    return value.get();
  }

  private void check(BooleanSupplier condition, String name) {
    if (!read(condition)) throw new AssertionError(name);
    checks++;
  }

  private void await(BooleanSupplier condition, String name) throws Exception {
    long end = SystemClock.elapsedRealtime() + 8000;
    while (SystemClock.elapsedRealtime() < end) {
      if (read(condition)) {
        checks++;
        return;
      }
      Thread.sleep(40);
    }
    throw new AssertionError(
        "timeout: "
            + name
            + "; playing="
            + read(() -> service.playing())
            + "; pos="
            + service.position()
            + "; error="
            + service.error
            + "; mode="
            + service.mode);
  }
}
