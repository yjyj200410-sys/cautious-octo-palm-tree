package com.volo.mobile;

import android.content.Context;
import android.net.Uri;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;

final class WallpaperLayout extends FrameLayout {
  private final FrameLayout videoLayer;
  private final View shade;
  private String source = "";
  private ProfileVideoBackdrop video;

  WallpaperLayout(Context context, View content) {
    super(context);
    videoLayer = new FrameLayout(context);
    shade = new View(context);
    addView(videoLayer, new LayoutParams(-1, -1));
    addView(shade, new LayoutParams(-1, -1));
    addView(content, new LayoutParams(-1, -1));
    refresh();
  }

  void refresh() {
    setBackground(DotoAppearance.background());
    var prefs = DotoAppearance.prefs(getContext());
    String next = "video".equals(prefs.getString("background", "default"))
        ? prefs.getString("wallpaper-video-uri", "") : "";
    if (!source.equals(next)) {
      source = next;
      videoLayer.removeAllViews();
      video = null;
      if (!source.isEmpty()) {
        ImageView poster = new ImageView(getContext());
        poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
        poster.setVisibility(INVISIBLE);
        video = new ProfileVideoBackdrop(getContext(), Uri.parse(source), poster);
        videoLayer.addView(video, new LayoutParams(-1, -1));
        videoLayer.addView(poster, new LayoutParams(-1, -1));
        video.setActive(true);
      }
    }
    if (video != null) video.setVideoBlur(prefs.getInt("background-blur", 50));
    int brightness = prefs.getInt("background-brightness", 50);
    shade.setBackgroundColor(video == null ? 0 : Math.round(255 * (1 - brightness / 100f)) << 24);
  }
}
