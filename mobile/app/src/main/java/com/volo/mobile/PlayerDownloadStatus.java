package com.volo.mobile;

import android.app.DownloadManager;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import java.util.ArrayList;
import java.util.Map;

/** Read-only status of the existing system download, never inferred from an enqueue request. */
record PlayerDownloadStatus(boolean complete, boolean busy, int percent) {
  static final PlayerDownloadStatus IDLE = new PlayerDownloadStatus(false, false, 0);
  static final PlayerDownloadStatus WAITING = new PlayerDownloadStatus(false, true, 0);

  static PlayerDownloadStatus read(
      Context context, DownloadManager manager, String songId, boolean local) {
    if (local && !songId.matches("[0-9]+")) return new PlayerDownloadStatus(true, false, 100);
    Map<String, ?> saved = context.getSharedPreferences("downloads", 0).getAll();
    Map<String, ?> songs = context.getSharedPreferences("download-song-ids", 0).getAll();
    ArrayList<Long> ids = new ArrayList<>();
    for (String key : saved.keySet()) {
      try {
        ids.add(Long.parseLong(key));
      } catch (NumberFormatException ignored) {
      }
    }
    if (ids.isEmpty()) return IDLE;
    long[] filter = new long[ids.size()];
    for (int i = 0; i < ids.size(); i++) filter[i] = ids.get(i);
    try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(filter))) {
      return fromRows(cursor, songs, songId);
    }
  }

  static PlayerDownloadStatus fromRows(Cursor cursor, Map<String, ?> songs, String songId) {
    PlayerDownloadStatus result = IDLE;
    while (cursor != null && cursor.moveToNext()) {
      long id = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_ID));
      Object mappedSong = songs.get(Long.toString(id));
      String mapped = mappedSong == null ? "" : mappedSong.toString();
      String localUri =
          cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI));
      String file = localUri == null ? "" : Uri.parse(localUri).getLastPathSegment();
      if (!songId.equals(mapped)
          && !songId.equals("download:" + id)
          && (file == null || !file.startsWith(songId + "-"))) continue;
      int state = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
      if (state == DownloadManager.STATUS_SUCCESSFUL)
        return new PlayerDownloadStatus(true, false, 100);
      if (state == DownloadManager.STATUS_PENDING
          || state == DownloadManager.STATUS_RUNNING
          || state == DownloadManager.STATUS_PAUSED) {
        long total =
            cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
        long bytes =
            cursor.getLong(
                cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
        result =
            new PlayerDownloadStatus(
                false, true, total > 0 ? (int) Math.min(99, bytes * 100 / total) : 0);
      }
    }
    return result;
  }
}
