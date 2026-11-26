package com.volo.mobile;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Matrix;
import android.graphics.RenderEffect;
import android.graphics.Shader;
import android.graphics.SurfaceTexture;
import android.media.MediaPlayer;
import android.net.Uri;
import android.view.Surface;
import android.view.TextureView;
import android.widget.ImageView;

final class ProfileVideoBackdrop extends TextureView implements TextureView.SurfaceTextureListener {
  private final Uri uri;
  private final ImageView poster;
  private boolean frameVisible;
  private boolean hasPoster;
  private MediaPlayer player;
  private boolean prepared;
  private boolean seeking;
  private int resumePosition;
  private boolean active;

  ProfileVideoBackdrop(Context context, Uri uri, ImageView poster) {
    super(context);
    this.uri = uri;
    this.poster = poster;
    setOpaque(false);
    setSurfaceTextureListener(this);
  }

  void setActive(boolean active) {
    if (this.active && !active) savePoster();
    this.active = active;
    updatePlayback();
  }

  void setInitialPoster(Bitmap bitmap) {
    if (!hasPoster) setPoster(bitmap);
  }

  void setVideoBlur(int amount) {
    setBlur(this, amount);
    setBlur(poster, amount);
  }

  private void setPoster(Bitmap bitmap) {
    hasPoster = true;
    poster.setImageBitmap(bitmap);
    if (!frameVisible) poster.setVisibility(VISIBLE);
  }

  private void savePoster() {
    if (!frameVisible || !isAvailable() || getWidth() == 0 || getHeight() == 0) return;
    int width = Math.min(720, getWidth());
    int height = Math.max(1, Math.round((float) getHeight() * width / getWidth()));
    Bitmap frame = getBitmap(width, height);
    if (frame != null) {
      frameVisible = false;
      setPoster(frame);
    }
  }

  static void setBlur(android.view.View view, int amount) {
    float radius = amount * view.getResources().getDisplayMetrics().density * .24f;
    view.setRenderEffect(radius > 0
        ? RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP) : null);
  }

  private void updatePlayback() {
    if (!prepared || seeking) return;
    if (active && isShown() && getWindowVisibility() == VISIBLE) player.start();
    else if (player.isPlaying()) player.pause();
  }

  @Override protected void onWindowVisibilityChanged(int visibility) {
    super.onWindowVisibilityChanged(visibility);
    updatePlayback();
  }

  @Override public void onSurfaceTextureAvailable(SurfaceTexture texture, int width, int height) {
    release();
    MediaPlayer media = new MediaPlayer();
    player = media;
    Surface surface = new Surface(texture);
    try {
      media.setSurface(surface);
      media.setDataSource(getContext(), uri);
      media.setLooping(true);
      media.setVolume(0, 0);
      media.setOnPreparedListener(p -> {
        if (p != player) return;
        prepared = true;
        crop(p.getVideoWidth(), p.getVideoHeight(), getWidth(), getHeight());
        if (resumePosition > 0 && resumePosition < p.getDuration()) {
          seeking = true;
          p.seekTo(resumePosition, MediaPlayer.SEEK_CLOSEST);
        } else {
          updatePlayback();
        }
      });
      media.setOnSeekCompleteListener(p -> {
        if (p != player) return;
        seeking = false;
        updatePlayback();
      });
      media.setOnErrorListener((p, what, extra) -> {
        if (p == player) { release(); setVisibility(INVISIBLE); }
        return true;
      });
      media.prepareAsync();
    } catch (java.io.IOException | RuntimeException e) {
      release();
      setVisibility(INVISIBLE);
    } finally {
      surface.release();
    }
  }

  @Override public void onSurfaceTextureSizeChanged(SurfaceTexture texture, int width, int height) {
    if (prepared) crop(player.getVideoWidth(), player.getVideoHeight(), width, height);
  }

  private void crop(int videoWidth, int videoHeight, int width, int height) {
    if (videoWidth <= 0 || videoHeight <= 0 || width <= 0 || height <= 0) return;
    float ratio = ((float) videoWidth / videoHeight) / ((float) width / height);
    Matrix transform = new Matrix();
    transform.setScale(Math.max(1f, ratio), Math.max(1f, 1f / ratio), width / 2f, height / 2f);
    setTransform(transform);
  }

  @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture texture) {
    if (prepared && !seeking) resumePosition = player.getCurrentPosition();
    release();
    return true;
  }

  @Override public void onSurfaceTextureUpdated(SurfaceTexture texture) {
    if (!active || !prepared || seeking || frameVisible) return;
    frameVisible = true;
    poster.setVisibility(INVISIBLE);
  }

  private void release() {
    prepared = false;
    seeking = false;
    frameVisible = false;
    if (hasPoster) poster.setVisibility(VISIBLE);
    if (player != null) {
      player.release();
      player = null;
    }
  }
}
