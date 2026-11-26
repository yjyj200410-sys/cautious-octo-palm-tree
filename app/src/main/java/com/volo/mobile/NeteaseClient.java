package com.volo.mobile;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.X509EncodedKeySpec;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import org.json.*;

/** Direct NetEase HTTPS transport; no desktop/local proxy required. */
final class NeteaseClient {
  volatile String cookie = "";

  static JSONObject json(Object... values) throws JSONException {
    JSONObject j = new JSONObject();
    for (int i = 0; i < values.length; i += 2) j.put((String) values[i], values[i + 1]);
    return j;
  }

  private static byte[] bytes(String s) {
    return s.getBytes(StandardCharsets.UTF_8);
  }

  private static String hex(byte[] b) {
    StringBuilder s = new StringBuilder();
    for (byte v : b) s.append(String.format(Locale.ROOT, "%02x", v & 255));
    return s.toString();
  }

  private static byte[] aes(String text, String key, boolean cbc) throws Exception {
    Cipher c = Cipher.getInstance(cbc ? "AES/CBC/PKCS5Padding" : "AES/ECB/PKCS5Padding");
    SecretKeySpec k = new SecretKeySpec(bytes(key), "AES");
    if (cbc) c.init(Cipher.ENCRYPT_MODE, k, new IvParameterSpec(bytes("0102030405060708")));
    else c.init(Cipher.ENCRYPT_MODE, k);
    return c.doFinal(bytes(text));
  }

  JSONObject request(String path, JSONObject data, boolean web) throws Exception {
    data.put("e_r", false);
    String body, url;
    if (web) {
      data.put("csrf_token", cookieValue("__csrf"));
      String secret = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
      String first =
          java.util.Base64.getEncoder()
              .encodeToString(aes(data.toString(), "0CoJUm6Qyw8W8jud", true));
      String params = java.util.Base64.getEncoder().encodeToString(aes(first, secret, true));
      String publicKey =
          "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB";
      Cipher rsa = Cipher.getInstance("RSA/ECB/NoPadding");
      rsa.init(
          Cipher.ENCRYPT_MODE,
          KeyFactory.getInstance("RSA")
              .generatePublic(
                  new X509EncodedKeySpec(java.util.Base64.getDecoder().decode(publicKey))));
      body =
          "params="
              + URLEncoder.encode(params, "UTF-8")
              + "&encSecKey="
              + hex(rsa.doFinal(bytes(new StringBuilder(secret).reverse().toString())));
      url = "https://music.163.com/weapi/" + path.substring(5);
    } else {
      JSONObject header =
          json(
              "os",
              "pc",
              "appver",
              "3.1.17.204416",
              "deviceId",
              "volo-mobile",
              "requestId",
              System.currentTimeMillis() + "_0001",
              "__csrf",
              cookieValue("__csrf"));
      String music = cookieValue("MUSIC_U");
      if (!music.isEmpty()) header.put("MUSIC_U", music);
      data.put("header", header);
      String text = data.toString();
      String digest =
          hex(
              MessageDigest.getInstance("MD5")
                  .digest(bytes("nobody" + path + "use" + text + "md5forencrypt")));
      body =
          "params="
              + hex(aes(
                      path + "-36cd479b6b5-" + text + "-36cd479b6b5-" + digest,
                      "e82ckenh8dichen8",
                      false))
                  .toUpperCase(Locale.ROOT);
      url = "https://interface.music.163.com/eapi/" + path.substring(5);
    }
    HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
    try {
      connection.setConnectTimeout(12000);
      connection.setReadTimeout(15000);
      connection.setRequestMethod("POST");
      connection.setDoOutput(true);
      connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
      connection.setRequestProperty("Referer", "https://music.163.com/");
      connection.setRequestProperty("User-Agent", "Mozilla/5.0");
      connection.setRequestProperty(
          "Cookie", cookie + "; os=pc; appver=3.1.17.204416; __remember_me=true");
      try (OutputStream out = connection.getOutputStream()) {
        out.write(bytes(body));
      }
      int status = connection.getResponseCode();
      if (status != 200) throw new IOException("网易云请求失败 HTTP " + status);
      byte[] response;
      try (InputStream in = connection.getInputStream()) {
        response = in.readNBytes(8 * 1024 * 1024 + 1);
      }
      if (response.length > 8 * 1024 * 1024) throw new IOException("响应过大");
      JSONObject result = new JSONObject(new String(response, StandardCharsets.UTF_8));
      // Only login responses are allowed to replace the saved account session.
      if ((path.equals("/api/w/login/cellphone") && result.optInt("code") == 200)
          || (path.equals("/api/login/qrcode/client/login") && result.optInt("code") == 803)) {
        StringBuilder session = new StringBuilder();
        for (var entry : connection.getHeaderFields().entrySet())
          if (entry.getKey() != null && entry.getKey().equalsIgnoreCase("Set-Cookie"))
            for (String value : entry.getValue())
              session.append(value.split(";", 2)[0]).append("; ");
        result.put("sessionCookie", session.toString());
      }
      int code = result.optInt("code", 200);
      if (code != 200
          && !(path.equals("/api/login/qrcode/client/login") && code >= 800 && code <= 803))
        throw new IOException(
            "网易云返回 " + code + "：" + result.optString("message", result.optString("msg", "请求失败")));
      return result;
    } finally {
      connection.disconnect();
    }
  }

  private String cookieValue(String name) {
    for (String part : cookie.split(";")) {
      String[] pair = part.trim().split("=", 2);
      if (pair.length == 2 && pair[0].equals(name)) return pair[1];
    }
    return "";
  }

  JSONObject search(String query) throws Exception {
    return request(
        "/api/cloudsearch/pc",
        json("s", query, "type", 1, "limit", 30, "offset", 0, "total", true),
        false);
  }

  JSONObject profile() throws Exception {
    return request("/api/w/nuser/account/get", json(), true).optJSONObject("profile");
  }

  String qrKey() throws Exception {
    return request("/api/login/qrcode/unikey", json("type", 3), false).getString("unikey");
  }

  JSONObject qrCheck(String key) throws Exception {
    return request("/api/login/qrcode/client/login", json("key", key, "type", 3), false);
  }

  JSONArray playlists(long user) throws Exception {
    return request(
            "/api/user/playlist",
            json("uid", user, "limit", 100, "offset", 0, "includeVideo", true),
            true)
        .getJSONArray("playlist");
  }

  JSONArray personalRadio() throws Exception {
    return request("/api/v1/radio/get", json(), true).getJSONArray("data");
  }

  JSONArray dailySongs() throws Exception {
    JSONObject result = request("/api/v3/discovery/recommend/songs", json(), true);
    JSONObject data = result.optJSONObject("data");
    JSONArray songs =
        data == null ? result.optJSONArray("recommend") : data.optJSONArray("dailySongs");
    return songs == null ? new JSONArray() : songs;
  }

  JSONArray recommendedPlaylists() throws Exception {
    JSONArray result =
        request("/api/personalized/playlist", json("limit", 30, "total", true, "n", 1000), true)
            .optJSONArray("result");
    JSONArray combined=new JSONArray();java.util.Set<String> ids=new java.util.HashSet<>();
    if(!cookie.isEmpty())try{JSONArray personal=request("/api/v1/discovery/recommend/resource",json(),true).optJSONArray("recommend");for(int i=0;personal!=null&&i<personal.length();i++){JSONObject item=personal.optJSONObject(i);if(item!=null&&item.optLong("id")>0&&ids.add(item.optString("id")))combined.put(item);}}catch(Exception error){android.util.Log.w("DotoDiscovery","Personal playlists unavailable",error);}
    for(int i=0;result!=null&&i<result.length();i++){JSONObject item=result.optJSONObject(i);if(item!=null&&item.optLong("id")>0&&ids.add(item.optString("id")))combined.put(item);}return combined;
  }

  JSONArray discoverySections(boolean refresh)throws Exception{
    JSONArray sections=DiscoverySections.parse(homepage(refresh));
    if(DiscoverySections.curatedCount(sections)>0&&DiscoverySections.curatedCount(sections)<12){try{sections=DiscoverySections.mergeCurated(sections,DiscoverySections.parse(homepage(true)));}catch(Exception error){android.util.Log.w("DotoDiscovery","Additional curated batch unavailable",error);}}
    return sections;
  }
  JSONObject homepage(boolean refresh)throws Exception{return request("/api/homepage/block/page",json("refresh",refresh),true);}
  JSONArray heartSongs(long song,long playlist)throws Exception{
    JSONArray data=request("/api/playmode/intelligence/list",json("songId",song,"playlistId",playlist,"startMusicId",song,"type","fromPlayOne","count",20),false).getJSONArray("data"),songs=new JSONArray();
    for(int i=0;i<data.length();i++){JSONObject item=data.optJSONObject(i),info=item==null?null:item.optJSONObject("songInfo");if(info!=null)songs.put(info);}return songs;
  }
  JSONArray playlistPage(int offset)throws Exception{return request("/api/playlist/list",json("cat","全部","order","hot","limit",30,"offset",offset,"total",true),true).getJSONArray("playlists");}

  JSONArray tracks(long id) throws Exception {
    return request("/api/v6/playlist/detail", json("id", id, "n", 1000, "s", 0), false)
        .getJSONObject("playlist")
        .getJSONArray("tracks");
  }

  JSONArray likedIds(long user) throws Exception {
    JSONArray ids = request("/api/song/like/get", json("uid", user), false).optJSONArray("ids");
    return ids == null ? new JSONArray() : ids;
  }

  void editPlaylist(long list,long song,boolean remove) throws Exception {
    JSONObject result=request("/api/playlist/manipulate/tracks",json("op",remove?"del":"add","pid",list,"trackIds","["+song+"]","imme","true"),false);
    if(result.optInt("code",200)!=200)throw new java.io.IOException("修改失败："+result.optInt("code"));
  }
  void setLike(long id, boolean like) throws Exception {
    request(
        "/api/radio/like",
        json("alg", "itembased", "trackId", id, "like", like, "time", "3"),
        true);
  }

  JSONObject resolve(long id) throws Exception {
    JSONArray list =
        request(
                "/api/song/enhance/player/url/v1",
                json("ids", "[" + id + "]", "level", "standard", "encodeType", "mp3"),
                false)
            .getJSONArray("data");
    if (list.length() == 0) throw new IOException("没有可用音源");
    JSONObject song = list.getJSONObject(0);
    String url = song.optString("url", "");
    if (song.optInt("code", 200) != 200 || url.isEmpty() || url.equals("null"))
      throw new IOException("当前账号无可用音源");
    return song;
  }

  static boolean isTrial(JSONObject source) {
    return !source.isNull("freeTrialInfo") && !"null".equals(source.optString("freeTrialInfo"));
  }
}
