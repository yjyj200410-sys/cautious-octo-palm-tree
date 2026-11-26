package com.volo.mobile;

import android.app.*;
import android.content.*;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.*;
import android.media.session.*;
import android.net.Uri;
import android.os.*;
import java.util.concurrent.*;
import org.json.*;

/** Playback survives screens; browsing never mutates the active queue. */
public final class PlaybackService extends Service {
  final class LocalBinder extends Binder {
    PlaybackService get() {
      return PlaybackService.this;
    }
  }

  interface Observer {
    void changed(boolean trackChanged);
  }

  Observer observer;
  MediaPlayer player;
  boolean prepared, loading;
  JSONArray queue = new JSONArray();
  int index = -1;
  Uri originalUri;
  String title = "", error = "", mode;
  private MediaSession session;
  private AudioManager audio;
  private AudioFocusRequest focus;
  private boolean resumeOnFocus;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ExecutorService io = Executors.newFixedThreadPool(2);
  private final ExecutorService metadataIo = Executors.newFixedThreadPool(2);
  private String systemTrack = "";
  private int systemTrackGeneration;
  private Bitmap systemArtwork;
  private String systemLyrics = "";
  private final java.util.TreeMap<Integer, String> desktopLines = new java.util.TreeMap<>();
  private final java.util.Map<Integer, String> desktopTranslations = new java.util.HashMap<>();
  private DesktopLyrics desktopLyrics;
  private final Runnable desktopLyricTick = this::refreshDesktopLyrics;

  void refreshDesktopLyrics() {
    main.removeCallbacks(desktopLyricTick);
    long delay = ((DotoApp) getApplication()).lyricsDelay();
    if (!DesktopLyrics.enabled(this) || desktopLines.isEmpty() || !wantPlay || !playing() || delay != 0) {
      desktopLyrics.hide();
      if (delay > 0 && wantPlay && DesktopLyrics.enabled(this) && playing())
        main.postDelayed(desktopLyricTick, delay);
      return;
    }
    var line = desktopLines.floorEntry(position());
    desktopLyrics.show(line == null ? "" : line.getValue(),
        line == null ? null : desktopTranslations.get(line.getKey()));
    main.postDelayed(desktopLyricTick, 150);
  }
  private static final java.util.regex.Pattern LRC_TIMECODE =
      java.util.regex.Pattern.compile("\\[\\d{1,3}:\\d{2}(?:[.:]\\d{1,3})?\\]");
  private volatile int generation;
  private boolean wantPlay, completed;
  private boolean personalRadio, radioLoading, radioWaiting;
  private int radioGeneration;
  private volatile boolean destroyed;
  private int targetPosition, lastPosition, retryCount;
  private Uri activeUri;
  private StemStream preview;
  private LiveStemPlayer livePlayer;
  private PowerManager.WakeLock liveWake;
  final PlaybackOrder order = new PlaybackOrder();
  private Future<?> pendingRequest;
  private Runnable prepareDeadline;
  private StemHandoff handoff;
  private int timelineDuration, positionBias;
  private float outputGain = 1;
  private int liveGeneration;
  StemPreloader stems;

  private final Runnable checkpoint =
      new Runnable() {
        public void run() {
          lastPosition = position();
          persist();
          main.postDelayed(this, 5000);
        }
      };
  private final BroadcastReceiver noisy =
      new BroadcastReceiver() {
        public void onReceive(Context c, Intent i) {
          pause();
        }
      };

  public IBinder onBind(Intent i) {
    return new LocalBinder();
  }

  public void onCreate() {
    super.onCreate();
    desktopLyrics = new DesktopLyrics(this);
    ((DotoApp) getApplication()).visibilityChanged = this::refreshDesktopLyrics;
    getSharedPreferences("playback-settings", 0)
        .registerOnSharedPreferenceChangeListener(playbackSettingsListener);
    stems = new StemPreloader(this);
    audio = (AudioManager) getSystemService(AUDIO_SERVICE);
    liveWake =
        ((PowerManager) getSystemService(POWER_SERVICE))
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Doto:live-stems");
    liveWake.setReferenceCounted(false);
    focus =
        new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build())
            .setOnAudioFocusChangeListener(
                change -> {
                  if (mixAudio(this)) return;
                  android.util.Log.i("VoloAudioFocus", "focus=" + change + " playing=" + playing());
                  if (change == AudioManager.AUDIOFOCUS_GAIN) {
                    outputGain = 1;
                    applyOutputVolume();
                    if (resumeOnFocus) {
                      resumeOnFocus = false;
                      resume();
                    }
                  } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                    outputGain = .2f;
                    applyOutputVolume();
                  } else {
                    boolean resumeLater =
                        wantPlay && change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT;
                    pause();
                    resumeOnFocus = resumeLater;
                  }
                })
            .build();
    registerReceiver(
        noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), RECEIVER_NOT_EXPORTED);
    session = new MediaSession(this, "Doto");
    session.setCallback(
        new MediaSession.Callback() {
          public void onPlay() {
            play();
          }

          public void onPause() {
            pause();
          }

          public void onSkipToNext() {
            step(1);
          }

          public void onSkipToPrevious() {
            step(-1);
          }

          public void onSeekTo(long p) {
            seek((int) Math.max(0, Math.min(Integer.MAX_VALUE, p)));
          }

          public void onStop() {
            stop();
          }

          public void onSkipToQueueItem(long id) {
            select((int) id);
          }

          public void onCustomAction(String action, Bundle extras) {
            if ("repeat".equals(action))
              setMode(PlaybackOrder.Mode.values()[(order.mode.ordinal() + 1) % 3]);
            else if ("shuffle".equals(action)) setShuffle(!order.isShuffled());
          }
        });
    session.setActive(false);
    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    nm.createNotificationChannel(
        new NotificationChannel("playback", "音乐播放", NotificationManager.IMPORTANCE_LOW));
    android.content.SharedPreferences saved = getSharedPreferences("playback", 0);
    try {
      queue = new JSONArray(saved.getString("queue", "[]"));
      index = saved.getInt("index", -1);
      try {
        order.restore(
            PlaybackOrder.Mode.valueOf(saved.getString("order", "LIST_LOOP")),
            saved.getBoolean("shuffle", false));
      } catch (IllegalArgumentException ignored) {
      }
      title = saved.getString("title", "");
      int position = saved.getInt("position", 0);
      String selected = saved.getString("mode", "");
      String trackUri = saved.getString("activeUri", ""), original = saved.getString("uri", "");
      if (index >= 0 && index < queue.length()) {
        if (!selected.isEmpty()
            && !trackUri.isEmpty()
            && new java.io.File(Uri.parse(trackUri).getPath()).isFile()) {
          mode = selected;
          originalUri = Uri.parse(original);
          playUri(Uri.parse(trackUri), title, position, false, true);
        } else resolveCurrent(position, false);
      }
    } catch (Exception ignored) {
      queue = new JSONArray();
      index = -1;
    }
    main.postDelayed(checkpoint, 5000);
  }

  public int onStartCommand(Intent i, int flags, int id) {
    if (i != null) {
      String action = i.getAction();
      if ("toggle".equals(action)) toggle();
      else if ("next".equals(action)) step(1);
      else if ("previous".equals(action)) step(-1);
      else if ("activate".equals(action)) publish();
    }
    return START_NOT_STICKY;
  }

  JSONObject current() {
    JSONObject item = index >= 0 && index < queue.length() ? queue.optJSONObject(index) : null;
    return item == null ? new JSONObject() : item;
  }

  JSONObject nextForStemPreload() {
    int next = order.peekAutomatic(queue.length(), index);
    return next < 0 || next == index ? null : queue.optJSONObject(next);
  }

  void stemsChanged() { notifyObserver(false); }

  void startQueue(JSONArray items, int start) {
    if (items == null || items.length() == 0 || start < 0 || start >= items.length()) return;
    try {
      JSONArray copy = new JSONArray(items.toString());
      for (int i = 0; i < copy.length(); i++) if (copy.optJSONObject(i) == null) return;
      cancelRadio();
      queue = copy;
      index = start;
      order.reset();
      retryCount = 0;
      resolveCurrent();
    } catch (JSONException ignored) {
    }
  }

  void cancelRadio() {
    radioGeneration++;
    personalRadio = radioLoading = radioWaiting = false;
  }

  void startPersonalRadio() {
    if (!radioLoading) loadRadioBatch(true);
  }

  private void loadRadioBatch(boolean first) {
    if (radioLoading) return;
    radioLoading = true;
    int request = ++radioGeneration;
    io.submit(() -> {
      JSONArray batch = new JSONArray();
      try {
        NeteaseClient api = new NeteaseClient();
        api.cookie = new SessionStore(this).load();
        if (api.cookie != null && !api.cookie.isBlank()) batch = api.personalRadio();
      } catch (Exception ignored) {
      }
      JSONArray result = batch;
      main.post(() -> {
        if (destroyed || request != radioGeneration) return;
        radioLoading = false;
        JSONArray fresh = new JSONArray();
        java.util.HashSet<Long> ids = new java.util.HashSet<>();
        if (!first) for (int i = 0; i < queue.length(); i++) {
          JSONObject item = queue.optJSONObject(i);
          if (item != null) ids.add(item.optLong("id"));
        }
        for (int i = 0; i < result.length() && fresh.length() < 3; i++) {
          JSONObject item = result.optJSONObject(i);
          if (item != null && item.optLong("id") > 0 && ids.add(item.optLong("id"))) fresh.put(item);
        }
        if (fresh.length() == 0) {
          if (first) android.widget.Toast.makeText(this, "私人漫游加载失败，请重试", android.widget.Toast.LENGTH_SHORT).show();
          if (radioWaiting) {
            radioWaiting = false;
            wantPlay = false;
            notifyObserver(false);
          }
          return;
        }
        if (first) {
          startQueue(fresh, 0);
          personalRadio = true;
          if (queue.length() == 1) loadRadioBatch(false);
          return;
        }
        for (int i = 0; i < fresh.length(); i++) queue.put(fresh.optJSONObject(i));
        order.reset();
        if (radioWaiting) {
          radioWaiting = false;
          index++;
          resolveCurrent();
        } else {
          persist();
          notifyObserver(false);
        }
      });
    });
  }

  void local(Uri uri, String label) {
    try {
      startQueue(
          new JSONArray()
              .put(
                  new JSONObject()
                      .put("id", uri.toString())
                      .put("name", label)
                      .put("uri", uri.toString())),
          0);
    } catch (JSONException e) {
      fail(e.getMessage());
    }
  }

  void select(int selected) {
    if (selected < 0 || selected >= queue.length()) return;
    index = selected;
    order.reset();
    retryCount = 0;
    resolveCurrent();
  }

  void setMode(PlaybackOrder.Mode mode) {
    order.setRepeat(mode);
    persistOrder();
    persist();
    notifyObserver(false);
  }

  void setPlayerMode(PlaybackOrder.Mode mode) {
    order.restore(mode == PlaybackOrder.Mode.SHUFFLE ? PlaybackOrder.Mode.LIST_LOOP : mode,
        mode == PlaybackOrder.Mode.SHUFFLE);
    persistOrder();
    persist();
    notifyObserver(false);
  }

  void setShuffle(boolean enabled) {
    order.setShuffle(enabled);
    persistOrder();
    persist();
    notifyObserver(false);
  }

  private void persistOrder() {
    getSharedPreferences("playback", 0)
        .edit()
        .putString("order", order.mode.name())
        .putBoolean("shuffle", order.isShuffled())
        .apply();
  }

  void enqueue(JSONObject item, boolean next) {
    if (item == null) return;
    JSONArray result = new JSONArray();
    int at = next ? Math.max(0, index + 1) : queue.length();
    try {
      for (int i = 0; i <= queue.length(); i++) {
        if (i == at) result.put(new JSONObject(item.toString()));
        if (i < queue.length()) result.put(queue.get(i));
      }
      queue = result;
      order.reset();
      if (index < 0) index = 0;
      persist();
      notifyObserver(false);
    } catch (JSONException ignored) {
    }
  }

  void move(int from, int to) {
    if (from < 0 || to < 0 || from >= queue.length() || to >= queue.length() || from == to) return;
    java.util.ArrayList<JSONObject> entries = new java.util.ArrayList<>();
    for (int i = 0; i < queue.length(); i++) entries.add(queue.optJSONObject(i));
    JSONObject playing = current();
    entries.add(to, entries.remove(from));
    queue = new JSONArray(entries);
    index = entries.indexOf(playing);
    order.reset();
    persist();
    notifyObserver(false);
  }

  void moveDisplayed(int from,int to){
    if(from<0||to<0||from>=queue.length()||to>=queue.length()||from==to)return;
    if(order.isShuffled()){order.moveDisplayed(queue.length(),index,from,to);persist();notifyObserver(false);}else move(from,to);
  }

  void remove(int at) {
    if (at < 0 || at >= queue.length()) return;
    JSONArray result = new JSONArray();
    for (int i = 0; i < queue.length(); i++) if (i != at) result.put(queue.optJSONObject(i));
    boolean removedCurrent = at == index;
    boolean resume = wantPlay;
    queue = result;
    order.reset();
    if (queue.length() == 0) {
      stop();
      return;
    }
    if (at < index) index--;
    else if (index >= queue.length()) index = queue.length() - 1;
    if (removedCurrent) resolveCurrent(0, resume);
    else {
      persist();
      notifyObserver(false);
    }
  }

  void step(int direction) {
    if (queue.length() == 0) return;
    if (personalRadio && direction > 0 && index == queue.length() - 1) {
      radioWaiting = true;
      loadRadioBatch(false);
      return;
    }
    int next =
        personalRadio ? index + direction : direction < 0
            ? order.previous(queue.length(), index)
            : order.next(queue.length(), index, false);
    if (next < 0 || next >= queue.length()) return;
    radioWaiting = false;
    index = next;
    retryCount = 0;
    resolveCurrent();
  }

  void resolveCurrent() {
    resolveCurrent(0, true);
  }

  private void resolveCurrent(int position, boolean autoplay) {
    if (index < 0 || index >= queue.length()) return;
    cancelPending();
    releasePlayer();
    wantPlay = autoplay;
    targetPosition = Math.max(0, position);
    lastPosition = targetPosition;
    completed = false;
    JSONObject item = current();
    title = item.optString("name", "未知歌曲");
    mode = null;
    preview = null;
    originalUri = null;
    activeUri = null;
    timelineDuration = 0;
    loading = true;
    error = "";
    notifyObserver(true);
    if (personalRadio && index == queue.length() - 1) loadRadioBatch(false);
    String local = item.optString("uri");
    if (!local.isEmpty()) {
      playUri(Uri.parse(local), title, targetPosition, autoplay, false);
      return;
    }
    int ticket = generation;
    if (autoplay) promote();
    pendingRequest =
        io.submit(
            () -> {
              if (ticket != generation || destroyed) return;
              try {
                NeteaseClient api = new NeteaseClient();
                api.cookie = new SessionStore(this).load();
                OnlineAudio source = OnlineAudio.resolve(api, item);
                main.post(
                    () -> {
                      if (ticket == generation && !destroyed)
                        playUri(
                            Uri.parse(source.url()),
                            item.optString("name") + (source.trial() ? "（试听）" : ""),
                            targetPosition,
                            wantPlay,
                            false,
                            source.thirdParty() ? source : null);
                    });
              } catch (Exception e) {
                main.post(
                    () -> {
                      if (ticket == generation && !destroyed) fail(e.getMessage());
                    });
              }
            });
  }

  void switchTrack(Uri uri, String selected) {
    if (originalUri == null || uri == null) return;
    if (prepared && (player != null || livePlayer != null)) {
      beginHandoff(uri, selected, null);
      return;
    }
    int position = position();
    boolean resume = wantPlay;
    preview = null;
    mode = selected;
    playUri(uri, title, position, resume, true);
  }

  private void beginHandoff(Uri uri, String selected, StemStream stream) {
    cancelHandoff();
    if (uri.equals(activeUri) && java.util.Objects.equals(selected, mode) && stream == preview) {
      notifyObserver(false);
      return;
    }
    StemHandoff next = new StemHandoff(uri, selected, stream);
    handoff = next;
    mode = selected;
    error = "";
    next.prepare();
    notifyObserver(false);
  }

  private void applyOutputVolume() {
    float mix = handoff != null && handoff.started ? handoff.mix : 0;
    float volume = outputGain * (1 - mix);
    if (prepared && player != null) player.setVolume(volume, volume);
    if (livePlayer != null) livePlayer.volume(volume);
    if (handoff != null) handoff.volume(outputGain * mix);
  }

  private void cancelHandoff() {
    StemHandoff previous = handoff;
    if (previous == null) return;
    handoff = null;
    mode = previous.previousMode;
    previous.release();
    applyOutputVolume();
  }

  /** Prepare and align a second output while the active output owns the timeline. */
  private final class StemHandoff {
    final Uri uri;
    final String selected, previousMode;
    final StemStream stream;
    MediaPlayer media;
    LiveStemPlayer live;
    boolean ready, started;
    float mix;
    long seekStarted, fadeStarted, warmStarted;
    int lead = 80, startPosition;
    final Runnable deadline = () -> failed("新音轨加载超时");
    final Runnable alignTask = this::align;
    final Runnable fadeTask = this::fade;
    final Runnable warmTask = this::waitForOutput;

    StemHandoff(Uri uri, String selected, StemStream stream) {
      this.uri = uri;
      this.selected = selected;
      this.stream = stream;
      previousMode = mode;
    }

    boolean current() { return handoff == this && !destroyed; }

    void prepare() {
      main.postDelayed(deadline, 30000);
      try {
        if (stream != null) {
          live = new LiveStemPlayer(stream, selected, position(), new LiveStemPlayer.Events() {
            public void ended() { main.post(() -> { if (livePlayer == live && !current()) completeCurrent(); }); }
            public void failed(String message) {
              main.post(() -> {
                if (current()) StemHandoff.this.failed(message);
                else if (livePlayer == live && !destroyed && handoff == null) fail(message);
              });
            }
          });
          live.volume(0);
          ready = true;
          align();
        } else {
          media = new MediaPlayer();
          media.setAudioAttributes(new AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_MEDIA)
              .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
          media.setWakeMode(PlaybackService.this, PowerManager.PARTIAL_WAKE_LOCK);
          media.setOnPreparedListener(p -> {
            if (!current()) return;
            ready = true;
              p.setVolume(0, 0);
            p.setOnSeekCompleteListener(x -> {
              if (!current()) return;
              lead = (int) Math.min(1500, Math.max(80, SystemClock.uptimeMillis() - seekStarted + 40));
              align();
            });
            seekIncoming();
          });
          media.setOnErrorListener((p, what, extra) -> {
            if (current()) failed("无法加载音轨（" + what + "/" + extra + "）");
            return true;
          });
          media.setDataSource(PlaybackService.this, uri);
          media.prepareAsync();
        }
      } catch (Exception e) { failed(e.getMessage()); }
    }

    int incomingPosition() { return live != null ? live.position() : media.getCurrentPosition(); }

    boolean timelineAdvancing() {
      return playing() && (livePlayer == null || preview == null
          || preview.milliseconds() > livePlayer.position() + 40L);
    }

    void seekIncoming() {
      if (!current()) return;
      seekStarted = SystemClock.uptimeMillis();
      int aim = Math.min(Math.max(0, media.getDuration() - 1), position() + (timelineAdvancing() ? lead : 0));
      media.seekTo(aim, MediaPlayer.SEEK_CLOSEST);
    }

    void align() {
      if (!current()) return;
      try {
        main.removeCallbacks(alignTask);
        if (live != null) {
          // A growing file must have the current playback point before becoming audible.
          if (wantPlay && !stream.complete() && stream.milliseconds() < position() + 250L) {
            main.postDelayed(alignTask, 30);
            return;
          }
          live.seek(position());
        } else {
          int delta = incomingPosition() - position();
          if (timelineAdvancing() && delta > 8) {
            main.postDelayed(alignTask, Math.min(delta, 80));
            return;
          }
          if (Math.abs(delta) > 45) { seekIncoming(); return; }
        }
        if (!wantPlay) { finish(); return; }
        startPosition = incomingPosition();
        started = true;
        if (live != null) {
          if (!liveWake.isHeld()) liveWake.acquire();
          live.play();
        } else media.start();
        warmStarted = SystemClock.uptimeMillis();
        waitForOutput();
      } catch (Exception e) { failed(e.getMessage()); }
    }

    void waitForOutput() {
      if (!current()) return;
      try {
        if (!wantPlay) { finish(); return; }
        if (incomingPosition() - startPosition >= 10) {
          fadeStarted = SystemClock.uptimeMillis();
          fade();
        } else if (SystemClock.uptimeMillis() - warmStarted >= 1500) {
          failed("新音轨尚未输出音频");
        } else main.postDelayed(warmTask, 8);
      } catch (Exception e) { failed(e.getMessage()); }
    }

    void volume(float value) {
      if (!ready) return;
      if (live != null) live.volume(value);
      else if (media != null) media.setVolume(value, value);
    }

    void fade() {
      if (!current()) return;
      try {
        float t = Math.min(1, (SystemClock.uptimeMillis() - fadeStarted) / 120f);
        mix = t * t * (3 - 2 * t);
        applyOutputVolume();
        if (t >= 1 || !wantPlay) finish();
        else main.postDelayed(fadeTask, 8);
      } catch (Exception e) { failed(e.getMessage()); }
    }

    void finish() {
      if (!current()) return;
      int timeline = position();
      if (!wantPlay && started) {
        if (live != null) live.pause(); else media.pause();
      }
      positionBias = timeline - incomingPosition();
      MediaPlayer oldMedia = player;
      LiveStemPlayer oldLive = livePlayer;
      liveGeneration++;
      player = media;
      livePlayer = live;
      preview = stream;
      activeUri = uri;
      mode = selected;
      handoff = null;
      main.removeCallbacks(deadline);
      main.removeCallbacks(alignTask);
      main.removeCallbacks(fadeTask);
      main.removeCallbacks(warmTask);
      prepared = true;
      loading = false;
      completed = false;
      lastPosition = targetPosition = timeline;
      if (media != null) {
        media.setOnPreparedListener(null);
        media.setOnCompletionListener(p -> { if (p == player) completeCurrent(); });
        media.setOnSeekCompleteListener(p -> {
          if (p == player) {
            lastPosition = targetPosition = position();
            completed = false;
            persist();
            notifyObserver(false);
          }
        });
        media.setOnErrorListener((p, what, extra) -> {
          if (p == player) fail("无法播放，请重试（" + what + "/" + extra + "）");
          return true;
        });
        media.setOnBufferingUpdateListener((p, percent) -> { if (p == player) bufferedPercent = percent; });
      }
      if (oldMedia != null) oldMedia.release();
      if (oldLive != null) oldLive.close();
      if (live == null && liveWake.isHeld()) liveWake.release();
      applyOutputVolume();
      persist();
      notifyObserver(false);
    }

    void failed(String message) {
      if (!current()) return;
      cancelHandoff();
      error = "音轨切换失败，已保留当前播放：" + (message == null ? "请重试" : message);
      notifyObserver(false);
    }

    void release() {
      main.removeCallbacks(deadline);
      main.removeCallbacks(alignTask);
      main.removeCallbacks(fadeTask);
      main.removeCallbacks(warmTask);
      if (media != null) media.release();
      if (live != null) live.close();
      if (livePlayer == null && liveWake.isHeld()) liveWake.release();
    }
  }

  void preview(StemStream stream, String selected) {
    if (originalUri == null || stream == null || !stream.available()) return;
    if (prepared && (player != null || livePlayer != null)) {
      beginHandoff(Uri.fromFile(new java.io.File(stream.folder, selected)), selected, stream);
      return;
    }
    int position = position();
    boolean resume = wantPlay;
    preview = stream;
    mode = selected;
    playUri(Uri.fromFile(new java.io.File(stream.folder, selected)), title, position, resume, true);
  }

  boolean previewing(StemStream stream) {
    return (preview == stream || (handoff != null && handoff.stream == stream)) && mode != null;
  }

  boolean switchingTrack() { return handoff != null; }

  void cancelPreview(StemStream stream) {
    if (previewing(stream)) {
      switchTrack(originalUri, null);
    }
  }

  void playUri(Uri uri, String label, int position, boolean autoplay, boolean stem) {
    playUri(uri, label, position, autoplay, stem, null);
  }

  private void playUri(Uri uri, String label, int position, boolean autoplay, boolean stem,
      OnlineAudio alternative) {
    cancelPending();
    releasePlayer();
    targetPosition = Math.max(0, position);
    positionBias = 0;
    lastPosition = targetPosition;
    wantPlay = autoplay;
    completed = false;
    loading = true;
    error = "";
    activeUri = uri;
    if (!stem) {
      timelineDuration = 0;
      originalUri = uri;
      title = label;
      mode = null;
    }
    if (stem && preview != null && mode != null) {
      try {
        int liveTicket = generation, liveIdentity = ++liveGeneration;
        livePlayer =
            new LiveStemPlayer(
                preview,
                mode,
                targetPosition,
                new LiveStemPlayer.Events() {
                  public void ended() {
                    main.post(
                        () -> {
                          if (liveTicket == generation && liveIdentity == liveGeneration && preview != null) completeCurrent();
                        });
                  }

                  public void failed(String message) {
                    main.post(
                        () -> {
                          if (liveTicket == generation && liveIdentity == liveGeneration && handoff == null) fail(message);
                        });
                  }
                });
        prepared = true;
        loading = false;
        if (wantPlay) resume();
        else notifyObserver(false);
        return;
      } catch (Exception e) {
        fail(e.getMessage());
        return;
      }
    }
    player = new MediaPlayer();
    MediaPlayer p = player;
    Runnable rejectAlternative = () -> {
      if (alternative.officialTrial() == null) {
        fail("第三方音源无法完整播放");
        return;
      }
      playUri(Uri.parse(alternative.officialTrial()), label + "（试听）", targetPosition, wantPlay, false);
    };
    p.setAudioAttributes(
        new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build());
    p.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
    notifyObserver(false);
    try {
      p.setDataSource(this, uri);
      p.setOnPreparedListener(
          mp -> {
            if (mp != player || destroyed) return;
            if (alternative != null && !alternative.matchesDuration(mp.getDuration())) {
              rejectAlternative.run();
              return;
            }
            prepared = true;
              mp.setOnSeekCompleteListener(
                x -> {
                  if (x != player) return;
                  finishPreparation();
                });
            if (targetPosition > 0)
              mp.seekTo(
                  Math.min(targetPosition, Math.max(0, mp.getDuration() - 1)),
                  MediaPlayer.SEEK_CLOSEST);
            else finishPreparation();
          });
      p.setOnCompletionListener(
          mp -> {
            if (mp == player) completeCurrent();
          });
      p.setOnErrorListener(
          (mp, what, extra) -> {
            if (mp != player) return true;
            if (alternative != null) {
              rejectAlternative.run();
              return true;
            }
            lastPosition = targetPosition > 0 ? targetPosition : lastPosition;
            if (mode == null && current().optString("uri").isEmpty() && retryCount++ < 1) {
              int pos = lastPosition;
              boolean resume = wantPlay;
              resolveCurrent(pos, resume);
            } else fail("无法播放，请重试（" + what + "/" + extra + "）");
            return true;
          });
      p.setOnBufferingUpdateListener(
          (mp, percent) -> {
            if (mp == player) bufferedPercent = percent;
          });
      p.prepareAsync();
      int ticket = generation;
      prepareDeadline =
          () -> {
            if (ticket != generation || !loading) return;
            if (alternative != null) rejectAlternative.run();
            else fail("音频加载超时，请重试");
          };
      main.postDelayed(prepareDeadline, 30000);
      if (autoplay) promote();
    } catch (Exception e) {
      if (alternative != null) rejectAlternative.run();
      else fail(e.getMessage());
    }
  }

  private void completeCurrent() {
    cancelHandoff();
    lastPosition = duration();
    completed = true;
    if (personalRadio && index == queue.length() - 1) {
      radioWaiting = wantPlay;
      if (radioWaiting) loadRadioBatch(false);
      return;
    }
    int next = personalRadio ? index + 1 : order.next(queue.length(), index, true);
    if (next < 0) {
      if (liveWake.isHeld()) liveWake.release();
      wantPlay = false;
      audio.abandonAudioFocusRequest(focus);
      notifyObserver(false);
      persist();
      return;
    }
    if (next == index) playUri(activeUri, title, 0, true, true);
    else {
      index = next;
      retryCount = 0;
      resolveCurrent();
    }
  }

  private int bufferedPercent;

  private void finishPreparation() {
    if (prepareDeadline != null) main.removeCallbacks(prepareDeadline);
    loading = false;
    if (timelineDuration == 0) timelineDuration = player.getDuration();
    rememberCurrent();
    lastPosition = player.getCurrentPosition();
    targetPosition = lastPosition;
    player.setOnSeekCompleteListener(
        p -> {
          if (p == player) {
            lastPosition = p.getCurrentPosition();
            targetPosition = lastPosition;
            completed = false;
            persist();
            notifyObserver(false);
          }
        });
    if (wantPlay) resume();
    else notifyObserver(false);
    persist();
  }

  int position() {
    if (livePlayer != null) return Math.max(0, livePlayer.position() + positionBias);
    try {
      return prepared && !loading && player != null
          ? Math.max(0, player.getCurrentPosition() + positionBias) : lastPosition;
    } catch (IllegalStateException e) {
      return lastPosition;
    }
  }

  int duration() {
    if (timelineDuration > 0) return timelineDuration;
    if (livePlayer != null) return livePlayer.duration();
    try {
      return prepared && player != null ? player.getDuration() : 0;
    } catch (IllegalStateException e) {
      return 0;
    }
  }

  boolean playbackActive() {
    return playing() || (loading && wantPlay && error.isEmpty());
  }

  boolean playing() {
    if (livePlayer != null) return livePlayer.playing();
    try {
      return prepared && player != null && player.isPlaying();
    } catch (IllegalStateException e) {
      return false;
    }
  }

  void toggle() {
    if (wantPlay) pause();
    else play();
  }

  void play() {
    resumeOnFocus = false;
    wantPlay = true;
    if (loading) {
      promote();
      notifyObserver(false);
      return;
    }
    if ((!error.isEmpty() && !prepared) || (player == null && livePlayer == null)) {
      retryCount = 0;
      resolveCurrent(lastPosition, true);
      return;
    }
    error = "";
    if (completed) {
      playUri(activeUri, title, 0, true, true);
      return;
    }
    resume();
  }

  static final String MIX_AUDIO = "mix-audio";

  static boolean mixAudio(Context context) {
    return context.getSharedPreferences("playback-settings", 0).getBoolean(MIX_AUDIO, true);
  }

  private final SharedPreferences.OnSharedPreferenceChangeListener playbackSettingsListener =
      (preferences, key) -> {
        if (!MIX_AUDIO.equals(key)) return;
        resumeOnFocus = false;
        if (mixAudio(this)) {
          audio.abandonAudioFocusRequest(focus);
          outputGain = 1;
          applyOutputVolume();
        } else if (playing()
            && audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
          pause();
        }
      };

  void resume() {
    wantPlay = true;
    if (!prepared || (player == null && livePlayer == null)) return;
    promote();
    if (!mixAudio(this) && audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
      wantPlay = false;
      error = "其他应用正在使用音频，请稍后重试";
      notifyObserver(false);
      return;
    }
    if (livePlayer != null) {
      outputGain = 1;
      if (!liveWake.isHeld()) liveWake.acquire();
      livePlayer.play();
    } else {
      outputGain = 1;
      player.start();
    }
    applyOutputVolume();
    notifyObserver(false);
  }

  void pause() {
    resumeOnFocus = false;
    wantPlay = false;
    if (playing()) {
      if (livePlayer != null) livePlayer.pause();
      else player.pause();
    }
    if (handoff != null && handoff.started) handoff.finish();
    if (liveWake.isHeld()) liveWake.release();
    lastPosition = position();
    audio.abandonAudioFocusRequest(focus);
    notifyObserver(false);
    persist();
  }

  void seek(int ms) {
    cancelHandoff();
    positionBias = 0;
    targetPosition = Math.max(0, ms);
    lastPosition = targetPosition;
    if (livePlayer != null) {
      livePlayer.seek(ms);
      notifyObserver(false);
      return;
    }
    if (prepared && player != null) {
      targetPosition = Math.min(targetPosition, Math.max(0, duration() - 1));
      player.seekTo(targetPosition, MediaPlayer.SEEK_CLOSEST);
    }
    notifyObserver(false);
  }

  void stop() {
    cancelRadio();
    cancelPending();
    wantPlay = false;
    resumeOnFocus = false;
    releasePlayer();
    loading = false;
    error = "";
    originalUri = null;
    activeUri = null;
    mode = null;
    title = "";
    queue = new JSONArray();
    index = -1;
    lastPosition = 0;
    timelineDuration = 0;
    order.reset();
    getSharedPreferences("playback", 0).edit().clear().commit();
    audio.abandonAudioFocusRequest(focus);
    session.setActive(false);
    stopForeground(STOP_FOREGROUND_REMOVE);
    ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(7);
    notifyObserver(true);
    stopSelf();
  }

  private void cancelPending() {
    cancelHandoff();
    generation++;
    if (pendingRequest != null) pendingRequest.cancel(true);
    if (prepareDeadline != null) main.removeCallbacks(prepareDeadline);
  }

  private void promote() {
    startForegroundService(new Intent(this, PlaybackService.class).setAction("activate"));
    startForeground(7, notification());
  }

  private PendingIntent command(String action, int code) {
    return PendingIntent.getService(
        this,
        code,
        new Intent(this, PlaybackService.class).setAction(action),
        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  }

  private Notification notification() {
    PendingIntent open =
        PendingIntent.getActivity(
            this,
            0,
            Intent.makeMainActivity(new ComponentName(this, MusicActivity.class))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Notification.Builder notification = new Notification.Builder(this, "playback")
        .setSmallIcon(android.R.drawable.ic_media_play)
        .setContentTitle(title.isEmpty() ? "Doto" : title)
        .setContentText(!error.isEmpty() ? error : loading ? "加载中" : playing() ? "正在播放" : "已暂停")
        .setContentIntent(open)
        .setOnlyAlertOnce(true)
        .setOngoing(playing())
        .addAction(
            new Notification.Action.Builder(
                    android.R.drawable.ic_media_previous, "上一首", command("previous", 1))
                .build())
        .addAction(
            new Notification.Action.Builder(
                    playing()
                        ? android.R.drawable.ic_media_pause
                        : android.R.drawable.ic_media_play,
                    playing() ? "暂停" : "播放",
                    command("toggle", 2))
                .build())
        .addAction(
            new Notification.Action.Builder(
                    android.R.drawable.ic_media_next, "下一首", command("next", 3))
                .build())
        .setStyle(
            new Notification.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2));
    if (systemArtwork != null) notification.setLargeIcon(systemArtwork);
    return notification.build();
  }

  private void loadSystemTrackMetadata(JSONObject item) {
    String id = item.optString("id");
    String uri = item.optString("uri");
    String artworkUrl = MusicActivity.coverUrl(item);
    String key = index < 0 ? "" : id + "|" + uri + "|" + artworkUrl;
    if (key.equals(systemTrack)) return;
    systemTrack = key;
    systemArtwork = null;
    systemLyrics = "";
    desktopLines.clear();
    desktopTranslations.clear();
    int request = ++systemTrackGeneration;
    if (index < 0) return;
    if (!artworkUrl.isEmpty() || !uri.isEmpty()) metadataIo.submit(() -> {
      try {
        Bitmap artwork = loadSystemArtwork(artworkUrl, uri);
        main.post(() -> {
          if (destroyed || request != systemTrackGeneration || artwork == null) return;
          systemArtwork = artwork;
          publish();
        });
      } catch (Exception error) {
        android.util.Log.d("DotoMetadata", "Cover unavailable", error);
      }
    });
    if (item.optLong("id") > 0) metadataIo.submit(() -> {
      try {
        NeteaseClient api = new NeteaseClient();
        api.cookie = new SessionStore(this).load();
        JSONObject response = api.request("/api/song/lyric",
            NeteaseClient.json("id", id, "lv", -1, "tv", -1), true);
        String lrc = timedLyric(response.optJSONObject("lrc"));
        if (lrc.isEmpty()) return;
        String translated = timedLyric(response.optJSONObject("tlyric"));
        main.post(() -> {
          if (destroyed || request != systemTrackGeneration) return;
          try {
            JSONObject lyrics = NeteaseClient.json(
                "songId", id, "songName", item.optString("name"), "artist", artist(),
                "lyricType", 0, "lyric", lrc, "noLyric", false,
                "sessionGeneration", request, "provider", getPackageName());
            if (!translated.isEmpty()) lyrics.put("translationLyric", translated);
            systemLyrics = lyrics.toString();
            desktopLines.putAll(SpatialPlayer.parseTimedLines(lrc, null));
            desktopTranslations.putAll(SpatialPlayer.parseTimedLines(translated, null));
            publish();
          } catch (JSONException error) {
            android.util.Log.d("DotoMetadata", "Unable to package lyrics", error);
          }
        });
      } catch (Exception error) {
        android.util.Log.d("DotoMetadata", "Lyrics unavailable", error);
      }
    });
  }

  private Bitmap loadSystemArtwork(String url, String local) throws Exception {
    Bitmap artwork = url.isEmpty() ? null : ArtworkLoader.fetch(url, 256);
    if (artwork == null && !local.isEmpty()) {
      try (MediaMetadataRetriever retriever = new MediaMetadataRetriever()) {
        retriever.setDataSource(this, Uri.parse(local));
        byte[] picture = retriever.getEmbeddedPicture();
        if (picture != null) artwork = BitmapFactory.decodeByteArray(picture, 0, picture.length);
      }
    }
    if (artwork == null) return null;
    float scale = 256f / Math.max(artwork.getWidth(), artwork.getHeight());
    return scale >= 1f ? artwork : Bitmap.createScaledBitmap(artwork,
        Math.max(1, Math.round(artwork.getWidth() * scale)),
        Math.max(1, Math.round(artwork.getHeight() * scale)), true);
  }

  private static String timedLyric(JSONObject data) {
    String lrc = data == null ? "" : data.optString("lyric");
    return lrc.length() <= 32768 && LRC_TIMECODE.matcher(lrc).find() ? lrc : "";
  }

  // The system lyric consumer reads this vendor-specific MediaMetadata key.
  @android.annotation.SuppressLint("WrongConstant")
  private static void publishVendorLyrics(MediaMetadata.Builder metadata, String lyrics) {
    metadata.putString("lyricInfo", lyrics);
  }

  private void publish() {
    if (session == null) return;
    JSONObject item = current();
    loadSystemTrackMetadata(item);
    refreshDesktopLyrics();
    java.util.ArrayList<MediaSession.QueueItem> systemQueue = new java.util.ArrayList<>();
    for (int i = 0; i < queue.length(); i++)
      systemQueue.add(
          new MediaSession.QueueItem(
              new MediaDescription.Builder()
                  .setMediaId(currentId(i))
                  .setTitle(queue.optJSONObject(i).optString("name"))
                  .build(),
              i));
    session.setQueue(systemQueue);
    int state =
        !error.isEmpty() && !prepared
            ? PlaybackState.STATE_ERROR
            : loading
                ? PlaybackState.STATE_BUFFERING
                : playing() ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
    int position = position(), duration = duration();
    session.setPlaybackState(
        new PlaybackState.Builder()
            .setActions(
                PlaybackState.ACTION_PLAY
                    | PlaybackState.ACTION_PAUSE
                    | PlaybackState.ACTION_PLAY_PAUSE
                    | PlaybackState.ACTION_SKIP_TO_NEXT
                    | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                    | PlaybackState.ACTION_SEEK_TO)
            .setBufferedPosition(
                preview != null ? preview.milliseconds() : (long) duration * bufferedPercent / 100)
            .setActiveQueueItemId(index)
            .setErrorMessage(error)
            .addCustomAction(
                new PlaybackState.CustomAction.Builder(
                        "repeat", "播放模式：" + order.mode.name(), android.R.drawable.ic_menu_rotate)
                    .build())
            .addCustomAction(
                new PlaybackState.CustomAction.Builder(
                        "shuffle",
                        order.isShuffled() ? "随机播放已开启" : "随机播放已关闭",
                        android.R.drawable.ic_menu_sort_by_size)
                    .build())
            .setState(state, position, playing() ? 1 : 0)
            .build());
    MediaMetadata.Builder metadata = new MediaMetadata.Builder()
        .putString(MediaMetadata.METADATA_KEY_MEDIA_ID, item.optString("id"))
        .putString(MediaMetadata.METADATA_KEY_TITLE, title)
        .putString(MediaMetadata.METADATA_KEY_ARTIST, artist())
        .putLong(MediaMetadata.METADATA_KEY_DURATION, duration);
    if (systemArtwork != null) {
      metadata.putBitmap(MediaMetadata.METADATA_KEY_ART, systemArtwork);
      metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, systemArtwork);
    }
    if (!systemLyrics.isEmpty()) publishVendorLyrics(metadata, systemLyrics);
    session.setMetadata(metadata.build());
    session.setActive(index >= 0);
    if (index >= 0)
      ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(7, notification());
  }

  private void fail(String message) {
    cancelPending();
    releasePlayer();
    loading = false;
    wantPlay = false;
    audio.abandonAudioFocusRequest(focus);
    error = message == null ? "播放失败" : message;
    publish();
    notifyObserver(false);
  }

  private void notifyObserver(boolean changed) {
    publish();
    if (observer != null) observer.changed(changed);
    if (stems != null) stems.playbackChanged();
  }

  private String currentId(int at) {
    return queue.optJSONObject(at).optString("id");
  }

  private String artist() {
    JSONArray artists = current().optJSONArray("ar");
    if (artists == null) artists = current().optJSONArray("artists");
    StringBuilder result = new StringBuilder();
    if (artists != null)
      for (int i = 0; i < artists.length(); i++) {
        if (i > 0) result.append(" / ");
        result.append(artists.optJSONObject(i).optString("name"));
      }
    return result.toString();
  }

  private void rememberCurrent() {
    String id = current().optString("id");
    if (!(id.matches("[0-9]+")
        || id.startsWith("content:")
        || id.startsWith("file:")
        || id.startsWith("download:"))) return;
    try {
      JSONArray old = new JSONArray(getSharedPreferences("recent", 0).getString("songs", "[]")),
          updated = new JSONArray().put(new JSONObject(current().toString()));
      for (int i = 0; i < old.length() && updated.length() < 50; i++)
        if (!id.equals(old.optJSONObject(i).optString("id"))) updated.put(old.optJSONObject(i));
      getSharedPreferences("recent", 0).edit().putString("songs", updated.toString()).apply();
    } catch (Exception ignored) {
    }
  }

  void persist() {
    if (index < 0 || loading || handoff != null || (preview != null && !preview.complete())) return;
    getSharedPreferences("playback", 0)
        .edit()
        .putString("queue", queue.toString())
        .putInt("index", index)
        .putString("uri", originalUri == null ? "" : originalUri.toString())
        .putString("activeUri", activeUri == null ? "" : activeUri.toString())
        .putString("title", title)
        .putInt("position", position())
        .putString("mode", mode == null ? "" : mode)
        .putString("order", order.mode.name())
        .putBoolean("shuffle", order.isShuffled())
        .apply();
  }

  private void releasePlayer() {
    cancelHandoff();
    liveGeneration++;
    if (liveWake != null && liveWake.isHeld()) liveWake.release();
    if (livePlayer != null) {
      livePlayer.close();
      livePlayer = null;
    }
    prepared = false;
    bufferedPercent = 0;
    if (player != null) {
      player.release();
      player = null;
    }
  }

  public void onDestroy() {
    persist();
    destroyed = true;
    ((DotoApp) getApplication()).visibilityChanged = null;
    getSharedPreferences("playback-settings", 0)
        .unregisterOnSharedPreferenceChangeListener(playbackSettingsListener);
    desktopLyrics.hide();
    stems.close();
    cancelPending();
    main.removeCallbacksAndMessages(null);
    io.shutdownNow();
    metadataIo.shutdownNow();
    releasePlayer();
    audio.abandonAudioFocusRequest(focus);
    unregisterReceiver(noisy);
    session.release();
    super.onDestroy();
  }
}
