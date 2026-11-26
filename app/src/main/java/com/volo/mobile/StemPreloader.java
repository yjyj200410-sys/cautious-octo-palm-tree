package com.volo.mobile;

import android.net.Uri;
import android.os.*;
import java.io.File;
import java.util.HashSet;
import java.util.concurrent.*;
import org.json.JSONObject;

/** One shared worker for explicit separation and optional current/next-song warming. */
final class StemPreloader implements AutoCloseable {
  private final PlaybackService service;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final HashSet<String> failed = new HashSet<>();
  private final PowerManager.WakeLock wake;
  private final Runnable refreshTask = this::refresh;
  private Job job;
  private String currentKey = "", suppressed = "", lastMessage = "";
  private boolean closed;

  private static final class Job {
    final String key, label;
    final JSONObject item;
    final Uri source;
    final File folder;
    final StemStream stream;
    volatile boolean cancelled;
    boolean automatic;
    String message = "正在准备当前歌曲…";

    Job(String key, JSONObject item, Uri source, File folder, boolean automatic) {
      this.key = key;
      this.item = item;
      this.label = item.optString("name", "未知歌曲");
      this.source = source;
      this.folder = folder;
      this.stream = new StemStream(folder);
      this.automatic = automatic;
    }
  }

  StemPreloader(PlaybackService service) {
    this.service = service;
    wake = ((PowerManager) service.getSystemService(android.content.Context.POWER_SERVICE))
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Doto:stem-preload");
    wake.setReferenceCounted(false);
  }

  boolean enabled() {
    return service.getSharedPreferences("playback-settings", 0).getBoolean("preload-stems", false);
  }

  void setEnabled(boolean value) {
    service.getSharedPreferences("playback-settings", 0).edit().putBoolean("preload-stems", value).apply();
    suppressed = "";
    failed.clear();
    if (!value && job != null && job.automatic) cancelJob();
    playbackChanged();
    service.stemsChanged();
  }

  static String key(JSONObject item) {
    return item.optString("id", item.optString("uri"));
  }

  File cached(String key) {
    String path = service.getSharedPreferences("stems", 0).getString(key, "");
    if (path.isEmpty()) return null;
    File folder = new File(path);
    return new File(folder, "vocals.wav").length() > 44
            && new File(folder, "accompaniment.wav").length() > 44 ? folder : null;
  }

  boolean running() { return job != null && job.key.equals(key(service.current())); }
  StemStream stream() { return streamFor(key(service.current())); }
  StemStream streamFor(String key) { return job != null && job.key.equals(key) ? job.stream : null; }
  float progress() {
    if (running()) {
      long total = job.stream.totalMilliseconds();
      return total > 0 ? Math.min(.99f, (float) job.stream.milliseconds() / total) : 0;
    }
    return cached(key(service.current())) == null ? 0 : 1;
  }
  String message() {
    if (running()) return job.message;
    if (cached(key(service.current())) != null) return "音轨已就绪，可切换人声或伴奏";
    return lastMessage.isEmpty() ? "分离当前歌曲的人声与伴奏" : lastMessage;
  }
  String workingKey() { return job == null ? "" : job.key; }

  void playbackChanged() {
    main.removeCallbacks(refreshTask);
    if (!closed) main.post(refreshTask);
  }

  private void refresh() {
    if (closed) return;
    String now = service.index < 0 ? "" : key(service.current());
    boolean changed = !now.equals(currentKey);
    if (changed) {
      currentKey = now;
      suppressed = "";
      lastMessage = "";
    }
    if (now.isEmpty()) { cancelJob(); return; }
    JSONObject next = enabled() ? service.nextForStemPreload() : null;
    String nextKey = next == null ? "" : key(next);
    if (job != null) {
      // A prefetched song promoted to current keeps its already generated prefix.
      if (job.key.equals(now)) {
        if (changed) service.stemsChanged();
        return;
      }
      if (enabled() && !changed && cached(now) != null && job.key.equals(nextKey)) return;
      cancelJob();
    }
    if (!enabled() || !service.prepared || !service.playing() || service.originalUri == null) return;
    if (cached(now) == null) {
      if (!now.equals(suppressed) && !failed.contains(now)) start(service.current(), service.originalUri, true);
      return;
    }
    if (next != null && !nextKey.equals(now) && !failed.contains(nextKey) && cached(nextKey) == null)
      start(next, null, true);
  }

  void requestCurrent(boolean force) {
    if (closed || service.originalUri == null || service.index < 0) return;
    String key = key(service.current());
    if (job != null && job.key.equals(key)) {
      job.automatic = false;
      service.stemsChanged();
      return;
    }
    if (!force && cached(key) != null) { service.stemsChanged(); return; }
    cancelJob();
    suppressed = "";
    failed.remove(key);
    start(service.current(), service.originalUri, false);
  }

  void cancelCurrent() {
    suppressed = key(service.current());
    if (running()) cancelJob();
    lastMessage = "已取消，可重新开始";
    service.stemsChanged();
  }

  private void cancelJob() {
    Job previous = job;
    if (previous == null) return;
    job = null;
    previous.cancelled = true;
    if (!closed) service.cancelPreview(previous.stream);
    previous.stream.cancel();
  }

  private void start(JSONObject item, Uri source, boolean automatic) {
    try {
      JSONObject copy = new JSONObject(item.toString());
      File folder = new File(service.getFilesDir(), "preload-stems-" + System.nanoTime());
      if (!folder.mkdirs()) throw new java.io.IOException("无法创建分轨目录");
      Job next = new Job(key(copy), copy, source, folder, automatic);
      job = next;
      lastMessage = "";
      worker.submit(() -> run(next));
      service.stemsChanged();
    } catch (Exception e) {
      failed.add(key(item));
      lastMessage = "分轨未完成：" + e.getMessage();
      service.stemsChanged();
    }
  }

  private void run(Job task) {
    boolean success = false;
    try {
      wake.acquire();
      Uri source = task.source;
      if (source == null) {
        String local = task.item.optString("uri");
        if (!local.isEmpty()) source = Uri.parse(local);
        else {
          NeteaseClient api = new NeteaseClient();
          api.cookie = new SessionStore(service).load();
          JSONObject official = api.resolve(task.item.optLong("id"));
          if (NeteaseClient.isTrial(official)) throw new java.io.IOException("官方音源仅提供试听");
          source = Uri.parse(official.getString("url").replace("http://", "https://"));
        }
      }
      if (task.cancelled) return;
      AudioJob.run(service, source, task.folder, new AudioJob.Progress() {
        long published;
        public boolean cancelled() { return task.cancelled || Thread.currentThread().isInterrupted(); }
        public void update(String message) { publish(task, message); }
        public void partial(long frames, long total) {
          task.stream.commit(frames, total);
          if (frames - published >= 24000 || frames == total) {
            published = frames;
            publish(task, "可试听至 " + task.stream.milliseconds() / 1000 + " 秒 · 分轨继续中");
          }
        }
      });
      if (task.cancelled) return;
      task.stream.finish();
      success = true;
      main.post(() -> {
        if (closed || task.cancelled) { discard(task); return; }
        service.getSharedPreferences("stems", 0).edit().putString(task.key, task.folder.getAbsolutePath()).apply();
        service.getSharedPreferences("stem-names", 0).edit().putString(task.key, task.label).apply();
        if (job == task) job = null;
        lastMessage = "";
        service.stemsChanged();
        playbackChanged();
      });
    } catch (Exception e) {
      main.post(() -> {
        if (closed || task.cancelled || job != task) return;
        job = null;
        service.cancelPreview(task.stream);
        task.stream.cancel();
        failed.add(task.key);
        if (task.key.equals(currentKey)) lastMessage = "分轨未完成：" + e.getMessage();
        service.stemsChanged();
      });
    } finally {
      if (!success) discard(task);
      if (wake.isHeld()) wake.release();
    }
  }

  private void publish(Job task, String message) {
    main.post(() -> {
      if (job != task || task.cancelled || closed) return;
      task.message = message;
      if (task.key.equals(key(service.current()))) service.stemsChanged();
    });
  }

  private void discard(Job task) {
    for (String name : new String[] {"decoded.tmp", "vocals.wav.part", "accompaniment.wav.part", "vocals.wav", "accompaniment.wav"})
      new File(task.folder, name).delete();
    task.folder.delete();
  }

  public void close() {
    closed = true;
    main.removeCallbacks(refreshTask);
    cancelJob();
    worker.shutdownNow();
  }
}
