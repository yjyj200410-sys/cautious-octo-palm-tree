package com.volo.mobile;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/** Resolves playback sources independently of the official download workflow. */
record OnlineAudio(String url, boolean trial, boolean thirdParty, String officialTrial, long durationMs) {
  static OnlineAudio resolve(NeteaseClient client, JSONObject song) throws Exception {
    String official = null;
    Exception officialError = null;
    long duration = song.optLong("dt", song.optLong("duration"));
    try {
      JSONObject response = client.resolve(song.getLong("id"));
      official = https(response.optString("url"));
      if (official == null) throw new IOException("网易云未返回可用音源");
      if (!NeteaseClient.isTrial(response))
        return new OnlineAudio(official, false, false, null, duration);
    } catch (Exception error) {
      officialError = error;
    }
    if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
    try {
      String alternative = kuwo(song, duration);
      if (alternative != null) return new OnlineAudio(alternative, false, true, official, duration);
    } catch (Exception error) {
      if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
      android.util.Log.d("DotoSource", "Third-party source unavailable: " + error.getClass().getSimpleName());
    }
    if (official != null) return new OnlineAudio(official, true, false, null, duration);
    throw officialError;
  }

  boolean matchesDuration(long actualMs) {
    return sameDuration(durationMs, actualMs);
  }

  private static boolean sameDuration(long expectedMs, long actualMs) {
    return expectedMs > 0 && actualMs > 0
        && Math.abs(actualMs - expectedMs) <= Math.max(2500, expectedMs * .05);
  }

  private static String normalized(String value) {
    return Normalizer.normalize(value, Normalizer.Form.NFKC)
        .toLowerCase(Locale.ROOT).replaceAll("[\\p{P}\\p{Z}\\s]+", "");
  }

  private static java.util.Set<String> artists(String value) {
    java.util.Set<String> result = new java.util.HashSet<>();
    for (String name : value.split("[&、/／;,，；]")) {
      String key = normalized(name);
      if (!key.isEmpty()) result.add(key);
    }
    return result;
  }

  private static String kuwo(JSONObject song, long duration) throws Exception {
    String title = song.optString("name");
    JSONArray authors = song.optJSONArray("ar");
    if (authors == null) authors = song.optJSONArray("artists");
    java.util.Set<String> expectedArtists = new java.util.HashSet<>();
    for (int i = 0; authors != null && i < authors.length(); i++) {
      JSONObject author = authors.optJSONObject(i);
      if (author != null) expectedArtists.addAll(artists(author.optString("name")));
    }
    if (title.isBlank() || expectedArtists.isEmpty() || duration <= 0) return null;
    String name = normalized(title);
    String query = URLEncoder.encode(title, StandardCharsets.UTF_8.name());
    JSONArray sections = new JSONObject(get(
        "https://search.kuwo.cn/r.s?correct=1&stype=comprehensive&encoding=utf8"
            + "&rformat=json&mobi=1&searchapi=6&all=" + query)).optJSONArray("content");
    for (int i = 0; sections != null && i < sections.length(); i++) {
      JSONObject section = sections.optJSONObject(i);
      JSONObject page = section == null ? null : section.optJSONObject("musicpage");
      JSONArray tracks = page == null ? null : page.optJSONArray("abslist");
      for (int j = 0; tracks != null && j < tracks.length(); j++) {
        JSONObject track = tracks.optJSONObject(j);
        if (track == null || !name.equals(normalized(track.optString("SONGNAME")))
            || !expectedArtists.equals(artists(track.optString("ARTIST")))
            || !sameDuration(duration, track.optLong("DURATION") * 1000)) continue;
        String rid = track.optString("MUSICRID");
        if (!rid.matches("MUSIC_[0-9]+")) continue;
        if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
        String address = https(get("https://antiserver.kuwo.cn/anti.s?type=convert_url&rid="
            + rid + "&format=mp3&response=url").trim());
        if (address != null && URI.create(address).getHost().toLowerCase(Locale.ROOT).endsWith(".kuwo.cn"))
          return address;
      }
    }
    return null;
  }

  static String https(String value) {
    try {
      URI uri = URI.create(value);
      if (uri.getHost() == null || uri.getUserInfo() != null) return null;
      if ("https".equalsIgnoreCase(uri.getScheme())) return value;
      return "http".equalsIgnoreCase(uri.getScheme()) ? "https" + value.substring(4) : null;
    } catch (IllegalArgumentException error) {
      return null;
    }
  }

  private static String get(String address) throws Exception {
    HttpURLConnection connection = (HttpURLConnection) URI.create(address).toURL().openConnection();
    try {
      connection.setConnectTimeout(3500);
      connection.setReadTimeout(3500);
      connection.setInstanceFollowRedirects(false);
      if (connection.getResponseCode() != 200) throw new IOException("第三方音源不可用");
      try (var input = connection.getInputStream()) {
        byte[] bytes = input.readNBytes(1024 * 1024 + 1);
        if (bytes.length > 1024 * 1024) throw new IOException("第三方响应过大");
        return new String(bytes, StandardCharsets.UTF_8);
      }
    } finally {
      connection.disconnect();
    }
  }
}
