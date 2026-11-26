package com.volo.mobile;

import android.graphics.*;
import android.net.Uri;
import android.os.*;
import android.util.LruCache;
import android.widget.ImageView;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

final class ArtworkLoader implements AutoCloseable {
  private final ExecutorService worker = Executors.newFixedThreadPool(3);
  private final Handler main = new Handler(Looper.getMainLooper());
  private static final LruCache<String, Bitmap> cache =
      new LruCache<>(32 * 1024 * 1024) {
        protected int sizeOf(String key, Bitmap bitmap) {
          return bitmap.getByteCount();
        }
      };
  private volatile boolean closed;
  private static File coverDirectory;
  static void storage(android.content.Context context){coverDirectory=new File(context.getFilesDir(),"song-covers");coverDirectory.mkdirs();}
  private static File coverFile(String url) throws Exception {return new File(coverDirectory,hexDigest(java.security.MessageDigest.getInstance("SHA-256").digest(url.getBytes(java.nio.charset.StandardCharsets.UTF_8)))+".jpg");}
  private static String hexDigest(byte[] bytes){char[] chars=new char[bytes.length*2];String digits="0123456789abcdef";for(int i=0;i<bytes.length;i++){chars[2*i]=digits.charAt((bytes[i]&255)>>>4);chars[2*i+1]=digits.charAt(bytes[i]&15);}return new String(chars);}
  static void saveCover(String url) throws Exception {if(url!=null&&url.startsWith("http"))fetch(url,640);}

  interface Source {
    Bitmap fetch(String url, int size) throws Exception;
  }

  private record Request(Consumer<Bitmap> success, Runnable failure) {}

  private final Source source;
  private final Map<String, List<Request>> pending = new HashMap<>();

  ArtworkLoader() {
    this(ArtworkLoader::fetch);
  }

  ArtworkLoader(Source source) {
    this.source = source;
  }

  Bitmap cached(String url, int size) {
    if (url == null || url.isEmpty()) return null;
    Bitmap exact = cache.get(url + ":" + size);
    if (exact != null && !exact.isRecycled()) return exact;
    for (int fallback : new int[] {256, 400, 640, 960}) {
      Bitmap image = cache.get(url + ":" + fallback);
      if (image != null && !image.isRecycled()) return image;
    }
    return null;
  }

  void into(ImageView view, String url) {
    view.setTag(url);
    load(
        url,
        b -> {
          if (url.equals(view.getTag())) view.setImageBitmap(b);
        });
  }

  void load(String url, Consumer<Bitmap> callback) {
    load(url, 400, callback);
  }

  void load(String url, int size, Consumer<Bitmap> callback) {
    load(url, size, callback, () -> {});
  }

  void load(String url, int size, Consumer<Bitmap> callback, Runnable failure) {
    String key = url + ":" + size;
    if (closed || url == null || !url.startsWith("http")) return;
    Bitmap existing = cached(url,size);
    if (existing != null) {
      callback.accept(existing);
      return;
    }
    synchronized (pending) {
      List<Request> listeners = pending.get(key);
      if (listeners != null) {
        listeners.add(new Request(callback, failure));
        return;
      }
      listeners = new ArrayList<>();
      listeners.add(new Request(callback, failure));
      pending.put(key, listeners);
    }
    worker.submit(
        () -> {
          Bitmap bitmap = null;
          try {
            bitmap = source.fetch(url, size);
            if (bitmap != null && !bitmap.isRecycled()) cache.put(key, bitmap);
          } catch (Exception ignored) {
          }
          Bitmap result = bitmap;
          // One completion owns/removes this request. Failure must unlock retries,
          // and a second cleanup post must never delete a newer retry's listeners.
          main.post(
              () -> {
                List<Request> listeners;
                synchronized (pending) {
                  listeners = pending.remove(key);
                }
                if (!closed && listeners != null)
                  for (Request listener : listeners) {
                    if (result != null && !result.isRecycled()) listener.success().accept(result);
                    else listener.failure().run();
                  }
              });
        });
  }

  static String address(String url, int size) {
    Uri uri = Uri.parse(url.replace("http://", "https://"));
    if (!isMusicCdn(uri) || hasImagePipeline(uri)) return uri.toString();
    Uri.Builder builder = uri.buildUpon().clearQuery();
    for (String name : uri.getQueryParameterNames()) {
      if (name.equals("param")) continue;
      for (String value : uri.getQueryParameters(name)) builder.appendQueryParameter(name, value);
    }
    return builder.appendQueryParameter("param", size + "y" + size).build().toString();
  }

  private static boolean isMusicCdn(Uri uri) {
    String host = uri.getHost();
    return host != null && (host.endsWith(".music.126.net") || host.endsWith(".music.163.com"));
  }

  private static boolean hasImagePipeline(Uri uri) {
    return uri.getQueryParameterNames().contains("imageView");
  }

  static Bitmap fetch(String url, int size) throws Exception {
    File stored=coverDirectory==null?null:coverFile(url);
    if(stored!=null&&stored.isFile()){Bitmap local=BitmapFactory.decodeFile(stored.getPath());if(local!=null)return local;}
    Bitmap result=fetchRemote(url,size);
    if(result!=null&&stored!=null){File temporary=File.createTempFile("cover-",".tmp",coverDirectory);try{try(OutputStream out=new FileOutputStream(temporary)){result.compress(Bitmap.CompressFormat.JPEG,92,out);}java.nio.file.Files.move(temporary.toPath(),stored.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);}finally{temporary.delete();}}
    return result;
  }
  private static Bitmap fetchRemote(String url, int size) throws Exception {
    Uri uri = Uri.parse(url);
    if (isMusicCdn(uri) && hasImagePipeline(uri)) {
      try {
        Bitmap composed = fetchAddress(address(url, size), size);
        if (composed != null) return composed;
      } catch (java.io.IOException error) {
        if (Thread.currentThread().isInterrupted()) throw error;
      }
      url = uri.buildUpon().clearQuery().build().toString();
    }
    return fetchAddress(address(url, size), size);
  }

  private static Bitmap fetchAddress(String address, int size) throws Exception {
    HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
    try {
      connection.setConnectTimeout(8000);
      connection.setReadTimeout(8000);
      try (InputStream input = connection.getInputStream()) {
        byte[] bytes = input.readNBytes(4 * 1024 * 1024);
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        options.inSampleSize = 1;
        while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > size * 2)
          options.inSampleSize *= 2;
        options.inJustDecodeBounds = false;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
      }
    } finally {
      connection.disconnect();
    }
  }

  public void close() {
    closed = true;
    worker.shutdownNow();
    main.removeCallbacksAndMessages(null);
    synchronized (pending) {
      pending.clear();
    }
  }
}
