package com.volo.mobile;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Functional integration screen; visual redesign is a separate step. */
public class MusicActivity extends Activity {
  private final ExecutorService network = Executors.newSingleThreadExecutor();
  private final NeteaseClient api = new NeteaseClient();
  private SessionStore sessions;
  private TextView status, account;
  private LinearLayout content;
  private EditText search;
  private final ArtworkLoader images = new ArtworkLoader();
  private final ExecutorService homeData = Executors.newFixedThreadPool(3);
  private final ExecutorService searchNetwork = Executors.newFixedThreadPool(2);
  private Future<?> searchRequest;
  private int searchGeneration;
  private TextView pageTitle, miniArtist;
  private ImageView miniCover;
  private LinearLayout body, dock;
  private ScrollView pageScroll;
  private int discoverScroll, personalScroll;
  private int mainTab;
  private volatile int accountEpoch;
  private String avatarUrl = "";
  private JSONArray dailySongs = new JSONArray(),
      suggestedLists = new JSONArray(),
      myLists = new JSONArray();
  private boolean homeLoading, personalLoading;
  private boolean accountRestoring=true,extraDiscoveryAttempted;
  private String homeFailure = "";
  private Runnable listParent = this::showHome;

  private MediaPlayer player;
  private PlaybackService engine;
  private boolean bound, foreground;
  private String browse = "home";
  private JSONArray displayedSongs;
  private String listTitle = "歌曲";
  private JSONObject listInfo = new JSONObject();
  private SongListPanel songListPanel;
  private GlassUi.Symbol headerBack, headerMore;
  private View headerSettings;
  private View homeToolbar;
  private View personalToolbar;
  private View profileAccountButton;
  private View profileStyleButton;
  private LinearLayout homeBar;
  private GlassUi.Symbol homeSearch;
  private android.graphics.Rect homeSearchOrigin;
  private boolean searchClosing;
  private final Runnable liveSearch = this::searchSongs;
  private long appearanceRevision;
  private boolean reopenPlayer;
  private final ServiceConnection connection =
      new ServiceConnection() {
        public void onServiceConnected(ComponentName name, IBinder binder) {
          engine = ((PlaybackService.LocalBinder) binder).get();
          engine.observer = changed -> syncPlayback(changed);
          syncPlayback(true);
          if (restoreFullPlayer && engine.originalUri != null) showStemControls();
          restoreFullPlayer = false;
        }

        public void onServiceDisconnected(ComponentName name) {
          engine = null;
          updateHomeSongIndicators();
        }
      };

  private void syncPlayback(boolean changed) {
    if (engine == null || destroyed) return;
    player = engine.player;
    updateHomeSongIndicators();
    if (songListPanel != null)
      songListPanel.updateCurrent(engine.current().optString("id"), engine.playbackActive());
    originalUri = engine.originalUri;
    originalLabel = engine.title;
    prepared = engine.prepared && !engine.loading;
    if (changed) {
      stemEpoch++;
      originalUri = engine.originalUri;
      originalLabel = engine.title;
      albumBitmap = null;
      selectedMode = engine.mode;
      String path = getSharedPreferences("stems", 0).getString(stemKey(), "");
      stemFiles = path.isEmpty() ? null : new File(path);
      if (stemFiles != null
          && (!new File(stemFiles, "vocals.wav").isFile()
              || !new File(stemFiles, "accompaniment.wav").isFile())) stemFiles = null;
      stemMessage = stemFiles == null ? "分离当前歌曲的人声与伴奏" : "音轨已就绪，可切换人声或伴奏";
      awaitingStem = null;
      if (spatial != null && spatial.isShowing()) updatePlayerTrack();
    }
    playerBar.setVisibility(
        engine.index < 0 || compactMode || (spatial != null && spatial.isShowing())
            ? View.GONE
            : View.VISIBLE);
    if (compactMode && engine.index >= 0 && compactPlayer == null) enterCompact(null);
    refreshCompact();
    nowPlaying.setText(engine.title + (engine.loading ? " · 加载中" : ""));
    miniArtist.setText(artists(engine.current()));
    String miniUrl = coverUrl(engine.current());
    if (!miniUrl.equals(miniCover.getTag())) {
      miniCover.setImageDrawable(null);
      images.into(miniCover, miniUrl);
    }
    playPause.setEnabled(engine.index >= 0);
    playPause.setText(!engine.error.isEmpty() && !prepared ? "↻" : engine.playbackActive() ? "Ⅱ" : "▶");
    playerSeek.setEnabled(prepared);
    selectedMode = awaitingStem != null ? awaitingStem : engine.mode;
    stemFiles = engine.stems.cached(stemKey());
    stemStream = engine.stems.stream();
    stemRunning = engine.stems.running();
    stemMessage = engine.stems.message();
    if (awaitingStem != null && (stemFiles != null || (stemStream != null && stemStream.available()))) {
      String desired = awaitingStem;
      awaitingStem = null;
      switchStem(desired);
    }
    if (spatial != null && engine.loading) spatial.playback(engine.position(), 0, engine.playbackActive());
    if (spatial != null) {
      spatial.favorite(isFavorite(engine.current().optString("id")));
      refreshPlayerActions();
    }
    if (!engine.error.isEmpty()) {
      status.setText(engine.error);
      if (spatial != null) {
        spatial.playback(engine.position(), engine.duration(), engine.playbackActive());
        spatial.state(engine.error, stemRunning, stemFiles != null, selectedMode, engine.stems.progress());
      }
    } else refreshStemControls();
    timer.removeCallbacks(playbackTick);
    if (prepared && foreground) timer.post(playbackTick);
    if (reopenPlayer && prepared && foreground) {
      reopenPlayer = false;
      showStemControls();
    }
  }

  private String stemKey() {
    return engine == null ? originalLabel : engine.current().optString("id", originalLabel);
  }

  private long userId;
  private volatile boolean destroyed;
  private volatile boolean requesting;
  private int page;
  private boolean restoreFullPlayer;
  private final Handler timer = new Handler(Looper.getMainLooper());

  private DownloadManager downloads;

  @Override
  public void onCreate(Bundle saved) {
    super.onCreate(saved);
    getSplashScreen().setOnExitAnimationListener(splash->splash.remove());
    DotoAppearance.load(this);appearanceRevision=DotoAppearance.revision(this);
    getWindow().setDecorFitsSystemWindows(false);
    hideHomeStatusBar();
    sessions = new SessionStore(this);
    downloads = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
    FrameLayout root = new FrameLayout(this);
    root.setClipChildren(false);root.setClipToPadding(false);
    root.setOnApplyWindowInsetsListener(
        (v, insets) -> {
          android.graphics.Insets bars =
              insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
          int gutter = gd(DotoDesign.PAGE_GUTTER);
          android.graphics.Insets safe = insets.getInsetsIgnoringVisibility(
              WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
          v.setPadding(gutter + safe.left, bars.top, gutter + safe.right, bars.bottom);
          v.post(() -> updatePageViewport(root));
          WindowInsetsController controller = getWindow().getInsetsController();
          if (controller != null)
            controller.setSystemBarsAppearance(
                DotoAppearance.light ? WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS : 0,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
          return insets;
        });
    body = MobileUi.column(this);
    body.setClipChildren(false);body.setClipToPadding(false);
    root.addView(body, new FrameLayout.LayoutParams(-1, -1));
    root.addOnLayoutChangeListener((v,l,t,r,b,oldL,oldT,oldR,oldB) -> updatePageViewport(root));
    LinearLayout header = new LinearLayout(this);
    header.setGravity(Gravity.CENTER_VERTICAL);
    headerBack = new GlassUi.Symbol(this, "back", "返回上一页", () -> listParent.run());
    LinearLayout leftHeader=new LinearLayout(this);searchEntryContainer=leftHeader;leftHeader.setGravity(Gravity.CENTER_VERTICAL);
    leftHeader.addView(headerBack,new LinearLayout.LayoutParams(gd(48),gd(48)));
    headerBack.setVisibility(View.GONE);
    pageTitle = GlassUi.label(this, "发现", 22, true);
    pageTitle.setVisibility(View.GONE);
    header.addView(pageTitle, new LinearLayout.LayoutParams(0, GlassUi.dp(this, 64), 1));
    GlassUi.Symbol searchButton = new GlassUi.Symbol(this, "search", "搜索", this::showSearch);
    leftHeader.addView(searchButton,new LinearLayout.LayoutParams(gd(48),gd(48)));
    DotoDesign.roundGlass(searchButton,body);
    DotoDesign.roundGlass(headerBack,body);
    FrameLayout.LayoutParams leftParams=new FrameLayout.LayoutParams(-2,gd(48),Gravity.TOP|Gravity.LEFT);
    leftParams.topMargin=gd(20);root.addView(leftHeader,leftParams);
    SettingsActivity.Glyph settings=new SettingsActivity.Glyph(this,SettingsActivity.Kind.ENTRY);
    settings.setContentDescription("设置");GlassUi.touch(settings,this::showSettings);
    headerSettings = settings;
    header.addView(
        settings, new LinearLayout.LayoutParams(GlassUi.dp(this, 48), GlassUi.dp(this, 48)));
    headerMore =
        new GlassUi.Symbol(
            this,
            "more",
            "歌单操作",
            () -> {
              if(listInfo.optBoolean("savedAlbum")){albumActions(listInfo);}
              else if(listInfo.optLong("id")>0){JSONObject liked=likedPlaylist();if(listInfo.optInt("specialType")!=5&&(liked==null||liked.optLong("id")!=listInfo.optLong("id")))playlistActions(listInfo);}
              else if(songListPanel!=null)songListPanel.showOptions();
            });
    header.addView(headerMore, new LinearLayout.LayoutParams(gd(48), gd(48)));
    headerMore.setVisibility(View.GONE);
    DotoDesign.roundGlass(settings,body);
    DotoDesign.roundGlass(headerMore,body);
    FrameLayout.LayoutParams hp=new FrameLayout.LayoutParams(-2,gd(48),Gravity.TOP|Gravity.RIGHT);
    hp.topMargin=gd(20);root.addView(header,hp);
    homeBar = new LinearLayout(this);
    homeBar.setGravity(Gravity.CENTER_VERTICAL);
    homeToolbar = homeBar;
    SettingsActivity.Glyph homeSettings = new SettingsActivity.Glyph(this, SettingsActivity.Kind.ENTRY);
    homeSettings.setContentDescription("设置");
    GlassUi.touch(homeSettings, this::showSettings);
    DotoDesign.roundGlass(homeSettings, body);
    homeBar.addView(homeSettings, new LinearLayout.LayoutParams(gd(48), gd(48)));

    homeBar.addView(new View(this), new LinearLayout.LayoutParams(0, 0, 1));
    homeSearch = new GlassUi.Symbol(this, "search", "搜索", this::showSearch);
    DotoDesign.roundGlass(homeSearch, body);
    homeBar.addView(homeSearch, new LinearLayout.LayoutParams(gd(48), gd(48)));
    FrameLayout.LayoutParams homeParams = new FrameLayout.LayoutParams(-1, gd(48), Gravity.TOP);
    homeParams.topMargin = gd(32);
    root.addView(homeBar, homeParams);
    LinearLayout profileBar = new LinearLayout(this);
    profileBar.setGravity(Gravity.CENTER_VERTICAL);
    personalToolbar = profileBar;
    profileAccountButton = new GlassUi.Symbol(this, "person", "账号管理", this::accountMenu);
    DotoDesign.roundGlass(profileAccountButton, body);
    profileBar.addView(profileAccountButton, new LinearLayout.LayoutParams(gd(48), gd(48)));
    profileBar.addView(new View(this), new LinearLayout.LayoutParams(0, 0, 1));
    profileStyleButton = new GlassUi.Symbol(this, "moreVertical",
        "个人页个性化设置", this::showProfileStyleMenu);
    DotoDesign.roundGlass(profileStyleButton, body);
    profileBar.addView(profileStyleButton, new LinearLayout.LayoutParams(gd(48), gd(48)));
    FrameLayout.LayoutParams profileBarParams = new FrameLayout.LayoutParams(-1, gd(48), Gravity.TOP);
    profileBarParams.topMargin = gd(32);
    root.addView(profileBar, profileBarParams);
    personalToolbar.setVisibility(View.GONE);
    account = GlassUi.label(this, "未登录", 13, false);
    searchToolbar = new FrameLayout(this);
    searchToolbar.setVisibility(View.GONE);
    searchExit = new GlassUi.Symbol(this, "close", "退出搜索", this::exitSearch);
    FrameLayout.LayoutParams exitParams = new FrameLayout.LayoutParams(gd(48), gd(48), Gravity.END);

    searchRow = new LinearLayout(this);
    searchRow.setGravity(Gravity.CENTER_VERTICAL);
    FrameLayout.LayoutParams searchParams =
        new FrameLayout.LayoutParams(-1, gd(48), Gravity.TOP | Gravity.LEFT);
    searchParams.rightMargin = gd(56);
    searchToolbar.addView(searchRow, searchParams);
    searchToolbar.addView(searchExit, exitParams);
    search = new EditText(this);
    search.setSingleLine();
    android.graphics.drawable.Drawable cursor = search.getTextCursorDrawable();
    if (cursor != null) {
      cursor = cursor.mutate();
      cursor.setTint(android.graphics.Color.WHITE);
      search.setTextCursorDrawable(cursor);
    }
    search.setTextColor(GlassUi.INK);
    search.setHintTextColor(GlassUi.MUTED);
    search.setTextSize(15);
    search.setHint("搜索歌曲、歌手");
    search.setBackgroundColor(android.graphics.Color.TRANSPARENT);
    search.setOnClickListener(view -> { if (!"search".equals(browse)) showSearch(); });
    GlassUi.touch(searchRow, () -> {
      if ("search".equals(browse)) focusSearch();
      else showSearch();
    });
    search.setPadding(0, 0, gd(8), 0);
    searchRow.addView(new GlassUi.Symbol(this, "search", "搜索", () -> {
      if ("search".equals(browse)) searchSongs();
      else showSearch();
    }), new LinearLayout.LayoutParams(gd(48), gd(48)));
    searchRow.addView(search,new LinearLayout.LayoutParams(0,gd(48),1));
    searchClear = new GlassUi.Symbol(this, "close", "清空搜索", () -> {
      search.setText("");
      focusSearch();
    });
    searchClear.setVisibility(View.GONE);
    searchRow.addView(searchClear, new LinearLayout.LayoutParams(gd(48), gd(48)));
    search.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH);
    search.addTextChangedListener(new android.text.TextWatcher() {
      public void beforeTextChanged(CharSequence text, int start, int count, int after) {}
      public void onTextChanged(CharSequence text, int start, int before, int count) {
        searchClear.setVisibility(text.length() == 0 ? View.GONE : View.VISIBLE);
        if (!"search".equals(browse) || searchClosing) return;
        if (playlistSearchSource != null) filterPlaylistSongs();
        else {
          cancelSearchRequest();
          showSearchPrompt();
          if (!text.toString().isBlank()) timer.postDelayed(liveSearch, 240);
        }
      }
      public void afterTextChanged(android.text.Editable text) {}
    });

    search.setOnEditorActionListener(
        (v, action, event) -> {
          if (action == android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH) {
            searchSongs();
            return true;
          }
          return false;
        });
    status = GlassUi.label(this, "", 12, false);
    status.setTextColor(GlassUi.MUTED);
    status.setMaxLines(2);
    status.setPadding(0, GlassUi.dp(this, 6), 0, GlassUi.dp(this, 4));
    body.addView(status, new LinearLayout.LayoutParams(-1, -2));
    status.addTextChangedListener(
        new android.text.TextWatcher() {
          public void beforeTextChanged(CharSequence t, int st, int count, int after) {}

          public void onTextChanged(CharSequence t, int st, int before, int count) {
            status.setVisibility(
                t.toString().contains("失败")
                        || t.toString().contains("等待")
                        || t.toString().contains("失效")
                    ? View.VISIBLE
                    : View.GONE);
          }

          public void afterTextChanged(android.text.Editable e) {}
        });
    status.setVisibility(View.GONE);
    ScrollView scroll = new ScrollView(this) {
      @Override protected void dispatchDraw(android.graphics.Canvas canvas) {
        int saved = canvas.save();
        // Keep the discovery carousel's side peek while clipping rows vertically.
        canvas.clipRect(-gd(20), getScrollY(), getWidth() + gd(20), getScrollY() + getHeight());
        super.dispatchDraw(canvas);
        canvas.restoreToCount(saved);
      }
    };
    pageScroll = scroll;
    scroll.setFillViewport(true);
    scroll.setVerticalScrollBarEnabled(false);
    // The fading-edge layer clips carousel previews to the ScrollView width.
    scroll.setVerticalFadingEdgeEnabled(false);
    scroll.setClipToPadding(false);scroll.setClipChildren(false);
    content = new LinearLayout(this) {
      @Override public boolean hasOverlappingRendering() {
        // Draw each home section's fade without clipping the edge-to-edge shelves
        // to this narrower column's bounds.
        return !"home".equals(browse);
      }
    };
    content.setOrientation(LinearLayout.VERTICAL);
    content.setClipChildren(false);content.setClipToPadding(false);
    content.setPadding(0, gd(8), 0, gd(8));
    LinearLayout scrollContents = MobileUi.column(this);
    scrollContents.setClipChildren(false);
    scrollContents.setClipToPadding(false);
    // Start below the toolbar, then let the leading space scroll away.
    scrollContents.setPadding(0, gd(80), 0, 0);
    searchToolbar.setClipChildren(false);
    searchToolbar.setClipToPadding(false);
    DotoDesign.roundGlass(searchRow, body);
    DotoDesign.roundGlass(searchExit, body);
    FrameLayout.LayoutParams toolbarParams = new FrameLayout.LayoutParams(-1, gd(48), Gravity.TOP);
    toolbarParams.topMargin = gd(32);
    root.addView(searchToolbar, toolbarParams);
    scrollContents.addView(content, new LinearLayout.LayoutParams(-1, -2));
    scroll.addView(scrollContents);
    body.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
    dock = MobileUi.column(this);
    dock.setGravity(Gravity.CENTER_HORIZONTAL);
    dock.setVisibility(View.GONE);
    FrameLayout.LayoutParams dockParams = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
    dockParams.bottomMargin = GlassUi.dp(this, 12);
    root.addView(dock, dockParams);
    playerBar = MobileUi.column(this);
    playerBar.setBackground(GlassUi.glass(this, 20));
    playerBar.setPadding(
        GlassUi.dp(this, 9), GlassUi.dp(this, 8), GlassUi.dp(this, 8), GlassUi.dp(this, 8));
    LinearLayout miniRow = new LinearLayout(this);
    miniRow.setGravity(Gravity.CENTER_VERTICAL);
    miniCover = GlassUi.art(this, 10);
    miniRow.addView(
        miniCover, new LinearLayout.LayoutParams(GlassUi.dp(this, 42), GlassUi.dp(this, 42)));
    LinearLayout miniInfo = MobileUi.column(this);
    miniInfo.setPadding(GlassUi.dp(this, 12), 0, 0, 0);
    nowPlaying = GlassUi.label(this, "", 13, true);
    nowPlaying.setSingleLine();
    nowPlaying.setEllipsize(android.text.TextUtils.TruncateAt.END);
    miniArtist = GlassUi.label(this, "", 12, false);
    miniArtist.setTextColor(GlassUi.MUTED);
    miniArtist.setSingleLine();
    miniInfo.addView(nowPlaying);
    miniInfo.addView(miniArtist);
    miniRow.addView(miniInfo, new LinearLayout.LayoutParams(0, -2, 1));
    GlassUi.touch(miniInfo, this::showStemControls);
    GlassUi.touch(miniCover, this::showStemControls);
    LinearLayout miniControls = new LinearLayout(this);
    playPause =
        button(
            miniControls,
            "▶",
            () -> {
              if (engine != null) engine.toggle();
            });
    playPause.setBackground(GlassUi.glass(this, 24));
    playPause.setTextSize(15);
    playPause.setLayoutParams(
        new LinearLayout.LayoutParams(GlassUi.dp(this, 44), GlassUi.dp(this, 44)));
    playPause.setContentDescription("播放或暂停");
    miniRow.addView(miniControls);
    playerBar.addView(miniRow);
    playerSeek = new SeekBar(this);
    playerSeek.setMax(1000);
    playerSeek.setVisibility(View.GONE);
    LinearLayout.LayoutParams miniParams = new LinearLayout.LayoutParams(-1, -2);
    miniParams.bottomMargin = GlassUi.dp(this, 12);
    dock.addView(playerBar, miniParams);
    playerBar.setVisibility(View.GONE);
    navigation = new RubberNavigation(this, index -> {
      switchMainTab(index);
    });
    leftHeader.bringToFront();
    header.bringToFront();
    setContentView(new WallpaperLayout(this, root));
    addContentView(
        floatingNavigation = new FloatingNavigation(this, navigation,
            () -> compactPlayer != null && compactPlayer.getVisibility() == View.VISIBLE),
        new android.view.ViewGroup.LayoutParams(-1, -1));
    DotoDesign.shapedGlass(navigation, body, floatingNavigation::glassOutline, true);
    bindService(new Intent(this, PlaybackService.class), connection, BIND_AUTO_CREATE);
    bound = true;
    if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
        != android.content.pm.PackageManager.PERMISSION_GRANTED)
      requestPermissions(new String[] {android.Manifest.permission.POST_NOTIFICATIONS}, 22);
    if(android.os.Build.VERSION.SDK_INT>=34){
      pageBackCallback=new android.window.OnBackAnimationCallback(){
        private boolean tracking;
        public void onBackStarted(android.window.BackEvent event){tracking="search".equals(browse)||"tracks".equals(browse)||"daily".equals(browse)||page==1||page==2||page==4;pageScroll.animate().cancel();}
        public void onBackProgressed(android.window.BackEvent event){if(!tracking)return;float progress=event.getProgress();float direction=event.getSwipeEdge()==android.window.BackEvent.EDGE_LEFT?1:-1;pageScroll.setPivotX(pageScroll.getWidth()/2f);pageScroll.setPivotY(pageScroll.getHeight()/2f);pageScroll.setScaleX(1-.07f*progress);pageScroll.setScaleY(1-.07f*progress);pageScroll.setTranslationX(direction*gd(36)*progress);pageScroll.setAlpha(1-.12f*progress);}
        public void onBackCancelled(){resetBackPreview(true);tracking=false;}
        public void onBackInvoked(){resetBackPreview(false);tracking=false;navigateBack();}
      };
    }else pageBackCallback=this::navigateBack;
    restorePage(saved);
    root.getViewTreeObserver().addOnPreDrawListener(()->{updateBackOwnership();return true;});
    updateBackOwnership();
    registerReceiver(appearanceReceiver,new android.content.IntentFilter("com.volo.mobile.APPEARANCE_CHANGED"),Context.RECEIVER_NOT_EXPORTED);
    if (((DotoApp) getApplication()).isFirstMainScreen() && saved == null) LiquidLaunch.show(this);
    timer.postDelayed(()->{if(!homeFirstShown){homeStartupReady=true;renderDiscovery();}},1800);
    task(
        "恢复账号…",
        () -> {
          try{
            api.cookie=sessions.load();
            if(!api.cookie.isEmpty()){JSONObject profile=api.profile();if(profile==null)throw new IOException("会话失效，请重新登录");applyProfile(profile);}
          }finally{ui(()->{accountRestoring=false;loadDiscovery();loadExtraDiscovery();loadPersonal();renderCuratedSongs();});}
          return "";
        });
    if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
        && getIntent().getBooleanExtra("playbackFlowTest", false))
      timer.postDelayed(
          () -> {
            try {
              File sample = new File(getFilesDir(), "flow-test.wav");
              try (InputStream in = getAssets().open("benchmark.wav");
                  OutputStream out = new FileOutputStream(sample)) {
                in.transferTo(out);
              }
              String uri = Uri.fromFile(sample).toString();
              JSONArray items =
                  new JSONArray()
                      .put(
                          new JSONObject()
                              .put("id", "flow-a")
                              .put("name", "测试队列 A")
                              .put("uri", uri))
                      .put(
                          new JSONObject()
                              .put("id", "flow-b")
                              .put("name", "测试队列 B")
                              .put("uri", uri));
              engine.startQueue(items, 0);
              timer.postDelayed(() -> engine.seek(8500), 2500);
            } catch (Exception e) {
              status.setText(e.toString());
            }
          },
          1500);
    if (getIntent().getBooleanExtra("playerStemTest", false))
      timer.postDelayed(
          () -> {
            try {
              File sample = new File(getCacheDir(), "player-test.wav");
              try (InputStream in = getAssets().open("benchmark.wav");
                  OutputStream out = new FileOutputStream(sample)) {
                in.transferTo(out);
              }
              play(Uri.fromFile(sample), "本地播放分轨测试");
              showStemControls();
              timer.postDelayed(this::prepareCurrentStems, 1500);
            } catch (Exception e) {
              status.setText(e.getMessage());
            }
          },
          1500);
    if (getIntent().getBooleanExtra("smoke", false)) timer.postDelayed(this::smoke, 1500);
    if (getIntent().getBooleanExtra("qrLogin", false)) timer.postDelayed(this::loginDialog, 1200);
    if (getIntent().getBooleanExtra("qrSmoke", false))
      timer.postDelayed(
          () ->
              task(
                  "二维码接口测试…",
                  () -> {
                    String key = qrApi.qrKey();
                    int code = qrApi.qrCheck(key).optInt("code");
                    android.util.Log.i(
                        "VoloQrTest", "keyPresent=" + (!key.isEmpty()) + ", status=" + code);
                    return "二维码接口状态：" + code;
                  }),
          1200);
  }

  private FrameLayout searchToolbar;
  private LinearLayout searchRow, playerBar;
  private View searchEntryContainer,searchExit,searchClear;
  private Runnable searchReturn;
  private android.animation.ValueAnimator searchExpansion;
  private RubberNavigation navigation;
  private FloatingNavigation floatingNavigation;
  private TextView nowPlaying;
  private Button playPause;
  private SeekBar playerSeek;
  private boolean seeking, prepared;
  private final Runnable playbackTick = () -> updatePlayback();

  private void updatePlayback() {
    if (engine == null || !engine.prepared) return;
    int duration = engine.duration(), position = engine.position();
    if (!seeking)
      playerSeek.setProgress(duration > 0 ? (int) ((long) position * 1000 / duration) : 0);
    if (spatial != null && spatial.isShowing())
      spatial.playback(position, duration, engine.playbackActive());
    timer.postDelayed(playbackTick, 500);
  }

  private JSONArray lastSongs;

  private TextView text(String value, int size) {
    return MobileUi.text(this, value, size);
  }

  private Button button(LinearLayout parent, String label, Runnable action) {
    return MobileUi.button(parent, label, action);
  }

  private void selectPage(int value) {
    if (page == 3 && value != 3 && profileVideo != null) profileVideo.setActive(false);
    cancelSearchRequest();
    personalRenderKey=null;
    songListPanel = null;
    listHeader(false);
    page = value;
    setDiscoveryMargins(false);
    if (value == 0) mainTab = 0;
    else if (value == 3 || value == 2 || value == 4) mainTab = 1;
    if(searchExpansion!=null)searchExpansion.cancel();
    searchClosing = false;
    content.animate().cancel();
    content.setAlpha(1f);
    searchRow.animate().cancel();
    searchExit.animate().cancel();
    if (searchRow.getParent() == searchToolbar) resetExpandedSearchWidth();
    search.setAlpha(1f);
    searchClear.setAlpha(1f);
    searchRow.setTranslationX(0f);
    searchRow.setTranslationY(0f);
    searchRow.setAlpha(1f);
    searchExit.setAlpha(1f);
    searchToolbar.setVisibility(View.GONE);
    searchEntryContainer.setVisibility(View.VISIBLE);
    homeToolbar.setVisibility(View.GONE);
    personalToolbar.setVisibility(View.GONE);
    updatePageViewport((FrameLayout) body.getParent());
    timer.removeCallbacks(refreshDownloads);
    pageTitle.setText(
        value == 0 ? "发现" : value == 3 || value == 4 ? "个人" : value == 2 ? "下载" : "音乐库");
    navigation.setSelectedIndex(mainTab);
    content.post(()->{if(!tabSliding&&!"home".equals(browse)&&!"personal".equals(browse)&&!"tracks".equals(browse))DotoDesign.enter(content);});
  }

  private boolean landscapeViewport;

  private void updatePageViewport(FrameLayout root) {
    int safeTop = 0;
    WindowInsets insets = root.getRootWindowInsets();
    if (searchToolbar.getVisibility() == View.VISIBLE && insets != null) {
      int cutoutTop = insets.getInsetsIgnoringVisibility(WindowInsets.Type.displayCutout()).top;
      safeTop = Math.max(0, cutoutTop - root.getPaddingTop());
    }
    View scrollContents = pageScroll.getChildAt(0);
    boolean landscape = root.getWidth() > root.getHeight();
    if (landscape != landscapeViewport) {
      landscapeViewport = landscape;
      if (songListPanel != null) songListPanel.refreshViewport();
      if (page == 3 && "personal".equals(browse)) {
        personalRenderKey = null;
        renderPersonal();
      }
      if ("home".equals(browse) && featuredHost != null && featuredVisible != null)
        renderFeaturedGrid(featuredHost, featuredVisible);
    }
    int available = root.getWidth() - root.getPaddingLeft() - root.getPaddingRight();
    boolean wide = root.getWidth() > root.getHeight() && available >= gd(640);
    int maximum = gd("home".equals(browse) || page == 3 ? 1000 : 720);
    int side = wide && page != 3 ? Math.max(0, (available - maximum) / 2) : 0;
    int bodyMargin = page == 3 ? -gd(DotoDesign.PAGE_GUTTER) : 0;
    int leading = page == 3 ? 0
        : Math.max(0, gd(searchToolbar.getVisibility() == View.VISIBLE ? 90 : 80) - safeTop);
    if (scrollContents.getPaddingTop() != leading || scrollContents.getPaddingLeft() != side)
      scrollContents.setPadding(side, leading, side, 0);
    FrameLayout.LayoutParams layout = (FrameLayout.LayoutParams) body.getLayoutParams();
    if (layout.topMargin != safeTop || layout.leftMargin != bodyMargin
        || layout.rightMargin != bodyMargin) {
      layout.topMargin = safeTop;
      layout.leftMargin = bodyMargin;
      layout.rightMargin = bodyMargin;
      body.setLayoutParams(layout);
    }

    int[] location = new int[2];
    root.getLocationOnScreen(location);
    int clearBottom = FloatingNavigation.navigationTop(this, getWindowManager().getCurrentWindowMetrics()) - gd(8);
    // Leave room to scroll the last row above the capsules, while the viewport
    // itself continues behind them all the way to the system inset.
    int bottom = gd(8) + Math.max(0, location[1] + root.getHeight() - root.getPaddingBottom() - clearBottom);
    int contentTop = page == 3 ? 0 : gd(8);
    if (content.getPaddingTop() != contentTop || content.getPaddingBottom() != bottom)
      content.setPadding(0, contentTop, 0, bottom);
  }

  private boolean tabSliding,tabRenderPending;
  private int tabSlideGeneration;
  private ImageView tabOutgoing;
  private android.graphics.Bitmap tabSnapshot;
  private ValueAnimator tabMotion;
  private View[] tabCaptureControls;

  private void restoreTabControls() {
    if (tabCaptureControls == null) return;
    for (View control : tabCaptureControls) control.setAlpha(1f);
    tabCaptureControls = null;
  }

  private void clearTabMotion() {
    restoreTabControls();
    if (tabMotion != null) {
      tabMotion.removeAllListeners();
      tabMotion.cancel();
      tabMotion = null;
    }
    if (tabOutgoing != null) {
      tabOverlayHost().getOverlay().remove(tabOutgoing);
      tabOutgoing.setImageDrawable(null);
      tabOutgoing = null;
    }
    if (tabSnapshot != null) {
      tabSnapshot.recycle();
      tabSnapshot = null;
    }
    content.setTranslationX(0f);
    content.setAlpha(1f);
  }
  private ViewGroup tabOverlayHost() {
    return (ViewGroup) pageScroll.getParent().getParent();
  }

  private void switchMainTab(int index){
    boolean targetHome=index==0;
    if((targetHome&&"home".equals(browse))||(!targetHome&&"personal".equals(browse)))return;
    int generation=++tabSlideGeneration;tabSliding=true;
    pageScroll.animate().cancel();pageScroll.setTranslationX(0);pageScroll.setAlpha(1);
    clearTabMotion();
    if (!ValueAnimator.areAnimatorsEnabled()) {
      tabSliding = false;
      if (targetHome) showHome(); else showAccount();
      return;
    }
    int[] screenLocation = new int[2];
    pageScroll.getLocationOnScreen(screenLocation);
    int dockTop = FloatingNavigation.navigationTop(this, getWindowManager().getCurrentWindowMetrics());
    int width=pageScroll.getWidth(),height=Math.min(pageScroll.getHeight(), dockTop-screenLocation[1]);
    if(width<=0||height<=0){tabSliding=false;if(targetHome)showHome();else showAccount();return;}

    int[] location=new int[2];pageScroll.getLocationInWindow(location);
    View overlayHost = tabOverlayHost();
    int[] hostLocation = new int[2];
    overlayHost.getLocationInWindow(hostLocation);
    int left = Math.max(hostLocation[0], location[0] - gd(20));
    int right = Math.min(hostLocation[0] + overlayHost.getWidth(), location[0] + width + gd(20));
    android.graphics.Rect bounds = new android.graphics.Rect(left, location[1], right, location[1]+height);
    android.graphics.Rect overlayBounds = new android.graphics.Rect(bounds);
    overlayBounds.offset(-hostLocation[0], -hostLocation[1]);
    if (bounds.width() <= 0 || !overlayHost.isHardwareAccelerated()) {
      finishTabSwitch(targetHome, generation, bounds.width(), overlayBounds, null);
      return;
    }

    // Capture the page and its background before changing tabs. The fixed controls
    // stay outside the snapshot so no transparent cutouts move with the page.
    tabCaptureControls = new View[] {searchEntryContainer, headerSettings, headerMore,
        homeToolbar, personalToolbar};
    for (View control : tabCaptureControls) control.setAlpha(0f);
    overlayHost.getViewTreeObserver().registerFrameCommitCallback(() -> {
      if (destroyed || generation != tabSlideGeneration || tabCaptureControls == null) return;
      android.graphics.Bitmap snapshot = android.graphics.Bitmap.createBitmap(
          bounds.width(), height, android.graphics.Bitmap.Config.ARGB_8888);
      try {
        android.view.PixelCopy.request(getWindow(), bounds, snapshot, result -> {
          if (destroyed || generation != tabSlideGeneration || tabCaptureControls == null) {
            snapshot.recycle();
            return;
          }
          restoreTabControls();
          if (result != android.view.PixelCopy.SUCCESS) {
            snapshot.recycle();
            finishTabSwitch(targetHome, generation, bounds.width(), overlayBounds, null);
          } else {
            finishTabSwitch(targetHome, generation, bounds.width(), overlayBounds, snapshot);
          }
        }, timer);
      } catch (IllegalArgumentException error) {
        snapshot.recycle();
        restoreTabControls();
        finishTabSwitch(targetHome, generation, bounds.width(), overlayBounds, null);
      }
    });
    overlayHost.invalidate();
    timer.postDelayed(() -> {
      if (destroyed || generation != tabSlideGeneration || tabCaptureControls == null) return;
      restoreTabControls();
      finishTabSwitch(targetHome, generation, bounds.width(), overlayBounds, null);
    }, 250);
  }

  private void finishTabSwitch(boolean targetHome, int generation, int width,
      android.graphics.Rect bounds, android.graphics.Bitmap snapshot) {
    if (snapshot != null) {
      tabSnapshot = snapshot;
      tabOutgoing = new ImageView(this);
      tabOutgoing.setImageBitmap(snapshot);
      tabOutgoing.setScaleType(ImageView.ScaleType.FIT_XY);
      tabOutgoing.layout(bounds.left, bounds.top, bounds.right, bounds.bottom);
      tabOverlayHost().getOverlay().add(tabOutgoing);
    }
    tabRenderPending = false;
    tabSliding = false;
    if (targetHome) showHome(); else showAccount();
    if (snapshot == null) return;

    tabSliding = true;
    int direction = targetHome ? 1 : -1;
    content.setTranslationX(-direction * width);
    beforePageDraw(() -> {
      if (generation != tabSlideGeneration || destroyed || tabOutgoing == null) return;
      ValueAnimator motion = ValueAnimator.ofFloat(0f, 1f);
      tabMotion = motion;
      motion.setDuration(300);
      motion.setInterpolator(UiMotion.CURVE);
      motion.addUpdateListener(animation -> {
        float progress = (float) animation.getAnimatedValue();
        content.setTranslationX(direction * width * (progress - 1f));
        tabOutgoing.setTranslationX(direction * width * progress);
      });
      motion.addListener(new AnimatorListenerAdapter() {
        @Override public void onAnimationEnd(Animator animation) {
          tabMotion = null;
          clearTabMotion();
          tabSliding = false;
          if (tabRenderPending) {
            tabRenderPending = false;
            if ("home".equals(browse)) renderDiscovery();
            else if ("personal".equals(browse)) renderPersonal();
          }
        }
      });
      motion.start();
    });
  }

  private android.window.OnBackInvokedCallback pageBackCallback;
  private boolean pageBackRegistered;
  private void updateBackOwnership(){
    if(pageBackCallback==null)return;
    boolean nested="search".equals(browse)||"tracks".equals(browse)||"daily".equals(browse)||page==1||page==2||page==4||(page==0&&!"home".equals(browse));
    if(nested==pageBackRegistered)return;
    if(nested)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0,pageBackCallback);
    else getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(pageBackCallback);
    pageBackRegistered=nested;
  }

  private void resetBackPreview(boolean animate){
    pageScroll.animate().cancel();
    if(animate)pageScroll.animate().scaleX(1).scaleY(1).translationX(0).alpha(1).setStartDelay(0).setDuration(180).setInterpolator(UiMotion.CURVE).start();
    else{pageScroll.setScaleX(1);pageScroll.setScaleY(1);pageScroll.setTranslationX(0);pageScroll.setAlpha(1);}
  }
  private void navigateBack(){
    if("search".equals(browse))exitSearch();
    else if("tracks".equals(browse)||"daily".equals(browse))listParent.run();
    else if(page==1||page==2||page==4)showAccount();
    else if(page==0&&!"home".equals(browse))showHome();
    else moveTaskToBack(true);
  }

  private void beforePageDraw(Runnable action){
    pageScroll.getViewTreeObserver().addOnPreDrawListener(new android.view.ViewTreeObserver.OnPreDrawListener(){
      public boolean onPreDraw(){if(pageScroll.getViewTreeObserver().isAlive())pageScroll.getViewTreeObserver().removeOnPreDrawListener(this);action.run();return true;}
    });pageScroll.requestLayout();
  }

  private void saveRootScroll() {
    if (pageScroll == null) return;
    if ("home".equals(browse)) discoverScroll = pageScroll.getScrollY();
    else if ("personal".equals(browse)) personalScroll = pageScroll.getScrollY();
  }

  private void showHome() {
    saveRootScroll();
    selectPage(0);
    browse = "home";
    showMainToolbar();
    renderDiscovery();
    final int restoreY=discoverScroll;beforePageDraw(() -> pageScroll.scrollTo(0,restoreY));
  }

  private void showMainToolbar() {
    search.setFocusable(false);
    search.setCursorVisible(false);
    search.setText("");
    search.setHint("搜索歌曲、歌手");
    for (int i = 0; i < homeBar.getChildCount(); i++) {
      View item = homeBar.getChildAt(i);
      item.animate().cancel();
      item.setAlpha(1f);
    }
    boolean personal = "personal".equals(browse);
    homeToolbar.setVisibility(personal ? View.GONE : View.VISIBLE);
    personalToolbar.setVisibility(personal ? View.VISIBLE : View.GONE);
    searchEntryContainer.setVisibility(View.GONE);
    headerSettings.setVisibility(View.GONE);
  }

  private JSONArray playlistSearchSource;
  private void showSearch() {
    if ("search".equals(browse)) {
      focusSearch();
      return;
    }
    openSearch();
  }

  private void openSearch() {
    if("tracks".equals(browse)){
      JSONArray source=displayedSongs;JSONObject metadata=listInfo;String title=listTitle;Runnable parent=listParent;
      playlistSearchSource=source;
      searchReturn=()->openSongs(title,source,parent,metadata);
    } else {
      playlistSearchSource = null;
      searchReturn = mainTab == 1 ? this::showAccount : this::showHome;
    }
    android.graphics.Rect origin = null;
    if (homeToolbar.getVisibility() == View.VISIBLE && ValueAnimator.areAnimatorsEnabled()) {
      int[] point = new int[2];
      homeSearch.getLocationInWindow(point);
      origin = new android.graphics.Rect(point[0], point[1],
          point[0] + homeSearch.getWidth(), point[1] + homeSearch.getHeight());
    }
    int originTab = mainTab;
    selectPage(0);
    mainTab = originTab;
    navigation.setSelectedIndex(mainTab);
    search.setText("");
    search.setHint(playlistSearchSource == null ? "搜索歌曲、歌手" : "搜索此歌单");
    browse = "search";
    listParent = this::exitSearch;
    applySearchChrome();
    if (playlistSearchSource == null) showSearchPrompt();
    else filterPlaylistSongs();
    pageScroll.scrollTo(0, 0);
    homeSearchOrigin = origin;
    if (origin != null) expandSearchFrom(origin);
    else focusSearch();
  }

  private void expandSearchFrom(android.graphics.Rect origin) {
    searchRow.setAlpha(0f);
    searchExit.setAlpha(0f);
    beforePageDraw(() -> {
      if (!"search".equals(browse) || searchClosing) return;
      android.graphics.Rect expanded = searchBounds();
      setSearchBounds(origin);
      searchRow.setAlpha(1f);
      animateSearchBounds(origin, expanded, false, () -> {
        resetExpandedSearchWidth();
        focusSearch();
      });
    });
  }

  private android.graphics.Rect searchBounds() {
    int[] location = new int[2];
    searchRow.getLocationInWindow(location);
    return new android.graphics.Rect(location[0], location[1],
        location[0] + searchRow.getWidth(), location[1] + searchRow.getHeight());
  }

  private void setSearchBounds(android.graphics.Rect bounds) {
    int[] parent = new int[2];
    searchToolbar.getLocationInWindow(parent);
    // Commit the size and position together. A LayoutParams update alone can leave
    // one frame at the previous width while the translation has already moved.
    int width = bounds.width();
    int height = gd(48);
    searchRow.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
    searchRow.layout(0, 0, width, height);
    searchRow.setTranslationX(bounds.left - parent[0]);
    searchRow.setTranslationY(bounds.top - parent[1]);
  }

  private void resetExpandedSearchWidth() {
    FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) searchRow.getLayoutParams();
    params.width = -1;
    searchRow.setLayoutParams(params);
    searchRow.setTranslationX(0f);
    searchRow.setTranslationY(0f);
  }

  private void animateSearchBounds(android.graphics.Rect from, android.graphics.Rect to,
      boolean closing, Runnable complete) {
    android.graphics.Rect bounds = new android.graphics.Rect();
    searchExpansion = android.animation.ValueAnimator.ofFloat(0f, 1f);
    searchExpansion.setDuration(android.animation.ValueAnimator.areAnimatorsEnabled() ? 280 : 0);
    searchExpansion.setInterpolator(UiMotion.CURVE);
    searchExpansion.addUpdateListener(animation -> {
      float fraction = (float) animation.getAnimatedValue();
      bounds.left = Math.round(from.left + (to.left - from.left) * fraction);
      bounds.top = Math.round(from.top + (to.top - from.top) * fraction);
      bounds.right = bounds.left + Math.round(from.width() + (to.width() - from.width()) * fraction);
      setSearchBounds(bounds);
      searchExit.setAlpha(closing ? 1f - fraction : fraction);
      if (closing) searchClear.setAlpha(Math.max(0f, 1f - 2f * fraction));
    });
    searchExpansion.addListener(new android.animation.AnimatorListenerAdapter() {
      private boolean cancelled;
      @Override public void onAnimationCancel(android.animation.Animator animation) { cancelled = true; }
      @Override public void onAnimationEnd(android.animation.Animator animation) {
        if (!cancelled) complete.run();
      }
    });
    searchExpansion.start();
  }

  private void focusSearch() {
    search.requestFocus();
    ((android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE))
        .showSoftInput(search, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
  }

  private void applySearchChrome(){
    search.setFocusableInTouchMode(true);
    search.setCursorVisible(true);
    homeToolbar.setVisibility(View.GONE);
    personalToolbar.setVisibility(View.GONE);
    searchEntryContainer.setVisibility(View.GONE);
    headerSettings.setVisibility(View.GONE);headerMore.setVisibility(View.GONE);
    searchToolbar.setVisibility(View.VISIBLE);
    updatePageViewport((FrameLayout) body.getParent());
  }
  private void exitSearch() {
    if (searchClosing) return;
    cancelSearchRequest();
    Runnable destination = searchReturn == null ? this::showHome : searchReturn;
    android.graphics.Rect origin = homeSearchOrigin;
    homeSearchOrigin = null;
    Runnable finish = () -> {
      if (!"search".equals(browse)) return;
      ((android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE))
          .hideSoftInputFromWindow(search.getWindowToken(), 0);
      search.clearFocus();
      playlistSearchSource = null;
      destination.run();
    };
    if (origin == null || !ValueAnimator.areAnimatorsEnabled()) {
      finish.run();
      return;
    }
    if (searchExpansion != null) searchExpansion.cancel();
    searchClosing = true;
    search.setCursorVisible(false);
    animateSearchBounds(searchBounds(), origin, true, finish);
  }

  private void libraryEntry(String title, String description, Runnable action) {
    LinearLayout row = new LinearLayout(this);
    row.setGravity(Gravity.CENTER_VERTICAL);
    row.setPadding(
        MobileUi.dp(this, 8), MobileUi.dp(this, 16), MobileUi.dp(this, 8), MobileUi.dp(this, 16));
    LinearLayout labels = MobileUi.column(this);
    labels.addView(MobileUi.heading(this, title, 18));
    TextView detail = text(description, 12);
    detail.setTextColor(MobileUi.MUTED);
    detail.setMaxLines(2);
    labels.addView(detail);
    row.addView(labels, new LinearLayout.LayoutParams(0, -2, 1));
    row.addView(text("›", 24));
    GlassUi.touch(row, action);
    content.addView(row);
    View line = new View(this);
    line.setBackgroundColor(MobileUi.LINE);
    content.addView(line, new LinearLayout.LayoutParams(-1, 1));
  }

  private void showLibrary() {
    showAccount();
  }

  private void showStemLibrary() {
    selectPage(1);
    browse = "stems";
    content.removeAllViews();
    pageTitle.setText("分轨结果");
    listParent=this::showAccount;
    headerBack.setVisibility(View.VISIBLE);
    for (var e : getSharedPreferences("stems", 0).getAll().entrySet()) {
      File folder = new File(e.getValue().toString());
      if (!new File(folder, "vocals.wav").isFile()) continue;
      String name = getSharedPreferences("stem-names", 0).getString(e.getKey(), "分轨音频");
      LinearLayout card = MobileUi.card(this);
      card.addView(text(name, 16));
      LinearLayout controls=new LinearLayout(this);
      button(controls, "人声", () -> play(Uri.fromFile(new File(folder, "vocals.wav")), name + " · 人声"));
      button(
          controls,
          "伴奏",
          () -> play(Uri.fromFile(new File(folder, "accompaniment.wav")), name + " · 伴奏"));
      card.addView(controls);
      content.addView(card);
    }
    if (content.getChildCount() == 0) content.addView(text("暂无分轨结果，在播放器中开启分轨。", 14));
  }

  private void showAccount() {
    saveRootScroll();
    selectPage(3);
    browse = "personal";
    showMainToolbar();
    renderPersonal();
    loadPersonal();
    loadSavedAlbums();
    final int restoreY=personalScroll;beforePageDraw(() -> pageScroll.scrollTo(0,restoreY));
  }

  private int gd(float value) {
    return GlassUi.dp(this, value);
  }

  static String coverUrl(JSONObject song) {
    if (song == null) return "";
    JSONObject album = song.optJSONObject("al");
    JSONObject legacy = song.optJSONObject("album");
    for (String candidate :
        new String[] {
          album == null ? "" : album.optString("picUrl"),
          legacy == null ? "" : legacy.optString("picUrl"),
          song.optString("picUrl"),
          song.optString("coverImgUrl")
        }) if (candidate.startsWith("http")) return candidate;
    return "";
  }

  private void gap(LinearLayout parent, int size) {
    View v = new View(this);
    parent.addView(v, new LinearLayout.LayoutParams(1, gd(size)));
  }

  private void section(String title, String action, Runnable click) {
    LinearLayout row = new LinearLayout(this);
    row.setGravity(Gravity.CENTER_VERTICAL);
    row.addView(GlassUi.label(this, title, 20, true), new LinearLayout.LayoutParams(0, gd(48), 1));
    if (!action.isEmpty()) {
      TextView button = GlassUi.label(this, action, 12, false);
      button.setTextColor(GlassUi.MUTED);
      button.setGravity(Gravity.CENTER);
      row.addView(button, new LinearLayout.LayoutParams(-2, gd(48)));
      GlassUi.touch(button, click);
    }
    content.addView(row);
  }

  private void empty(LinearLayout parent, String value, Runnable retry) {
    TextView label = GlassUi.label(this, value, 13, false);
    label.setTextColor(GlassUi.MUTED);
    label.setPadding(gd(14), gd(18), gd(14), gd(18));
    label.setMinHeight(gd(64));
    parent.addView(label);
    if (retry != null) GlassUi.touch(label, retry);
  }

  private void listHeader(boolean visible) {
    if (headerBack == null) return;
    headerBack.setVisibility(visible ? View.VISIBLE : View.GONE);
    JSONObject liked=likedPlaylist();boolean favorite=listInfo.optInt("specialType")==5||(liked!=null&&listInfo.optLong("id")>0&&liked.optLong("id")==listInfo.optLong("id")&&!listInfo.optBoolean("savedAlbum"));
    headerMore.setVisibility(visible&&!favorite&&!listInfo.optBoolean("heartMode")&&!listInfo.optBoolean("dailyRecommend") ? View.VISIBLE : View.GONE);
    headerSettings.setVisibility(visible ? View.GONE : View.VISIBLE);

    pageTitle.getLayoutParams().height = gd(64);
    pageTitle.requestLayout();
    if (visible) pageTitle.setText("");
  }

  private void openSongs(String title, JSONArray songs, Runnable parent) {
    openSongs(title, songs, parent, new JSONObject());
  }

  private boolean playlistEntrancePending;
  private void openSongs(String title, JSONArray songs, Runnable parent, JSONObject metadata) {
    playlistEntrancePending=true;
    saveRootScroll();
    listTitle = title;
    listInfo = metadata;
    listParent = parent;
    selectPage(1);
    browse = "tracks";
    showSongs(songs);
  }

  private void playFeed(JSONArray songs, int index) {
    if (engine == null) {
      status.setText("播放器连接中，请稍候");
      return;
    }
    engine.startQueue(songs, index);
  }

  private final ExecutorService playlistReader=Executors.newFixedThreadPool(2);
  private int playlistRequest;
  private void openPlaylist(JSONObject playlist, Runnable parent) {
    final int epoch=accountEpoch,request=++playlistRequest;
    final long id=playlist.optLong("id");
    final String key=Long.toString(id),cookie=api.cookie;
    final android.content.SharedPreferences cache=getSharedPreferences("playlist-cache-"+userId,0);
    JSONArray cached=null;try{String data=cache.getString(key,null);if(data!=null)cached=new JSONArray(data);}catch(Exception ignored){}
    final String previous=cached==null?null:cached.toString();
    if(isLikedList(playlist)){applyLikedCover(playlist);refreshLikedCover();}
    JSONObject metadata=playlist;
    if(cached==null)try{metadata=new JSONObject(playlist.toString()).put("loading",true);}catch(Exception ignored){}
    status.setText("");status.setVisibility(View.GONE);
    openSongs(playlist.optString("name"),cached==null?new JSONArray():cached,parent,metadata);
    if(cached!=null&&System.currentTimeMillis()-cache.getLong(key+"-time",0)<60000)return;
    playlistReader.submit(()->{
      try{
        NeteaseClient client=new NeteaseClient();client.cookie=cookie;
        JSONArray songs=client.tracks(id);String data=songs.toString();
        if(destroyed||epoch!=accountEpoch)return;
        cache.edit().putString(key,data).putLong(key+"-time",System.currentTimeMillis()).apply();
        ui(()->{
          if(epoch!=accountEpoch||request!=playlistRequest||!"tracks".equals(browse)||listInfo.optLong("id")!=id)return;
          listInfo=playlist;
          if(data.equals(previous))return;
          int y=pageScroll.getScrollY();showSongs(songs);beforePageDraw(()->pageScroll.scrollTo(0,y));
        });
      }catch(Exception error){
        ui(()->{if(epoch==accountEpoch&&request==playlistRequest&&"tracks".equals(browse)&&listInfo.optLong("id")==id){
          if(previous==null){content.removeAllViews();listHeader(true);empty(content,"歌单暂时无法打开，点击重试",()->openPlaylist(playlist,parent));}
          Toast.makeText(this,previous==null?"歌单加载失败":"暂时无法更新，已显示缓存",Toast.LENGTH_SHORT).show();
        }});
      }
    });
  }

  private boolean homeStartupReady,homeFirstShown;
  private void revealHome(){
    if(homeFirstShown||!"home".equals(browse))return;homeFirstShown=true;
    revealSections(content);
  }
  private void revealSections(ViewGroup group){
    if(!android.animation.ValueAnimator.areAnimatorsEnabled())return;
    for(int i=0;i<group.getChildCount();i++){
      View child=group.getChildAt(i);child.animate().cancel();child.setAlpha(0);child.setTranslationY(gd(32));
      child.animate().alpha(1).translationY(0).setStartDelay(60+Math.min(i,7)*55L).setDuration(580).setInterpolator(new android.view.animation.PathInterpolator(.2f,.8f,.2f,1)).withEndAction(()->child.animate().setStartDelay(0)).start();
    }
  }
  private void openDailySongs(){
    JSONObject info=new JSONObject();try{info.put("dailyRecommend",true);}catch(Exception ignored){}
    openSongs("每日推荐",dailySongs,this::showHome,info);
  }
  private FrameLayout heartCardHost;
  private void setDiscoveryMargins(boolean home) {
    // Android's stretch effect clips the carousel previews to the ScrollView bounds.
    pageScroll.setOverScrollMode(home ? View.OVER_SCROLL_NEVER : View.OVER_SCROLL_IF_CONTENT_SCROLLS);
    LinearLayout.LayoutParams params = (LinearLayout.LayoutParams) content.getLayoutParams();
    int margin = home ? -gd(4) : 0;
    if (params.leftMargin != margin || params.rightMargin != margin) {
      params.leftMargin = params.rightMargin = margin;
      content.setLayoutParams(params);
    }
  }

  private GlassUi.Surface recommendationCard(String title,String eyebrow,String description,JSONArray covers,Runnable open,Runnable play){
    GlassUi.Surface card=new GlassUi.Surface(this,23);card.solidGlass(23);
    GlassUi.DailyArtwork art = new GlassUi.DailyArtwork(this);
    card.addView(covers == null ? new RadioArtwork(this) : art, new FrameLayout.LayoutParams(-1, -1));
    LinearLayout caption = new LinearLayout(this);
    caption.setGravity(Gravity.BOTTOM);
    caption.setPadding(gd(12), 0, gd(4), gd(4));
    caption.setBackground(new android.graphics.drawable.GradientDrawable(
        android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM,
        new int[]{0, 0xb8000000}));
    card.addView(caption, new FrameLayout.LayoutParams(-1, gd(70), Gravity.BOTTOM));
    TextView heading = GlassUi.label(this, title, 18, true);
    heading.setTextColor(android.graphics.Color.WHITE);
    heading.setSingleLine();
    heading.setAutoSizeTextTypeUniformWithConfiguration(
        12, 18, 1, android.util.TypedValue.COMPLEX_UNIT_SP);
    heading.setGravity(Gravity.CENTER_VERTICAL);
    caption.addView(heading, new LinearLayout.LayoutParams(0, gd(44), 1));
    GlassUi.Symbol button = new GlassUi.Symbol(this, "play", "播放" + title, play);
    button.color = android.graphics.Color.WHITE;
    button.bare = true;
    caption.addView(button, new LinearLayout.LayoutParams(gd(44), gd(44)));
    for (int i = 0; covers != null && i < Math.min(3, covers.length()); i++) {
      final int index = i;
      images.load(coverUrl(covers.optJSONObject(i)), bitmap -> art.cover(index, bitmap));
    }
    GlassUi.touch(card, open);
    return card;
  }
  private static final class RadioArtwork extends View {
    private final android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);

    RadioArtwork(Context context) { super(context); }

    @Override protected void onDraw(android.graphics.Canvas canvas) {
      canvas.drawColor(0xff163e40);
      float unit = Math.min(getWidth(), getHeight());
      canvas.save();
      canvas.translate(getWidth() * .56f, getHeight() * .39f);
      canvas.rotate(-24);
      paint.setStyle(android.graphics.Paint.Style.STROKE);
      paint.setStrokeWidth(unit * .025f);
      for (int i = 1; i <= 3; i++) {
        float radius = unit * (.14f + .105f * i);
        paint.setColor(i == 2 ? 0xffa9e2c7 : 0xff4da893);
        canvas.drawOval(-radius, -radius * .64f, radius, radius * .64f, paint);
      }
      paint.setStyle(android.graphics.Paint.Style.FILL);
      paint.setColor(0xfff7edca);
      canvas.drawCircle(0, 0, unit * .061f, paint);
      canvas.restore();
    }
  }

  private void refreshHeartCard(){
    if(heartCardHost==null||!"home".equals(browse))return;restoreHeartCache();heartCardHost.removeAllViews();
    String detail=userId==0?"登录，发现更多喜欢的音乐":heartCache.length()>0?"从喜欢的旋律，遇见下一首":"为你准备心动推荐";
    heartCardHost.addView(recommendationCard("心动模式","为你延续喜欢",detail,heartCache,this::openHeartMode,()->{if(userId!=0&&heartCache.length()>0)playFeed(heartCache,0);else openHeartMode();}),new FrameLayout.LayoutParams(-1,-1));
  }

  private void renderDiscovery() {
    if(!homeStartupReady)return;
    if(homeLoading)return;
    if(tabSliding){tabRenderPending=true;return;}
    if (page != 0 || !"home".equals(browse)) return;
    setDiscoveryMargins(true);
    content.removeAllViews();
    String today=new java.text.SimpleDateFormat("M月d日",Locale.CHINA).format(new Date());
    Runnable dailyAction=()->{if(dailySongs.length()>0)openDailySongs();else if(userId==0)loginDialog();else loadDiscovery();};
    Runnable radioAction = () -> {
      if (userId == 0) loginDialog();
      else if (engine != null) engine.startPersonalRadio();
    };
    LinearLayout recommendationRow = new LinearLayout(this);
    int gutter = gd(16), spacing = gd(10);
    recommendationRow.setPadding(gutter, 0, gutter, 0);
    HorizontalScrollView recommendationShelf = new HorizontalScrollView(this) {
      @Override protected void onMeasure(int widthSpec, int heightSpec) {
        int width = View.MeasureSpec.getSize(widthSpec);
        boolean wide = getResources().getConfiguration().orientation
            == android.content.res.Configuration.ORIENTATION_LANDSCAPE;
        int cardWidth = wide ? Math.max(1, (width - 2 * gutter - 2 * spacing) / 3)
            : Math.max(1, Math.round(width * .365f));
        for (int i = 0; i < recommendationRow.getChildCount(); i++) {
          View child = recommendationRow.getChildAt(i);
          if (child.getLayoutParams().width != cardWidth) {
            child.getLayoutParams().width = cardWidth;
            child.forceLayout();
          }
        }
        recommendationRow.forceLayout();
        int height = wide ? Math.min(cardWidth, gd(150)) : cardWidth;
        super.onMeasure(widthSpec, View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
      }
    };
    recommendationShelf.setHorizontalScrollBarEnabled(false);
    recommendationShelf.setOverScrollMode(View.OVER_SCROLL_NEVER);
    recommendationShelf.addView(recommendationRow, new FrameLayout.LayoutParams(-2, -1));
    LinearLayout.LayoutParams shelfParams = new LinearLayout.LayoutParams(-1, -2);
    shelfParams.leftMargin = shelfParams.rightMargin = -gutter;
    content.addView(recommendationShelf, shelfParams);
    recommendationRow.addView(recommendationCard("每日推荐", today, "", dailySongs, dailyAction,
        () -> { if (dailySongs.length() > 0) playFeed(dailySongs, 0); else dailyAction.run(); }),
        new LinearLayout.LayoutParams(0, -1));
    heartCardHost = new FrameLayout(this);
    LinearLayout.LayoutParams heartLayout = new LinearLayout.LayoutParams(0, -1);
    heartLayout.leftMargin = spacing;
    recommendationRow.addView(heartCardHost, heartLayout);
    refreshHeartCard();
    LinearLayout.LayoutParams radioLayout = new LinearLayout.LayoutParams(0, -1);
    radioLayout.leftMargin = spacing;
    recommendationRow.addView(recommendationCard("私人漫游", "", "", null, radioAction, radioAction), radioLayout);
    gap(content,12);
    curatedSongsHost=MobileUi.column(this);content.addView(curatedSongsHost,new LinearLayout.LayoutParams(-1,-2));
    vipSongsHost=MobileUi.column(this);content.addView(vipSongsHost,new LinearLayout.LayoutParams(-1,-2));renderCuratedSongs();
    gap(content,10);
    section("精选歌单","换一批 ↻",this::nextFeaturedPlaylists);
    featuredHost=MobileUi.column(this);content.addView(featuredHost,new LinearLayout.LayoutParams(-1,-2));
    JSONArray featured=DiscoverySections.batch(suggestedLists,featuredOffset,6);if(featured.length()==0)featured=DiscoverySections.batch(suggestedLists,0,6);featuredVisible=featured;renderFeaturedGrid(featuredHost,featured);
    extraDiscoveryHost=MobileUi.column(this);content.addView(extraDiscoveryHost,new LinearLayout.LayoutParams(-1,-2));renderExtraDiscovery();
    revealHome();
  }

  private final Map<NowPlayingBars,String> homeSongIndicators=new HashMap<>();
  private void updateHomeSongIndicators(){
    String id=engine==null?"":engine.current().optString("id");boolean playing=engine!=null&&engine.playbackActive();
    for(var entry:homeSongIndicators.entrySet())entry.getKey().state(!id.isEmpty()&&id.equals(entry.getValue()),playing);
  }

  private void addSongRow(
      LinearLayout parent, JSONObject song, JSONArray queue, int index, boolean divider) {
    if (divider) {
      View line = new View(this);
      line.setBackgroundColor(DotoDesign.LINE);
      LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, 1);
      lp.leftMargin = gd(57);
      lp.rightMargin = gd(12);
      parent.addView(line, lp);
    }
    LinearLayout row = new LinearLayout(this);
    row.setGravity(Gravity.CENTER_VERTICAL);
    FrameLayout artFrame=new FrameLayout(this);GlassUi.rounded(artFrame,9);
    ImageView art=GlassUi.art(this,9);images.into(art,coverUrl(song));artFrame.addView(art,new FrameLayout.LayoutParams(-1,-1));
    NowPlayingBars indicator=new NowPlayingBars(this);artFrame.addView(indicator,new FrameLayout.LayoutParams(-1,-1));
    artFrame.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener(){
      public void onViewAttachedToWindow(View view){homeSongIndicators.put(indicator,song.optString("id"));updateHomeSongIndicators();}
      public void onViewDetachedFromWindow(View view){homeSongIndicators.remove(indicator);indicator.state(false,false);}
    });
    row.addView(artFrame,new LinearLayout.LayoutParams(gd(44),gd(44)));
    LinearLayout words = MobileUi.column(this);
    words.setPadding(gd(11), 0, 0, 0);
    TextView title = GlassUi.label(this, song.optString("name"), 14, true);
    title.setSingleLine();
    title.setEllipsize(android.text.TextUtils.TruncateAt.END);
    words.addView(title);
    TextView artist = GlassUi.label(this, artists(song), 12, false);
    artist.setTextColor(GlassUi.MUTED);
    artist.setSingleLine();
    artist.setEllipsize(android.text.TextUtils.TruncateAt.END);
    LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(-1, gd(21));
    ap.topMargin = gd(3);
    words.addView(artist, ap);
    row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
    Runnable play = () -> playFeed(queue, index);
    GlassUi.touch(artFrame,play);
    GlassUi.touch(art, play);
    GlassUi.touch(words, play);
    GlassUi.Symbol more=new GlassUi.Symbol(this,"moreVertical","歌曲操作",()->songActions(song,new JSONObject()));
    row.addView(more, new LinearLayout.LayoutParams(gd(48), gd(60)));
    parent.addView(row, new LinearLayout.LayoutParams(-1, gd(60)));
  }

  void songActions(JSONObject song,JSONObject source){
    android.app.Dialog sheet=new android.app.Dialog(this);
    LinearLayout panel=MobileUi.column(this);panel.setPadding(gd(24),gd(20),gd(24),gd(28));panel.setBackground(DotoDesign.cardSurface(this,28));
    LinearLayout heading=new LinearLayout(this);heading.setGravity(Gravity.CENTER_VERTICAL);
    ImageView art=GlassUi.art(this,12);images.into(art,coverUrl(song));heading.addView(art,new LinearLayout.LayoutParams(gd(56),gd(56)));
    TextView title=GlassUi.label(this,song.optString("name"),18,true);title.setPadding(gd(16),0,0,0);heading.addView(title,new LinearLayout.LayoutParams(0,-2,1));panel.addView(heading);
    JSONObject creator=source.optJSONObject("creator");JSONObject liked=likedPlaylist();boolean favorite=liked!=null&&liked.optLong("id")==source.optLong("id");
    boolean removable=userId!=0&&(favorite||(creator!=null&&creator.optLong("userId")==userId));
    String[] labels=removable?new String[]{"下一首播放","收藏","加入歌单","下载","移除"}:new String[]{"下一首播放","收藏","加入歌单","下载"};
    if(song.optLong("downloadId")>0){labels=java.util.Arrays.copyOf(labels,labels.length+1);labels[labels.length-1]="删除";}
    if(song.optBoolean("localLibrary")){labels=java.util.Arrays.copyOf(labels,labels.length+1);labels[labels.length-1]="从本地列表移除";}
    for(int n=0;n<labels.length;n++){final int action="从本地列表移除".equals(labels[n])?6:"删除".equals(labels[n])?5:n;TextView row=GlassUi.label(this,labels[n],16,false);row.setGravity(Gravity.CENTER_VERTICAL);panel.addView(row,new LinearLayout.LayoutParams(-1,gd(56)));GlassUi.touch(row,()->{sheet.dismiss();
      if(action==0){if(engine!=null)engine.enqueue(song,true);}
      else if(action==6){JSONArray kept=new JSONArray(),all=localSongs();for(int j=0;j<all.length();j++)if(!song.optString("uri").equals(all.optJSONObject(j).optString("uri")))kept.put(all.optJSONObject(j));getSharedPreferences("local-library",0).edit().putString("songs",kept.toString()).apply();showLocalMusic();}
      else if(action==5){long id=song.optLong("downloadId");downloads.remove(id);getSharedPreferences("downloads",0).edit().remove(Long.toString(id)).apply();getSharedPreferences("download-song-ids",0).edit().remove(Long.toString(id)).apply();getSharedPreferences("download-metadata",0).edit().remove(Long.toString(id)).apply();if(page==2)renderDownloads();}
      else if(action==3)resolve(song.optLong("id"),song.optString("name"),true);
      else if(userId==0)loginDialog();
      else if(action==1)chooseFavorite(song,true,null);
      else if(action==4&&favorite)chooseFavorite(song,false,true);
      else if(action==4)task("移除中…",()->{api.editPlaylist(source.optLong("id"),song.optLong("id"),true);getSharedPreferences("playlist-cache-"+userId,0).edit().clear().apply();ui(()->openPlaylist(source,this::showAccount));return "已移除";});
      else chooseSongPlaylist(song);
    });}
    DotoDesign.onPaper(panel);sheet.setContentView(panel);android.view.Window window=sheet.getWindow();window.setBackgroundDrawableResource(android.R.color.transparent);window.addFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND);window.setDimAmount(.4f);window.setGravity(Gravity.BOTTOM);sheet.show();window.setLayout(-1,-2);panel.setTranslationY(gd(100));panel.animate().translationY(0).setDuration(240).setInterpolator(new android.view.animation.DecelerateInterpolator()).start();
  }

  private LinearLayout featuredHost,extraDiscoveryHost;
  private JSONArray featuredVisible=new JSONArray(),discoverySections=new JSONArray();
  private int featuredOffset,featuredPageOffset;
  private boolean featuredRefreshing,extraDiscoveryLoading;
  private void renderFeaturedGrid(LinearLayout host,JSONArray items){
    renderPlaylistShelf(host, items);
  }
  private void renderPlaylistShelf(LinearLayout host,JSONArray items){
    host.removeAllViews();if(items.length()==0){empty(host,"暂无歌单，点击重试",this::nextFeaturedPlaylists);return;}
    HorizontalScrollView shelf=new HorizontalScrollView(this);shelf.setHorizontalScrollBarEnabled(false);shelf.setClipToPadding(false);LinearLayout cards=new LinearLayout(this);shelf.addView(cards);
    // Let covers scroll through the page gutters while keeping the resting inset.
    for (ViewGroup parent = host; parent != content && parent != null;
        parent = parent.getParent() instanceof ViewGroup group ? group : null) {
      parent.setClipChildren(false);
      parent.setClipToPadding(false);
    }
    int gutter = gd(16);
    cards.setPadding(gutter, 0, gutter, 0);
    LinearLayout.LayoutParams shelfParams = new LinearLayout.LayoutParams(-1, -2);
    shelfParams.leftMargin = -gutter;
    shelfParams.rightMargin = -gutter;
    host.addView(shelf, shelfParams);
    int width=Math.min(gd(184),Math.round(getWindowManager().getCurrentWindowMetrics().getBounds().width() * .365f));
    for(int i=0;i<items.length();i++){JSONObject item=items.optJSONObject(i);if(item==null)continue;LinearLayout card=MobileUi.column(this);ImageView cover=GlassUi.art(this,13);images.into(cover,item.optString("picUrl",item.optString("coverImgUrl")));card.addView(cover,new LinearLayout.LayoutParams(width,width));TextView name=GlassUi.label(this,item.optString("name"),12,true);name.setMaxLines(2);name.setEllipsize(android.text.TextUtils.TruncateAt.END);LinearLayout.LayoutParams text=new LinearLayout.LayoutParams(-1,gd(38));text.topMargin=gd(6);card.addView(name,text);LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(width,-2);lp.rightMargin=gd(10);cards.addView(card,lp);GlassUi.touch(card,()->openPlaylist(item,this::showHome));}
  }
  private void nextFeaturedPlaylists(){
    if(featuredRefreshing)return;
    if(featuredOffset+6<suggestedLists.length()){featuredOffset+=6;featuredVisible=DiscoverySections.batch(suggestedLists,featuredOffset,6);if(featuredHost!=null)renderFeaturedGrid(featuredHost,featuredVisible);return;}
    featuredRefreshing=true;final int epoch=accountEpoch;final String cookie=api.cookie;final JSONArray previous=featuredVisible;
    homeData.submit(()->{try{NeteaseClient client=new NeteaseClient();client.cookie=cookie;JSONArray fresh=DiscoverySections.excluding(client.playlistPage(featuredPageOffset),previous);
      ui(()->{if(epoch!=accountEpoch)return;featuredPageOffset+=30;if(fresh.length()==0){Toast.makeText(this,"暂时没有更多歌单",Toast.LENGTH_SHORT).show();return;}suggestedLists=fresh;featuredOffset=0;featuredVisible=DiscoverySections.batch(fresh,0,6);if("home".equals(browse)&&featuredHost!=null)renderFeaturedGrid(featuredHost,featuredVisible);});
    }catch(Exception error){ui(()->{if(epoch==accountEpoch)Toast.makeText(this,"换一批失败，已保留当前歌单",Toast.LENGTH_SHORT).show();});}finally{ui(()->{if(epoch==accountEpoch)featuredRefreshing=false;});}});
  }
  private void renderExtraDiscovery(){
    renderCuratedSongs();
    if(extraDiscoveryHost==null||!"home".equals(browse))return;extraDiscoveryHost.removeAllViews();
    for(int i=0;i<discoverySections.length();i++){JSONObject block=discoverySections.optJSONObject(i);if(block==null||DiscoverySections.radar(block)||pagedHomeSongs(block))continue;JSONArray items=block.optJSONArray("items");if(items==null||items.length()==0)continue;LinearLayout section=MobileUi.column(this);extraDiscoveryHost.addView(section);renderDiscoverySection(section,block);}
    TextView radarTitle=GlassUi.label(this,"雷达歌单",18,true);radarTitle.setPadding(0,gd(22),0,gd(12));extraDiscoveryHost.addView(radarTitle);
    LinearLayout radarGrid=MobileUi.column(this);extraDiscoveryHost.addView(radarGrid,new LinearLayout.LayoutParams(-1,-2));JSONArray radar=DiscoverySections.radarPlaylists(discoverySections);
    if(radar.length()>0)renderFeaturedGrid(radarGrid,radar);
    else empty(radarGrid,extraDiscoveryLoading?"正在加载雷达歌单…":"暂未返回雷达歌单，点击重试",this::loadExtraDiscovery);
  }
  private final Set<String> refreshingSections=new HashSet<>();
  private String discoverySectionKey(JSONObject block){return block.optString("code")+":"+block.optString("kind");}
  private LinearLayout curatedSongsHost,vipSongsHost;
  private boolean pagedHomeSongs(JSONObject block){return "HOMEPAGE_BLOCK_STYLE_RCMD".equals(block.optString("code"))||block.optString("code").contains("VIP_RCMD");}
  private void renderCuratedSongs(){
    if(!"home".equals(browse))return;
    renderHomeSongBlock(curatedSongsHost,false,"为你定制精选歌曲");
    renderHomeSongBlock(vipSongsHost,true,"每天免费听VIP歌曲");
  }
  private void renderHomeSongBlock(LinearLayout host,boolean vip,String fallbackTitle){
    if(host==null)return;
    for(int i=0;i<discoverySections.length();i++){JSONObject block=discoverySections.optJSONObject(i);if(block==null||!"songs".equals(block.optString("kind")))continue;boolean matches=vip?block.optString("code").contains("VIP_RCMD"):"HOMEPAGE_BLOCK_STYLE_RCMD".equals(block.optString("code"));if(matches){renderCuratedSongPages(host,block);return;}}
    host.removeAllViews();TextView title=GlassUi.label(this,fallbackTitle,18,true);title.setPadding(0,gd(12),0,gd(12));host.addView(title);empty(host,accountRestoring||extraDiscoveryLoading||!extraDiscoveryAttempted?"正在获取歌曲…":"歌曲暂不可用，点击重试",this::loadExtraDiscovery);
  }
  private void renderCuratedSongPages(LinearLayout host,JSONObject block){
    host.removeAllViews();JSONArray items=block.optJSONArray("items");if(items==null)return;
    LinearLayout heading=new LinearLayout(this);heading.setGravity(Gravity.CENTER_VERTICAL);TextView title=GlassUi.label(this,block.optString("title","为你定制精选歌曲"),18,true);title.setMaxLines(2);heading.addView(title,new LinearLayout.LayoutParams(0,gd(56),1));TextView refresh=GlassUi.label(this,refreshingSections.contains(discoverySectionKey(block))?"刷新中…":"刷新 ↻",13,false);refresh.setTextColor(DotoDesign.MUTED);refresh.setGravity(Gravity.CENTER);heading.addView(refresh,new LinearLayout.LayoutParams(gd(76),gd(48)));GlassUi.touch(refresh,()->refreshDiscoverySection(host,block,refresh));host.addView(heading);
    host.setClipChildren(false);host.setClipToPadding(false);
    LinearLayout pages=new LinearLayout(this);pages.setClipChildren(false);pages.setClipToPadding(false);
    HorizontalScrollView pager=new HorizontalScrollView(this){
      @Override protected void onMeasure(int widthSpec, int heightSpec) {
        int width = Math.max(1, MeasureSpec.getSize(widthSpec)-getPaddingLeft()-getPaddingRight());
        for (int i = 0; i < pages.getChildCount(); i++) {
          View child = pages.getChildAt(i);
          if (child.getLayoutParams().width != width) {
            child.getLayoutParams().width = width;
            child.forceLayout();
          }
        }
        pages.forceLayout();
        super.onMeasure(widthSpec,heightSpec);
      }
      private int startPage;
      private float downX,downY;
      private android.view.VelocityTracker velocity;
      private android.animation.ValueAnimator settle;
      private int nearestPage(){int best=0,distance=Integer.MAX_VALUE;for(int i=0;i<pages.getChildCount();i++){int delta=Math.abs(getScrollX()-pages.getChildAt(i).getLeft());if(delta<distance){distance=delta;best=i;}}return best;}
      private void settlePage(int index){
        if(pages.getChildCount()==0)return;index=Math.max(0,Math.min(index,pages.getChildCount()-1));int max=Math.max(0,pages.getWidth()-(getWidth()-getPaddingLeft()-getPaddingRight()));int target=Math.min(max,pages.getChildAt(index).getLeft());
        if(settle!=null)settle.cancel();settle=android.animation.ValueAnimator.ofInt(getScrollX(),target);settle.setDuration(android.animation.ValueAnimator.areAnimatorsEnabled()?240:0);settle.setInterpolator(new android.view.animation.PathInterpolator(.22f,.8f,.24f,1));settle.addUpdateListener(animation->scrollTo((int)animation.getAnimatedValue(),0));settle.start();
      }
      @Override public boolean dispatchTouchEvent(android.view.MotionEvent event){
        int action=event.getActionMasked();
        if(action==android.view.MotionEvent.ACTION_DOWN){if(settle!=null)settle.cancel();startPage=nearestPage();downX=event.getX();downY=event.getY();if(velocity!=null)velocity.recycle();velocity=android.view.VelocityTracker.obtain();}
        if(velocity!=null)velocity.addMovement(event);
        boolean result=super.dispatchTouchEvent(event);
        if(action==android.view.MotionEvent.ACTION_UP||action==android.view.MotionEvent.ACTION_CANCEL){
          float dx=event.getX()-downX,dy=event.getY()-downY,speed=0;if(velocity!=null){velocity.computeCurrentVelocity(1000);speed=velocity.getXVelocity();velocity.recycle();velocity=null;}
          int target=startPage;int slop=android.view.ViewConfiguration.get(getContext()).getScaledTouchSlop();
          if(action!=android.view.MotionEvent.ACTION_CANCEL&&Math.abs(dx)>slop&&Math.abs(dx)>Math.abs(dy)){
            int width=Math.max(1,getWidth()-getPaddingLeft()-getPaddingRight());boolean fast=Math.abs(speed)>android.view.ViewConfiguration.get(getContext()).getScaledMinimumFlingVelocity()*2;
            if(fast||Math.abs(dx)>width*.18f)target+=dx<0?1:-1;
          }
          settlePage(target);
        }return result;
      }
      @Override public boolean onTouchEvent(android.view.MotionEvent event){boolean result=super.onTouchEvent(event);if(event.getActionMasked()==android.view.MotionEvent.ACTION_MOVE&&pages.getChildCount()>0){int first=Math.max(0,startPage-1),last=Math.min(pages.getChildCount()-1,startPage+1);int min=pages.getChildAt(first).getLeft(),max=pages.getChildAt(last).getLeft();scrollTo(Math.max(min,Math.min(max,getScrollX())),0);}return result;}
      @Override public void fling(int velocity){/* Release is handled by one-page settling. */}
      @Override protected void onDetachedFromWindow(){if(settle!=null)settle.cancel();if(velocity!=null){velocity.recycle();velocity=null;}super.onDetachedFromWindow();}
    };
    // Full screen viewport; each swipe settles by at most one page.
    pager.setPadding(gd(16),0,gd(16),0);pager.setClipChildren(false);pager.setClipToPadding(false);pager.setOverScrollMode(View.OVER_SCROLL_NEVER);pager.setHorizontalScrollBarEnabled(false);pager.setFillViewport(true);pager.addView(pages);
    LinearLayout.LayoutParams pagerParams=new LinearLayout.LayoutParams(-1,gd(190));pagerParams.leftMargin=-gd(16);pagerParams.rightMargin=-gd(16);host.addView(pager,pagerParams);
    for(int start=0;start<items.length();start+=3){LinearLayout rows=MobileUi.column(this);rows.setPadding(0,gd(4),0,gd(4));for(int i=start;i<Math.min(start+3,items.length());i++)addSongRow(rows,items.optJSONObject(i),items,i,i>start);LinearLayout.LayoutParams pageParams=new LinearLayout.LayoutParams(-1,-1);if(start+3<items.length())pageParams.rightMargin=gd(12);pages.addView(rows,pageParams);}

  }
  private void renderDiscoverySection(LinearLayout host,JSONObject block){
    if(pagedHomeSongs(block)){renderCuratedSongPages(host,block);return;}

    host.removeAllViews();JSONArray items=block.optJSONArray("items");if(items==null)return;String title=block.optString("title");LinearLayout header=new LinearLayout(this);header.setGravity(Gravity.CENTER_VERTICAL);header.setPadding(0,gd(16),0,gd(6));host.addView(header);
    TextView heading=GlassUi.label(this,title,18,true);heading.setMaxLines(2);header.addView(heading,new LinearLayout.LayoutParams(0,gd(48),1));
    if("playlists".equals(block.optString("kind"))){
      LinearLayout shelf=MobileUi.column(this);host.addView(shelf);
      if("HOMEPAGE_BLOCK_PLAYLIST_RCMD".equals(block.optString("code"))){
        final int[] offset={0};renderFeaturedGrid(shelf,DiscoverySections.batch(items,0,6));
        if(items.length()>6){TextView next=GlassUi.label(this,"换一批 ↻",13,false);next.setTextColor(DotoDesign.MUTED);next.setGravity(Gravity.CENTER);header.addView(next,new LinearLayout.LayoutParams(gd(88),gd(48)));GlassUi.touch(next,()->{offset[0]=offset[0]+6<items.length()?offset[0]+6:0;renderFeaturedGrid(shelf,DiscoverySections.batch(items,offset[0],6));});}
      }else renderPlaylistShelf(shelf,items);
    }
    else{
      GlassUi.touch(heading,()->openSongs(title,items,this::showHome));
      if(block.optString("code").equals("HOMEPAGE_BLOCK_STYLE_RCMD")){TextView refresh=GlassUi.label(this,refreshingSections.contains(discoverySectionKey(block))?"刷新中…":"刷新 ↻",13,false);refresh.setTextColor(DotoDesign.MUTED);refresh.setGravity(Gravity.CENTER);header.addView(refresh,new LinearLayout.LayoutParams(gd(76),gd(48)));GlassUi.touch(refresh,()->refreshDiscoverySection(host,block,refresh));}
      LinearLayout rows=MobileUi.column(this);rows.setPadding(0,gd(4),0,gd(4));host.addView(rows);for(int j=0;j<Math.min(3,items.length());j++)addSongRow(rows,items.optJSONObject(j),items,j,j>0);
    }
  }
  private void refreshDiscoverySection(LinearLayout host,JSONObject previous,TextView button){
    final String key=discoverySectionKey(previous);if(!refreshingSections.add(key))return;button.setText("刷新中…");button.setEnabled(false);final int epoch=accountEpoch;final String cookie=api.cookie;
    homeData.submit(()->{try{NeteaseClient client=new NeteaseClient();client.cookie=cookie;JSONArray sections=client.discoverySections(true);JSONObject found=null;for(int i=0;i<sections.length();i++){JSONObject block=sections.optJSONObject(i);if(block!=null&&key.equals(discoverySectionKey(block))){found=block;break;}}if(found==null)throw new IOException("本次未返回歌曲推荐");final JSONObject fresh=found;
      ui(()->{if(epoch!=accountEpoch)return;JSONArray oldItems=previous.optJSONArray("items"),newItems=fresh.optJSONArray("items");boolean same=oldItems!=null&&newItems!=null&&oldItems.length()==newItems.length();for(int i=0;same&&i<oldItems.length();i++)same=oldItems.optJSONObject(i).optString("id").equals(newItems.optJSONObject(i).optString("id"));
        for(int i=0;i<discoverySections.length();i++){JSONObject block=discoverySections.optJSONObject(i);if(block!=null&&key.equals(discoverySectionKey(block)))try{discoverySections.put(i,fresh);}catch(Exception ignored){}}
        getSharedPreferences("discovery-"+userId,0).edit().putString("sections",discoverySections.toString()).apply();refreshingSections.remove(key);
        if(host.isAttachedToWindow()&&"home".equals(browse)&&!same)renderDiscoverySection(host,fresh);
        if(same)Toast.makeText(this,"暂时没有新的推荐歌曲",Toast.LENGTH_SHORT).show();
      });
    }catch(Exception error){ui(()->{if(epoch==accountEpoch)Toast.makeText(this,"刷新失败，已保留当前歌曲",Toast.LENGTH_SHORT).show();});}finally{ui(()->{if(epoch==accountEpoch){refreshingSections.remove(key);button.setEnabled(true);button.setText("刷新 ↻");}});}});
  }
  private void publishDiscoverySections(JSONArray fresh,int epoch,long owner){
    ui(()->{if(epoch!=accountEpoch)return;
      try{if(DiscoverySections.curatedCount(fresh)==0&&DiscoverySections.curatedCount(discoverySections)>0)DiscoverySections.mergeCurated(fresh,discoverySections);}catch(Exception ignored){}
      if(fresh.length()>0){discoverySections=fresh;getSharedPreferences("discovery-"+owner,0).edit().putString("sections",fresh.toString()).apply();}
      renderExtraDiscovery();
    });
  }
  private void loadExtraDiscovery(){
    if(extraDiscoveryLoading||accountRestoring)return;extraDiscoveryLoading=true;final int epoch=accountEpoch;final long owner=userId;final String cookie=api.cookie;renderCuratedSongs();
    homeData.submit(()->{try{
      NeteaseClient client=new NeteaseClient();client.cookie=cookie;JSONArray sections=null;
      // Publish the first usable batch before attempting a larger twelve-song batch.
      for(int attempt=0;attempt<2;attempt++){
        if(destroyed||epoch!=accountEpoch)return;
        try{JSONArray received=DiscoverySections.parse(client.homepage(attempt>0));sections=received;publishDiscoverySections(received,epoch,owner);if(DiscoverySections.curatedCount(received)>0)break;}
        catch(Exception error){if(attempt==1)throw error;android.util.Log.w("DotoDiscovery","Retrying initial homepage request",error);}
      }
      if(sections!=null&&DiscoverySections.curatedCount(sections)>0&&DiscoverySections.curatedCount(sections)<12){
        try{JSONArray expanded=DiscoverySections.mergeCurated(new JSONArray(sections.toString()),DiscoverySections.parse(client.homepage(true)));if(DiscoverySections.curatedCount(expanded)>DiscoverySections.curatedCount(sections))publishDiscoverySections(expanded,epoch,owner);}catch(Exception error){android.util.Log.w("DotoDiscovery","Kept first curated batch",error);}
      }
    }catch(Exception error){android.util.Log.w("DotoDiscovery","Homepage blocks unavailable; retained cache",error);}
    finally{ui(()->{if(epoch==accountEpoch){extraDiscoveryLoading=false;extraDiscoveryAttempted=true;renderExtraDiscovery();}});}});
  }
  private JSONArray heartCache=new JSONArray();
  private long heartOwner=-1,heartUpdatedAt;
  private int heartLoadingEpoch=-1,heartWaitingRequest=-1;
  private void restoreHeartCache(){
    if(heartOwner==userId)return;heartOwner=userId;heartCache=new JSONArray();heartUpdatedAt=0;heartWaitingRequest=-1;
    try{android.content.SharedPreferences cache=getSharedPreferences("heart-mode-"+userId,0);heartCache=new JSONArray(cache.getString("songs","[]"));heartUpdatedAt=cache.getLong("updated",0);}catch(Exception ignored){}
  }
  private void openHeartMode(){
    if(userId==0){loginDialog();return;}restoreHeartCache();
    JSONObject info=new JSONObject();try{info.put("heartMode",true).put("loading",heartCache.length()==0);}catch(Exception ignored){}
    openSongs("心动模式",heartCache,this::showHome,info);
    heartWaitingRequest=heartCache.length()==0?++playlistRequest:-1;
    prefetchHeartMode();
  }
  private void prefetchHeartMode(){
    if(userId==0||destroyed)return;restoreHeartCache();
    if(heartLoadingEpoch==accountEpoch)return;
    if(heartCache.length()>0&&System.currentTimeMillis()-heartUpdatedAt<30*60*1000)return;
    final int epoch=accountEpoch;final long owner=userId;final String cookie=api.cookie;
    final JSONObject knownLiked=likedPlaylist();final String knownSeed=favoriteIds.isEmpty()?"":favoriteIds.iterator().next();heartLoadingEpoch=epoch;
    playlistReader.submit(()->{
      try{
        NeteaseClient client=new NeteaseClient();client.cookie=cookie;JSONObject liked=knownLiked;
        if(liked==null){JSONArray lists;try{lists=new JSONArray(getSharedPreferences("personal-"+owner,0).getString("lists","[]"));}catch(Exception ignored){lists=new JSONArray();}
          for(int pass=0;pass<2&&liked==null;pass++){if(pass==1)lists=client.playlists(owner);for(int i=0;i<lists.length();i++){JSONObject candidate=lists.optJSONObject(i);if(candidate!=null&&candidate.optInt("specialType")==5){liked=candidate;break;}}}
        }
        if(liked==null)throw new IOException("未找到喜欢的音乐");long pid=liked.getLong("id"),seed=0;
        try{seed=Long.parseLong(knownSeed);}catch(Exception ignored){}
        if(seed<=0){try{JSONArray cached=new JSONArray(getSharedPreferences("playlist-cache-"+owner,0).getString(Long.toString(pid),"[]"));if(cached.length()>0)seed=cached.getJSONObject(0).optLong("id");}catch(Exception ignored){}}
        if(seed<=0){JSONObject detail=client.request("/api/v6/playlist/detail",NeteaseClient.json("id",pid,"n",1,"s",0),false).getJSONObject("playlist");JSONArray ids=detail.optJSONArray("trackIds");if(ids!=null&&ids.length()>0)seed=ids.getJSONObject(0).getLong("id");}
        if(seed<=0)throw new IOException("先收藏一些喜欢的歌曲");
        JSONArray songs=client.heartSongs(seed,pid);if(songs.length()==0)throw new IOException("暂时没有心动推荐");final long updated=System.currentTimeMillis();
        ui(()->{if(epoch!=accountEpoch)return;heartCache=songs;heartOwner=owner;heartUpdatedAt=updated;refreshHeartCard();getSharedPreferences("heart-mode-"+owner,0).edit().putString("songs",songs.toString()).putLong("updated",updated).apply();
          if(heartWaitingRequest==playlistRequest&&"tracks".equals(browse)&&listInfo.optBoolean("heartMode")){heartWaitingRequest=-1;try{listInfo.put("loading",false);}catch(Exception ignored){}showSongs(songs);}
          for(int i=0;i<Math.min(6,songs.length());i++)images.load(coverUrl(songs.optJSONObject(i)),bitmap->{});
        });
      }catch(Exception error){ui(()->{if(epoch!=accountEpoch)return;if(heartWaitingRequest==playlistRequest&&"tracks".equals(browse)&&listInfo.optBoolean("heartMode")){heartWaitingRequest=-1;try{listInfo.put("loading",false);}catch(Exception ignored){}showSongs(new JSONArray());empty(content,"心动推荐暂时无法加载，点击重试",()->{heartUpdatedAt=0;openHeartMode();});Toast.makeText(this,error.getMessage()==null?"心动推荐加载失败":error.getMessage(),Toast.LENGTH_SHORT).show();}});}
      finally{ui(()->{if(heartLoadingEpoch==epoch)heartLoadingEpoch=-1;});}
    });
  }

  private void loadDiscovery() {
    if (destroyed || homeLoading) return;
    homeLoading = true;
    try{if(discoverySections.length()==0)discoverySections=new JSONArray(getSharedPreferences("discovery-"+userId,0).getString("sections","[]"));}catch(Exception ignored){}
    loadExtraDiscovery();
    homeFailure = "";
    int epoch = accountEpoch;
    long owner = userId;
    String cookie = api.cookie;
    try {
      JSONObject cached =
          new JSONObject(getSharedPreferences("discovery-" + owner, 0).getString("data", "{}"));
      if (dailySongs.length() == 0 && cached.optJSONArray("daily") != null)
        dailySongs = cached.getJSONArray("daily");
      if (suggestedLists.length() == 0 && cached.optJSONArray("lists") != null)
        suggestedLists = cached.getJSONArray("lists");
    } catch (Exception ignored) {
    }
    homeStartupReady=true;
    java.util.concurrent.atomic.AtomicInteger pending =
        new java.util.concurrent.atomic.AtomicInteger(owner == 0 ? 1 : 2);
    for (int part = owner == 0 ? 2 : 0; part < 3; part++) {
      if(part==1)continue;
      final int kind = part;
      homeData.submit(
          () -> {
            try {
              NeteaseClient client = new NeteaseClient();
              client.cookie = cookie;
              JSONArray result =
                  kind == 0
                      ? client.dailySongs()
                      : client.recommendedPlaylists();
              ui(
                  () -> {
                    if (epoch != accountEpoch) return;
                    if (kind == 0) dailySongs = result;
                    else suggestedLists = result;
                    try {
                      JSONObject cache =
                          new JSONObject()
                              .put("daily", dailySongs)
                              .put("lists", suggestedLists);
                      getSharedPreferences("discovery-" + owner, 0)
                          .edit()
                          .putString("data", cache.toString())
                          .apply();
                    } catch (Exception ignored) {
                    }
                    renderDiscovery();
                  });
            } catch (Exception e) {
              ui(
                  () -> {
                    if (epoch == accountEpoch) homeFailure = "推荐暂时不可用";
                  });
            } finally {
              ui(
                  () -> {
                    if (epoch == accountEpoch && pending.decrementAndGet() == 0) {
                      homeLoading = false;
                      renderDiscovery();
                    }
                  });
            }
          });
    }
  }

  private static final class PersonalShortcut extends View {
    final int kind;final android.graphics.Paint pen=new android.graphics.Paint(3);final android.graphics.Path path=new android.graphics.Path();
    PersonalShortcut(Context context, int kind) {
      super(context);
      this.kind = kind;
      setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }
    protected void onDraw(android.graphics.Canvas canvas) {
      int save = canvas.save();
      canvas.translate(getWidth()/2f, getHeight()/2f);
      canvas.scale(getWidth()/30f, getHeight()/30f);
      pen.setColor(0xfffafafa);pen.setStyle(android.graphics.Paint.Style.STROKE);pen.setStrokeWidth(1.9f);pen.setStrokeCap(android.graphics.Paint.Cap.ROUND);pen.setStrokeJoin(android.graphics.Paint.Join.ROUND);
      pen.setStrokeWidth(2.2f);
      if(kind==0){
        path.reset();path.moveTo(-10,-7);path.cubicTo(-4,-13,6,-12,10,-5);path.cubicTo(15,4,8,12,0,12);path.cubicTo(-7,12,-12,7,-12,2);canvas.drawPath(path,pen);
        path.reset();path.moveTo(-12,-12);path.lineTo(-11,-6);path.lineTo(-5,-7);canvas.drawPath(path,pen);
        canvas.drawLine(0,-5,0,1,pen);canvas.drawLine(0,1,5,4,pen);
      }else if(kind==1){
        path.reset();path.moveTo(-12,-9);path.lineTo(-4,-9);path.lineTo(-1,-6);path.lineTo(12,-6);path.lineTo(12,11);path.lineTo(-12,11);path.close();canvas.drawPath(path,pen);
        canvas.drawLine(2,5,2,-2,pen);canvas.drawLine(2,-2,6,-1,pen);canvas.drawOval(-3,3,2,7,pen);
      }else{
        path.reset();path.moveTo(0,-12);path.lineTo(0,4);path.moveTo(-6,-1);path.lineTo(0,5);path.lineTo(6,-1);canvas.drawPath(path,pen);
        path.reset();path.moveTo(-12,5);path.lineTo(-12,10);path.quadTo(-12,13,-8,13);path.lineTo(8,13);path.quadTo(12,13,12,9);path.lineTo(12,5);canvas.drawPath(path,pen);
      }
      canvas.restoreToCount(save);
    }
  }

  private String personalRenderKey;
  private String personalCategory="全部";
  private JSONArray savedAlbums=new JSONArray();
  private boolean albumsLoading,albumsLoaded;
  private String albumsFailure="";
  private record ProfileStats(long following, long followers, int level) {}
  private ProfileStats profileStats;
  private int profileStatsEpoch = -1;
  private boolean profileStatsLoading;

  private void loadProfileStats() {
    if (userId == 0 || destroyed) return;
    int epoch = accountEpoch;
    if (profileStatsEpoch != epoch) {
      profileStatsEpoch = epoch;
      profileStats = null;
      profileStatsLoading = false;
    }
    if (profileStatsLoading || profileStats != null) return;
    profileStatsLoading = true;
    long owner = userId;
    String cookie = api.cookie;
    homeData.submit(() -> {
      ProfileStats stats = null;
      try {
        NeteaseClient client = new NeteaseClient();
        client.cookie = cookie;
        JSONObject detail = client.request("/api/v1/user/detail/" + owner, NeteaseClient.json(), true);
        JSONObject profile = detail.optJSONObject("profile");
        if (profile != null && profile.optLong("userId") == owner) {
          stats = new ProfileStats(profile.optLong("follows", -1),
              profile.optLong("followeds", -1), detail.optInt("level", -1));
        }
      } catch (Exception ignored) {
        // Profile lists remain usable while account statistics are unavailable.
      }
      ProfileStats result = stats;
      ui(() -> {
        if (epoch != accountEpoch || owner != userId) return;
        profileStatsLoading = false;
        profileStats = result;
        if (result != null && owner == profileStatsOwner && profileStatsHost != null) {
          profileStatsHost.removeAllViews();
          addProfileStats(profileStatsHost);
        }
      });
    });
  }

  private void addProfileStats(LinearLayout identity) {
    if (userId == 0 || profileStatsEpoch != accountEpoch || profileStats == null) return;
    LinearLayout row = new LinearLayout(this);
    row.setGravity(Gravity.CENTER);
    ProfileStats stats = profileStats;
    if (stats.following() >= 0) addProfileStat(row, stats.following() + " \u5173\u6ce8");
    if (stats.followers() >= 0) addProfileStat(row, stats.followers() + " \u7c89\u4e1d");
    if (stats.level() >= 0) addProfileStat(row, "Lv." + stats.level());
    if (row.getChildCount() > 0) identity.addView(row, new LinearLayout.LayoutParams(-1, -2));
  }

  private void addProfileStat(LinearLayout row, String value) {
    TextView stat = GlassUi.label(this, value, 13, true);
    stat.setTextColor(0xfffafafa);
    stat.setGravity(Gravity.CENTER);
    stat.setPadding(gd(8), gd(5), gd(8), gd(5));
    stat.setShadowLayer(gd(3), 0, gd(1), 0xb0000000);
    row.addView(stat);
  }

  private static final int PICK_PROFILE_IMAGE = 51;
  private static final int PICK_PROFILE_VIDEO = 52;
  private static final int PICK_PROFILE_AVATAR = 53;
  private ProfileVideoBackdrop profileVideo;
  private ImageView profileBackdrop;
  private View profileShade;
  private View profileCard;
  private String profileCardKey;
  private LinearLayout profileStatsHost;
  private long profileStatsOwner;

  private SharedPreferences profileAppearance() {
    return getSharedPreferences("profile-appearance", MODE_PRIVATE);
  }

  private View buildProfileCard() {
    FrameLayout card = new FrameLayout(this) {
      @Override protected void onMeasure(int widthSpec, int heightSpec) {
        int halfScreen = getWindowManager().getCurrentWindowMetrics().getBounds().height() / 2;
        super.onMeasure(widthSpec, MeasureSpec.makeMeasureSpec(halfScreen, MeasureSpec.EXACTLY));
      }
    };
    card.setClipChildren(true);
    SharedPreferences appearance = profileAppearance();
    String source = appearance.getString("uri", "");
    boolean transparent = source.isEmpty();
    profileBackdrop = null;
    profileShade = null;
    profileVideo = null;
    if (!transparent) {
      card.setBackgroundColor(0xff343840);
      profileBackdrop = new ImageView(this);
      profileBackdrop.setScaleType(ImageView.ScaleType.CENTER_CROP);
      card.addView(profileBackdrop, new FrameLayout.LayoutParams(-1, -1));
    }
    if (!source.isEmpty()) {
      Uri uri = Uri.parse(source);
      if (appearance.getBoolean("video", false)) {
        ImageView poster = new ImageView(this);
        poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
        poster.setVisibility(View.INVISIBLE);
        ProfileVideoBackdrop video = new ProfileVideoBackdrop(this, uri, poster);
        profileVideo = video;
        card.addView(video, new FrameLayout.LayoutParams(-1, -1));
        card.addView(poster, new FrameLayout.LayoutParams(-1, -1));
        video.setActive(foreground);
        homeData.submit(() -> {
          try (android.media.MediaMetadataRetriever retriever = new android.media.MediaMetadataRetriever()) {
            retriever.setDataSource(this, uri);
            android.graphics.Bitmap frame = retriever.getScaledFrameAtTime(
                0, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 720, 720);
            if (frame != null) ui(() -> video.setInitialPoster(frame));
          } catch (Exception ignored) {
            // Keep the fallback surface visible until the video produces a frame.
          }
        });
      } else {
        ImageView backdrop = profileBackdrop;
        ImageView custom = new ImageView(this);
        custom.setScaleType(ImageView.ScaleType.CENTER_CROP);
        card.addView(custom, new FrameLayout.LayoutParams(-1, -1));
        profileBackdrop = custom;
        loadProfileImage(uri, custom, () -> backdrop.setVisibility(View.GONE));
      }
    }
    if (!transparent) {
      profileShade = new View(this);
      card.addView(profileShade, new FrameLayout.LayoutParams(-1, -1));
      updateProfileEffects();
    }

    LinearLayout identity = MobileUi.column(this);
    identity.setGravity(Gravity.CENTER_HORIZONTAL);
    identity.setPadding(gd(22), gd(78), gd(22), gd(16));
    card.addView(identity, new FrameLayout.LayoutParams(-1, -1));

    if (account.getParent() instanceof ViewGroup old) old.removeView(account);
    ImageView portrait = GlassUi.art(this, 38);
    portrait.setImageResource(android.R.drawable.ic_menu_myplaces);
    portrait.setContentDescription("头像");
    portrait.setScaleType(ImageView.ScaleType.CENTER_CROP);
    applyProfileAvatar(portrait);
    identity.addView(portrait, new LinearLayout.LayoutParams(gd(76), gd(76)));
    account.setTextSize(22);
    account.setTextColor(0xffffffff);
    account.setMaxLines(2);
    account.setEllipsize(android.text.TextUtils.TruncateAt.END);
    account.setGravity(Gravity.CENTER);
    account.setShadowLayer(gd(4), 0, gd(1), 0xb0000000);
    LinearLayout.LayoutParams nickname = new LinearLayout.LayoutParams(-1, -2);
    nickname.topMargin = gd(20);
    identity.addView(account, nickname);
    View vipSpace = new Space(this);
    identity.addView(vipSpace, new LinearLayout.LayoutParams(-1, gd(32)));
    profileStatsOwner = userId;
    profileStatsHost = MobileUi.column(this);
    identity.addView(profileStatsHost, new LinearLayout.LayoutParams(-1, -2));
    addProfileStats(profileStatsHost);

    FrameLayout.LayoutParams shortcutParams = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
    int gutter = gd(DotoDesign.PAGE_GUTTER);
    shortcutParams.setMarginStart(gutter);
    shortcutParams.setMarginEnd(gutter);
    shortcutParams.bottomMargin = gd(18);
    if (getResources().getConfiguration().orientation
        != android.content.res.Configuration.ORIENTATION_LANDSCAPE) {
      card.addView(buildProfileShortcuts(), shortcutParams);
    }
    return card;
  }

  private void applyProfileAvatar(ImageView image) {
    images.into(image, avatarUrl);
    String local = profileAppearance().getString("avatar-" + userId, "");
    if (!local.isEmpty()) {
      loadProfileImage(Uri.parse(local), image, () -> image.setTag(null));
    }
  }

  private void loadProfileImage(Uri uri, ImageView image, Runnable loaded) {
    homeData.submit(() -> {
      try {
        android.graphics.Bitmap bitmap = android.graphics.ImageDecoder.decodeBitmap(
            android.graphics.ImageDecoder.createSource(getContentResolver(), uri),
            (decoder, info, source) -> {
              android.util.Size size = info.getSize();
              int sample = Math.max(1, Math.max(size.getWidth(), size.getHeight()) / 1400);
              decoder.setTargetSampleSize(sample);
            });
        ui(() -> {
          image.setImageBitmap(bitmap);
          loaded.run();
        });
      } catch (IOException | RuntimeException ignored) {
        // The background or portrait placeholder remains visible.
      }
    });
  }

  private void showProfileStyleMenu() {
    profilePopup("", new String[] {"头像", "卡片背景"},
        new Runnable[] {() -> profileStyleButton.post(this::showProfileAvatarMenu), this::showProfileAppearance})
        .showAsDropDown(profileStyleButton, 0, gd(4), Gravity.END);
  }

  private void showProfileAvatarMenu() {
    profilePopup("头像设置", new String[] {"选择头像图片", "恢复网易云头像"},
        new Runnable[] {
          () -> startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT)
              .addCategory(Intent.CATEGORY_OPENABLE).setType("image/*"), PICK_PROFILE_AVATAR),
          () -> setProfileAvatar(null)
        }).showAsDropDown(profileStyleButton, 0, gd(4), Gravity.END);
  }

  private void setProfileAvatar(Uri uri) {
    String key = "avatar-" + userId;
    SharedPreferences.Editor edit = profileAppearance().edit();
    if (uri == null) edit.remove(key);
    else edit.putString(key, uri.toString());
    edit.apply();
    personalRenderKey = null;
    renderPersonal();
  }

  private LinearLayout buildProfileShortcuts() {
    LinearLayout shortcuts = new LinearLayout(this);
    String[] labels = {"最近播放", "本地音乐", "已下载"};
    Runnable[] actions = {()->openSongs("最近播放",recentSongs(),this::showAccount), this::showLocalMusic, this::showDownloads};
    for (int i = 0; i < labels.length; i++) {
      LinearLayout card = new LinearLayout(this);
      card.setGravity(Gravity.CENTER);
      card.setBackground(DotoDesign.shape(this, 0x9920242a, 14));

      PersonalShortcut icon = new PersonalShortcut(this, i);
      card.addView(icon, new LinearLayout.LayoutParams(gd(18), gd(18)));
      TextView title = GlassUi.label(this, labels[i], 13, false);
      title.setTextSize(13);
      title.setTextColor(0xfffafafa);
      LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(-2, -2);
      titleParams.setMarginStart(gd(7));
      card.addView(title, titleParams);
      GlassUi.touch(card, actions[i]);
      LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, gd(44), 1);
      if (i > 0) lp.setMarginStart(gd(9));
      shortcuts.addView(card, lp);
    }
    return shortcuts;
  }

  private void updateProfileEffects() {
    if (profileBackdrop == null) return;
    SharedPreferences appearance = profileAppearance();
    int blur = appearance.getInt("blur", 24);
    ProfileVideoBackdrop.setBlur(profileBackdrop, blur);
    if (profileVideo != null) profileVideo.setVideoBlur(blur);
    int brightness = appearance.getInt("brightness", 68);
    int shade = Math.round(255 * (1 - brightness / 100f)) << 24;
    profileShade.setBackground(new android.graphics.drawable.GradientDrawable(
        android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM,
        new int[] {shade, shade, DotoDesign.BG}));
  }

  private void showProfileAppearance() {
    Dialog dialog = new Dialog(this);
    ScrollView scroll = new ScrollView(this);
    scroll.setVerticalScrollBarEnabled(false);
    scroll.setBackground(DotoDesign.cardSurface(this, 26));
    scroll.setClipToOutline(true);
    LinearLayout panel = MobileUi.column(this);
    panel.setPadding(gd(18), gd(12), gd(18), gd(18));
    scroll.addView(panel);

    LinearLayout heading = new LinearLayout(this);
    heading.setGravity(Gravity.CENTER_VERTICAL);
    TextView headingTitle = GlassUi.label(this, "卡片背景", 21, true);
    headingTitle.setTextColor(DotoDesign.CARD_INK);
    heading.addView(headingTitle, new LinearLayout.LayoutParams(0, -2, 1));
    GlassUi.Symbol close = new GlassUi.Symbol(this, "close", "关闭卡片背景", dialog::dismiss);
    heading.addView(close, new LinearLayout.LayoutParams(gd(44), gd(44)));
    panel.addView(heading);

    LinearLayout sources = new LinearLayout(this);
    LinearLayout.LayoutParams sourceParams = new LinearLayout.LayoutParams(-1, -2);
    sourceParams.topMargin = gd(14);
    panel.addView(sources, sourceParams);
    for (boolean video : new boolean[] {false, true}) {
      String label = video ? "选择视频" : "选择图片";
      LinearLayout source = new LinearLayout(this);
      source.setGravity(Gravity.CENTER);
      source.setBackground(DotoDesign.shape(this, DotoDesign.RAISED, 14));
      ImageView icon = new ImageView(this);
      icon.setImageDrawable(new DotoIcon(video ? "play" : "profile-landscape", DotoDesign.CARD_INK));
      source.addView(icon, new LinearLayout.LayoutParams(gd(17), gd(17)));
      TextView title = GlassUi.label(this, label, 13, true);
      title.setTextColor(DotoDesign.CARD_INK);
      LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(-2, -2);
      titleParams.setMarginStart(gd(8));
      source.addView(title, titleParams);
      source.setContentDescription(label);
      GlassUi.touch(source, () -> {
        dialog.dismiss();
        startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE).setType(video ? "video/*" : "image/*"),
            video ? PICK_PROFILE_VIDEO : PICK_PROFILE_IMAGE);
      });
      LinearLayout.LayoutParams actionParams = new LinearLayout.LayoutParams(0, gd(46), 1);
      if (video) actionParams.setMarginStart(gd(8));
      sources.addView(source, actionParams);
    }

    boolean transparent = profileAppearance().getString("uri", "").isEmpty();
    TextView clearBackground = GlassUi.label(this, "无背景", 13, true);
    clearBackground.setTextColor(DotoDesign.CARD_INK);
    clearBackground.setGravity(Gravity.CENTER);
    clearBackground.setSelected(transparent);
    android.graphics.drawable.GradientDrawable clearFrame =
        DotoDesign.shape(this, DotoDesign.RAISED, 14);
    if (transparent) clearFrame.setStroke(gd(2), DotoDesign.CARD_INK);
    clearBackground.setBackground(clearFrame);
    LinearLayout.LayoutParams clearParams = new LinearLayout.LayoutParams(-1, gd(44));
    clearParams.topMargin = gd(8);
    panel.addView(clearBackground, clearParams);
    GlassUi.touch(clearBackground, () -> {
      setProfileBackground(null, false);
      dialog.dismiss();
    });

    gap(panel, 18);
    addProfileSlider(panel, "模糊", "blur", 24);
    addProfileSlider(panel, "亮度", "brightness", 68);

    dialog.setContentView(scroll);
    Window window = dialog.getWindow();
    window.setBackgroundDrawableResource(android.R.color.transparent);
    window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
    window.setDimAmount(.35f);
    dialog.show();
    int width = getWindowManager().getCurrentWindowMetrics().getBounds().width();
    window.setLayout(Math.min(gd(420), width - gd(32)), -2);
  }

  private void addProfileSlider(LinearLayout panel, String title, String key, int initial) {
    SharedPreferences appearance = profileAppearance();
    int value = appearance.getInt(key, initial);
    LinearLayout labels = new LinearLayout(this);
    labels.setGravity(Gravity.CENTER_VERTICAL);
    TextView label = GlassUi.label(this, title, 14, true);
    label.setTextColor(DotoDesign.CARD_INK);
    labels.addView(label, new LinearLayout.LayoutParams(0, -2, 1));
    TextView percentage = GlassUi.label(this, value + "%", 13, false);
    percentage.setTextColor(DotoDesign.CARD_MUTED);
    labels.addView(percentage);
    panel.addView(labels);
    SeekBar slider = new SeekBar(this);
    android.content.res.ColorStateList accent =
        android.content.res.ColorStateList.valueOf(DotoDesign.CARD_INK);
    slider.setThumbTintList(accent);
    slider.setProgressTintList(accent);
    slider.setContentDescription(title);
    slider.setMax(100);
    slider.setEnabled(profileBackdrop != null);
    slider.setProgress(value);
    panel.addView(slider, new LinearLayout.LayoutParams(-1, gd(44)));
    slider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
      public void onStartTrackingTouch(SeekBar bar) {}
      public void onStopTrackingTouch(SeekBar bar) {}
      public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
        if (!fromUser) return;
        percentage.setText(progress + "%");
        appearance.edit().putInt(key, progress).apply();
        updateProfileEffects();
      }
    });
  }

  private void setProfileBackground(Uri uri, boolean video) {
    profileAppearance().edit().putString("uri", uri == null ? "" : uri.toString())
        .putBoolean("video", video).apply();
    personalRenderKey = null;
    renderPersonal();
  }

  private void renderPersonal() {
    if(tabSliding){tabRenderPending=true;return;}
    if (page != 3) return;
    likedPlaylist();
    String renderKey=personalCategory+":"+savedAlbums.toString()+":"+albumsLoading+":"+albumsFailure+":"+userId+":"+myLists.toString()+":"+recentSongs().toString()+":"+getSharedPreferences("downloads",0).getAll().size()+":"+DotoAppearance.revision(this)+":"+(myLists.length()==0&&personalLoading);
    if(renderKey.equals(personalRenderKey))return;
    personalRenderKey=renderKey;
    SharedPreferences appearance = profileAppearance();
    String cardKey = userId + ":" + avatarUrl + ":" + account.getText() + ":"
        + appearance.getString("avatar-" + userId, "") + ":" + appearance.getString("uri", "")
        + ":" + appearance.getBoolean("video", false)
        + ":" + landscapeViewport + ":"
        + DotoAppearance.revision(this);
    if (profileCard == null || !cardKey.equals(profileCardKey)) {
      content.removeAllViews();
      profileCard = buildProfileCard();
      profileCardKey = cardKey;
    }
    if (profileCard.getParent() == content) {
      int collectionViews = content.getChildCount() - 1;
      if (collectionViews > 0) content.removeViews(1, collectionViews);
    } else {
      content.removeAllViews();
      content.addView(profileCard, new LinearLayout.LayoutParams(-1, -2));
    }
    if (profileVideo != null) profileVideo.setActive(foreground);
    LinearLayout collection = MobileUi.column(this);
    LinearLayout.LayoutParams collectionParams = new LinearLayout.LayoutParams(-1, -2);
    int gutter = gd(DotoDesign.PAGE_GUTTER);
    collectionParams.setMarginStart(gutter);
    collectionParams.setMarginEnd(gutter);
    collectionParams.topMargin = gd(8);
    content.addView(collection, collectionParams);
    if (getResources().getConfiguration().orientation
        == android.content.res.Configuration.ORIENTATION_LANDSCAPE) {
      collection.addView(buildProfileShortcuts());
    }
    LinearLayout categories=new LinearLayout(this);
    for(String category:new String[]{"全部","创建","收藏","专辑"}){TextView tab=GlassUi.label(this,category,15,category.equals(personalCategory));tab.setGravity(Gravity.CENTER);tab.setTextColor(category.equals(personalCategory)?DotoDesign.INK:DotoDesign.MUTED);GlassUi.touch(tab,()->{personalCategory=category;personalRenderKey=null;renderPersonal();if(category.equals("专辑")||category.equals("全部"))loadSavedAlbums();});categories.addView(tab,new LinearLayout.LayoutParams(0,gd(48),1));}
    collection.addView(categories);
    if (userId == 0) {
      empty(collection, "登录网易云，查看你的歌曲和歌单", this::loginDialog);
      return;
    }
    if(personalCategory.equals("专辑")){
      if(savedAlbums.length()==0)empty(collection,albumsLoading?"正在加载专辑…":albumsFailure.isEmpty()?"暂无收藏专辑":albumsFailure,()->{albumsLoaded=false;loadSavedAlbums();});
      for(int i=0;i<savedAlbums.length();i++){JSONObject album=savedAlbums.optJSONObject(i);personalMediaRow(collection,album,true);}
      return;
    }
    if(personalCategory.equals("创建")){TextView create=GlassUi.label(this,"＋ 创建歌单",15,true);create.setPadding(0,gd(16),0,gd(16));GlassUi.touch(create,()->playlistNameDialog(null));collection.addView(create);}
    JSONObject liked=likedPlaylist();
    if((personalCategory.equals("全部")||personalCategory.equals("创建"))&&liked!=null)personalMediaRow(collection,liked,false);
    int shown=0;
    for(int i=0;i<myLists.length();i++){
      JSONObject item=myLists.optJSONObject(i);if(item==liked)continue;
      JSONObject creator=item.optJSONObject("creator");boolean own=creator!=null&&creator.optLong("userId")==userId;
      if(personalCategory.equals("创建")&&!own||personalCategory.equals("收藏")&&own)continue;
      personalMediaRow(collection,item,false);shown++;
    }
    if(personalCategory.equals("全部")){
      for(int i=0;i<savedAlbums.length();i++){personalMediaRow(collection,savedAlbums.optJSONObject(i),true);shown++;}
      if(albumsLoading){TextView loading=GlassUi.label(this,"正在加载专辑…",13,false);loading.setTextColor(DotoDesign.MUTED);collection.addView(loading);}
      else if(!albumsFailure.isEmpty())empty(collection,albumsFailure,()->{albumsLoaded=false;loadSavedAlbums();});
    }
    if(shown==0&&!albumsLoading&&!((personalCategory.equals("全部")||personalCategory.equals("创建"))&&liked!=null))empty(collection,personalLoading?"正在同步歌单…":"暂无歌单，点击刷新",this::loadPersonal);
  }
  private ImageView likedPersonalCover;
  private long likedPersonalCoverOwner=-1;
  private void personalMediaRow(LinearLayout collection,JSONObject item,boolean album){
    LinearLayout row=new LinearLayout(this);row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(0,gd(8),0,gd(8));
    ImageView cover;
    if(!album&&isLikedList(item)){
      if(likedPersonalCover==null||likedPersonalCoverOwner!=userId){likedPersonalCover=GlassUi.art(this,8);likedPersonalCoverOwner=userId;}
      cover=likedPersonalCover;if(cover.getParent() instanceof ViewGroup parent)parent.removeView(cover);
    }else cover=GlassUi.art(this,8);
    images.into(cover,item.optString(album?"picUrl":"coverImgUrl"));row.addView(cover,new LinearLayout.LayoutParams(gd(58),gd(58)));
    LinearLayout words=MobileUi.column(this);words.setPadding(gd(14),0,0,0);
    TextView name=GlassUi.label(this,item.optString("name"),15,true);name.setSingleLine();name.setEllipsize(android.text.TextUtils.TruncateAt.END);words.addView(name);
    String detail=item.optInt(album?"size":"trackCount")+" 首";JSONArray artists=item.optJSONArray("artists");if(album&&artists!=null&&artists.length()>0)detail+=" · "+artists.optJSONObject(0).optString("name");
    TextView subtitle=GlassUi.label(this,detail,12,false);subtitle.setTextColor(DotoDesign.MUTED);words.addView(subtitle);row.addView(words,new LinearLayout.LayoutParams(0,-2,1));
    if(album)row.addView(new GlassUi.Symbol(this,"moreVertical","专辑操作",()->albumActions(item)),new LinearLayout.LayoutParams(gd(48),gd(48)));
    JSONObject favoriteList=likedPlaylist();
    if(!album&&(favoriteList==null||favoriteList.optLong("id")!=item.optLong("id")))row.addView(new GlassUi.Symbol(this,"moreVertical","歌单操作",()->playlistActions(item)),new LinearLayout.LayoutParams(gd(48),gd(48)));
    GlassUi.touch(row,()->{if(album)openSavedAlbum(item);else openPlaylist(item,this::showAccount);});collection.addView(row,new LinearLayout.LayoutParams(-1,gd(78)));
  }
  private void chooseSongPlaylist(JSONObject song){
    if(song.optLong("id")<=0){Toast.makeText(this,"本地歌曲无法加入云端歌单",Toast.LENGTH_SHORT).show();return;}
    final int epoch=accountEpoch;final String cookie=api.cookie;
    task("加载歌单…",()->{NeteaseClient client=new NeteaseClient();client.cookie=cookie;JSONArray lists=client.playlists(userId);java.util.ArrayList<String> names=new java.util.ArrayList<>();java.util.ArrayList<Runnable> actions=new java.util.ArrayList<>();
      names.add("＋ 创建新歌单");actions.add(()->playlistNameDialog(null,id->addSongToPersonalPlaylist(song,id,epoch,cookie)));
      for(int i=0;i<lists.length();i++){JSONObject list=lists.optJSONObject(i);if(ownPlaylist(list)){long id=list.optLong("id");names.add(list.optString("name"));actions.add(()->{if(list.optInt("specialType")==5)chooseFavorite(song,true,null);else addSongToPersonalPlaylist(song,id,epoch,cookie);});}}
      ui(()->{if(epoch==accountEpoch)accountDrawer("加入歌单",names.toArray(new String[0]),actions.toArray(new Runnable[0]));});return "";
    });
  }
  void chooseSongsPlaylist(JSONArray songs){
    if(songs.length()==0||songs.optJSONObject(0).optLong("id")<=0){Toast.makeText(this,"本地歌曲无法加入云端歌单",Toast.LENGTH_SHORT).show();return;}
    final int epoch=accountEpoch;final String cookie=api.cookie;
    task("加载歌单…",()->{NeteaseClient client=new NeteaseClient();client.cookie=cookie;JSONArray lists=client.playlists(userId);java.util.ArrayList<String> names=new java.util.ArrayList<>();java.util.ArrayList<Runnable> actions=new java.util.ArrayList<>();
      names.add("＋ 创建新歌单");actions.add(()->playlistNameDialog(null,id->addSongsToPersonalPlaylist(songs,id,epoch,cookie)));
      for(int i=0;i<lists.length();i++){JSONObject list=lists.optJSONObject(i);if(ownPlaylist(list)){long id=list.optLong("id");names.add(list.optString("name"));actions.add(()->{if(list.optInt("specialType")==5)chooseFavorites(songs,true,null);else addSongsToPersonalPlaylist(songs,id,epoch,cookie);});}}
      ui(()->{if(epoch==accountEpoch)accountDrawer("加入歌单",names.toArray(new String[0]),actions.toArray(new Runnable[0]));});return "";
    });
  }
  private void addSongToPersonalPlaylist(JSONObject song,long id,int epoch,String cookie){
    if(epoch!=accountEpoch)return;
    network.submit(()->{try{NeteaseClient client=new NeteaseClient();client.cookie=cookie;client.editPlaylist(id,song.optLong("id"),false);ui(()->{if(epoch!=accountEpoch)return;getSharedPreferences("playlist-cache-"+userId,0).edit().remove(Long.toString(id)).remove(id+"-time").apply();loadPersonal();Toast.makeText(this,"已加入歌单",Toast.LENGTH_SHORT).show();});}
      catch(Exception error){ui(()->{if(epoch==accountEpoch)Toast.makeText(this,"加入歌单失败，请重试",Toast.LENGTH_SHORT).show();});}});
  }
  private void addSongsToPersonalPlaylist(JSONArray songs,long id,int epoch,String cookie){
    network.submit(()->{int added=0;try{NeteaseClient client=new NeteaseClient();client.cookie=cookie;for(int i=0;i<songs.length();i++){if(epoch!=accountEpoch)return;client.editPlaylist(id,songs.getJSONObject(i).getLong("id"),false);added++;}}catch(Exception error){android.util.Log.w("DotoBatch","Batch add interrupted",error);}final int count=added;ui(()->{if(epoch!=accountEpoch)return;getSharedPreferences("playlist-cache-"+userId,0).edit().remove(Long.toString(id)).remove(id+"-time").apply();loadPersonal();Toast.makeText(this,"已加入 "+count+" / "+songs.length()+" 首",Toast.LENGTH_LONG).show();});});
  }
  void deleteSelectedSongs(JSONArray songs,JSONObject source){
    JSONObject liked=likedPlaylist();boolean favorite=source.optInt("specialType")==5||(liked!=null&&liked.optLong("id")==source.optLong("id"));
    if(source.optBoolean("savedAlbum")||source.optLong("id")<=0||(!favorite&&!ownPlaylist(source))){Toast.makeText(this,"仅可从自己的歌单中删除歌曲",Toast.LENGTH_SHORT).show();return;}
    new DotoDesign.DialogBuilder(this).setTitle("删除选中的 "+songs.length()+" 首歌曲？").setNegativeButton("取消",null).setPositiveButton("删除",(dialog,which)->{
      if(favorite){chooseFavorites(songs,false,true);return;}
      final int epoch=accountEpoch;final String cookie=api.cookie;
      network.submit(()->{int removed=0;try{NeteaseClient client=new NeteaseClient();client.cookie=cookie;for(int i=0;i<songs.length();i++){if(epoch!=accountEpoch)return;long id=songs.getJSONObject(i).getLong("id");if(favorite)client.setLike(id,false);else client.editPlaylist(source.optLong("id"),id,true);removed++;}}catch(Exception error){android.util.Log.w("DotoBatch","Batch delete interrupted",error);}final int count=removed;ui(()->{if(epoch!=accountEpoch)return;getSharedPreferences("playlist-cache-"+userId,0).edit().remove(source.optString("id")).remove(source.optString("id")+"-time").apply();if(favorite){likedSongsChanged(null,false);loadFavorites();}loadPersonal();if("tracks".equals(browse)&&listInfo.optLong("id")==source.optLong("id"))openPlaylist(source,listParent);Toast.makeText(this,"已删除 "+count+" / "+songs.length()+" 首",Toast.LENGTH_LONG).show();});});
    }).show();
  }
  private boolean ownPlaylist(JSONObject item){
    if(userId==0)return false;JSONObject creator=item.optJSONObject("creator");if(creator!=null)return creator.optLong("userId")==userId;
    for(int i=0;i<myLists.length();i++){JSONObject known=myLists.optJSONObject(i);if(known!=null&&known.optLong("id")==item.optLong("id")){JSONObject owner=known.optJSONObject("creator");return owner!=null&&owner.optLong("userId")==userId;}}return false;
  }
  private final Map<Long,Boolean> playlistSubscriptions=new HashMap<>();
  private final Set<Long> playlistSubscriptionPending=new HashSet<>();
  boolean showPlaylistFavorite(JSONObject item){JSONObject liked=likedPlaylist();return item.optLong("id")>0&&!item.optBoolean("savedAlbum")&&item.optInt("specialType")!=5&&(liked==null||liked.optLong("id")!=item.optLong("id"))&&!ownPlaylist(item);}
  boolean isPlaylistCollected(JSONObject item){long id=item.optLong("id");if(playlistSubscriptions.containsKey(id))return playlistSubscriptions.get(id);for(int i=0;i<myLists.length();i++)if(myLists.optJSONObject(i).optLong("id")==id)return true;return item.optBoolean("subscribed",false);}
  void togglePlaylistFavorite(JSONObject item){
    if(userId==0){loginDialog();return;}if(!showPlaylistFavorite(item))return;final long id=item.optLong("id");if(!playlistSubscriptionPending.add(id))return;final boolean collect=!isPlaylistCollected(item);final int epoch=accountEpoch;final String cookie=api.cookie;
    network.submit(()->{try{NeteaseClient client=new NeteaseClient();client.cookie=cookie;client.request(collect?"/api/playlist/subscribe":"/api/playlist/unsubscribe",NeteaseClient.json("id",id),false);
      ui(()->{if(epoch!=accountEpoch)return;playlistSubscriptions.put(id,collect);try{item.put("subscribed",collect);if(listInfo.optLong("id")==id)listInfo.put("subscribed",collect);}catch(Exception ignored){}
        if(songListPanel!=null)songListPanel.updatePlaylistFavorite(id,collect);
        if(!collect){JSONArray kept=new JSONArray();for(int i=0;i<myLists.length();i++)if(myLists.optJSONObject(i).optLong("id")!=id)kept.put(myLists.optJSONObject(i));myLists=kept;}else{boolean exists=false;for(int i=0;i<myLists.length();i++)if(myLists.optJSONObject(i).optLong("id")==id)exists=true;if(!exists)myLists.put(item);}
        getSharedPreferences("personal-"+userId,0).edit().putString("lists",myLists.toString()).apply();personalRenderKey=null;loadPersonal();Toast.makeText(this,collect?"已收藏歌单":"已取消收藏",Toast.LENGTH_SHORT).show();});
    }catch(Exception error){ui(()->{if(epoch==accountEpoch)Toast.makeText(this,"操作失败，请重试",Toast.LENGTH_SHORT).show();});}finally{ui(()->{if(epoch==accountEpoch)playlistSubscriptionPending.remove(id);});}});
  }
  private void playlistNameDialog(JSONObject item){playlistNameDialog(item,null);}
  private void playlistNameDialog(JSONObject item,java.util.function.LongConsumer afterCreate){
    EditText input=new EditText(this);input.setSingleLine();input.setHint("20字以内的歌单名称");if(item!=null){input.setText(item.optString("name"));input.setSelection(input.length());}DotoDesign.input(input);
    input.setFilters(new android.text.InputFilter[]{(source,start,end,dest,dstart,dend)->{String next=dest.subSequence(0,dstart).toString()+source.subSequence(start,end)+dest.subSequence(dend,dest.length());return next.codePointCount(0,next.length())>20?"":null;}});
    Dialog dialog=new Dialog(this);
    LinearLayout panel=MobileUi.column(this);panel.setPadding(gd(24),gd(20),gd(24),gd(24));panel.setBackground(DotoDesign.cardSurface(this,24));
    LinearLayout heading=new LinearLayout(this);heading.setGravity(Gravity.CENTER_VERTICAL);
    TextView title=GlassUi.label(this,item==null?"创建歌单":"编辑歌单名称",20,true);title.setTextColor(DotoDesign.INK);heading.addView(title,new LinearLayout.LayoutParams(0,gd(48),1));
    GlassUi.Symbol close=new GlassUi.Symbol(this,"close","关闭",dialog::dismiss);close.color=DotoDesign.CARD_INK;heading.addView(close,new LinearLayout.LayoutParams(gd(48),gd(48)));panel.addView(heading);
    input.setTextColor(DotoDesign.CARD_INK);input.setHintTextColor(DotoDesign.CARD_MUTED);panel.addView(input,new LinearLayout.LayoutParams(-1,gd(56)));
    Button complete=new Button(this);DotoDesign.button(complete,"完成",false);complete.setTextColor(DotoDesign.CARD_INK);complete.setBackground(DotoDesign.shape(this,DotoAppearance.light?0xffccccca:0xff3a3a3d,24));LinearLayout.LayoutParams doneParams=new LinearLayout.LayoutParams(-1,gd(48));doneParams.topMargin=gd(20);panel.addView(complete,doneParams);
    dialog.setContentView(panel);android.view.Window window=dialog.getWindow();window.setBackgroundDrawableResource(android.R.color.transparent);window.addFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND);window.setDimAmount(.4f);window.setGravity(Gravity.BOTTOM);window.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE|android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
    panel.setOnApplyWindowInsetsListener((view,insets)->{android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars());panel.setPadding(gd(24),gd(20),gd(24),gd(24)+bars.bottom);return insets;});
    dialog.show();window.setLayout(-1,-2);input.requestFocus();input.post(()->((android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).showSoftInput(input,android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT));

    complete.setOnClickListener(v->{String name=input.getText().toString().trim();if(name.isEmpty()||name.codePointCount(0,name.length())>20){input.setError("请输入1至20字的名称");return;}complete.setEnabled(false);final int epoch=accountEpoch;final String cookie=api.cookie;
      network.submit(()->{try{NeteaseClient client=new NeteaseClient();client.cookie=cookie;long createdId=0;if(item==null){JSONObject created=client.request("/api/playlist/create",NeteaseClient.json("name",name,"privacy","0","type","NORMAL"),true);createdId=created.getJSONObject("playlist").getLong("id");}else client.request("/api/playlist/update/name",NeteaseClient.json("id",item.optLong("id"),"name",name),false);
        final long newId=createdId;
        ui(()->{if(epoch!=accountEpoch){dialog.dismiss();return;}dialog.dismiss();loadPersonal();if(afterCreate!=null&&newId>0)afterCreate.accept(newId);else Toast.makeText(this,item==null?"歌单已创建":"歌单名称已更新",Toast.LENGTH_SHORT).show();});
      }catch(Exception error){ui(()->{complete.setEnabled(true);input.setError("操作失败，请重试");});}});
    });
  }
  private void albumActions(JSONObject album){
    Dialog sheet=new Dialog(this);LinearLayout panel=MobileUi.column(this);panel.setPadding(gd(20),gd(18),gd(20),gd(24));panel.setBackground(DotoDesign.cardSurface(this,24));
    TextView title=GlassUi.label(this,album.optString("name"),18,true);title.setTextColor(DotoDesign.INK);title.setMaxLines(2);panel.addView(title);
    for(String label:new String[]{"下载全部音乐","取消收藏"}){TextView action=GlassUi.label(this,label,16,false);action.setTextColor(DotoDesign.CARD_INK);action.setPadding(0,gd(18),0,gd(18));panel.addView(action);GlassUi.touch(action,()->{sheet.dismiss();if(label.startsWith("下载"))downloadAlbum(album);else new DotoDesign.DialogBuilder(this).setTitle("取消收藏专辑？").setMessage(album.optString("name")).setNegativeButton("取消",null).setPositiveButton("取消收藏",(d,w)->removeSavedAlbum(album)).show();});}
    sheet.setContentView(panel);android.view.Window window=sheet.getWindow();window.setBackgroundDrawableResource(android.R.color.transparent);window.addFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND);window.setDimAmount(.4f);window.setGravity(Gravity.BOTTOM);sheet.show();window.setLayout(-1,-2);
  }
  private void removeSavedAlbum(JSONObject album){
    final int epoch=accountEpoch;final String cookie=api.cookie;
    network.submit(()->{try{NeteaseClient client=new NeteaseClient();client.cookie=cookie;client.request("/api/album/unsub",NeteaseClient.json("id",album.optLong("id")),true);
      ui(()->{if(epoch!=accountEpoch)return;JSONArray remaining=new JSONArray();for(int i=0;i<savedAlbums.length();i++)if(savedAlbums.optJSONObject(i).optLong("id")!=album.optLong("id"))remaining.put(savedAlbums.optJSONObject(i));savedAlbums=remaining;personalRenderKey=null;renderPersonal();Toast.makeText(this,"已取消收藏",Toast.LENGTH_SHORT).show();});
    }catch(Exception error){ui(()->Toast.makeText(this,"取消收藏失败，请重试",Toast.LENGTH_SHORT).show());}});
  }
  private void downloadAlbum(JSONObject album){
    final int epoch=accountEpoch;final String cookie=api.cookie;Toast.makeText(this,"正在准备专辑全部音乐",Toast.LENGTH_SHORT).show();
    playlistReader.submit(()->{try{NeteaseClient client=new NeteaseClient();client.cookie=cookie;JSONArray songs=client.request("/api/v1/album/"+album.optLong("id"),NeteaseClient.json(),true).getJSONArray("songs");
      ui(()->{if(epoch!=accountEpoch)return;int[] indices=new int[songs.length()];for(int i=0;i<indices.length;i++)indices[i]=i;downloadSelection(songs,indices);});
    }catch(Exception error){ui(()->Toast.makeText(this,"专辑加载失败，请重试",Toast.LENGTH_SHORT).show());}});
  }
  private void playlistActions(JSONObject item){
    boolean own=ownPlaylist(item);Dialog sheet=new Dialog(this);LinearLayout panel=MobileUi.column(this);panel.setPadding(gd(20),gd(18),gd(20),gd(24));panel.setBackground(DotoDesign.cardSurface(this,24));
    TextView title=GlassUi.label(this,item.optString("name"),18,true);title.setTextColor(DotoDesign.INK);title.setMaxLines(2);panel.addView(title);
    String[] labels=own?new String[]{"下载歌单","编辑歌单名称","删除歌单"}:isPlaylistCollected(item)?new String[]{"下载歌单","取消收藏"}:new String[]{"下载歌单","收藏歌单"};
    for(String label:labels){TextView action=GlassUi.label(this,label,16,false);action.setTextColor(DotoDesign.CARD_INK);action.setPadding(0,gd(18),0,gd(18));panel.addView(action);GlassUi.touch(action,()->{sheet.dismiss();if(label.startsWith("下载"))downloadPlaylist(item);else if(label.startsWith("编辑"))playlistNameDialog(item);else if(label.equals("收藏歌单")||label.equals("取消收藏"))togglePlaylistFavorite(item);else new DotoDesign.DialogBuilder(this).setTitle(own?"删除歌单？":"从收藏中移除歌单？").setMessage(item.optString("name")).setNegativeButton("取消",null).setPositiveButton("删除",(d,w)->removePersonalPlaylist(item,own)).show();});}
    sheet.setContentView(panel);android.view.Window window=sheet.getWindow();window.setBackgroundDrawableResource(android.R.color.transparent);window.addFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND);window.setDimAmount(.4f);window.setGravity(Gravity.BOTTOM);sheet.show();window.setLayout(-1,-2);
  }
  private void removePersonalPlaylist(JSONObject item,boolean own){
    final int epoch=accountEpoch;final String cookie=api.cookie;
    network.submit(()->{try{NeteaseClient client=new NeteaseClient();client.cookie=cookie;client.request(own?"/api/playlist/remove":"/api/playlist/unsubscribe",own?NeteaseClient.json("ids","["+item.optLong("id")+"]"):NeteaseClient.json("id",item.optLong("id")),own);
      ui(()->{if(epoch!=accountEpoch)return;JSONArray remaining=new JSONArray();for(int i=0;i<myLists.length();i++)if(myLists.optJSONObject(i).optLong("id")!=item.optLong("id"))remaining.put(myLists.optJSONObject(i));myLists=remaining;personalRenderKey=null;renderPersonal();loadPersonal();Toast.makeText(this,"已删除",Toast.LENGTH_SHORT).show();});
    }catch(Exception error){ui(()->Toast.makeText(this,"删除失败，请重试",Toast.LENGTH_SHORT).show());}});
  }
  private void downloadPlaylist(JSONObject item){
    final int epoch=accountEpoch;final String cookie=api.cookie;Toast.makeText(this,"正在准备歌单全部音乐",Toast.LENGTH_SHORT).show();
    playlistReader.submit(()->{try{NeteaseClient client=new NeteaseClient();client.cookie=cookie;JSONObject detail=client.request("/api/v6/playlist/detail",NeteaseClient.json("id",item.optLong("id"),"n",1000,"s",0),false).getJSONObject("playlist");JSONArray ids=detail.getJSONArray("trackIds"),songs=new JSONArray();
      for(int start=0;start<ids.length();start+=500){JSONArray batch=new JSONArray();for(int i=start;i<Math.min(start+500,ids.length());i++)batch.put(NeteaseClient.json("id",ids.getJSONObject(i).getLong("id")));JSONArray result=client.request("/api/v3/song/detail",NeteaseClient.json("c",batch.toString()),true).getJSONArray("songs");for(int i=0;i<result.length();i++)songs.put(result.get(i));}
      ui(()->{if(epoch!=accountEpoch)return;int[] indices=new int[songs.length()];for(int i=0;i<indices.length;i++)indices[i]=i;downloadSelection(songs,indices);});
    }catch(Exception error){ui(()->Toast.makeText(this,"歌单加载失败，请重试",Toast.LENGTH_SHORT).show());}});
  }
  private void loadSavedAlbums(){
    if(userId==0||albumsLoading||albumsLoaded)return;albumsLoading=true;albumsFailure="";personalRenderKey=null;renderPersonal();final int epoch=accountEpoch;final String cookie=api.cookie;
    homeData.submit(()->{try{NeteaseClient client=new NeteaseClient();client.cookie=cookie;JSONArray all=new JSONArray();int offset=0;while(true){JSONObject result=client.request("/api/album/sublist",NeteaseClient.json("limit",100,"offset",offset,"total",true),true);JSONArray batch=result.optJSONArray("data");if(batch==null)throw new IOException("Missing albums");for(int i=0;i<batch.length();i++)all.put(batch.get(i));if(!result.optBoolean("hasMore",false)||batch.length()==0)break;offset+=batch.length();}ui(()->{if(epoch!=accountEpoch)return;savedAlbums=all;albumsLoaded=true;});}catch(Exception e){ui(()->{if(epoch==accountEpoch)albumsFailure="专辑加载失败，点击重试";});}finally{ui(()->{if(epoch==accountEpoch){albumsLoading=false;personalRenderKey=null;renderPersonal();}});}});
  }
  private void openSavedAlbum(JSONObject album){
    final int epoch=accountEpoch,request=++playlistRequest;final String cookie=api.cookie;
    playlistReader.submit(()->{try{NeteaseClient client=new NeteaseClient();client.cookie=cookie;JSONObject result=client.request("/api/v1/album/"+album.optLong("id"),NeteaseClient.json(),true);JSONArray songs=result.getJSONArray("songs");JSONObject info=new JSONObject(album.toString());info.put("coverImgUrl",album.optString("picUrl"));info.put("savedAlbum",true);ui(()->{if(epoch==accountEpoch&&request==playlistRequest)openSongs(album.optString("name"),songs,this::showAccount,info);});}catch(Exception e){ui(()->{if(epoch==accountEpoch)Toast.makeText(this,"专辑加载失败，请重试",Toast.LENGTH_SHORT).show();});}});
  }

  private int likedCoverRequest;
  private android.content.SharedPreferences likedCoverPrefs(){return getSharedPreferences("liked-cover-"+userId,0);}
  private boolean isLikedList(JSONObject item){JSONObject liked=likedPlaylist();return item!=null&&(item.optInt("specialType")==5||(liked!=null&&item.optLong("id")==liked.optLong("id")));}
  private void applyLikedCover(JSONObject item){String url=likedCoverPrefs().getString("url","");if(!url.isEmpty())try{item.put("coverImgUrl",url);}catch(Exception ignored){}}
  private void updateLikedCover(long songId,String url,boolean local){
    if(url.isEmpty())return;
    boolean changed=!url.equals(likedCoverPrefs().getString("url",""));
    likedCoverPrefs().edit().putLong("song",songId).putString("url",url).putLong("local-time",local?System.currentTimeMillis():0).apply();
    JSONObject liked=likedPlaylist();if(liked!=null)applyLikedCover(liked);
    if(!changed)return;
    if(likedPersonalCover!=null&&likedPersonalCoverOwner==userId)images.into(likedPersonalCover,url);
    // Update only artwork; keep the visible row and its existing bitmap in place.
    if(isLikedList(listInfo)){applyLikedCover(listInfo);if(songListPanel!=null)songListPanel.updateCover(url);}
  }
  private void likedSongsChanged(JSONObject song,boolean added){
    ++likedCoverRequest;favoriteRevision++;favoritesOwner=-1;
    if(added&&song!=null&&!coverUrl(song).isEmpty()){updateLikedCover(song.optLong("id"),coverUrl(song),true);}
    else likedCoverPrefs().edit().putLong("local-time",0).apply();
    JSONObject liked=likedPlaylist();if(liked!=null)getSharedPreferences("playlist-cache-"+userId,0).edit().remove(liked.optString("id")).remove(liked.optString("id")+"-time").apply();
    refreshLikedCover();
  }
  private void refreshLikedCover(){
    JSONObject liked=likedPlaylist();if(userId==0||liked==null)return;final long pid=liked.optLong("id"),owner=userId;final int epoch=accountEpoch,request=++likedCoverRequest;final String cookie=api.cookie;
    playlistReader.submit(()->{try{NeteaseClient client=new NeteaseClient();client.cookie=cookie;JSONObject detail=client.request("/api/v6/playlist/detail",NeteaseClient.json("id",pid,"n",1,"s",0),false).getJSONObject("playlist");JSONArray tracks=detail.optJSONArray("tracks");JSONObject first=tracks!=null&&tracks.length()>0?tracks.optJSONObject(0):null;
      if(first==null)return;long id=first.optLong("id");String art=coverUrl(first);if(art.isEmpty()){JSONArray data=client.request("/api/v3/song/detail",NeteaseClient.json("c",new JSONArray().put(NeteaseClient.json("id",id)).toString()),true).getJSONArray("songs");if(data.length()>0)art=coverUrl(data.getJSONObject(0));}final String url=art;
      ui(()->{if(epoch!=accountEpoch||owner!=userId||request!=likedCoverRequest)return;long localTime=likedCoverPrefs().getLong("local-time",0),expected=likedCoverPrefs().getLong("song",0);if(localTime>0&&System.currentTimeMillis()-localTime<60000&&id!=expected)return;updateLikedCover(id,url,false);});
    }catch(Exception error){android.util.Log.w("DotoArtwork","Liked cover sync failed; keeping cached cover",error);}});
  }

  private JSONObject likedPlaylist() {
    for (int i = 0; i < myLists.length(); i++) {
      JSONObject item = myLists.optJSONObject(i);
      if (item.optInt("specialType") == 5
          || (item.optString("name").contains("喜欢")
              && item.optJSONObject("creator") != null
              && item.optJSONObject("creator").optLong("userId") == userId)) {applyLikedCover(item);return item;}
    }
    return null;
  }

  private JSONArray recentSongs() {
    try {
      return new JSONArray(getSharedPreferences("recent", 0).getString("songs", "[]"));
    } catch (Exception ignored) {
      return new JSONArray();
    }
  }

  private void libraryRow(
      LinearLayout group,
      String icon,
      String title,
      String detail,
      Runnable action,
      boolean divider) {
    if (divider) {
      View line = new View(this);
      line.setBackgroundColor(DotoDesign.LINE);
      LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, 1);
      lp.leftMargin = gd(59);
      group.addView(line, lp);
    }
    LinearLayout row = new LinearLayout(this);
    row.setGravity(Gravity.CENTER_VERTICAL);
    GlassUi.Symbol symbol = new GlassUi.Symbol(this, icon, title, action);
    symbol.setBackground(GlassUi.glass(this, 13));
    row.addView(symbol, new LinearLayout.LayoutParams(gd(44), gd(44)));
    LinearLayout labels = MobileUi.column(this);
    labels.setPadding(gd(13), 0, 0, 0);
    labels.addView(GlassUi.label(this, title, 16, true));
    TextView description = GlassUi.label(this, detail, 12, false);
    description.setTextColor(GlassUi.MUTED);
    LinearLayout.LayoutParams dp = new LinearLayout.LayoutParams(-1, gd(22));
    dp.topMargin = gd(4);
    labels.addView(description, dp);
    row.addView(labels, new LinearLayout.LayoutParams(0, -2, 1));
    TextView chevron = GlassUi.label(this, "›", 24, false);
    chevron.setTextColor(GlassUi.MUTED);
    row.addView(chevron, new LinearLayout.LayoutParams(gd(20), gd(48)));
    GlassUi.touch(row, action);
    group.addView(row, new LinearLayout.LayoutParams(-1, gd(78)));
  }

  private void loadPersonal() {
    loadProfileStats();
    if (destroyed || personalLoading || userId == 0) return;
    if(myLists.length()==0)try{myLists=new JSONArray(getSharedPreferences("personal-"+userId,0).getString("lists","[]"));}catch(Exception ignored){}
    personalLoading = true;
    if(myLists.length()==0)renderPersonal();
    int epoch = accountEpoch;
    long owner = userId;
    String cookie = api.cookie;
    homeData.submit(
        () -> {
          try {
            NeteaseClient client = new NeteaseClient();
            client.cookie = cookie;
            JSONArray result = client.playlists(owner);
            ui(
                () -> {
                  if (epoch == accountEpoch) {
                    myLists = result;
                    JSONObject liked=likedPlaylist();if(liked!=null)applyLikedCover(liked);refreshLikedCover();
                    getSharedPreferences("personal-"+owner,0).edit().putString("lists",result.toString()).apply();
                    for(int i=0;i<Math.min(8,result.length());i++)images.load(result.optJSONObject(i).optString("coverImgUrl"),bitmap->{});
                    renderPersonal();
                  }
                });
          } catch (Exception e) {
            ui(
                () -> {
                  if (epoch == accountEpoch) status.setText("歌单同步失败，点击刷新重试");
                });
          } finally {
            ui(
                () -> {
                  if (epoch == accountEpoch) {
                    personalLoading = false;
                    renderPersonal();
                  }
                });
          }
        });
  }

  private void showSettings() {
    startActivity(new Intent(this,SettingsActivity.class));
    if (android.os.Build.VERSION.SDK_INT < 34)
      overridePendingTransition(R.anim.settings_enter_left, R.anim.settings_still);
  }

  private PopupWindow popup(String title, String[] entries, Runnable[] actions) {
    return popup(title, entries, actions, 272);
  }

  private PopupWindow profilePopup(String title, String[] entries, Runnable[] actions) {
    return popup(title, entries, actions, 176);
  }

  private PopupWindow popup(String title, String[] entries, Runnable[] actions, int width) {
    LinearLayout menu = MobileUi.column(this);
    menu.setPadding(gd(9), gd(8), gd(9), gd(8));
    menu.setBackground(GlassUi.glass(this, 20));
    if (!title.isEmpty()) {
      TextView caption = GlassUi.label(this, title, 11, false);
      caption.setTextColor(GlassUi.MUTED);
      caption.setPadding(gd(10), gd(4), gd(10), gd(7));
      menu.addView(caption);
    }
    PopupWindow popup = new PopupWindow(menu, Math.min(gd(width),getResources().getDisplayMetrics().widthPixels-gd(40)), -2, true);
    popup.setBackgroundDrawable(
        new android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT));
    popup.setOutsideTouchable(true);
    popup.setElevation(gd(12));
    DotoDesign.popup(menu);
    for (int i = 0; i < entries.length; i++) {
      final int n = i;
      LinearLayout row=new LinearLayout(this);row.setGravity(Gravity.CENTER_VERTICAL);
      row.setPadding(gd(12),0,gd(12),0);
      String clean=entries[i].replaceAll("^[⇄＋⇥✓]+\\s*","");
      ImageView icon=new ImageView(this);icon.setImageDrawable(new DotoIcon(DotoIcon.forLabel(entries[i]),DotoDesign.INK));
      row.addView(icon,new LinearLayout.LayoutParams(gd(22),gd(22)));
      TextView label=GlassUi.label(this,clean,14,false);label.setPadding(gd(12),0,0,0);
      row.addView(label,new LinearLayout.LayoutParams(0,-2,1));
      row.setContentDescription(clean);
      menu.addView(row,new LinearLayout.LayoutParams(-1,gd(52)));
      GlassUi.touch(
          row,
          () -> {
            popup.dismiss();
            actions[n].run();
          });
    }
    return popup;
  }

  private void accountDrawer(String heading,String[] labels,Runnable[] actions){
    Dialog sheet=new Dialog(this);LinearLayout panel=MobileUi.column(this);panel.setPadding(gd(24),gd(18),gd(24),gd(24));panel.setBackground(DotoDesign.cardSurface(this,24));
    LinearLayout top=new LinearLayout(this);top.setGravity(Gravity.CENTER_VERTICAL);top.addView(new View(this),new LinearLayout.LayoutParams(gd(48),gd(48)));TextView title=GlassUi.label(this,heading,19,true);title.setTextColor(DotoDesign.INK);title.setGravity(Gravity.CENTER);title.setMaxLines(2);top.addView(title,new LinearLayout.LayoutParams(0,-2,1));GlassUi.Symbol close=new GlassUi.Symbol(this,"close","关闭账号菜单",sheet::dismiss);close.color=DotoDesign.CARD_INK;top.addView(close,new LinearLayout.LayoutParams(gd(48),gd(48)));panel.addView(top);
    ScrollView scroll=new ScrollView(this);scroll.setFillViewport(false);LinearLayout list=MobileUi.column(this);scroll.addView(list);panel.addView(scroll,new LinearLayout.LayoutParams(-1,-2));
    for(int i=0;i<labels.length;i++){
      final Runnable action=actions[i];LinearLayout row=new LinearLayout(this);row.setGravity(Gravity.CENTER);row.setContentDescription(labels[i]);
      TextView label=GlassUi.label(this,labels[i],16,false);label.setTextColor(DotoDesign.CARD_INK);label.setGravity(Gravity.CENTER);row.addView(label,new LinearLayout.LayoutParams(-2,gd(56)));list.addView(row,new LinearLayout.LayoutParams(-1,gd(56)));GlassUi.touch(row,()->{sheet.dismiss();action.run();});
    }

    sheet.setContentView(panel);android.view.Window window=sheet.getWindow();window.setBackgroundDrawableResource(android.R.color.transparent);window.addFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND);window.setDimAmount(.4f);window.setGravity(Gravity.BOTTOM);panel.setOnApplyWindowInsetsListener((v,insets)->{int bottom=insets.getInsets(android.view.WindowInsets.Type.systemBars()).bottom;panel.setPadding(gd(24),gd(18),gd(24),gd(24)+bottom);return insets;});sheet.show();window.setLayout(-1,-2);
  }

  private void accountMenu() {
    profilePopup(
            "",
            new String[] {"切换账号", "添加账号", "退出账号"},
            new Runnable[] {
              () -> profileAccountButton.post(this::chooseAccount),
              this::loginDialog,
              () ->
                  task(
                      "退出账号…",
                      () -> {
                        sessions.clear();
                        api.cookie = "";
                        ui(this::signedOut);
                        return "";
                      })
            }).showAsDropDown(profileAccountButton, 0, gd(4), Gravity.START);
  }

  private void chooseAccount() {
    JSONArray list = sessions.accounts();
    String[] names = new String[list.length() + 1];
    Runnable[] actions = new Runnable[names.length];
    for (int i = 0; i < list.length(); i++) {
      JSONObject item = list.optJSONObject(i);
      long id = item.optLong("userId");
      names[i] = (id == userId ? "✓  " : "") + item.optString("nickname");
      actions[i] =
          () -> {
            if (id == userId) return;
            task(
                "切换账号…",
                () -> {
                  String cookie = sessions.cookieFor(id);
                  NeteaseClient client = new NeteaseClient();
                  client.cookie = cookie;
                  JSONObject profile = client.profile();
                  if (profile == null) throw new IOException("账号已失效，请重新添加");
                  sessions.activate(id);
                  api.cookie = cookie;
                  applyProfile(profile);
                  return "";
                });
          };
    }
    names[names.length - 1] = "＋ 添加网易云账号";
    actions[actions.length - 1] = this::loginDialog;
    profilePopup("已保存的账号", names, actions)
        .showAsDropDown(profileAccountButton, 0, gd(4), Gravity.START);
  }

  private void signedOut() {
    userId = 0;
    favoriteIds.clear();
    favoritesOwner = -1;
    account.setText("未登录");
    avatarUrl = "";
    if (engine != null) engine.cancelRadio(); accountEpoch++;refreshingSections.clear();playlistSubscriptions.clear();playlistSubscriptionPending.clear();
    resetFavoriteRequests();
    dailySongs = new JSONArray();discoverySections=new JSONArray();extraDiscoveryLoading=false;extraDiscoveryAttempted=false;featuredOffset=0;featuredPageOffset=0;featuredRefreshing=false;featuredVisible=new JSONArray();
    suggestedLists = new JSONArray();
    myLists = new JSONArray();savedAlbums=new JSONArray();albumsLoaded=false;albumsLoading=false;albumsFailure="";
    homeLoading = false;
    personalLoading = false;
    loadDiscovery();
    if (mainTab == 1) showAccount();
    else showHome();
  }

  interface Work {
    String run() throws Exception;
  }

  private void task(String message, Work action) {
    if (requesting) {
      status.setText("请等待当前请求完成");
      return;
    }
    requesting = true;
    status.setText(message);
    network.submit(
        () -> {
          try {
            String result = action.run();
            ui(() -> status.setText(result));
          } catch (Exception e) {
            ui(() -> status.setText("操作失败：" + e.getMessage()));
            android.util.Log.w("VoloMusic", "Request failed: " + e.getClass().getSimpleName());
            if (getIntent().getBooleanExtra("smoke", false))
              android.util.Log.i("VoloSmoke", "Self-test failed: " + e.getMessage());
          } finally {
            requesting = false;
          }
        });
  }

  private void ui(Runnable action) {
    runOnUiThread(
        () -> {
          if (!destroyed) action.run();
        });
  }

  private void applyProfile(JSONObject profile) {
    sessions.remember(profile);
    ui(
        () -> {
          long previous = userId;
          userId = profile.optLong("userId");
          account.setText(profile.optString("nickname", "已登录"));
          avatarUrl = profile.optString("avatarUrl");
          if (previous != userId) {
            favoriteIds.clear();
            favoritesOwner = -1;
            if (engine != null) engine.cancelRadio(); accountEpoch++;refreshingSections.clear();playlistSubscriptions.clear();playlistSubscriptionPending.clear();
            resetFavoriteRequests();
            homeLoading = false;
            personalLoading = false;
            dailySongs = new JSONArray();discoverySections=new JSONArray();extraDiscoveryLoading=false;extraDiscoveryAttempted=false;featuredOffset=0;featuredPageOffset=0;featuredRefreshing=false;featuredVisible=new JSONArray();
                    suggestedLists = new JSONArray();
            myLists = new JSONArray();savedAlbums=new JSONArray();albumsLoaded=false;albumsLoading=false;albumsFailure="";
            loadDiscovery();
          }
          prefetchHeartMode();
          if (mainTab == 1) showAccount();
        });
  }

  private Dialog qrDialog;
  private int qrGeneration;
  private volatile boolean qrRequest;
  private android.graphics.Bitmap qrBitmap;
  private long qrDeadline;
  private String qrKey;
  private final NeteaseClient qrApi = new NeteaseClient();
  private TextView qrStatus;
  private ImageView qrImage;

  private void loginDialog() {
    if (qrDialog != null && qrDialog.isShowing()) return;
    qrDialog=new Dialog(this);
    LinearLayout form=MobileUi.column(this);form.setGravity(Gravity.CENTER_HORIZONTAL);form.setPadding(gd(20),gd(10),gd(20),gd(24));form.setBackground(DotoDesign.shape(this,0xffa32016,28));
    FrameLayout top=new FrameLayout(this);TextView title=GlassUi.label(this,"网易云扫码登录",20,true);title.setTextColor(0xffffffff);title.setGravity(Gravity.CENTER);title.setPadding(gd(40),0,gd(40),0);top.addView(title,new FrameLayout.LayoutParams(-1,gd(56)));
    View close=new View(this){final android.graphics.Paint paint=new android.graphics.Paint(3);protected void onDraw(android.graphics.Canvas canvas){float centerX=getWidth()/2f,centerY=getHeight()/2f,half=gd(6);paint.setColor(0xffffffff);paint.setStrokeWidth(gd(2));paint.setStrokeCap(android.graphics.Paint.Cap.ROUND);canvas.drawLine(centerX-half,centerY-half,centerX+half,centerY+half,paint);canvas.drawLine(centerX+half,centerY-half,centerX-half,centerY+half,paint);}};close.setContentDescription("关闭扫码登录");GlassUi.touch(close,qrDialog::dismiss);top.addView(close,new FrameLayout.LayoutParams(gd(44),gd(48),Gravity.TOP|Gravity.RIGHT));form.addView(top,new LinearLayout.LayoutParams(-1,gd(56)));
    TextView help=GlassUi.label(this,"使用网易云音乐扫一扫\n在官方 App 中确认登录",13,false);help.setTextColor(0xeeffffff);help.setGravity(Gravity.CENTER);form.addView(help,new LinearLayout.LayoutParams(-1,-2));
    FrameLayout qrFrame=new FrameLayout(this);qrFrame.setPadding(gd(8),gd(8),gd(8),gd(8));qrFrame.setBackground(DotoDesign.shape(this,0xffffffff,18));GlassUi.rounded(qrFrame,18);LinearLayout.LayoutParams qrLayout=new LinearLayout.LayoutParams(gd(188),gd(188));qrLayout.topMargin=gd(20);form.addView(qrFrame,qrLayout);
    qrImage=new ImageView(this);qrImage.setScaleType(ImageView.ScaleType.FIT_CENTER);GlassUi.rounded(qrImage,10);qrFrame.addView(qrImage,new FrameLayout.LayoutParams(-1,-1));
    qrImage.setContentDescription("登录二维码，点击刷新，长按保存到相册");qrImage.setOnClickListener(view->{if(!qrRequest)newQr();});qrImage.setOnLongClickListener(view->{saveQr();return true;});
    qrStatus=GlassUi.label(this,"正在获取二维码…",12,false);qrStatus.setTextColor(0xffffffff);qrStatus.setGravity(Gravity.CENTER);qrStatus.setMaxLines(3);LinearLayout.LayoutParams statusLayout=new LinearLayout.LayoutParams(-1,-2);statusLayout.topMargin=gd(16);form.addView(qrStatus,statusLayout);
    TextView hint=GlassUi.label(this,"点击二维码刷新 · 长按保存到相册",11,false);hint.setTextColor(0xddffffff);hint.setGravity(Gravity.CENTER);LinearLayout.LayoutParams hintLayout=new LinearLayout.LayoutParams(-1,-2);hintLayout.topMargin=gd(10);form.addView(hint,hintLayout);
    qrDialog.setContentView(form);Window window=qrDialog.getWindow();window.setBackgroundDrawableResource(android.R.color.transparent);window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);window.setDimAmount(.45f);window.setGravity(Gravity.CENTER);
    qrDialog.setOnDismissListener(
        d -> {
          qrGeneration++;
          timer.removeCallbacks(pollQr);
          qrBitmap = null;
          qrKey = null;
        });
    qrDialog.show();
    window.setLayout(Math.min(gd(340),getWindowManager().getCurrentWindowMetrics().getBounds().width()-gd(48)),-2);
    newQr();
  }

  private void newQr() {
    if (destroyed || qrRequest) return;
    int generation = ++qrGeneration;
    qrRequest = true;
    qrKey = null;
    qrBitmap = null;
    qrImage.setImageDrawable(null);
    qrStatus.setText("正在获取二维码…");
    timer.removeCallbacks(pollQr);
    network.submit(
        () -> {
          try {
            String key = qrApi.qrKey();
            String url =
                "https://music.163.com/login?codekey=" + java.net.URLEncoder.encode(key, "UTF-8");
            com.google.zxing.common.BitMatrix matrix =
                new com.google.zxing.qrcode.QRCodeWriter()
                    .encode(url, com.google.zxing.BarcodeFormat.QR_CODE, 640, 640);
            int[] pixels = new int[640 * 640];
            for (int y = 0; y < 640; y++)
              for (int x = 0; x < 640; x++)
                pixels[y * 640 + x] = matrix.get(x, y) ? 0xff000000 : 0xffffffff;
            android.graphics.Bitmap bitmap =
                android.graphics.Bitmap.createBitmap(
                    pixels, 640, 640, android.graphics.Bitmap.Config.ARGB_8888);
            ui(
                () -> {
                  if (generation != qrGeneration) return;
                  qrKey = key;
                  qrBitmap = bitmap;
                  qrImage.setImageBitmap(bitmap);
                  qrDeadline = SystemClock.elapsedRealtime() + 120000;
                  qrStatus.setText("等待扫码，请在网易云确认登录");
                  timer.postDelayed(pollQr, 2500);
                });
          } catch (Exception e) {
            ui(
                () -> {
                  if (generation == qrGeneration) qrStatus.setText("获取失败：" + e.getMessage());
                });
          } finally {
            qrRequest = false;
          }
        });
  }

  private final Runnable pollQr = () -> checkQr();

  private void checkQr() {
    if (destroyed || qrKey == null || qrRequest || qrDialog == null || !qrDialog.isShowing())
      return;
    if (SystemClock.elapsedRealtime() > qrDeadline) {
      qrStatus.setText("二维码已过期，请重新获取");
      return;
    }
    int generation = qrGeneration;
    String key = qrKey;
    qrRequest = true;
    network.submit(
        () -> {
          try {
            JSONObject result = qrApi.qrCheck(key);
            int code = result.optInt("code");
            if (generation != qrGeneration || destroyed) return;
            if (code == 803) {
              String candidate = result.optString("sessionCookie");
              if (!candidate.contains("MUSIC_U=")) throw new IOException("授权未返回有效会话，请重新扫码");
              // Validate with a separate client before changing the active account.
              NeteaseClient authenticated = new NeteaseClient();
              authenticated.cookie = candidate;
              JSONObject profile = authenticated.profile();
              if (profile == null) throw new IOException("授权已确认，但账号信息获取失败，请重新扫码");
              if (generation != qrGeneration || destroyed) return;
              sessions.save(candidate);
              api.cookie = candidate;
              applyProfile(profile);
              ui(
                  () -> {
                    if (generation == qrGeneration) {
                      status.setText("扫码登录成功");
                      qrDialog.dismiss();
                    }
                  });
            } else
              ui(
                  () -> {
                    if (generation != qrGeneration) return;
                    if (code == 800) {
                      qrStatus.setText("二维码已失效，请重新获取");
                      return;
                    }
                    qrStatus.setText(code == 802 ? "已扫码，请在网易云确认授权" : "等待扫码");
                    timer.postDelayed(pollQr, 2500);
                  });
          } catch (Exception e) {
            ui(
                () -> {
                  if (generation == qrGeneration)
                    qrStatus.setText("登录未完成：" + e.getMessage() + "。请重新获取二维码");
                });
          } finally {
            qrRequest = false;
          }
        });
  }

  private void saveQr() {
    if (qrBitmap == null) {
      qrStatus.setText("请先获取有效二维码");
      return;
    }
    android.graphics.Bitmap bitmap = qrBitmap;
    network.submit(
        () -> {
          Uri uri = null;
          try {
            ContentValues values = new ContentValues();
            values.put(
                android.provider.MediaStore.Images.Media.DISPLAY_NAME,
                "Doto-login-" + System.currentTimeMillis() + ".png");
            values.put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/png");
            values.put(android.provider.MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Doto");
            values.put(android.provider.MediaStore.Images.Media.IS_PENDING, 1);
            uri =
                getContentResolver()
                    .insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException("无法保存图片");
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
              if (out == null
                  || !bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out))
                throw new IOException("保存失败");
            }
            values.clear();
            values.put(android.provider.MediaStore.Images.Media.IS_PENDING, 0);
            getContentResolver().update(uri, values, null, null);
            ui(() -> qrStatus.setText("已保存到相册 Pictures/Doto，请到网易云扫一扫尝试识别"));
          } catch (Exception e) {
            if (uri != null) getContentResolver().delete(uri, null, null);
            ui(() -> qrStatus.setText("保存失败：" + e.getMessage()));
          }
        });
  }

  private void filterPlaylistSongs(){
    if(playlistSearchSource==null)return;String query=search.getText().toString().trim().toLowerCase(Locale.ROOT);JSONArray matches=new JSONArray();
    for(int i=0;i<playlistSearchSource.length();i++){JSONObject song=playlistSearchSource.optJSONObject(i);if(song==null)continue;String fields=song.optString("name")+" "+artists(song);if(fields.toLowerCase(Locale.ROOT).contains(query))matches.put(song);}
    showSongs(matches);
  }

  private void cancelSearchRequest() {
    timer.removeCallbacks(liveSearch);
    searchGeneration++;
    if (searchRequest != null) {
      searchRequest.cancel(true);
      searchRequest = null;
    }
  }

  private void showSearchPrompt() {
    content.removeAllViews();
    songListPanel = null;
    displayedSongs = new JSONArray();
    pageScroll.scrollTo(0, 0);
  }

  private void showSearchState(String message, boolean loading, Runnable retry) {
    content.removeAllViews();
    songListPanel = null;
    displayedSongs = new JSONArray();
    pageScroll.scrollTo(0, 0);

    LinearLayout state = MobileUi.column(this);
    state.setGravity(Gravity.CENTER_HORIZONTAL);
    state.setPadding(gd(16), gd(36), gd(16), gd(24));
    if (loading) {
      ProgressBar progress = new ProgressBar(this);
      progress.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(DotoDesign.INK));
      state.addView(progress, new LinearLayout.LayoutParams(gd(24), gd(24)));
    }
    TextView label = GlassUi.label(this, message, 14, false);
    label.setTextColor(DotoDesign.MUTED);
    label.setGravity(Gravity.CENTER);
    label.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
    LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(-1, -2);
    if (loading) labelParams.topMargin = gd(12);
    state.addView(label, labelParams);
    if (retry != null) {
      Button action = new Button(this);
      DotoDesign.button(action, "重试", false);
      action.setOnClickListener(view -> retry.run());
      LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(gd(96), gd(48));
      buttonParams.topMargin = gd(12);
      state.addView(action, buttonParams);
    }
    content.addView(state, new LinearLayout.LayoutParams(-1, -2));
  }

  private void searchSongs() {
    if (!"search".equals(browse)) return;
    if(playlistSearchSource!=null){filterPlaylistSongs();return;}
    String query = search.getText().toString().trim();
    if (query.isEmpty() || searchRequest != null) return;
    cancelSearchRequest();
    int generation = searchGeneration;
    int epoch = accountEpoch;
    NeteaseClient client = new NeteaseClient();
    client.cookie = api.cookie;
    searchRequest = searchNetwork.submit(() -> {
      try {
        JSONObject result = client.search(query).optJSONObject("result");
        JSONArray songs = result == null ? null : result.optJSONArray("songs");
        ui(() -> {
          if (generation != searchGeneration || !"search".equals(browse)) return;
          searchRequest = null;
          if (epoch != accountEpoch) {
            showSearchPrompt();
            return;
          }
          showSongs(songs);
        });
      } catch (Exception error) {
        ui(() -> {
          if (generation != searchGeneration || !"search".equals(browse)) return;
          searchRequest = null;
          showSearchState("搜索暂时不可用", false, this::searchSongs);
        });
      }
    });
  }

  private void showSongs(JSONArray songs) {
    lastSongs = songs;
    displayedSongs = songs == null ? new JSONArray() : songs;
    ui(
        () -> {
          if (page == 2 || page == 3 || page == 4) return;
          content.removeAllViews();
          boolean searchResults="search".equals(browse);
          if (searchResults) {
            applySearchChrome();
            if (displayedSongs.length() == 0) {
              showSearchState(playlistSearchSource == null ? "没有找到匹配的歌曲" : "歌单里没有匹配的歌曲", false, null);
              return;
            }
            listInfo = new JSONObject();
            try { listInfo.put("searchResults", true); } catch (JSONException ignored) {}
          }
          else listHeader(true);
          JSONArray list = displayedSongs;
          songListPanel =
              new SongListPanel(
                  this,
                  listTitle,
                  listInfo,
                  list,
                  images,
                  downloadedSongIds(),
                  completedStemIds(),
                  new SongListPanel.Actions() {
                    public void play(int index, boolean shuffle) {
                      if (engine == null) return;
                      if(searchResults){playSearchSong(list.optJSONObject(index));return;}
                      if (shuffle) engine.setShuffle(true);
                      playFeed(list, index);
                    }

                    public void next(int index) {
                      if (engine != null) engine.enqueue(list.optJSONObject(index), true);
                    }

                    public void append(int index) {
                      if (engine != null) engine.enqueue(list.optJSONObject(index), false);
                    }

                    public void download(int[] indices) {
                      downloadSelection(list, indices);
                    }

                    public void player(int index) {
                      if (engine == null) return;
                      if (engine
                          .current()
                          .optString("id")
                          .equals(list.optJSONObject(index).optString("id"))) showStemControls();
                      else {
                        reopenPlayer = true;
                        if(searchResults)playSearchSong(list.optJSONObject(index));else playFeed(list,index);
                      }
                    }
                  });
          content.addView(songListPanel, new LinearLayout.LayoutParams(-1, -2));
          if(listInfo.optBoolean("heartMode")&&listInfo.optBoolean("loading")){TextView preparing=GlassUi.label(this,"正在准备心动推荐…",14,false);preparing.setTextColor(DotoDesign.MUTED);preparing.setPadding(0,gd(20),0,gd(20));content.addView(preparing);}

          if(!searchResults&&playlistEntrancePending){playlistEntrancePending=false;revealSections(songListPanel);}
          if (engine != null)
            songListPanel.updateCurrent(engine.current().optString("id"), engine.playbackActive());
          pageScroll.post(() -> pageScroll.scrollTo(0, 0));
        });
  }

  private void playSearchSong(JSONObject song){
    if(engine==null||song==null)return;
    for(int i=0;i<engine.queue.length();i++)if(song.optString("id").equals(engine.queue.optJSONObject(i).optString("id"))){engine.select(i);return;}
    int index=engine.queue.length();engine.enqueue(song,false);engine.select(index);
  }

  private Set<String> downloadedSongIds() {
    Set<String> result = new HashSet<>();
    for (String key : getSharedPreferences("downloads", 0).getAll().keySet()) {
      try {
        long downloadId = Long.parseLong(key);
        try (Cursor cursor =
            downloads.query(new DownloadManager.Query().setFilterById(downloadId))) {
          if (cursor == null
              || !cursor.moveToFirst()
              || cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                  != DownloadManager.STATUS_SUCCESSFUL) continue;
          String uri =
              cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI));
          if (uri != null) {
            String file = Uri.parse(uri).getLastPathSegment();
            if (file != null && file.contains("-")) {
              String id = file.substring(0, file.indexOf('-'));
              if (id.matches("[0-9]+")) result.add(id);
            }
          }
        }
      } catch (Exception ignored) {
      }
    }
    return result;
  }

  private Set<String> completedStemIds() {
    Set<String> result = new HashSet<>();
    for (var entry : getSharedPreferences("stems", 0).getAll().entrySet()) {
      File folder = new File(entry.getValue().toString());
      if (new File(folder, "vocals.wav").isFile() && new File(folder, "accompaniment.wav").isFile())
        result.add(entry.getKey());
    }
    return result;
  }

  private void downloadSelection(JSONArray songs, int[] indices) {
    task(
        "准备下载所选歌曲…",
        () -> {
          int added = 0, skipped = 0;
          String reason = "";
          for (int index : indices) {
            JSONObject song = songs.optJSONObject(index);
            if (song == null || song.optLong("id") <= 0) {
              skipped++;
              continue;
            }
            try {
              JSONObject source = api.resolve(song.optLong("id"));
              if (NeteaseClient.isTrial(source)) {
                skipped++;
                reason = "部分歌曲仅支持试听";
                continue;
              }
              Uri uri = Uri.parse(source.getString("url")).buildUpon().scheme("https").build();
              enqueue(
                  uri, song.optLong("id"), song.optString("name"), source.optString("type", "mp3"),song);
              added++;
            } catch (Exception e) {
              skipped++;
              reason = "部分歌曲音源获取失败";
            }
          }
          String message =
              "已加入 " + added + " 首下载" + (skipped > 0 ? "，" + skipped + " 首未下载。" + reason : "");
          ui(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show());
          return message;
        });
  }

  private static String artists(JSONObject song) {
    JSONArray list = song.optJSONArray("ar");
    if (list == null) list = song.optJSONArray("artists");
    StringJoiner names = new StringJoiner(" / ");
    if (list != null)
      for (int i = 0; i < list.length(); i++) names.add(list.optJSONObject(i).optString("name"));
    return names.toString();
  }

  private void playlists() {
    if (userId == 0) {
      status.setText("请先登录");
      return;
    }
    mainTab = 1;
    listParent = this::showAccount;
    selectPage(1);
    browse = "playlists";
    task(
        "",
        () -> {
          JSONArray list = api.playlists(userId);
          ui(
              () -> {
                if (page != 1) return;
                content.removeAllViews();
                content.addView(MobileUi.heading(this, "我的歌单", 25));
                for (int i = 0; i < list.length(); i++) {
                  JSONObject item = list.optJSONObject(i);
                  long id = item.optLong("id");
                  button(
                      content,
                      item.optString("name") + " · " + item.optInt("trackCount") + " 首",
                      () -> openPlaylist(item,this::playlists));
                }
              });
          return "";
        });
  }

  private void resolve(long id, String name, boolean download) {
    if (!download) {
      if (engine == null) {
        status.setText("播放器正在连接，请稍候");
        return;
      }
      int index = 0;
      JSONArray items = displayedSongs == null ? new JSONArray() : displayedSongs;
      for (int i = 0; i < items.length(); i++)
        if (items.optJSONObject(i).optLong("id") == id) {
          index = i;
          break;
        }
      engine.startQueue(items, index);
      return;
    }
    task(
        "解析音源…",
        () -> {
          JSONObject source = api.resolve(id);
          boolean trial = NeteaseClient.isTrial(source);
          Uri uri = Uri.parse(source.getString("url"));
          if ("http".equals(uri.getScheme())) uri = uri.buildUpon().scheme("https").build();
          if (!"https".equals(uri.getScheme())) throw new IOException("音源地址无效");
          if (download) {
            if (trial) throw new IOException("当前仅提供试听，不能下载完整歌曲");
            enqueue(uri, id, name, source.optString("type", "mp3"));
            return "已加入系统下载队列";
          }
          Uri playUri = uri;
          ui(() -> play(playUri, name + (trial ? "（试听）" : "")));
          return trial ? "正在加载试听" : "正在加载 " + name;
        });
  }

  private volatile int stemEpoch;
  private Uri originalUri;
  private String originalLabel = "", stemMessage = "";
  private File stemFiles, stemExport;
  private StemStream stemStream;
  private boolean stemRunning, switchingStem, pendingResume = true;
  private int pendingSeek;
  private AlertDialog stemDialog;
  private TextView stemStatus;
  private Button stemStart, stemVoice, stemMusic;

  private JSONArray localSongs(){try{return new JSONArray(getSharedPreferences("local-library",0).getString("songs","[]"));}catch(Exception ignored){return new JSONArray();}}
  private void showLocalMusic(){
    saveRootScroll();selectPage(4);browse="local";listParent=this::showAccount;listHeader(true);headerMore.setVisibility(View.GONE);content.removeAllViews();
    LinearLayout add=new LinearLayout(this);add.setGravity(Gravity.END);button(add,"添加本地音乐",this::pickLocalMusic);content.addView(add);
    JSONArray songs=localSongs();
    songListPanel=new SongListPanel(this,"本地音乐",new JSONObject(),songs,images,downloadedSongIds(),completedStemIds(),new SongListPanel.Actions(){
      public void play(int index,boolean shuffle){if(engine!=null){if(shuffle)engine.setShuffle(true);engine.startQueue(songs,index);}}
      public void next(int index){if(engine!=null)engine.enqueue(songs.optJSONObject(index),true);}
      public void append(int index){if(engine!=null)engine.enqueue(songs.optJSONObject(index),false);}
      public void download(int[] indices){Toast.makeText(MusicActivity.this,"歌曲已在本地",Toast.LENGTH_SHORT).show();}
      public void player(int index){play(index,false);showStemControls();}
    });content.addView(songListPanel,new LinearLayout.LayoutParams(-1,-2));if(engine!=null)songListPanel.updateCurrent(engine.current().optString("id"),engine.playbackActive());
  }
  private void addLocalSongs(Intent data){
    java.util.ArrayList<Uri> selected=new java.util.ArrayList<>();
    if(data.getClipData()!=null)for(int i=0;i<data.getClipData().getItemCount();i++)selected.add(data.getClipData().getItemAt(i).getUri());else if(data.getData()!=null)selected.add(data.getData());
    JSONArray songs=localSongs();java.util.HashSet<String> existing=new java.util.HashSet<>();for(int i=0;i<songs.length();i++)existing.add(songs.optJSONObject(i).optString("uri"));
    for(Uri uri:selected){
      if(uri==null||existing.contains(uri.toString()))continue;
      try{getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);}catch(SecurityException ignored){}
      String name="本地音乐";
      try(Cursor cursor=getContentResolver().query(uri,new String[]{android.provider.OpenableColumns.DISPLAY_NAME},null,null,null)){if(cursor!=null&&cursor.moveToFirst())name=cursor.getString(0);}catch(Exception ignored){}
      try{songs.put(new JSONObject().put("id","local:"+uri).put("uri",uri.toString()).put("name",name).put("localLibrary",true));existing.add(uri.toString());}catch(Exception ignored){}
    }
    getSharedPreferences("local-library",0).edit().putString("songs",songs.toString()).apply();showLocalMusic();
  }

  private void pickLocalMusic() {
    startActivityForResult(
        new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .setType("audio/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            .addCategory(Intent.CATEGORY_OPENABLE),
        12);
  }

  private SpatialPlayer spatial;
  private CompactPlayerView compactPlayer;
  private boolean compactMode = true;
  private android.graphics.Bitmap compactCover;
  private String compactArtKey = "";
  private final Map<String, PlayerDownloadStatus> playerDownloadStates = new HashMap<>();
  private final Set<String> playerDownloadRequests = new HashSet<>();
  private boolean playerDownloadProbe;
  private long playerDownloadChecked, playerDownloadRevision;
  private String playerDownloadKey = "";
  private final Runnable playerActionTick =
      new Runnable() {
        public void run() {
          if (destroyed || !foreground || spatial == null || !spatial.isShowing()) return;
          refreshPlayerActions();
          timer.postDelayed(this, 1000);
        }
      };

  private String playerSongKey() {
    if (engine == null) return "";
    return engine.current().optString("id", originalUri == null ? "" : originalUri.toString());
  }

  private boolean currentSongIsLocal() {
    return originalUri != null
        && !"http".equals(originalUri.getScheme())
        && !"https".equals(originalUri.getScheme());
  }

  private void refreshPlayerActions() {
    if (destroyed || engine == null || spatial == null || !spatial.isShowing()) return;
    spatial.order(engine.order.mode, engine.order.isShuffled());
    int[] order=engine.order.queueOrder(engine.queue.length(),engine.index);
    if(!java.util.Arrays.equals(order,playerQueueOrder)) updatePlayerTrack();
    String key = playerSongKey();
    if (!key.equals(playerDownloadKey)) {
      playerDownloadKey = key;
      playerDownloadChecked = 0;
    }
    PlayerDownloadStatus state = playerDownloadStates.getOrDefault(key, PlayerDownloadStatus.IDLE);
    boolean pending = playerDownloadRequests.contains(key);
    spatial.download(
        state.complete(), !state.complete() && (pending || state.busy()), state.percent());
    long now = SystemClock.uptimeMillis();
    if (key.isEmpty() || playerDownloadProbe || now - playerDownloadChecked < 900) return;
    playerDownloadProbe = true;
    playerDownloadChecked = now;
    long revision = playerDownloadRevision;
    boolean local = currentSongIsLocal();
    homeData.execute(
        () -> {
          PlayerDownloadStatus found;
          try {
            found = PlayerDownloadStatus.read(this, downloads, key, local);
          } catch (Exception ignored) {
            found = null;
          }
          PlayerDownloadStatus result = found;
          ui(
              () -> {
                playerDownloadProbe = false;
                if (revision != playerDownloadRevision || result == null) return;
                playerDownloadStates.put(key, result);
                if (spatial != null && spatial.isShowing() && key.equals(playerSongKey()))
                  spatial.download(
                      result.complete(),
                      !result.complete() && (result.busy() || playerDownloadRequests.contains(key)),
                      result.percent());
              });
        });
  }

  private void downloadCurrentSong() {
    if (engine == null) return;
    String key = playerSongKey();
    PlayerDownloadStatus known = playerDownloadStates.getOrDefault(key, PlayerDownloadStatus.IDLE);
    if (known.complete() || currentSongIsLocal() && !key.matches("[0-9]+")) {
      Toast.makeText(this, "歌曲已在本地", Toast.LENGTH_SHORT).show();
      return;
    }
    if (known.busy() || playerDownloadRequests.contains(key)) return;
    if (!key.matches("[1-9][0-9]*")) {
      Toast.makeText(this, "当前音源不支持下载", Toast.LENGTH_SHORT).show();
      return;
    }
    String name = engine.current().optString("name", originalLabel);
    playerDownloadRequests.add(key);
    playerDownloadRevision++;
    refreshPlayerActions();
    homeData.execute(
        () -> {
          PlayerDownloadStatus result = PlayerDownloadStatus.IDLE;
          String message;
          try {
            PlayerDownloadStatus existing = PlayerDownloadStatus.read(this, downloads, key, false);
            if (existing.complete() || existing.busy()) {
              result = existing;
              message = existing.complete() ? "歌曲已下载" : "歌曲已在下载队列中";
            } else {
              JSONObject source = api.resolve(Long.parseLong(key));
              if (NeteaseClient.isTrial(source))
                throw new IOException("当前仅提供试听，不能下载完整歌曲");
              Uri uri = Uri.parse(source.getString("url"));
              if ("http".equals(uri.getScheme())) uri = uri.buildUpon().scheme("https").build();
              if (!"https".equals(uri.getScheme())) throw new IOException("音源地址无效");
              enqueue(uri, Long.parseLong(key), name, source.optString("type", "mp3"));
              result = PlayerDownloadStatus.WAITING;
              message = "已加入系统下载队列";
            }
          } catch (Exception error) {
            message = "下载失败：" + error.getMessage();
          }
          PlayerDownloadStatus finished = result;
          String feedback = message;
          ui(
              () -> {
                playerDownloadRequests.remove(key);
                playerDownloadRevision++;
                playerDownloadStates.put(key, finished);
                playerDownloadChecked = 0;
                refreshPlayerActions();
                Toast.makeText(this, feedback, Toast.LENGTH_LONG).show();
              });
        });
  }

  private void refreshCompact() {
    if (compactPlayer == null || engine == null) return;
    int visibility = compactMode && engine.index >= 0 ? View.VISIBLE : View.GONE;
    if (compactPlayer.getVisibility() != visibility) {
      compactPlayer.setVisibility(visibility);
      floatingNavigation.requestLayout();
    }
    compactPlayer.state(compactCover, engine.playbackActive());
    String url = coverUrl(engine.current());
    if (!url.equals(compactArtKey)) {
      compactArtKey = url;
      compactCover = null;
      compactPlayer.state(null, engine.playbackActive());
      images.load(
          url,
          bitmap -> {
            if (!destroyed && compactArtKey.equals(url)) {
              compactCover = bitmap;
              compactPlayer.state(bitmap, engine != null && engine.playbackActive());
            }
          });
    }
  }

  private void enterCompact(android.graphics.Bitmap cover) {
    compactMode = true;
    compactCover = cover;
    compactArtKey = engine == null || cover == null ? "" : coverUrl(engine.current());
    if (compactPlayer == null) {
      compactPlayer =
          new CompactPlayerView(this, this::showStemControls, () -> playPause.performClick());
      compactPlayer.setExpansionDrag(
          new CompactPlayerView.ExpansionDrag() {
            public boolean begin(boolean horizontal) {
              showStemControls(true);
              if (spatial == null || !spatial.isShowing()) {
                return false;
              }
              spatial.beginCapsuleDrag(horizontal);
              return true;
            }

            public void update(float fraction) {
              if (spatial != null && spatial.isShowing()) spatial.dragFromCapsule(fraction);
            }

            public void end(float speed, boolean cancelled) {
              if (spatial != null && spatial.isShowing()) spatial.endCapsuleDrag(speed, cancelled);
            }
          });
      addContentView(compactPlayer, new android.view.ViewGroup.LayoutParams(-1, -1));
    }
    playerBar.setVisibility(View.GONE);
    refreshCompact();
    compactPlayer.setVisibility(View.VISIBLE);
    floatingNavigation.requestLayout();
  }

  private android.graphics.Bitmap albumBitmap;
  private String selectedMode, awaitingStem;
  private final Set<String> favoriteIds = new HashSet<>();
  private final Map<String, FavoriteWrite> favoriteWrites = new HashMap<>();
  private final Handler favoriteTimer = new Handler(Looper.getMainLooper());
  private final ExecutorService favoriteNetwork = Executors.newSingleThreadExecutor();
  private long favoriteRevision;

  private final class FavoriteWrite {
    final String id, cookie;
    final int epoch;
    final FavoriteToggle toggle;
    final JSONObject song;
    final Runnable send = () -> sendFavorite(this);

    FavoriteWrite(String id,JSONObject metadata,Boolean known) {
      this.id = id;
      song=metadata;
      cookie = api.cookie;
      epoch = accountEpoch;
      toggle = new FavoriteToggle(known!=null?known:favoriteIds.contains(id));
    }
  }

  private boolean isFavorite(String id) {
    FavoriteWrite pending = favoriteWrites.get(id);
    return pending != null && pending.epoch == accountEpoch
        ? pending.toggle.desired
        : favoriteIds.contains(id);
  }

  private void resetFavoriteRequests() {
    favoriteTimer.removeCallbacksAndMessages(null);
    favoriteWrites.clear();
    favoriteRevision++;
  }

  private void refreshFavorite(boolean animate) {
    if (engine != null && spatial != null)
      spatial.favorite(isFavorite(engine.current().optString("id")), animate);
  }

  private boolean favoritesLoading;
  private long favoritesOwner = -1;

  private void showStemControls() {
    showStemControls(false);
  }

  private void showStemControls(boolean interactive) {
    if (originalUri == null) {
      status.setText("请先播放歌曲");
      return;
    }
    if (spatial != null && spatial.isShowing()) return;
    JSONArray active = engine == null ? new JSONArray() : engine.queue;
    String[][] details = playerDetails(active);
    String artist = engine == null ? "" : artists(engine.current());
    String album = albumName(engine == null ? new JSONObject() : engine.current());
    spatial =
        new SpatialPlayer(
            this,
            originalLabel,
            artist,
            album,
            details[0],
            details[1],
            details[2],
            details[3],
            engine == null ? 0 : engine.index,
            new SpatialPlayer.Actions() {
              public void toggle() {
                playPause.performClick();
              }

              public void seek(int value) {
                if (engine != null) engine.seek((int) ((long) value * engine.duration() / 1000));
              }

              public void seekLyric(int millis, int duration) {
                if (engine != null) engine.seek(millis);
              }

              public int previewTrack(int direction) {
                return engine == null
                    ? -1
                    : playerDisplayIndex(engine.order.peek(engine.queue.length(), engine.index, direction));
              }

              public void faceChanged(boolean back) {
                getSharedPreferences("player-view", 0)
                    .edit()
                    .putBoolean("lyrics-back", back)
                    .apply();
              }

              public void showEffects() {
                showPlayerEffects();
              }

              public void requestLyrics() {
                loadPlayerLyrics();
              }

              public void previous() {
                queueStep(-1);
              }

              public void next() {
                queueStep(1);
              }

              public void queue(int index) {
                if(index>=0&&index<playerQueueOrder.length) playQueue(playerQueueOrder[index]);
              }

              public void removeQueue(int index){if(engine==null||index<0||index>=playerQueueOrder.length)return;engine.remove(playerQueueOrder[index]);updatePlayerTrack();}
              public void moveQueue(int from,int to){if(engine==null)return;engine.moveDisplayed(from,to);updatePlayerTrack();}

              public void split() {
                if (engine == null) return;
                if (stemRunning) {
                  awaitingStem = null;
                  engine.stems.cancelCurrent();
                } else prepareCurrentStems();
              }

              public void mode(String name) {
                selectedMode = name;
                if (name != null
                    && stemFiles == null
                    && (stemStream == null || !stemStream.available())) {
                  awaitingStem = name;
                  if (engine != null) engine.stems.requestCurrent(false);
                  refreshStemControls();
                  return;
                }
                awaitingStem = null;
                switchStem(name);
                refreshStemControls();
              }

              public void favorite(boolean value) {
                favoriteCurrent(value);
              }

              public void order(PlaybackOrder.Mode value) {
                if (engine != null) engine.setPlayerMode(value);
              }

              public void shuffle(boolean enabled) {
                if (engine != null) engine.setShuffle(enabled);
              }

              public void download() {
                downloadCurrentSong();
              }

              public void export() {
                if (stemFiles == null) {
                  status.setText("请先完成分轨");
                  return;
                }
                new DotoDesign.DialogBuilder(MusicActivity.this)
                    .setItems(
                        new String[] {"人声", "伴奏"},
                        (d, i) -> {
                          stemExport =
                              new File(stemFiles, i == 0 ? "vocals.wav" : "accompaniment.wav");
                          startActivityForResult(
                              new Intent(Intent.ACTION_CREATE_DOCUMENT)
                                  .setType("audio/wav")
                                  .putExtra(Intent.EXTRA_TITLE, stemExport.getName()),
                              11);
                        })
                    .show();
              }
            });
    spatial.restoreLyricsFace(
        getSharedPreferences("player-view", 0).getBoolean("lyrics-back", false));
    spatial.setOnCollapsed(this::enterCompact);
    spatial.setOnDismissListener(
        d -> {
          timer.removeCallbacks(playerActionTick);
          if (engine != null) {
            playerBar.setVisibility(engine.index < 0 || compactMode ? View.GONE : View.VISIBLE);
            refreshCompact();
          }
        });
    playerBar.setVisibility(View.GONE);
    if (interactive)
      spatial
          .getWindow()
          .addFlags(
              WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                  | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
    // Seed state before the opening transition captures the page.
    updatePlayerTrack();
    spatial.order(engine.order.mode, engine.order.isShuffled());
    spatial.playback(engine.position(), engine.duration(), engine.playbackActive());
    refreshStemControls();
    spatial.show();
    spatial.requestTrackLyrics();
    spatial.artwork(compactMode && compactCover != null ? compactCover : albumBitmap);
    if (compactMode && !interactive) spatial.expandFromCapsule();
    refreshStemControls();
    if (prepared) {
      timer.removeCallbacks(playbackTick);
      updatePlayback();
    }
    loadFavorites();
    spatial.favorite(engine != null && isFavorite(engine.current().optString("id")));
    timer.removeCallbacks(playerActionTick);
    timer.post(playerActionTick);
  }

  private String albumName(JSONObject song) {
    JSONObject album = song.optJSONObject("al");
    if (album == null) album = song.optJSONObject("album");
    return album == null ? "" : album.optString("name");
  }

  private String[][] playerDetails(JSONArray active) {
    String[][] details = new String[4][active.length()];
    for (int i = 0; i < active.length(); i++) {
      JSONObject song = active.optJSONObject(i);
      details[0][i] = song.optString("name");
      details[1][i] = coverUrl(song);
      details[2][i] = artists(song);
      details[3][i] = albumName(song);
    }
    return details;
  }

  private int[] playerQueueOrder = new int[0];
  private int playerDisplayIndex(int actual) {
    for(int i=0;i<playerQueueOrder.length;i++)if(playerQueueOrder[i]==actual)return i;
    return actual;
  }

  private void updatePlayerTrack() {
    if (engine == null || spatial == null) return;
    String[][] original = playerDetails(engine.queue);
    int[] order=engine.order.queueOrder(engine.queue.length(),engine.index);
    if(!java.util.Arrays.equals(order,playerQueueOrder)&&playerQueueOrder.length==order.length)
      spatial.queueReordered();
    playerQueueOrder=order;
    String[][] details=new String[4][order.length];
    for(int j=0;j<4;j++)for(int i=0;i<order.length;i++)details[j][i]=original[j][order[i]];
    spatial.track(
        engine.title,
        artists(engine.current()),
        albumName(engine.current()),
        details[0],
        details[1],
        details[2],
        details[3],
        playerDisplayIndex(engine.index));
  }

  private void loadFavorites() {
    if (userId == 0 || favoritesLoading || favoritesOwner == userId) return;
    favoritesLoading = true;
    long owner = userId;
    int epoch = accountEpoch;
    String cookie = api.cookie;
    long revision = favoriteRevision;
    homeData.submit(
        () -> {
          try {
            NeteaseClient client = new NeteaseClient();
            client.cookie = cookie;
            JSONArray ids = client.likedIds(owner);
            ui(
                () -> {
                  if (epoch != accountEpoch || revision != favoriteRevision) return;
                  favoriteIds.clear();
                  for (int i = 0; i < ids.length(); i++) favoriteIds.add(ids.optString(i));
                  favoritesOwner = owner;
                  if (engine != null && spatial != null)
                    spatial.favorite(isFavorite(engine.current().optString("id")));
                });
          } catch (Exception ignored) {
          } finally {
            ui(
                () -> {
                  favoritesLoading = false;
                  if (epoch == accountEpoch && revision != favoriteRevision) loadFavorites();
                });
          }
        });
  }

  private void favoriteCurrent(boolean value) {
    if(engine!=null)chooseFavorite(engine.current(),value,null);
  }
  private void chooseFavorites(JSONArray songs,boolean value,Boolean known){for(int i=0;i<songs.length();i++)chooseFavorite(songs.optJSONObject(i),value,known);}
  private void chooseFavorite(JSONObject song,boolean value,Boolean known) {
    if(song==null)return;
    if (userId == 0) {
      refreshFavorite(true);
      loginDialog();
      return;
    }
    long id = song.optLong("id");
    if (id <= 0) {
      refreshFavorite(true);
      Toast.makeText(this, "本地音频暂不支持网易云收藏", Toast.LENGTH_SHORT).show();
      return;
    }
    String key = Long.toString(id);
    FavoriteWrite pending = favoriteWrites.get(key);
    if (pending == null || pending.epoch != accountEpoch) {
      pending = new FavoriteWrite(key,song,known);
      favoriteWrites.put(key, pending);
    }
    pending.toggle.choose(value);
    favoriteRevision++;
    refreshFavorite(true);
    // Merge a burst of taps into its latest choice without delaying visual feedback.
    favoriteTimer.removeCallbacks(pending.send);
    favoriteTimer.postDelayed(pending.send, 200);
  }

  private void updateVisibleLikedSongs(JSONObject song,String id,boolean added){
    if(!"tracks".equals(browse)||!isLikedList(listInfo))return;
    JSONArray updated=new JSONArray();if(added&&song!=null)updated.put(song);
    for(int i=0;i<displayedSongs.length();i++){JSONObject item=displayedSongs.optJSONObject(i);if(item!=null&&!id.equals(item.optString("id")))updated.put(item);}
    int y=pageScroll.getScrollY();showSongs(updated);beforePageDraw(()->pageScroll.scrollTo(0,y));
  }

  private void sendFavorite(FavoriteWrite pending) {
    if (destroyed || pending.epoch != accountEpoch || favoriteWrites.get(pending.id) != pending)
      return;
    Boolean value = pending.toggle.begin();
    if (value == null) {
      if (!pending.toggle.inFlight) favoriteWrites.remove(pending.id);
      return;
    }
    favoriteNetwork.submit(
        () -> {
          if (destroyed || pending.epoch != accountEpoch) return;
          boolean success;
          String failureMessage = "";
          try {
            NeteaseClient client = new NeteaseClient();
            client.cookie = pending.cookie;
            client.setLike(Long.parseLong(pending.id), value);
            success = true;
          } catch (Exception error) {
            success = false;
            failureMessage =
                error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            android.util.Log.w(
                "VoloMusic",
                "Favorite sync failed: "
                    + error.getClass().getSimpleName()
                    + ": "
                    + failureMessage);
          }
          final boolean saved = success;
          final String reason = failureMessage;
          ui(
              () -> {
                if (pending.epoch != accountEpoch || favoriteWrites.get(pending.id) != pending)
                  return;
                boolean reverted = pending.toggle.complete(saved);
                favoriteRevision++;
                if (saved) {
                  if (pending.toggle.confirmed) favoriteIds.add(pending.id);
                  else favoriteIds.remove(pending.id);
                  likedSongsChanged(pending.song,pending.toggle.confirmed);
                  loadPersonal();
                  if(pending.toggle.desired==pending.toggle.confirmed)updateVisibleLikedSongs(pending.song,pending.id,pending.toggle.confirmed);
                }
                refreshFavorite(true);
                if (reverted) Toast.makeText(this, "收藏同步失败：" + reason, Toast.LENGTH_LONG).show();
                // An older acknowledgement cannot override a newer tap. Send only the remaining
                // intent.
                favoriteTimer.removeCallbacks(pending.send);
                if (pending.toggle.desired != pending.toggle.confirmed)
                  favoriteTimer.postDelayed(pending.send, 200);
                else favoriteWrites.remove(pending.id);
              });
        });
  }

  private void playQueue(int index) {
    if (engine == null || index < 0 || index >= engine.queue.length()) return;
    engine.select(index);
  }

  private void queueStep(int direction) {
    if (engine != null) engine.step(direction);
  }

  private void loadPlayerLyrics() {
    if (engine == null || spatial == null) return;
    final SpatialPlayer target = spatial;
    final String id = engine.current().optString("id");
    if (id.isEmpty()) {
      target.lyrics("暂无歌词");
      return;
    }
    target.lyrics("歌词加载中…");
    network.submit(
        () -> {
          String text;
          String translation = "";
          try {
            JSONObject response =
                api.request(
                    "/api/song/lyric", NeteaseClient.json("id", id, "lv", -1, "tv", -1), true);
            JSONObject translated = response.optJSONObject("tlyric");
            if (translated != null) translation = translated.optString("lyric", "");
            JSONObject lrc = response.optJSONObject("lrc");
            text = lrc == null ? "暂无歌词" : lrc.optString("lyric", "");
          } catch (Exception error) {
            text = "歌词加载失败，请翻回后重试";
          }
          final String result = text;
          final String translatedLyrics = translation;
          ui(
              () -> {
                if (spatial == target

                    && engine != null
                    && id.equals(engine.current().optString("id"))) target.lyrics(result, translatedLyrics);
              });
        });
  }

  private void loadCover() {
    if (engine == null) return;
    JSONObject song = engine.current(), album = song.optJSONObject("al");
    if (album == null) album = song.optJSONObject("album");
    String url = album == null ? "" : album.optString("picUrl");
    if (!url.startsWith("http")) return;
    int epoch=stemEpoch;
    images.load(url,640,bitmap->{if(epoch==stemEpoch){albumBitmap=bitmap;if(spatial!=null)spatial.artwork(bitmap);}});
  }

  private void refreshStemControls() {
    if (spatial != null)
      spatial.state(
          stemMessage,
          stemRunning,
          stemFiles != null || (stemStream != null && stemStream.available()),
          selectedMode,
          engine == null ? 0 : engine.stems.progress());
    if (stemStatus == null) return;
    stemStatus.setText(stemMessage);
    stemStart.setText(stemRunning ? "取消分轨" : stemFiles != null ? "重新分轨" : "开启人声 / 伴奏分离");
    stemVoice.setEnabled(stemFiles != null);
    stemMusic.setEnabled(stemFiles != null);
  }

  private void prepareCurrentStems() {
    if (engine != null) engine.stems.requestCurrent(true);
  }

  private void switchStem(String name) {
    if (engine == null || originalUri == null) return;
    if (name != null && stemFiles == null) {
      if (stemStream != null && stemStream.available()) engine.preview(stemStream, name);
      return;
    }
    engine.switchTrack(name == null ? originalUri : Uri.fromFile(new File(stemFiles, name)), name);
  }

  private void play(Uri uri, String label) {
    if (engine == null) {
      status.setText("播放器正在连接");
      return;
    }
    if (switchingStem) engine.playUri(uri, label, pendingSeek, pendingResume, true);
    else engine.local(uri, label);
  }

  private void stopPlayer() {
    if (engine != null) engine.pause();
  }

  private long enqueue(Uri uri,long songId,String name,String type) throws Exception {return enqueue(uri,songId,name,type,null);}
  private long enqueue(Uri uri, long songId, String name, String type,JSONObject supplied) throws Exception {
    String ext =
        type.toLowerCase(Locale.ROOT).matches("mp3|flac|m4a|aac|ogg|wav")
            ? type.toLowerCase(Locale.ROOT)
            : "mp3";
    String filename = songId + "-" + System.currentTimeMillis() + "." + ext;
    DownloadManager.Request request =
        new DownloadManager.Request(uri)
            .setTitle(name)
            .setDescription("Doto 音乐下载")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_MUSIC, filename);
    long id = downloads.enqueue(request);
    getSharedPreferences("downloads", 0).edit().putString(Long.toString(id), name).apply();
    JSONObject metadata=supplied;
    for(int i=0;metadata==null&&lastSongs!=null&&i<lastSongs.length();i++)if(lastSongs.optJSONObject(i).optLong("id")==songId){metadata=lastSongs.optJSONObject(i);break;}
    if(metadata==null&&engine!=null&&engine.current().optLong("id")==songId)metadata=engine.current();
    if(metadata!=null){getSharedPreferences("download-metadata",0).edit().putString(Long.toString(id),metadata.toString()).apply();
      String artwork=coverUrl(metadata);network.submit(()->{try{ArtworkLoader.saveCover(artwork);}catch(Exception error){android.util.Log.w("DotoArtwork","Cover download failed",error);}});
    }

    getSharedPreferences("download-song-ids", 0)
        .edit()
        .putString(Long.toString(id), Long.toString(songId))
        .apply();
    return id;
  }

  private void showDownloads() {
    selectPage(2);
    renderDownloads();
  }

  private boolean repairingDownloadCovers,downloadCoverRepairAttempted;
  private void repairDownloadCovers(){
    if(repairingDownloadCovers||downloadCoverRepairAttempted)return;
    java.util.Map<String,?> ids=getSharedPreferences("download-song-ids",0).getAll();
    java.util.LinkedHashMap<String,Long> missing=new java.util.LinkedHashMap<>();
    for(var entry:ids.entrySet())try{JSONObject data=new JSONObject(getSharedPreferences("download-metadata",0).getString(entry.getKey(),"{}"));if(coverUrl(data).isEmpty())missing.put(entry.getKey(),Long.parseLong(entry.getValue().toString()));}catch(Exception ignored){}
    if(missing.isEmpty())return;downloadCoverRepairAttempted=true;repairingDownloadCovers=true;final String cookie=api.cookie;
    playlistReader.submit(()->{boolean updated=false;try{NeteaseClient client=new NeteaseClient();client.cookie=cookie;JSONArray batch=new JSONArray();java.util.ArrayList<Long> unique=new java.util.ArrayList<>(new java.util.LinkedHashSet<>(missing.values()));
      for(int start=0;start<unique.size();start+=500){batch=new JSONArray();for(int i=start;i<Math.min(start+500,unique.size());i++)batch.put(NeteaseClient.json("id",unique.get(i)));JSONArray songs=client.request("/api/v3/song/detail",NeteaseClient.json("c",batch.toString()),true).getJSONArray("songs");
        for(int i=0;i<songs.length();i++){JSONObject song=songs.getJSONObject(i);for(var entry:missing.entrySet())if(entry.getValue()==song.optLong("id")){getSharedPreferences("download-metadata",0).edit().putString(entry.getKey(),song.toString()).apply();updated=true;}try{ArtworkLoader.saveCover(coverUrl(song));}catch(Exception ignored){}}
      }
    }catch(Exception error){android.util.Log.w("DotoArtwork","Download metadata repair failed",error);}finally{boolean refresh=updated;ui(()->{repairingDownloadCovers=false;if(refresh&&page==2)renderDownloads();});}});
  }
  private void renderDownloads() {
    repairDownloadCovers();
    content.removeAllViews();JSONArray songs=new JSONArray();java.util.ArrayList<String> pending=new java.util.ArrayList<>();
    for(var entry:getSharedPreferences("downloads",0).getAll().entrySet())try{
      long id=Long.parseLong(entry.getKey());
      try(Cursor cursor=downloads.query(new DownloadManager.Query().setFilterById(id))){
        if(cursor==null||!cursor.moveToFirst())continue;
        int state=cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
        if(state!=DownloadManager.STATUS_SUCCESSFUL){pending.add(entry.getValue()+" · "+(state==DownloadManager.STATUS_FAILED?"下载失败":"下载中"));continue;}
        Uri uri=downloads.getUriForDownloadedFile(id);if(uri==null)continue;
        long cloudId=Long.parseLong(getSharedPreferences("download-song-ids",0).getString(entry.getKey(),"0"));
        JSONObject song=new JSONObject(getSharedPreferences("download-metadata",0).getString(entry.getKey(),"{}"));
        song.put("id",cloudId>0?Long.toString(cloudId):"download:"+id).put("name",entry.getValue().toString()).put("uri",uri.toString()).put("downloadId",id);songs.put(song);
      }
    }catch(Exception ignored){}
    songListPanel=new SongListPanel(this,"已下载音乐",new JSONObject(),songs,images,downloadedSongIds(),completedStemIds(),new SongListPanel.Actions(){
      public void play(int index,boolean shuffle){if(engine!=null){if(shuffle)engine.setShuffle(true);engine.startQueue(songs,index);}}
      public void next(int index){if(engine!=null)engine.enqueue(songs.optJSONObject(index),true);}
      public void append(int index){if(engine!=null)engine.enqueue(songs.optJSONObject(index),false);}
      public void download(int[] indices){}
      public void player(int index){play(index,false);showStemControls();}
    });
    content.addView(songListPanel,new LinearLayout.LayoutParams(-1,-2));
    if(engine!=null)songListPanel.updateCurrent(engine.current().optString("id"),engine.playbackActive());
    for(String line:pending)content.addView(text(line,13));
    timer.removeCallbacks(refreshDownloads);if(!pending.isEmpty())timer.postDelayed(refreshDownloads,1500);
  }

  private void playDownloads(long selected) {
    if (engine == null) return;
    JSONArray items = new JSONArray();
    int start = 0;
    for (var entry : getSharedPreferences("downloads", 0).getAll().entrySet()) {
      try {
        long id = Long.parseLong(entry.getKey());
        try (Cursor c = downloads.query(new DownloadManager.Query().setFilterById(id))) {
          if (c == null
              || !c.moveToFirst()
              || c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                  != DownloadManager.STATUS_SUCCESSFUL) continue;
          Uri uri = downloads.getUriForDownloadedFile(id);
          if (uri == null) continue;
          if (id == selected) start = items.length();
          items.put(
              new JSONObject()
                  .put("id", "download:" + id)
                  .put("uri", uri.toString())
                  .put("name", entry.getValue().toString()));
        }
      } catch (Exception ignored) {
      }
    }
    if (items.length() > 0) engine.startQueue(items, start);
  }

  private String extension(long id) {
    try (Cursor c = downloads.query(new DownloadManager.Query().setFilterById(id))) {
      if (c != null && c.moveToFirst()) {
        String file = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI));
        if (file != null && file.lastIndexOf('.') >= 0)
          return file.substring(file.lastIndexOf('.'));
      }
    }
    return ".mp3";
  }

  private long exportId;
  private String exportName;

  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (result != RESULT_OK || data == null) return;
    if (request == PICK_PROFILE_IMAGE || request == PICK_PROFILE_VIDEO || request == PICK_PROFILE_AVATAR) {
      Uri uri = data.getData();
      if (uri == null) return;
      try {
        getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if (request == PICK_PROFILE_AVATAR) setProfileAvatar(uri);
        else setProfileBackground(uri, request == PICK_PROFILE_VIDEO);
      } catch (SecurityException e) {
        Toast.makeText(this, "\u65e0\u6cd5\u4fdd\u5b58\u6b64\u6587\u4ef6\u7684\u8bfb\u53d6\u6743\u9650", Toast.LENGTH_SHORT).show();
      }
      return;
    }
    if(request==12){addLocalSongs(data);return;}
    if (request == 11) {
      File file = stemExport;
      Uri target = data.getData();
      task(
          "导出音轨…",
          () -> {
            try (InputStream in = new FileInputStream(file);
                OutputStream out = getContentResolver().openOutputStream(target)) {
              in.transferTo(out);
            }
            return "音轨已导出";
          });
      return;
    }
    if (request != 10) return;
    Uri target = data.getData(), source = downloads.getUriForDownloadedFile(exportId);
    task(
        "导出中…",
        () -> {
          try (InputStream in = getContentResolver().openInputStream(source);
              OutputStream out = getContentResolver().openOutputStream(target)) {
            in.transferTo(out);
          }
          return "已导出 " + exportName;
        });
  }

  private final Runnable refreshDownloads =
      () -> {
        if (page == 2 && !destroyed) renderDownloads();
      };

  private void verifyDownload(long id) throws Exception {
    long deadline = SystemClock.elapsedRealtime() + 60000;
    while (SystemClock.elapsedRealtime() < deadline) {
      try (Cursor c = downloads.query(new DownloadManager.Query().setFilterById(id))) {
        if (c != null && c.moveToFirst()) {
          int state = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
          if (state == DownloadManager.STATUS_FAILED)
            throw new IOException(
                "系统下载失败 " + c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)));
          if (state == DownloadManager.STATUS_SUCCESSFUL) {
            Uri uri = downloads.getUriForDownloadedFile(id);
            android.media.MediaExtractor extractor = new android.media.MediaExtractor();
            try {
              extractor.setDataSource(this, uri, null);
              if (extractor.getTrackCount() == 0) throw new IOException("下载结果没有音轨");
            } finally {
              extractor.release();
            }
            android.util.Log.i(
                "VoloSmoke",
                "系统下载及音频解析通过，bytes="
                    + c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)));
            return;
          }
        }
      }
      Thread.sleep(500);
    }
    throw new IOException("系统下载仍在进行，请在下载页查看");
  }

  private void smoke() {
    task(
        "接口自检…",
        () -> {
          JSONArray songs = api.search("义勇军进行曲").getJSONObject("result").getJSONArray("songs");
          JSONObject profile = api.profile();
          JSONObject sample = songs.getJSONObject(0);
          JSONObject source = api.resolve(sample.getLong("id"));
          if (getIntent().getBooleanExtra("smokeDownload", false)) {
            if (NeteaseClient.isTrial(source))
              throw new IOException("测试曲目为试听，跳过下载");
            Uri testUri = Uri.parse(source.getString("url")).buildUpon().scheme("https").build();
            long downloadId =
                enqueue(
                    testUri, sample.getLong("id"), "Doto 下载链路测试", source.optString("type", "mp3"));
            verifyDownload(downloadId);
          }
          String result = "搜索 " + songs.length() + " 首，音源=" + (!source.optString("url").isEmpty());
          android.util.Log.i("VoloSmoke", result);
          showSongs(songs);
          return result;
        });
  }

  @Override protected void onSaveInstanceState(Bundle state) {
    super.onSaveInstanceState(state);
    saveRootScroll();
    state.putInt("main-tab", mainTab);
    state.putInt("page", page);
    state.putString("browse", browse);
    state.putInt("discover-scroll", discoverScroll);
    state.putInt("personal-scroll", personalScroll);
    state.putInt("page-scroll", pageScroll.getScrollY());
    state.putBoolean("full-player", spatial != null && spatial.isShowing());
  }

  private void restorePage(Bundle state) {
    if (state == null) {
      showHome();
      return;
    }
    discoverScroll = state.getInt("discover-scroll");
    personalScroll = state.getInt("personal-scroll");
    restoreFullPlayer = state.getBoolean("full-player");
    int savedPage = state.getInt("page");
    if (savedPage == 2) showDownloads();
    else if (savedPage == 4) showLocalMusic();
    else if ("stems".equals(state.getString("browse"))) showStemLibrary();
    else if (state.getInt("main-tab") == 1) showAccount();
    else showHome();
    if (page == savedPage && (page == 2 || page == 4 || "stems".equals(browse)))
      beforePageDraw(() -> pageScroll.scrollTo(0, state.getInt("page-scroll")));
  }

  protected void onPause() {
    super.onPause();
    if (profileVideo != null) profileVideo.setActive(false);
    foreground = false;
    timer.removeCallbacks(playbackTick);
    timer.removeCallbacks(refreshDownloads);
    timer.removeCallbacks(playerActionTick);
    if (engine != null) engine.persist();
  }

  private void hideHomeStatusBar() {
    WindowInsetsController controller = getWindow().getDecorView().getWindowInsetsController();
    if (controller != null) {
      controller.setSystemBarsBehavior(
          WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
      controller.hide(WindowInsets.Type.statusBars());
    }
  }

  public void onWindowFocusChanged(boolean focused) {
    super.onWindowFocusChanged(focused);
    if (focused) hideHomeStatusBar();
  }

  private void refreshChromeColors(View view){
    if(view instanceof TextView text){int color=text.getCurrentTextColor();if(color==0xff202020||color==0xfffafafa)text.setTextColor(DotoDesign.INK);else if(color==0xff646464||color==0xffa0a0a0)text.setTextColor(DotoDesign.MUTED);}
    if(view instanceof GlassUi.Symbol symbol && !symbol.bare){symbol.color=DotoDesign.INK;symbol.invalidate();}
    if(view instanceof ViewGroup group)for(int i=0;i<group.getChildCount();i++)refreshChromeColors(group.getChildAt(i));
    view.invalidate();
  }

  private final android.content.BroadcastReceiver appearanceReceiver=new android.content.BroadcastReceiver(){
    public void onReceive(Context context,Intent intent){if(!destroyed)applyAppearanceChange();}
  };

  private void applyAppearanceChange(){
    if(appearanceRevision!=DotoAppearance.revision(this)){
      int y=pageScroll.getScrollY();
      DotoAppearance.load(this);appearanceRevision=DotoAppearance.revision(this);
      ViewGroup host=findViewById(android.R.id.content);
      if (host.getChildAt(0) instanceof WallpaperLayout wallpaper) wallpaper.refresh();
      refreshChromeColors(host);
      personalRenderKey=null;
      if("home".equals(browse))renderDiscovery();
      else if("personal".equals(browse))renderPersonal();
      else if(page==2)renderDownloads();
      else if("tracks".equals(browse)||"search".equals(browse))showSongs(displayedSongs);
      beforePageDraw(()->pageScroll.scrollTo(0,y));
      host.invalidate();
    }
  }

  private boolean awaitingDesktopLyricsPermission;

  private void showPlayerEffects() {
    if (spatial == null || !spatial.isShowing() || isFinishing()) return;
    PlayerEffectsSheet sheet = new PlayerEffectsSheet(spatial);
    LinearLayout panel = MobileUi.column(this);
    int padding = MobileUi.dp(this, 20);
    panel.setPadding(padding, padding, padding, padding);
    TextView heading = GlassUi.label(this, "播放效果", 20, true);
    panel.addView(heading);
    SettingsActivity.addToggle(panel, "桌面歌词", DesktopLyrics.enabled(this), checked -> {
      if (checked && !android.provider.Settings.canDrawOverlays(this)) {
        sheet.dismiss();
        try {
          awaitingDesktopLyricsPermission = true;
          startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
              Uri.parse("package:" + getPackageName())));
        } catch (android.content.ActivityNotFoundException error) {
          awaitingDesktopLyricsPermission = false;
          Toast.makeText(this, "无法打开悬浮窗权限设置", Toast.LENGTH_SHORT).show();
        }
        return;
      }
      DesktopLyrics.setEnabled(this, checked);
      if (engine != null) engine.refreshDesktopLyrics();
    });
    android.content.SharedPreferences prefs = DesktopLyrics.preferences(this);
    TextView style = GlassUi.label(this, "设置歌词样式", 14, true);
    style.setPadding(0, MobileUi.dp(this, 10), 0, MobileUi.dp(this, 4));
    TextView preview = GlassUi.label(this, "歌词预览", 18, false);
    preview.setGravity(Gravity.CENTER);
    preview.setPadding(0, padding, 0, padding);
    Runnable updatePreview = () -> {
      DesktopLyrics.applyStyle(preview, prefs);
      preview.setAlpha(DesktopLyrics.opacity(this, prefs.getBoolean(DesktopLyrics.LOCKED, false)));
    };
    SettingsActivity.addToggle(panel, "锁定桌面歌词位置",
        prefs.getBoolean(DesktopLyrics.LOCKED, false), locked -> {
          prefs.edit().putBoolean(DesktopLyrics.LOCKED, locked).apply();
          updatePreview.run();
        });
    panel.addView(style);
    updatePreview.run();
    panel.addView(preview, new LinearLayout.LayoutParams(-1, -2));

    addLyricChoice(sheet, panel, "字体", DesktopLyrics.FONT, DesktopLyrics.FONT_NAMES,
        new int[]{0, 1, 2, 3, 4, 5}, 0, updatePreview);
    addLyricChoice(sheet, panel, "字重", DesktopLyrics.WEIGHT,
        new String[]{"常规", "半粗", "粗体"}, new int[]{400, 600, 700}, 400, updatePreview);
    addLyricChoice(sheet, panel, "字号", DesktopLyrics.SIZE,
        new String[]{"14 sp", "16 sp", "18 sp", "22 sp", "26 sp", "32 sp"},
        new int[]{14, 16, 18, 22, 26, 32}, 18, updatePreview);
    addLyricChoice(sheet, panel, "字色", DesktopLyrics.COLOR,
        new String[]{"白色", "黑色", "浅黄", "浅蓝", "浅粉", "浅绿"},
        new int[]{0xffffffff, 0xff161616, 0xffffe58a, 0xffa8ddff, 0xffffb4cf, 0xffb8edbd},
        0xffffffff, updatePreview);

    ScrollView scroll = new ScrollView(this);
    scroll.setClickable(true);
    scroll.setVerticalScrollBarEnabled(false);
    float radius = MobileUi.dp(this, 26);
    DotoDesign.shapedGlass(scroll, spatial.effectsBackdrop(), (path, bounds) ->
        path.addRoundRect(bounds, new float[]{radius, radius, radius, radius, 0, 0, 0, 0},
            android.graphics.Path.Direction.CW), true, false);
    scroll.setOnApplyWindowInsetsListener((view, insets) -> {
      var safe = insets.getInsetsIgnoringVisibility(
          WindowInsets.Type.navigationBars() | WindowInsets.Type.displayCutout());
      view.setPadding(safe.left, 0, safe.right, safe.bottom);
      return insets;
    });
    scroll.addView(panel);
    sheet.show(scroll);
  }

  private final class PlayerEffectsSheet extends FrameLayout {
    private final SpatialPlayer player;
    private Runnable backAction = this::dismiss;
    private final android.window.OnBackInvokedCallback back = () -> backAction.run();
    private int previousAccessibility;

    PlayerEffectsSheet(SpatialPlayer player) {
      super(MusicActivity.this);
      this.player = player;
      setBackgroundColor(0x61000000);
      setOnClickListener(view -> dismiss());
    }

    void show(ScrollView body) {
      addView(body, new FrameLayout.LayoutParams(-1, 0, Gravity.BOTTOM));
      player.addContentView(this, new ViewGroup.LayoutParams(-1, -1));
      requestApplyInsets();
    }

    @Override protected void onMeasure(int widthSpec, int heightSpec) {
      View body = getChildAt(0);
      body.getLayoutParams().height = Math.min(MobileUi.dp(MusicActivity.this, 480),
          (int) (MeasureSpec.getSize(heightSpec) * .84f));
      super.onMeasure(widthSpec, heightSpec);
    }

    @Override protected void onAttachedToWindow() {
      super.onAttachedToWindow();
      View backdrop = player.effectsBackdrop();
      previousAccessibility = backdrop.getImportantForAccessibility();
      backdrop.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
      player.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
          android.window.OnBackInvokedDispatcher.PRIORITY_OVERLAY, back);
    }

    @Override protected void onDetachedFromWindow() {
      player.getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(back);
      player.effectsBackdrop().setImportantForAccessibility(previousAccessibility);
      super.onDetachedFromWindow();
    }

    void dismiss() {
      if (getParent() instanceof ViewGroup parent) parent.removeView(this);
    }
  }

  private void addLyricChoice(PlayerEffectsSheet sheet, LinearLayout panel, String title,
      String key, String[] labels, int[] values, int fallback, Runnable updatePreview) {
    android.content.SharedPreferences prefs = DesktopLyrics.preferences(this);
    LinearLayout row = new LinearLayout(this);
    row.setGravity(Gravity.CENTER_VERTICAL);
    TextView label = GlassUi.label(this, title, 15, false);
    row.addView(label, new LinearLayout.LayoutParams(0, -2, 1));
    TextView value = GlassUi.label(this, "", 14, false);
    value.setTextColor(DotoDesign.MUTED);
    row.addView(value);
    ImageView arrow = new ImageView(this);
    arrow.setImageDrawable(new DotoIcon("next", DotoDesign.MUTED));
    LinearLayout.LayoutParams arrowParams = new LinearLayout.LayoutParams(
        MobileUi.dp(this, 16), MobileUi.dp(this, 16));
    arrowParams.setMarginStart(MobileUi.dp(this, 8));
    row.addView(arrow, arrowParams);
    java.util.function.IntSupplier selected = () -> {
      int saved = prefs.getInt(key, fallback);
      for (int i = 0; i < values.length; i++) if (saved == values[i]) return i;
      return 0;
    };
    value.setText(labels[selected.getAsInt()]);
    GlassUi.touch(row, () -> {
      if (!sheet.isAttachedToWindow()) return;
      showLyricChoices(sheet, panel, title, key, labels, values, selected.getAsInt(), index -> {
        prefs.edit().putInt(key, values[index]).apply();
        value.setText(labels[index]);
        updatePreview.run();
      });
    });
    panel.addView(row, new LinearLayout.LayoutParams(-1, MobileUi.dp(this, 48)));
    View divider = new View(this);
    divider.setBackgroundColor(DotoDesign.LINE);
    panel.addView(divider, new LinearLayout.LayoutParams(-1, 1));
  }

  private void showLyricChoices(PlayerEffectsSheet sheet, LinearLayout effects, String title,
      String key, String[] labels, int[] values, int selected, java.util.function.IntConsumer choose) {
    ScrollView scroll = (ScrollView) effects.getParent();
    LinearLayout choices = MobileUi.column(this);
    int padding = MobileUi.dp(this, 20);
    choices.setPadding(padding, padding, padding, padding);

    Runnable returnToEffects = () -> {
      sheet.backAction = sheet::dismiss;
      scroll.removeView(choices);
      scroll.addView(effects);
      scroll.scrollTo(0, 0);
    };
    sheet.backAction = returnToEffects;

    LinearLayout header = new LinearLayout(this);
    header.setGravity(Gravity.CENTER_VERTICAL);
    GlassUi.Symbol returnButton = new GlassUi.Symbol(this, "close", "返回播放效果", returnToEffects);
    header.addView(returnButton, new LinearLayout.LayoutParams(MobileUi.dp(this, 44), MobileUi.dp(this, 44)));
    header.addView(GlassUi.label(this, "选择" + title, 20, true));
    choices.addView(header);

    for (int index = 0; index < labels.length; index++) {
      int option = index;
      LinearLayout row = new LinearLayout(this);
      row.setGravity(Gravity.CENTER_VERTICAL);
      row.setMinimumHeight(MobileUi.dp(this, 76));
      LinearLayout words = MobileUi.column(this);
      TextView name = GlassUi.label(this, labels[index], 14, true);
      words.addView(name);
      TextView sample = GlassUi.label(this, "歌词随音乐流动", 20, false);
      switch (key) {
        case DesktopLyrics.FONT -> sample.setTypeface(DesktopLyrics.fontFace(this, values[index]));
        case DesktopLyrics.WEIGHT -> sample.setTypeface(android.graphics.Typeface.create(
            android.graphics.Typeface.DEFAULT, values[index], false));
        case DesktopLyrics.SIZE -> sample.setTextSize(values[index]);
        case DesktopLyrics.COLOR -> {
          sample.setTextColor(values[index]);
          sample.setShadowLayer(MobileUi.dp(this, 2), 0, MobileUi.dp(this, 1),
              DotoAppearance.light ? 0xff666666 : 0xffaaaaaa);
        }
      }
      words.addView(sample);
      row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
      if (index == selected) {
        TextView check = GlassUi.label(this, "✓", 20, true);
        check.setTextColor(DotoAppearance.accent);
        row.addView(check);
        row.setSelected(true);
      }
      row.setContentDescription(labels[index] + (index == selected ? "，已选" : ""));
      GlassUi.touch(row, () -> {
        choose.accept(option);
        returnToEffects.run();
      });
      choices.addView(row, new LinearLayout.LayoutParams(-1, -2));
      View divider = new View(this);
      divider.setBackgroundColor(DotoDesign.LINE);
      choices.addView(divider, new LinearLayout.LayoutParams(-1, 1));
    }
    scroll.removeView(effects);
    scroll.addView(choices);
    scroll.scrollTo(0, 0);
  }

  protected void onResume() {
    super.onResume();
    if (awaitingDesktopLyricsPermission) {
      awaitingDesktopLyricsPermission = false;
      DesktopLyrics.setEnabled(this, android.provider.Settings.canDrawOverlays(this));
    }
    if (engine != null) engine.refreshDesktopLyrics();
    if (profileVideo != null && page == 3) profileVideo.setActive(true);
    applyAppearanceChange();
    hideHomeStatusBar();
    foreground = true;
    if (engine != null) syncPlayback(false);
    if (page == 2) renderDownloads();
    if (spatial != null && spatial.isShowing()) {
      timer.removeCallbacks(playerActionTick);
      timer.post(playerActionTick);
    }
  }

  protected void onDestroy() {
    clearTabMotion();
    if (spatial != null) spatial.dismiss();
    destroyed = true;
    if(pageBackRegistered){getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(pageBackCallback);pageBackRegistered=false;}
    unregisterReceiver(appearanceReceiver);
    if(searchExpansion!=null)searchExpansion.cancel();
    stemEpoch++;
    qrGeneration++;
    timer.removeCallbacksAndMessages(null);
    if (engine != null) {
      engine.persist();
      if (!isChangingConfigurations()) engine.observer = null;
    }
    if (bound) unbindService(connection);
    resetFavoriteRequests();
    favoriteNetwork.shutdownNow();
    network.shutdownNow();
    searchNetwork.shutdownNow();
    playlistReader.shutdownNow();
    homeData.shutdownNow();
    images.close();
    super.onDestroy();
  }
}


