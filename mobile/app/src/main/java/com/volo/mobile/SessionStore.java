package com.volo.mobile;

import android.content.Context;
import android.security.keystore.*;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import org.json.*;

/** Login cookies are encrypted at rest with a non-exportable Android Keystore key. */
final class SessionStore {
  private final Context context;

  SessionStore(Context context) {
    this.context = context;
  }

  private SecretKey key() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    if (!store.containsAlias("volo-session")) {
      KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
      generator.init(
          new KeyGenParameterSpec.Builder(
                  "volo-session", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
              .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
              .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
              .build());
      generator.generateKey();
    }
    return (SecretKey) store.getKey("volo-session", null);
  }

  void save(String value) throws Exception {
    Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
    c.init(Cipher.ENCRYPT_MODE, key());
    String encoded =
        Base64.encodeToString(c.getIV(), Base64.NO_WRAP)
            + ":"
            + Base64.encodeToString(
                c.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
    if (!context.getSharedPreferences("account", 0).edit().putString("session", encoded).commit())
      throw new java.io.IOException("登录信息保存失败");
  }

  String load() throws Exception {
    String encoded = context.getSharedPreferences("account", 0).getString("session", "");
    if (encoded.isEmpty()) return "";
    String[] parts = encoded.split(":");
    Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
    c.init(
        Cipher.DECRYPT_MODE,
        key(),
        new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
    return new String(c.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
  }

  void clear() {
    android.content.SharedPreferences accounts = context.getSharedPreferences("accounts", 0);
    String active = accounts.getString("active", "");
    accounts
        .edit()
        .remove("session:" + active)
        .remove("profile:" + active)
        .remove("active")
        .commit();
    context.getSharedPreferences("account", 0).edit().clear().commit();
  }

  void remember(JSONObject profile) {
    long id = profile.optLong("userId");
    if (id <= 0) return;
    String encrypted = context.getSharedPreferences("account", 0).getString("session", "");
    if (encrypted.isEmpty()) return;
    JSONObject publicProfile = new JSONObject();
    try {
      publicProfile
          .put("userId", id)
          .put("nickname", profile.optString("nickname", "网易云账号"))
          .put("avatarUrl", profile.optString("avatarUrl"));
    } catch (JSONException ignored) {
    }
    context
        .getSharedPreferences("accounts", 0)
        .edit()
        .putString("active", Long.toString(id))
        .putString("session:" + id, encrypted)
        .putString("profile:" + id, publicProfile.toString())
        .commit();
  }

  JSONArray accounts() {
    JSONArray list = new JSONArray();
    for (var entry : context.getSharedPreferences("accounts", 0).getAll().entrySet())
      if (entry.getKey().startsWith("profile:"))
        try {
          list.put(new JSONObject(entry.getValue().toString()));
        } catch (JSONException ignored) {
        }
    return list;
  }

  String cookieFor(long id) throws Exception {
    String encoded = context.getSharedPreferences("accounts", 0).getString("session:" + id, "");
    if (encoded.isEmpty()) throw new java.io.IOException("账号会话不存在，请重新添加");
    String[] parts = encoded.split(":");
    Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
    c.init(
        Cipher.DECRYPT_MODE,
        key(),
        new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
    return new String(c.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
  }

  void activate(long id) throws Exception {
    String cookie = cookieFor(id);
    save(cookie);
    context
        .getSharedPreferences("accounts", 0)
        .edit()
        .putString("active", Long.toString(id))
        .commit();
  }
}
