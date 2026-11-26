package com.volo.mobile;

import android.animation.ValueAnimator;
import android.app.*;
import android.content.Context;
import android.graphics.*;
import android.graphics.drawable.ColorDrawable;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.view.*;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.*;
import java.util.*;

/** Reference artwork uses a 931 x 2048 design canvas, scaled to the display. */
final class SpatialPlayer extends Dialog {
  private static final int PLAYER_CARD=0xffdeded9;
  private static final int PLAYER_CARD_INK=0xff202020;
  private static final int PLAYER_CARD_MUTED=0xff666666;
  interface Actions {
    void toggle();

    void seek(int value);

    default void seekLyric(int millis, int duration) {
      seek((int)Math.min(1000, ((long)millis * 1000 + duration - 1) / duration));
    }

    void previous();

    void next();

    default void requestLyrics() {}

    default void showEffects() {}

    default void faceChanged(boolean back) {}

    default int previewTrack(int direction) {
      return -1;
    }

    void split();

    void mode(String name);

    void export();

    void queue(int index);
    default void removeQueue(int index){}
    default void moveQueue(int from,int to){}

    void favorite(boolean value);

    default void order(PlaybackOrder.Mode value) {}

    default void shuffle(boolean enabled) {}

    default void download() {}
  }

  private final Activity activity;
  private final Actions actions;
  private final Layout root;

  View effectsBackdrop() { return root; }
  private final Scene scene;
  private final ArtworkLoader images = new ArtworkLoader();
  private final HashMap<String, Bitmap> artwork = new HashMap<>();
  private final android.util.LruCache<String, Bitmap> thumbnails = new android.util.LruCache<>(64);
  private final HashSet<String> requested = new HashSet<>();
  private final HashMap<String, Integer> artworkFailures = new HashMap<>();
  private final HashMap<String, Long> artworkRetryAfter = new HashMap<>();
  private final Handler artworkRetries = new Handler();
  private final Runnable retryArtwork = this::preload;
  private String song, artist, album, message = "";
  private String[] queue, covers, artists, albums;
  private int current, preview, position, duration;
  private long progressSampleTime;

  private float displayedPosition() {
    if (draggingSeek) return (float)((long)seek.getProgress()*duration/1000);
    long elapsed = playing && duration>0
        ? Math.min(650, Math.max(0,android.os.SystemClock.uptimeMillis()-progressSampleTime)) : 0;
    return Math.max(0,Math.min(duration,position+elapsed));
  }
  private boolean playing, liked, running, ready, draggingSeek, draggingRail, closed;
  private String mode;
  private boolean cancelSeekCommit;
  private SensorManager motion;
  private Sensor rotation;
  private boolean motionRegistered, orientationReady;
  private float neutralPitch, neutralRoll, tiltX, tiltY;
  private long lastPoseFrameNanos;
  private float targetTiltX, targetTiltY;
  private boolean poseFrameScheduled;
  private int poseRenderedFrames;
  private final Choreographer.FrameCallback poseFrame = this::renderPoseFrame;

  private static final float TILT_TRANSLATION_LIMIT = 110f;

  private void stopPoseFrames() {
    Choreographer.getInstance().removeFrameCallback(poseFrame);
    poseFrameScheduled = false;
    lastPoseFrameNanos = 0;
  }

  private void schedulePoseFrame() {
    if (!closed && !poseFrameScheduled) {
      poseFrameScheduled = true;
      Choreographer.getInstance().postFrameCallback(poseFrame);
    }
  }

  private void renderPoseFrame(long frameTimeNanos) {
    poseFrameScheduled = false;
    if (closed
        || returningToPlane
        || motionRested
        || cardDragging
        || trackAnimation != null
        || capsuleSpring != null
        || root.morphProgress > 0) {
      lastPoseFrameNanos = 0;
      return;
    }
    double seconds =
        lastPoseFrameNanos == 0
            ? 1.0 / Math.max(30, activity.getDisplay().getRefreshRate())
            : Math.min(.05, (frameTimeNanos - lastPoseFrameNanos) / 1_000_000_000.0);
    lastPoseFrameNanos = frameTimeNanos;
    float blend = (float) -Math.expm1(-seconds / .11);
    float maxStep = (float) (180 * seconds);
    tiltX += Math.max(-maxStep, Math.min(maxStep, (targetTiltX - tiltX) * blend));
    tiltY += Math.max(-maxStep, Math.min(maxStep, (targetTiltY - tiltY) * blend));
    boolean settled =
        Math.max(Math.abs(targetTiltX - tiltX), Math.abs(targetTiltY - tiltY)) < .015f;
    if (settled) {
      tiltX = targetTiltX;
      tiltY = targetTiltY;
    }
    poseRenderedFrames++;
    redraw();
    if (!settled) schedulePoseFrame();
    else lastPoseFrameNanos = 0;
  }

  private static final float MAX_CARD_TILT = 45f;
  private static final float PERSPECTIVE_STRENGTH = .60f;
  private static final float MOTION_DEAD_ZONE = 2f;
  private final Handler motionFrames = new Handler();
  private float latestPitch, latestRoll, significantPitch, significantRoll;
  private boolean returningToPlane, motionRested;
  private ValueAnimator orientationReturn, capsuleAnimation;
  private static final float CAPSULE_DRAG_RANGE = 260f;
  private static final float CAPSULE_OVERDRAG = 80f;
  private float capsulePull = CAPSULE_DRAG_RANGE;
  private CapsuleSpring capsuleSpring;
  private boolean cardDragging;
  private float capsuleFraction = 1, cardOverdrag;
  private boolean capsuleHidden = true, capsuleTouching;
  private int capsuleSide = 1;
  private static final float TRACK_DRAG_RANGE = 560f;
  private float flipProgress;
  private boolean lyricsBack, splitImmersive;
  private float splitAmount;
  private boolean splitActive() { return splitImmersive && controlsCollapsed && root.wide(); }
  private ValueAnimator flipAnimation, lyricAnimation, lyricRevealAnimation;
  private float lyricReveal = 1;
  private boolean lyricReady = true, pendingLyricReveal;
  private float lyricFocus, lyricWindow;
  private float extraLyricRows() { return root.wide() ? 0f : focusAmount; }
  private float lyricStep() { return 188f; }
  private float lyricTop() { return 202f - lyricStep() * extraLyricRows(); }
  private float lyricStart() { return lyricWindow - extraLyricRows(); }
  private float lyricBottom() { return 1160f + lyricStep() * extraLyricRows(); }
  private int lyricTarget = -1;
  private String lyricsText = "长按查看歌词";
  private String[] lyricSentences = {"长按查看歌词"};
  private final ArrayList<Integer> lyricTimes = new ArrayList<>();
  private final ArrayList<android.text.StaticLayout> lyricRows = new ArrayList<>();

  private boolean timelineStarted, lyricsRequested;

  void requestTrackLyrics() {
    if (lyricsRequested) return;
    lyricsRequested = true;
    actions.requestLyrics();
  }

  private final ArrayList<String> translatedLines = new ArrayList<>();

  static java.util.TreeMap<Integer,String> parseTimedLines(String raw, StringBuilder plain) {
    java.util.TreeMap<Integer, String> lines = new java.util.TreeMap<>();
    java.util.regex.Pattern stamps =
        java.util.regex.Pattern.compile("\\[(\\d+):(\\d+(?:\\.\\d+)?)\\]");

    for (String line : raw.split("\\r?\\n")) {
      java.util.regex.Matcher match = stamps.matcher(line);
      String content = line.replaceAll("\\[[^\\]]*\\]", "").trim();
      boolean timed = false;
      while (match.find()) {
        timed = true;
        int time =
            (int)
                ((Integer.parseInt(match.group(1)) * 60 + Double.parseDouble(match.group(2)))
                    * 1000);
        if (!content.isEmpty()) lines.put(time, content);
      }
      if (plain != null && !timed && !content.isEmpty()) plain.append(content).append('\n');
    }
    return lines;
  }

  void lyrics(String raw) {
    lyrics(raw, "");
  }

  void lyrics(String raw, String translation) {
    if (raw.startsWith("歌词加载失败")) lyricsRequested = false;
    lyricReady = !raw.equals("歌词加载中…");
    if (!lyricReady) {
      if (lyricRevealAnimation != null) lyricRevealAnimation.cancel();
      lyricReveal = 0;
      pendingLyricReveal = true;
    }
    scene.mappedDuration = -1;
    lyricTimes.clear();
    lyricRows.clear();
    StringBuilder plain = new StringBuilder();
    java.util.TreeMap<Integer,String> lines = parseTimedLines(raw, plain);
    java.util.TreeMap<Integer,String> translated = parseTimedLines(translation, null);
    translatedLines.clear();
    StringBuilder text = new StringBuilder();
    for (java.util.Map.Entry<Integer, String> entry : lines.entrySet()) {
      lyricTimes.add(entry.getKey());
      String subtitle = translated.get(entry.getKey());
      translatedLines.add(entry.getValue().equals(subtitle) ? null : subtitle);
      text.append(entry.getValue()).append('\n');
    }
    lyricsText = text.length() > 0 ? text.toString().trim() : plain.toString().trim();
    if (lyricsText.isEmpty()) lyricsText = "暂无歌词";
    lyricSentences = lyricsText.split("\\n");
    lyricTarget = -1;
    updateLyricMotion(false);
    revealLyricsIfReady();
    redraw();
  }

  private void revealLyricsIfReady() {
    if (!pendingLyricReveal || !lyricReady || !lyricsBack || trackAnimation != null) return;
    pendingLyricReveal = false;
    if (lyricRevealAnimation != null) lyricRevealAnimation.cancel();
    if (!ValueAnimator.areAnimatorsEnabled()) {
      lyricReveal = 1;
      return;
    }
    lyricRevealAnimation = ValueAnimator.ofFloat(lyricReveal, 1);
    lyricRevealAnimation.setDuration(460);
    lyricRevealAnimation.setInterpolator(new android.view.animation.LinearInterpolator());
    lyricRevealAnimation.addUpdateListener(
        a -> {
          float t = (float) a.getAnimatedValue();
          lyricReveal = t * t * t * (10 + t * (-15 + 6 * t));
          redraw();
        });
    lyricRevealAnimation.start();
  }

  private void updateLyricMotion(boolean animate) {
    int selected = 0;
    for (int i = 0; i < lyricTimes.size(); i++) {
      if (lyricTimes.get(i) > position) break;
      selected = i;
    }
    if (selected == lyricTarget && animate) return;
    lyricTarget = selected;
    if (lyricAnimation != null) lyricAnimation.cancel();
    float nextWindow = selected - 2;
    if (!animate || (!lyricsBack && !splitActive()) || !ValueAnimator.areAnimatorsEnabled()) {
      lyricFocus = selected;
      lyricWindow = nextWindow;
      return;
    }
    final float fromFocus = lyricFocus, fromWindow = lyricWindow, toFocus = selected;
    lyricAnimation = ValueAnimator.ofFloat(0, 1);
    lyricAnimation.setDuration(580);
    lyricAnimation.setInterpolator(new android.view.animation.LinearInterpolator());
    lyricAnimation.addUpdateListener(
        a -> {
          float phase = (float) a.getAnimatedValue();
          // Zero velocity and acceleration at both ends: no initial kick or abrupt stop.
          float t = phase * phase * phase * (10 + phase * (-15 + 6 * phase));
          lyricFocus = fromFocus + (toFocus - fromFocus) * t;
          lyricWindow = fromWindow + (nextWindow - fromWindow) * t;
          redraw();
        });
    lyricAnimation.start();
  }

  boolean isLyricsFace() {
    return flipProgress >= .5f;
  }

  void restoreLyricsFace(boolean back) {
    if (flipAnimation != null) flipAnimation.cancel();
    lyricsBack = back;
    flipProgress = back ? 1 : 0;
    updateLyricMotion(false);
    redraw();
  }

  private boolean flippingToClose;

  private void flipCard() {
    if (flippingToClose) return;
    root.cancelBlankGesture();
    if (flipAnimation != null) flipAnimation.cancel();
    if (splitActive()) {
      splitImmersive = false;
    } else if (controlsCollapsed && root.wide() && lyricsBack) {
      splitImmersive = true;
      lyricsBack = false;
    } else {
      lyricsBack = !lyricsBack;
    }
    actions.faceChanged(lyricsBack);
    updateLyricMotion(false);
    if (lyricsBack || splitImmersive) {
      requestTrackLyrics();
      revealLyricsIfReady();
    }
    float startFlip = flipProgress;
    float targetFlip = lyricsBack ? 1f : 0f;
    float startSplit = splitAmount;
    float targetSplit = splitImmersive ? 1f : 0f;
    flipAnimation = ValueAnimator.ofFloat(0f, 1f);
    flipAnimation.setDuration(ValueAnimator.areAnimatorsEnabled() ? 460 : 0);
    flipAnimation.setInterpolator(UiMotion.CURVE);
    flipAnimation.addUpdateListener(a -> {
      float progress = (float) a.getAnimatedValue();
      flipProgress = startFlip + (targetFlip - startFlip) * progress;
      splitAmount = startSplit + (targetSplit - startSplit) * progress;
      redraw();
    });
    flipAnimation.start();
  }

  private float trackProgress;
  private int trackRenderedFrames;
  private int trackDirection;
  private int dragTrackIndex = -1;
  private int trackIncomingDraws;
  private Bitmap outgoingCover;
  private String outgoingSong, outgoingArtist;
  private ValueAnimator trackAnimation;
  private final Handler capsuleIdle = new Handler();
  private final Runnable hideIdleCapsule = this::hideIdleCapsule;

  private void hideIdleCapsule() {
    if (!closed
        && !capsuleHidden
        && !capsuleTouching
        && !draggingRail
        && capsuleSpring == null
        && root.morphProgress == 0) settleCapsule(true);
  }

  private void armCapsuleIdle() {
    capsuleIdle.removeCallbacks(hideIdleCapsule);
    if (!closed
        && !capsuleHidden
        && !capsuleTouching
        && !draggingRail
        && capsuleSpring == null
        && root.morphProgress == 0) capsuleIdle.postDelayed(hideIdleCapsule, 2000);
  }

  private java.util.function.Consumer<Bitmap> onCollapsed;

  void setOnCollapsed(java.util.function.Consumer<Bitmap> callback) {
    onCollapsed = callback;
  }

  private View lightSwitch, controlsSwitch;
  private boolean controlsCollapsed, blackBackground;
  private float focusAmount;
  private ValueAnimator focusAnimator, lightAnimator;
  private float darkness;

  private void animateBackground() {
    if (lightAnimator != null) lightAnimator.cancel();
    lightAnimator = ValueAnimator.ofFloat(darkness, blackBackground ? 1f : 0f);
    lightAnimator.setDuration(ValueAnimator.areAnimatorsEnabled() ? 300 : 0);
    lightAnimator.addUpdateListener(animation -> {
      darkness = (float) animation.getAnimatedValue();
      scene.invalidate();
    });
    lightAnimator.start();
  }
  private final Runnable hideFocusButtons = () -> {
    if (!controlsCollapsed || closed) return;
    lightSwitch.setVisibility(View.INVISIBLE);
    controlsSwitch.setVisibility(View.INVISIBLE);
  };

  private void showFocusButtons() {
    lightSwitch.setVisibility(View.VISIBLE);
    controlsSwitch.setVisibility(View.VISIBLE);
    root.removeCallbacks(hideFocusButtons);
    if (controlsCollapsed) root.postDelayed(hideFocusButtons, 2000);
  }

  private void toggleControls() {
    controlsCollapsed = !controlsCollapsed;
    if (!controlsCollapsed && splitImmersive) {
      splitImmersive = false;
      if (flipAnimation != null) flipAnimation.cancel();
      flipProgress = 0f;
    }
    controlsSwitch.setContentDescription(controlsCollapsed ? "展开播放控件" : "收起播放控件");
    controlsSwitch.invalidate();
    showFocusButtons();
    if (focusAnimator != null) focusAnimator.cancel();
    focusAnimator = ValueAnimator.ofFloat(focusAmount, controlsCollapsed ? 1f : 0f);
    focusAnimator.setDuration(ValueAnimator.areAnimatorsEnabled() ? 320 : 0);
    focusAnimator.addUpdateListener(animation -> {
      focusAmount = (float) animation.getAnimatedValue();
      if (focusAmount == 0f && !controlsCollapsed) splitAmount = 0f;
      for (View child : root.bounds.keySet()) {
        if (child == rail) {
          child.setTranslationY(root.railShiftY());
          continue;
        }
        child.setTranslationY(root.controlDrop());
        child.setVisibility(focusAmount >= 1f ? View.INVISIBLE : View.VISIBLE);
      }
      scene.invalidate();
    });
    focusAnimator.start();
  }

  private View focusButton(boolean light) {
    View button = new View(activity) {
      private final Paint ink = new Paint(Paint.ANTI_ALIAS_FLAG);
      @Override protected void onDraw(Canvas canvas) {
        canvas.save();
        canvas.translate(getWidth() / 2f, getHeight() / 2f);
        float unit = Math.min(getWidth(), getHeight()) / 48f;
        canvas.scale(unit, unit);
        ink.setColor(Color.WHITE);
        ink.setStyle(Paint.Style.STROKE);
        ink.setStrokeWidth(2);
        ink.setStrokeCap(Paint.Cap.ROUND);
        if (light) {
          canvas.drawArc(-5, -7, 5, 3, 145, 250, false, ink);
          canvas.drawLine(-3, 2, -2, 5, ink);
          canvas.drawLine(3, 2, 2, 5, ink);
          canvas.drawLine(-2, 5, 2, 5, ink);
          canvas.drawLine(-1, 8, 1, 8, ink);
          if (!blackBackground) {
            canvas.drawLine(-10, -2, -8, -2, ink);
            canvas.drawLine(8, -2, 10, -2, ink);
            canvas.drawLine(0, -12, 0, -10, ink);
          }
        } else {
          float direction = controlsCollapsed ? -1 : 1;
          canvas.drawLine(-6, -3 * direction, 0, 3 * direction, ink);
          canvas.drawLine(0, 3 * direction, 6, -3 * direction, ink);
        }
        canvas.restore();
      }
    };
    button.setContentDescription(light ? "关闭背景灯光" : "收起播放控件");
    GlassUi.touch(button, () -> {
      if (light) {
        blackBackground = !blackBackground;
        button.setContentDescription(blackBackground ? "开启背景灯光" : "关闭背景灯光");
        button.invalidate();
        animateBackground();
        showFocusButtons();
      } else toggleControls();
    });
    return button;
  }

  private ValueAnimator entranceAnimator;
  private float entrance=1;

  private float entranceOffset(int group) {
    float delay=group*.045f;
    float t=Math.max(0,Math.min(1,(entrance-delay)/(1-delay)));
    float u=t-1;
    float eased=1+2.5f*u*u*u+1.5f*u*u;
    return (1-eased)*(group==0 ? 65 : 95);
  }

  private void startEntrance() {
    if (entranceAnimator!=null) entranceAnimator.cancel();
    entrance=0;
    entranceAnimator=ValueAnimator.ofFloat(0,1);
    entranceAnimator.setDuration(ValueAnimator.areAnimatorsEnabled() ? 850 : 0);
    entranceAnimator.setInterpolator(t -> t);
    entranceAnimator.addUpdateListener(a -> {
      entrance=(float)a.getAnimatedValue();
      if (entrance == 1f) root.startCoverTailIfReady();
      for (Map.Entry<View,RectF> entry:root.bounds.entrySet()) {
        View child=entry.getKey();
        if (child==scene) continue;
        int group=child==heartButton ? 2 : child==repeatButton ? 3
            : child==downloadButton ? 4 : child==source ? 5 : (child==playButton || child==previousButton || child==nextButton) ? 6 : 1;
        child.setTranslationY(entranceOffset(group)*root.unitY() + (child == rail ? 0 : root.controlDrop()));
      }
      scene.invalidate(); root.invalidate();
    });
    entranceAnimator.start();
  }

  void expandFromCapsule() {
    startEntrance();
    root.beginOpening();
    root.setMorph(1);
    root.post(
        () -> {
          root.prepareCover();
          root.finishPull(false);
        });
  }

  void beginCapsuleDrag(boolean horizontal) {
    startEntrance();
    root.beginOpening();
    root.openingHorizontal = horizontal;
    root.setMorph(1);
    root.post(root::prepareCover);
  }

  void dragFromCapsule(float fraction) {
    root.setMorph(1 - fraction);
  }

  void endCapsuleDrag(float openingVelocity, boolean cancelled) {
    getWindow()
        .clearFlags(
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
    root.finishOpeningGesture(openingVelocity, cancelled);
  }

  float collapseProgress() {
    return root.morphProgress;
  }

  private final Runnable resetPlane =
      () -> {
        if (closed || cardDragging || trackAnimation != null) return;
        stopPoseFrames();
        neutralPitch = latestPitch;
        neutralRoll = latestRoll;
        significantPitch = latestPitch;
        significantRoll = latestRoll;
        returningToPlane = true;
        final float fromX = tiltX, fromY = tiltY;
        orientationReturn = ValueAnimator.ofFloat(0, 1);
        orientationReturn.setDuration(900);
        orientationReturn.setInterpolator(UiMotion.CURVE);
        orientationReturn.addUpdateListener(
            a -> {
              float remaining = 1 - (Float) a.getAnimatedValue();
              tiltX = fromX * remaining;
              tiltY = fromY * remaining;
              if (remaining == 0) {
                returningToPlane = false;
                motionRested = true;
              }
              redraw();
            });
        orientationReturn.start();
      };

  private Matrix cardMatrix() {
    Camera camera = new Camera();
    Matrix perspective = new Matrix();
    camera.setLocation(0, 0, -18 / PERSPECTIVE_STRENGTH);
    camera.rotateX(-tiltX * .75f);
    camera.rotateY(tiltY * .75f + (flipProgress <= .5f ? flipProgress : flipProgress - 1) * 180);
    camera.getMatrix(perspective);
    perspective.preTranslate(-358, -743);
    perspective.postTranslate(358, 743);
    Matrix placement = new Matrix();
    float depth = cardOverdrag / CAPSULE_OVERDRAG;
    float scale =
        (.92f + .12f * capsuleFraction * capsuleFraction * (3 - 2 * capsuleFraction))
            * (1 - .03f * depth * depth);
    placement.setScale(scale, scale, 358, 743);
    placement.postTranslate(
        107.5f
            - capsuleSide * 128 * (1 - capsuleFraction)
            + cardExtraOffset()
            + tiltY * TILT_TRANSLATION_LIMIT / MAX_CARD_TILT,
        -tiltX * TILT_TRANSLATION_LIMIT / MAX_CARD_TILT);
    placement.preConcat(perspective);
    return placement;
  }

  // Both cards share one spring coordinate: depth, perspective and lateral motion stay in phase.
  private Matrix trackCardMatrix(boolean incoming) {
    float distance = incoming ? 1 - trackProgress : trackProgress;
    Camera camera = new Camera();
    camera.setLocation(0, 0, -18 / PERSPECTIVE_STRENGTH);
    camera.translate(0, 0, 170 * distance);
    camera.rotateY(trackDirection * (incoming ? 16 : -20) * distance);
    camera.rotateZ(trackDirection * (incoming ? -1.5f : 2.5f) * distance);
    Matrix perspective = new Matrix();
    camera.getMatrix(perspective);
    perspective.preTranslate(-358, -743);
    perspective.postTranslate(358, 743);
    Matrix matrix = cardMatrix();
    matrix.preConcat(perspective);
    matrix.preScale(1 - .13f * distance, 1 - .13f * distance, 358, 743);
    matrix.postTranslate(trackDirection * (incoming ? -470 : 440) * distance, 38 * distance);
    return matrix;
  }

  private static float smoothRange(float value, float from, float to) {
    float t = Math.max(0, Math.min(1, (value - from) / (to - from)));
    return t * t * (3 - 2 * t);
  }

  private boolean cardAt(float x, float y) {
    Matrix inverse = new Matrix();
    Matrix hit =
        outgoingSong != null
            ? trackCardMatrix(true)
            : trackProgress > 0 ? trackCardMatrix(false) : cardMatrix();
    if (!hit.invert(inverse)) return false;
    float[] point = root.artPoint(x,y);
    inverse.mapPoints(point);
    return new RectF(49, 318, 667, 1126).contains(point[0], point[1]);
  }

  private boolean restingCardAt(float x, float y) {
    Matrix inverse = new Matrix();
    if (!cardMatrix().invert(inverse)) return false;
    float[] point = root.artPoint(x,y);
    inverse.mapPoints(point);
    return new RectF(49, 318, 667, 1126).contains(point[0], point[1]);
  }

  private float capsuleOffset() {
    float extra = cardExtraOffset();
    float leftOffset = capsuleSide < 0 ? root.railLeftOffset() : 0;
    return leftOffset
        + capsuleSide * 200 * capsuleFraction * capsuleFraction * (3 - 2 * capsuleFraction)
        + capsuleSide * Math.min(0, extra * capsuleSide) * Math.abs(extra) / 24 * .6f;
  }

  private float cardExtraOffset() {
    return Math.copySign(24 * (1 - (float) Math.exp(-Math.abs(cardOverdrag) / 24)), cardOverdrag);
  }

  private float capsuleDepth() {
    float amount = cardOverdrag / CAPSULE_OVERDRAG;
    return 1 - .01f * amount * amount;
  }

  private void applyCapsulePull(float pull) {
    capsulePull = pull;
    float bounded = Math.max(0, Math.min(CAPSULE_DRAG_RANGE, pull));
    float extra = pull - bounded;
    cardOverdrag =
        capsuleSide
            * Math.copySign(
                CAPSULE_OVERDRAG
                    * (1 - (float) Math.exp(-Math.abs(extra) * .5f / CAPSULE_OVERDRAG)),
                extra);
    setCapsuleFraction(bounded / CAPSULE_DRAG_RANGE);
  }

  private void setCapsuleFraction(float value) {
    boolean revealing = capsuleFraction >= .99f && value < .99f;
    capsuleFraction = Math.max(0, Math.min(1, value));
    rail.setTranslationX(capsuleOffset() * root.unitX());
    rail.setScaleX(capsuleDepth());
    rail.setScaleY(capsuleDepth());
    rail.setVisibility(capsuleFraction < .85f ? View.VISIBLE : View.INVISIBLE);
    if (revealing) {
      artworkFailures.clear();
      artworkRetryAfter.clear();
      preload();
    }
    redraw();
  }

  private void settleCapsule(boolean hidden) {
    float velocity =
        capsuleSpring != null && capsuleAnimation != null
            ? (float) capsuleSpring.velocity(capsuleAnimation.getCurrentPlayTime() / 1000.0)
            : 0;
    settleCapsule(hidden, velocity);
  }

  private void settleCapsule(boolean hidden, float velocity) {
    if (root.pulling || root.morphProgress > 0) return;
    capsuleHidden = hidden;
    if (capsuleAnimation != null) capsuleAnimation.cancel();
    capsuleIdle.removeCallbacks(hideIdleCapsule);
    float target = hidden ? CAPSULE_DRAG_RANGE : 0;
    CapsuleSpring spring = new CapsuleSpring(capsulePull, velocity, target);
    capsuleSpring = spring;
    capsuleAnimation = ValueAnimator.ofFloat(0, 1);
    capsuleAnimation.setDuration(1000);
    capsuleAnimation.setInterpolator(new android.view.animation.LinearInterpolator());
    capsuleAnimation.addUpdateListener(
        a -> {
          double time = a.getCurrentPlayTime() / 1000.0;
          float position = (float) spring.position(time);
          applyCapsulePull(position);
          if (time >= 1
              || Math.abs(position - target) < .15f && Math.abs(spring.velocity(time)) < 2) {
            a.cancel();
            capsuleSpring = null;
            applyCapsulePull(target);
            neutralPitch = significantPitch = latestPitch;
            neutralRoll = significantRoll = latestRoll;
            returningToPlane = true;
            motionFrames.removeCallbacks(resetPlane);
            motionFrames.postDelayed(resetPlane, 500);
            armCapsuleIdle();
          }
        });
    capsuleAnimation.start();
    armCapsuleIdle();
  }

  private void redraw() {
    scene.invalidate();
  }

  private static float stableTiltDegrees(float radians) {
    float degrees = (float) Math.toDegrees(radians);
    float blend =
        Math.max(0, Math.min(1, (Math.abs(degrees) - MOTION_DEAD_ZONE) / (4 - MOTION_DEAD_ZONE)));
    // Smoothstep removes the jump at the dead-zone boundary; larger rotations retain their scale.
    return degrees * blend * blend * (3 - 2 * blend);
  }

  private static float angleDelta(float value, float baseline) {
    return (float) Math.atan2(Math.sin(value - baseline), Math.cos(value - baseline));
  }

  private final float[] rotationMatrix = new float[9],
      remapped = new float[9],
      orientation = new float[3];
  private final SensorEventListener orientationListener =
      new SensorEventListener() {
        public void onAccuracyChanged(Sensor sensor, int accuracy) {}

        public void onSensorChanged(SensorEvent event) {
          SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values);
          int displayRotation = activity.getDisplay().getRotation();
          int x = SensorManager.AXIS_X, y = SensorManager.AXIS_Y;
          if (displayRotation == Surface.ROTATION_90) {
            x = SensorManager.AXIS_Y;
            y = SensorManager.AXIS_MINUS_X;
          } else if (displayRotation == Surface.ROTATION_180) {
            x = SensorManager.AXIS_MINUS_X;
            y = SensorManager.AXIS_MINUS_Y;
          } else if (displayRotation == Surface.ROTATION_270) {
            x = SensorManager.AXIS_MINUS_Y;
            y = SensorManager.AXIS_X;
          }
          SensorManager.remapCoordinateSystem(rotationMatrix, x, y, remapped);
          SensorManager.getOrientation(remapped, orientation);
          updateOrientation(orientation[1], orientation[2]);
        }
      };

  private void updateOrientation(float pitch, float roll) {
    latestPitch = pitch;
    latestRoll = roll;
    if (root.morphProgress > 0 || cardDragging || trackAnimation != null || capsuleSpring != null)
      return;
    if (!orientationReady) {
      neutralPitch = significantPitch = pitch;
      neutralRoll = significantRoll = roll;
      orientationReady = true;
    }
    // Accept accumulated posture changes, not tiny sample-to-sample hand tremors.
    boolean moved =
        Math.hypot(angleDelta(pitch, significantPitch), angleDelta(roll, significantRoll))
            > Math.toRadians(MOTION_DEAD_ZONE);
    if (moved) {
      significantPitch = pitch;
      significantRoll = roll;
      returningToPlane = motionRested = false;
      if (orientationReturn != null) orientationReturn.cancel();
      motionFrames.removeCallbacks(resetPlane);
      motionFrames.postDelayed(resetPlane, 500);
    }
    if (returningToPlane || motionRested) return;
    // Preserve the original sensor rotation direction and physical scale.
    targetTiltX =
        Math.max(
            -MAX_CARD_TILT,
            Math.min(
                MAX_CARD_TILT,
                (float) stableTiltDegrees(angleDelta(significantPitch, neutralPitch))));
    targetTiltY =
        Math.max(
            -MAX_CARD_TILT,
            Math.min(
                MAX_CARD_TILT,
                -(float) stableTiltDegrees(angleDelta(significantRoll, neutralRoll))));
    if (Math.max(Math.abs(targetTiltX - tiltX), Math.abs(targetTiltY - tiltY)) > .001f)
      schedulePoseFrame();
  }

  private ElasticScrub scrub;
  private long lastFrame, lastPreload;
  private final Handler railFrames = new Handler();
  private final Runnable railTick =
      new Runnable() {
        public void run() {
          if (!draggingRail || scrub == null || closed) return;
          long now = android.os.SystemClock.uptimeMillis();
          scrub.advance(Math.min(.05, Math.max(0, now - lastFrame) / 1000.0));
          lastFrame = now;
          if (now - lastPreload >= 200) {
            preload();
            lastPreload = now;
          }
          redraw();
          railFrames.postDelayed(this, 16);
        }
      };
  private long seekReleasedAt = -1000;
  private final SeekBar seek;
  private final StemIconButton source;
  private final TransportButton playButton, previousButton, nextButton;
  private float playMorph;
  private float playFinishScale = 1;
  private android.animation.ValueAnimator playMorphAnimator;
  private final Rail rail;
  private final SketchHeartButton heartButton;
  private final ModePathButton repeatButton;
  private final SketchActionButton downloadButton;
  private PlaybackOrder.Mode playbackOrder = PlaybackOrder.Mode.LIST_LOOP;
  private boolean shuffleEnabled;

  SpatialPlayer(
      Activity activity,
      String song,
      String artist,
      String album,
      String[] queue,
      String[] covers,
      String[] artists,
      String[] albums,
      int index,
      Actions actions) {
    super(activity, android.R.style.Theme_Material_NoActionBar);
    this.activity = activity;
    this.actions = actions;
    this.song = song;
    this.artist = artist;
    this.album = album;
    this.queue = queue;
    this.covers = covers;
    this.artists = artists;
    this.albums = albums;
    current = preview = index;
    root = new Layout(activity);
    root.setBackgroundColor(Color.TRANSPARENT);
    scene = new Scene(activity);
    root.addView(scene, new FrameLayout.LayoutParams(-1, -1));
    root.addView(new CardGesture(activity), new FrameLayout.LayoutParams(-1, -1));
    playButton = new TransportButton("播放", actions::toggle, 0);
    root.place(playButton, 662 + PlayerMorph.PLAY_OFFSET_X, 1723, 236, 241);

    previousButton = new TransportButton("上一曲", () -> swipeTrack(1, 0f), -1);
    nextButton = new TransportButton("下一曲", () -> swipeTrack(-1, 0f), 1);
    root.place(previousButton, 208, 1723, 128, 241);
    root.place(nextButton, 588, 1723, 128, 241);

    heartButton = new SketchHeartButton(activity);
    heartButton.setOnClickListener(
        v -> {
          boolean value = !liked;
          favorite(value, true);
          actions.favorite(value);
        });
    float actionEdge = 78, actionWidth = 128;
    float actionStep = (931 - actionEdge * 2 - actionWidth) / 3;
    root.place(heartButton, actionEdge, 1514, actionWidth, 129);
    repeatButton = new ModePathButton(activity);
    downloadButton = new SketchActionButton(activity, SketchActionButton.Kind.DOWNLOAD);
    repeatButton.setOnClickListener(v -> {
      PlaybackOrder.Mode next = shuffleEnabled ? PlaybackOrder.Mode.LIST_LOOP
          : playbackOrder == PlaybackOrder.Mode.SINGLE_LOOP ? PlaybackOrder.Mode.SHUFFLE
          : PlaybackOrder.Mode.SINGLE_LOOP;
      actions.order(next);
    });
    downloadButton.setOnClickListener(v -> actions.download());
    root.place(repeatButton, actionEdge + actionStep, 1514, actionWidth, 129);
    root.place(downloadButton, actionEdge + actionStep * 2, 1514, actionWidth, 129);
    order(playbackOrder);
    download(false, false, 0);
    seek = new SeekBar(activity);
    transparentSeek(seek);
    seek.setMax(1000);
    seek.setContentDescription("播放进度");
    seek.setOnSeekBarChangeListener(
        new SeekBar.OnSeekBarChangeListener() {
          public void onStartTrackingTouch(SeekBar b) {
            draggingSeek = true;
            redraw();
          }

          public void onStopTrackingTouch(SeekBar b) {
            if (!cancelSeekCommit) {
              position=(int)((long)b.getProgress()*duration/1000);
              progressSampleTime=android.os.SystemClock.uptimeMillis();
              actions.seek(b.getProgress());
            }
            else b.setProgress(duration > 0 ? (int) ((long) position * 1000 / duration) : 0);
            seekReleasedAt = android.os.SystemClock.uptimeMillis();
            draggingSeek = false;
            redraw();
          }

          public void onProgressChanged(SeekBar b, int n, boolean user) {
            if (user) redraw();
          }
        });
    root.place(seek, 93, 1261, 741, 128);
    source =
        new StemIconButton(
            activity,
            new StemIconButton.Listener() {
              public void select(int value) {
                requestMode(value);
              }

              public void manage() {
                stemMenu();
              }
            });
    // Main stem circle (local center y=170) shares the play/pause centerline.
    root.place(source, actionEdge + actionStep * 3, 1514, actionWidth, 129);
    rail = new Rail(activity);
    rail.setContentDescription("按住上下拉动调节切歌速度，拉得越远滚得越快，松手切歌；长按打开队列");
    rail.setOnLongClickListener(
        v -> {
          showQueue();
          return true;
        });
    root.place(rail, 706, 298, 190, 930);
    setCapsuleFraction(1);
    lightSwitch = focusButton(true);
    controlsSwitch = focusButton(false);
    root.addView(lightSwitch);
    root.addView(controlsSwitch);
    setContentView(root);
    Window window = getWindow();
    window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
    window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
    window.setWindowAnimations(0);
    window.setDecorFitsSystemWindows(false);
    window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
    window.getDecorView().setOnApplyWindowInsetsListener((v, insets) -> WindowInsets.CONSUMED);
    preload();
  }

  private final android.window.OnBackInvokedCallback collapseOnBack=this::collapseFromBack;
  private void collapseFromBack(){
    if(closed||root.settlingClosed)return;
    if(entranceAnimator!=null)entranceAnimator.cancel();
    root.finishPull(true);
  }
  @Override public void onBackPressed(){collapseFromBack();}

  protected void onStart() {
    super.onStart();
    Window window = getWindow();
    getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,collapseOnBack);
    window.setLayout(-1, -1);
    motion = (SensorManager) activity.getSystemService(Context.SENSOR_SERVICE);
    if (motion != null) {
      rotation = motion.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR);
      if (rotation == null) rotation = motion.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
      if (rotation != null)
        motionRegistered =
            motion.registerListener(orientationListener, rotation, SensorManager.SENSOR_DELAY_GAME);
    }
    WindowInsetsController controller = window.getDecorView().getWindowInsetsController();
    if (controller != null) {
      controller.setSystemBarsBehavior(
          WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
      controller.hide(WindowInsets.Type.systemBars());
    }
  }

  protected void onStop() {
    root.cancelCoverTail();
    if(queueSheet!=null){queueSheet.dismiss();queueSheet=null;}
    getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(collapseOnBack);
    closed = true;
    root.removeCallbacks(hideFocusButtons);
    if (lightAnimator != null) lightAnimator.cancel();
    if (focusAnimator != null) focusAnimator.cancel();
    if(sortingAnimator!=null)sortingAnimator.cancel();
    if (entranceAnimator!=null) entranceAnimator.cancel();
    root.cancelCoverTail();
    playButton.cancelPress();
    previousButton.cancelPress();
    nextButton.cancelPress();
    if (playMorphAnimator != null) playMorphAnimator.cancel();
    stopPoseFrames();
    capsuleIdle.removeCallbacksAndMessages(null);
    artworkRetries.removeCallbacksAndMessages(null);
    if (motion != null) motion.unregisterListener(orientationListener);
    motionRegistered = false;
    motionFrames.removeCallbacksAndMessages(null);
    if (orientationReturn != null) orientationReturn.cancel();
    if (capsuleAnimation != null) capsuleAnimation.cancel();
    if (trackAnimation != null) trackAnimation.cancel();
    capsuleSpring = null;
    cardDragging = false;
    returningToPlane = false;
    railFrames.removeCallbacksAndMessages(null);
    if (railScrollAnimation != null) railScrollAnimation.cancel();
    scene.clearTrackTextures();
    if (flipAnimation != null) flipAnimation.cancel();
    if (lyricAnimation != null) lyricAnimation.cancel();
    if (lyricRevealAnimation != null) lyricRevealAnimation.cancel();
    images.close();
    super.onStop();
  }

  private final class TransportButton extends View {
    private final int direction;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path triangle = new Path();
    private float pressScale = 1f;
    private ValueAnimator pressAnimator;
    private ValueAnimator skipAnimator;
    private float skipFraction;

    TransportButton(String description, Runnable action, int direction) {
      super(activity);
      this.direction = direction;
      setContentDescription(description);
      setFocusable(true);
      setOnClickListener(v -> {
        if (direction != 0) animateSkip();
        action.run();
      });
    }

    @Override public CharSequence getAccessibilityClassName() {
      return Button.class.getName();
    }

    @Override protected void onDraw(Canvas canvas) {
      canvas.save();
      if (direction == 0) {
        canvas.scale(getWidth() / 236f, getHeight() / 241f);
        canvas.translate(-(662 + PlayerMorph.PLAY_OFFSET_X), -1693);
        float scale = 1.25f * pressScale * playFinishScale;
        canvas.scale(scale, scale, 783.5f + PlayerMorph.PLAY_OFFSET_X, 1813.5f);
        PlayerMorph.playLiquid(canvas, playMorph);
      } else {
        canvas.translate(getWidth() / 2f, getHeight() * 120.5f / 241f);
        canvas.scale(direction * getWidth() / 128f, getHeight() / 241f);
        float recoil = phase(skipFraction, 0f, .18f, .39f);
        float thrust = phase(skipFraction, .18f, .39f, .69f);
        float settle = phase(skipFraction, .39f, .69f, 1f);
        canvas.translate(-10f * recoil + 23f * thrust - 5f * settle, 0f);
        canvas.scale(pressScale * (1f - .22f * recoil + .25f * thrust - .08f * settle),
            pressScale * (1f + .08f * recoil - .18f * thrust + .06f * settle));
        paint.setColor(0xfffafafa);
        paint.setPathEffect(new android.graphics.CornerPathEffect(6));
        triangle.reset();
        triangle.moveTo(-30, -32);
        triangle.lineTo(16, 0);
        triangle.lineTo(-30, 32);
        triangle.close();
        canvas.drawPath(triangle, paint);
        canvas.drawRoundRect(19, -29, 30, 29, 5.5f, 5.5f, paint);
      }
      canvas.restore();
    }

    @Override public void setPressed(boolean pressed) {
      boolean changed = pressed != isPressed();
      super.setPressed(pressed);
      if (changed) animatePress(pressed);
    }

    private float phase(float t, float start, float peak, float end) {
      return smoothRange(t, start, peak) * (1f - smoothRange(t, peak, end));
    }

    private void animateSkip() {
      if (skipAnimator != null) skipAnimator.cancel();
      if (!ValueAnimator.areAnimatorsEnabled()) return;
      skipAnimator = ValueAnimator.ofFloat(0f, 1f);
      skipAnimator.setDuration(520);
      skipAnimator.setInterpolator(new android.view.animation.LinearInterpolator());
      skipAnimator.addUpdateListener(animation -> {
        skipFraction = (float) animation.getAnimatedValue();
        invalidate();
        root.invalidate();
      });
      skipAnimator.start();
    }

    void cancelPress() {
      if (skipAnimator != null) skipAnimator.cancel();
      skipFraction = 0f;
      if (pressAnimator != null) pressAnimator.cancel();
      pressScale = 1f;
    }

    private void animatePress(boolean down) {
      if (pressAnimator != null) pressAnimator.cancel();
      if (!ValueAnimator.areAnimatorsEnabled()) {
        pressScale = 1f;
        invalidate();
        return;
      }
      float start = pressScale;
      pressAnimator = ValueAnimator.ofFloat(0f, 1f);
      pressAnimator.setDuration(down ? 60 : 307);
      pressAnimator.setInterpolator(t -> t);
      pressAnimator.addUpdateListener(animation -> {
        float t = (float) animation.getAnimatedValue();
        if (down) {
          pressScale = start + (.86f - start) * t * t * (3 - 2 * t);
        } else {
          float seconds = t * .46f;
          float offset = start - 1;
          float velocity = start > .98f ? -1.2f : 0;
          pressScale = t == 1 ? 1 : 1 + (float) (Math.exp(-11 * seconds)
              * (offset * Math.cos(23 * seconds)
                  + (velocity + 11 * offset) / 23 * Math.sin(23 * seconds)));
        }
        invalidate();
        root.invalidate();
      });
      pressAnimator.start();
    }
  }

  private void transparentSeek(SeekBar bar) {
    bar.setPadding(0, 0, 0, 0);
    bar.setProgressDrawable(new ColorDrawable(Color.TRANSPARENT));
    bar.setThumb(new ColorDrawable(Color.TRANSPARENT));
    bar.setSplitTrack(false);
  }

  private boolean reorderingQueue;
  private String[] sortingFrom;
  private float sortingOffset, sortingProgress=1;
  private ValueAnimator sortingAnimator;
  void queueReordered() {
    reorderingQueue=true;
    if(sortingAnimator!=null)sortingAnimator.cancel();
    sortingFrom=covers.clone();sortingOffset=railOffset();
    sortingProgress=(!capsuleHidden&&isShowing()&&ValueAnimator.areAnimatorsEnabled())?0:1;
  }

  void track(
      String song,
      String artist,
      String album,
      String[] queue,
      String[] covers,
      String[] artists,
      String[] albums,
      int index) {
    float previousRailOffset = railOffset();
    boolean selectionChanged = !reorderingQueue && (current != index || !Arrays.equals(this.queue, queue));
    boolean externalTransition =
        selectionChanged
            && outgoingSong == null
            && !closed
            && isShowing()
            && root.morphProgress == 0
            && !cardDragging
            && ValueAnimator.areAnimatorsEnabled();
    if (externalTransition) {
      // Automatic playback updates have no swipe to capture the outgoing card or reset progress.
      outgoingCover = cover(preview);
      outgoingSong = preview >= 0 && preview < this.queue.length ? this.queue[preview] : this.song;
      outgoingArtist =
          preview >= 0 && preview < this.artists.length ? this.artists[preview] : this.artist;
      trackProgress = 0;
      trackDirection = -1;
      dragTrackIndex = index;
      capsuleIdle.removeCallbacks(hideIdleCapsule);
      // Finish any rail settling before starting the one shared card trajectory.
      if (capsuleAnimation != null) capsuleAnimation.cancel();
      capsuleSpring = null;
      applyCapsulePull(capsuleHidden ? CAPSULE_DRAG_RANGE : 0);
    }
    this.song = song;
    this.artist = artist;
    this.album = album;
    this.queue = queue;
    this.covers = covers;
    this.artists = artists;
    this.albums = albums;
    current = index;
    if(queueSheet!=null&&queueSheet.isShowing())queueSheet.state(queue,artists,current);
    if (selectionChanged) {
      if (outgoingSong != null) dragTrackIndex = index;
      timelineStarted = false;
      lyricsRequested = false;
      lyrics("歌词加载中…");
      artwork.remove("");
      heartButton.finishAnimation();
      downloadButton.download(false, false, 0, false);
      root.cancelBlankGesture();
    }
    if (selectionChanged || !draggingRail) {
      preview = index;
      draggingRail = false;
      railFrames.removeCallbacksAndMessages(null);
      scrub = null;
    }
    if (selectionChanged) animateRailScroll(previousRailOffset, start());
    if(reorderingQueue) {
      reorderingQueue=false;
      if(sortingProgress==0) {
        capsuleIdle.removeCallbacks(hideIdleCapsule);
        sortingAnimator=ValueAnimator.ofFloat(0,1);sortingAnimator.setDuration(480);
        sortingAnimator.setInterpolator(new android.view.animation.PathInterpolator(.2f,0,.2f,1));
        sortingAnimator.addUpdateListener(a->{sortingProgress=(float)a.getAnimatedValue();redraw();});
        sortingAnimator.addListener(new android.animation.AnimatorListenerAdapter(){
          public void onAnimationEnd(android.animation.Animator a){sortingProgress=1;armCapsuleIdle();}
        });sortingAnimator.start();
      }
    }
    preload();
    if (selectionChanged) root.refreshTransitionArtwork();
    if (externalTransition) animateTrack(1, 0);
    if (selectionChanged && (lyricsBack || splitActive())) requestTrackLyrics();
    redraw();
  }

  void favorite(boolean value) {
    favorite(value, false);
  }

  void favorite(boolean value, boolean animate) {
    liked = value;
    heartButton.setLiked(value, animate);
  }

  void order(PlaybackOrder.Mode value) {
    order(value, value == PlaybackOrder.Mode.SHUFFLE || shuffleEnabled);
  }

  void order(PlaybackOrder.Mode value, boolean shuffle) {
    playbackOrder = value == PlaybackOrder.Mode.SHUFFLE ? PlaybackOrder.Mode.LIST_LOOP : value;
    shuffleEnabled = shuffle;
    repeatButton.mode(shuffle ? 2 : playbackOrder == PlaybackOrder.Mode.SINGLE_LOOP ? 1 : 0,
        isShowing());
  }

  void download(boolean complete, boolean busy, int percent) {
    downloadButton.download(complete, busy, percent, true);
  }

  void state(String message, boolean running, boolean ready, String mode) {
    state(message, running, ready, mode, ready && !running ? 1 : 0);
  }

  void state(String message, boolean running, boolean ready, String mode, float progress) {
    this.message = message;
    this.running = running;
    this.ready = ready;
    this.mode = mode;
    source.setMode(mode == null ? 1 : mode.equals("vocals.wav") ? 0 : 2);
    source.setSeparation(ready && !running, running, progress);
    source.setStateDescription(
        (running ? "分轨处理中，" : "")
            + (mode == null ? "原声" : mode.equals("vocals.wav") ? "人声" : "伴奏"));
    redraw();
  }

  void playback(int position, int duration, boolean playing) {
    boolean playChanged = this.playing != playing;
    this.position = position;
    progressSampleTime = android.os.SystemClock.uptimeMillis();
    updateLyricMotion(true);
    this.duration = duration;
    this.playing = playing;
    if ((playing || position > 0) && duration > 0 && !timelineStarted) {
      timelineStarted = true;
      scene.mappedDuration = -1;
      requestTrackLyrics();
    }
    if (!draggingSeek)
      seek.setProgress(duration > 0 ? (int) ((long) position * 1000 / duration) : 0);
    seek.setEnabled(duration > 0);
    playButton.setContentDescription(playing ? "暂停" : "播放");
    if (!isShowing()) {
      if (playMorphAnimator != null) playMorphAnimator.cancel();
      playMorph = playing ? 1 : 0;
      playFinishScale = 1;
      playButton.invalidate();
    } else if (playChanged) {
      if (playMorphAnimator != null) playMorphAnimator.cancel();
      float morphStart = playMorph;
      float finishStart = playFinishScale;
      float destination = playing ? 1f : 0f;
      playMorphAnimator = android.animation.ValueAnimator.ofFloat(0, 1);
      playMorphAnimator.setDuration(android.animation.ValueAnimator.areAnimatorsEnabled() ? 467 : 0);
      playMorphAnimator.setInterpolator(t -> t);
      playMorphAnimator.addUpdateListener(a -> {
        float t = (float)a.getAnimatedValue();
        float m = Math.min(1, t/.60f);
        m = m*m*(3-2*m);
        playMorph = morphStart + (destination-morphStart)*m;
        // Finish on the final glyph, with opposite spring directions for each state.
        float u = Math.max(0, (t-.56f)/.44f);
        float pulse = (float)(Math.sin(2*Math.PI*u)*Math.exp(-3*u));
        float amplitude = playing ? .26f : -.26f;
        playFinishScale = t == 1 ? 1 : 1 + (finishStart-1)*(1-m) + amplitude*pulse;
        playButton.invalidate();
        root.invalidate();
      });
      playMorphAnimator.start();
    }
    redraw();
  }

  void artwork(Bitmap bitmap) {
    if (bitmap != null && current >= 0 && current < covers.length) {
      artwork.put(covers[current], bitmap);
      root.refreshTransitionArtwork();
      redraw();
    }
  }

  private void requestMode(int value) {
    actions.mode(value == 0 ? "vocals.wav" : value == 2 ? "accompaniment.wav" : null);
  }

  private void stemMenu() {
    ArrayList<String> items = new ArrayList<>();
    items.add(running ? "取消分轨" : ready ? "音轨已生成" : "开启分轨");
    if (ready && !running) items.add("导出音轨");
    new DotoDesign.DialogBuilder(activity)
        .setTitle("人声与伴奏")
        .setMessage(message)
        .setPositiveButton(
            items.get(0),
            (d, n) -> {
              if (running || !ready) actions.split();
            })
        .setNeutralButton(
            ready && !running ? "导出音轨" : "关闭",
            (d, n) -> {
              if (ready && !running) actions.export();
            })
        .show();
  }

  private QueueSheet queueSheet;
  private void showQueue(){
    if(queue.length==0||queueSheet!=null&&queueSheet.isShowing())return;
    queueSheet=new QueueSheet(activity,new QueueSheet.Actions(){public void play(int index){if(index!=current)actions.queue(index);}public void remove(int index){actions.removeQueue(index);}public void move(int from,int to){actions.moveQueue(from,to);}});
    queueSheet.state(queue,artists,current);queueSheet.show();
  }

  private void preload() {
    if (closed) return;
    float offset =
        draggingRail && scrub != null
            ? (float) Math.max(0, Math.min(Math.max(0, queue.length - 5), scrub.cursor() - 2))
            : start();
    int first = Math.max(0, (int) Math.floor(offset) - 1);
    int end = Math.min(covers.length, (int) Math.ceil(offset) + 6);
    for (int i = first; i < end; i++) requestArtwork(i, 256);
    requestArtwork(current, 960);
    if (!draggingRail || scrub == null || scrub.strength() < .45) requestArtwork(preview, 960);
    Set<String> keep = new HashSet<>();
    if (current >= 0 && current < covers.length) keep.add(covers[current]);
    if (preview >= 0 && preview < covers.length) keep.add(covers[preview]);
    artwork.keySet().retainAll(keep);
  }

  private void requestArtwork(int index, int size) {
    if (index < 0 || index >= covers.length) return;
    String url = covers[index];
    if (url == null || !url.startsWith("http")) return;
    if (size == 256 && thumbnails.get(url) != null || size == 960 && artwork.containsKey(url))
      return;
    String key = size + ":" + url;
    if (artworkFailures.getOrDefault(key, 0) >= 3
        || android.os.SystemClock.uptimeMillis() < artworkRetryAfter.getOrDefault(key, 0L)
        || !requested.add(key)) return;
    images.load(
        url,
        size,
        bitmap -> {
          requested.remove(key);
          if (closed) return;
          artworkFailures.remove(key);
          artworkRetryAfter.remove(key);
          if (size == 256) thumbnails.put(url, bitmap);
          else artwork.put(url, bitmap);
          if (current >= 0 && current < covers.length && url.equals(covers[current]))
            root.refreshTransitionArtwork();
          redraw();
        },
        () -> {
          requested.remove(key);
          if (closed) return;
          int attempts = artworkFailures.getOrDefault(key, 0) + 1;
          artworkFailures.put(key, attempts);
          long delay = 1500L * attempts;
          artworkRetryAfter.put(key, android.os.SystemClock.uptimeMillis() + delay);
          if (attempts < 3) {
            artworkRetries.removeCallbacks(retryArtwork);
            artworkRetries.postDelayed(retryArtwork, delay);
          }
        });
  }

  private Bitmap cover(int index) {
    if (index < 0 || index >= covers.length) return null;
    String url = covers[index];
    if (url == null || url.isEmpty()) return index == current ? artwork.get("") : null;
    Bitmap full = artwork.get(url);
    if (full != null && !full.isRecycled()) return full;
    Bitmap thumbnail = thumbnails.get(url);
    return thumbnail != null ? thumbnail : images.cached(url, 256);
  }

  private int start() {
    return Math.max(0, Math.min(Math.max(0, queue.length - 5), preview - 2));
  }

  private void swipeTrack(int direction, float velocity) {
    capsuleIdle.removeCallbacks(hideIdleCapsule);
    if (!ValueAnimator.areAnimatorsEnabled()) {
      trackProgress = 0;
      dragTrackIndex = -1;
      if (direction < 0) actions.next();
      else actions.previous();
      armCapsuleIdle();
      return;
    }
    trackDirection = direction;
    outgoingCover = cover(preview);
    outgoingSong = preview >= 0 && preview < queue.length ? queue[preview] : song;
    outgoingArtist = preview >= 0 && preview < artists.length ? artists[preview] : artist;
    animateTrack(1, velocity);
    if (direction < 0) actions.next();
    else actions.previous();
  }

  private void animateTrack(float target, float velocity) {
    if (trackAnimation != null) trackAnimation.cancel();
    stopPoseFrames();
    motionFrames.removeCallbacks(resetPlane);
    if (orientationReturn != null) orientationReturn.cancel();
    final float start = trackProgress;
    final float distance = target - start;
    final long duration = Math.round(320 + 100 * Math.abs(distance));
    // Monotone Hermite trajectory reaches the exact destination with zero end velocity.
    final float tangent =
        Math.copySign(
            Math.min(
                3 * Math.abs(distance),
                Math.max(0, velocity * Math.signum(distance)) * duration / 1000),
            distance);
    final float fromTiltX = tiltX, fromTiltY = tiltY;
    trackAnimation = ValueAnimator.ofFloat(0, 1);
    trackAnimation.setDuration(duration);
    trackAnimation.setInterpolator(new android.view.animation.LinearInterpolator());
    trackAnimation.addUpdateListener(
        animation -> {
          float t = (float) animation.getAnimatedValue();
          float t2 = t * t, t3 = t2 * t;
          float settled = 3 * t2 - 2 * t3;
          trackProgress = start + distance * settled + tangent * (t3 - 2 * t2 + t);
          // Pose and inertial offset land in the same frame as translation and depth.
          tiltX = fromTiltX * (1 - settled);
          tiltY = fromTiltY * (1 - settled);
          if (t >= 1) {
            trackProgress = 0;
            dragTrackIndex = -1;
            trackAnimation = null;
            outgoingCover = null;
            outgoingSong = outgoingArtist = null;
            revealLyricsIfReady();
            tiltX = tiltY = targetTiltX = targetTiltY = 0;
            neutralPitch = significantPitch = latestPitch;
            neutralRoll = significantRoll = latestRoll;
            returningToPlane = false;
            motionRested = true;
            armCapsuleIdle();
          }
          redraw();
        });
    trackAnimation.start();
  }

  private final class CardGesture extends View {
    float downX, downY, startPull;
    boolean sliding, horizontalRejected, startedRevealed;
    private int gestureSide;
    VelocityTracker velocity;

    CardGesture(Context context) {
      super(context);
      setFocusable(true);
      setContentDescription("歌曲卡片，双击翻面查看歌词，再次双击翻回。歌词面单击歌词可跳至该句。左滑呼出后再左滑切下一首，右滑呼出后再右滑切上一首，反向滑动收起");
    }

    public boolean onTouchEvent(MotionEvent event) {
      switch (event.getActionMasked()) {
        case MotionEvent.ACTION_DOWN:
          // A fresh swipe is a fresh command, even while the last transition is settling.
          if (!cardAt(event.getX(), event.getY())
              && !root.blankAt(event.getX(), event.getY())
              && !(trackAnimation != null && restingCardAt(event.getX(), event.getY())))
            return false;
          if (trackAnimation != null) trackAnimation.end();
          capsuleIdle.removeCallbacks(hideIdleCapsule);
          startedRevealed = !capsuleHidden && (root.wide() || capsuleFraction < .05f);
          if (capsuleAnimation != null) capsuleAnimation.cancel();
          capsuleSpring = null;
          cardDragging = true;
          stopPoseFrames();
          motionFrames.removeCallbacks(resetPlane);
          if (orientationReturn != null) orientationReturn.cancel();
          downX = event.getRawX();
          downY = event.getRawY();
          startPull = capsulePull;
          gestureSide = capsuleSide;
          sliding = horizontalRejected = false;
          if (velocity != null) velocity.recycle();
          velocity = VelocityTracker.obtain();
          velocity.addMovement(event);
          return true;
        case MotionEvent.ACTION_MOVE:
          if (velocity == null) return true;
          velocity.addMovement(event);
          float dx = event.getRawX() - downX, dy = event.getRawY() - downY;
          int slop = ViewConfiguration.get(getContext()).getScaledTouchSlop();
          if (!sliding && Math.abs(dy) > slop && Math.abs(dy) > Math.abs(dx))
            horizontalRejected = true;
          if (!horizontalRejected && Math.abs(dx) > slop && Math.abs(dx) > Math.abs(dy)) {
            if (!sliding) {
              if (root.wide()) {
                if (!startedRevealed) capsuleSide = dx > 0 ? -1 : 1;
                gestureSide = capsuleSide;
              } else if (capsuleFraction >= .99f) {
                capsuleSide = gestureSide = dx > 0 ? -1 : 1;
              }
            }
            sliding = true;
          }
          if (sliding) {
            float travel = dx * -gestureSide / root.unitX();
            if (startedRevealed && travel > 0) {
              // Track dragging owns the transform; do not also stretch the capsule spring.
              applyCapsulePull(0);
              trackDirection = -gestureSide;
              if (dragTrackIndex < 0 && queue.length > 0) {
                dragTrackIndex = actions.previewTrack(trackDirection < 0 ? 1 : -1);
                if (dragTrackIndex < 0 || dragTrackIndex >= queue.length)
                  dragTrackIndex =
                      Math.floorMod(current + (trackDirection < 0 ? 1 : -1), queue.length);
              }
              float raw = travel / TRACK_DRAG_RANGE;
              trackProgress =
                  raw <= .75f ? raw : .75f + .20f * (1 - (float) Math.exp(-(raw - .75f) / .20f));
              redraw();
            } else {
              trackProgress = 0;
              dragTrackIndex = -1;
              applyCapsulePull(startPull + dx * gestureSide / root.unitX());
            }
          }
          return true;
        case MotionEvent.ACTION_UP:
          cardDragging = false;
          if (velocity != null) {
            velocity.addMovement(event);
            velocity.computeCurrentVelocity(1000);
            float vx =
                Math.max(
                    -CAPSULE_DRAG_RANGE * 8,
                    Math.min(
                        CAPSULE_DRAG_RANGE * 8,
                        velocity.getXVelocity() * gestureSide / root.unitX()));
            if (sliding
                && startedRevealed
                && (event.getRawX() - downX) * gestureSide
                    < -ViewConfiguration.get(getContext()).getScaledTouchSlop() * 3) {
              // The revealed rail is already at rest; a second spring would schedule a late pose
              // reset.
              capsuleHidden = false;
              applyCapsulePull(0);
              swipeTrack(-gestureSide, -vx / TRACK_DRAG_RANGE);
            } else if (sliding && startedRevealed && (event.getRawX() - downX) * gestureSide > 0) {
              trackProgress = 0;
              settleCapsule(true, vx);
            } else if (sliding) {
              if (trackProgress > 0) animateTrack(0, -vx / TRACK_DRAG_RANGE);
              settleCapsule(capsulePull + vx * .16f >= CAPSULE_DRAG_RANGE * .5f, vx);
            } else settleCapsule(capsuleHidden);
            velocity.recycle();
            velocity = null;
          }
          return true;
        case MotionEvent.ACTION_POINTER_DOWN:
        case MotionEvent.ACTION_CANCEL:
          cardDragging = false;
          if (velocity != null) {
            velocity.recycle();
            velocity = null;
          }
          if (trackProgress > 0) animateTrack(0, 0);
          settleCapsule(capsuleHidden);
          return true;
      }
      return true;
    }

    public void onInitializeAccessibilityNodeInfo(AccessibilityNodeInfo info) {
      super.onInitializeAccessibilityNodeInfo(info);
      info.addAction(
          capsuleHidden
              ? AccessibilityNodeInfo.AccessibilityAction.ACTION_EXPAND
              : AccessibilityNodeInfo.AccessibilityAction.ACTION_COLLAPSE);
    }

    public boolean performAccessibilityAction(int action, android.os.Bundle arguments) {
      if (action == AccessibilityNodeInfo.ACTION_EXPAND
          || action == AccessibilityNodeInfo.ACTION_COLLAPSE) {
        settleCapsule(action == AccessibilityNodeInfo.ACTION_COLLAPSE);
        return true;
      }
      return super.performAccessibilityAction(action, arguments);
    }

    protected void onDetachedFromWindow() {
      if (velocity != null) velocity.recycle();
      velocity = null;
      super.onDetachedFromWindow();
    }
  }

  private final class Layout extends FrameLayout {
    private final HashMap<View, RectF> bounds = new HashMap<>();
    private boolean pullCandidate, pulling, settlingClosed;
    private float downX, downY, initialOffset;
    private VelocityTracker velocity;
    private float morphProgress;
    private ValueAnimator pullAnimation;
    private Matrix coverStart;
    private RectF coverSource = new RectF(PlayerMorph.LARGE_COVER);
    private float coverSourceRadius = 41;
    private Bitmap flyingCover, pageSnapshot;
    private boolean capturingSnapshot;
    private boolean openingOrigin, openingHorizontal, openingRegrab, regrabAxisLocked;
    private final GestureDetector blankGestures;
    private int tappedLyricTime = -1;

    private int lyricTimeAt(MotionEvent event) {
      if ((!splitActive() && (!lyricsBack || flipProgress != 1 || lyricReveal < 1)) || !lyricReady || duration <= 0
          || morphProgress != 0 || trackProgress != 0 || flippingToClose
          || railAt(event.getX(), event.getY())) return -1;
      float[] point;
      if (splitActive()) {
        point = new float[] {(event.getX() - splitLyricsX()) / unitX(),
            (event.getY() - splitLyricsY()) / unitY()};
      } else {
        Matrix inverse = new Matrix();
        if (!cardMatrix().invert(inverse)) return -1;
        point = artPoint(event.getX(), event.getY());
        point[1] -= entranceOffset(0);
        inverse.mapPoints(point);
      }
      if (point[0] < -18 || point[0] > 734 || point[1] < lyricTop() - 17 || point[1] > lyricBottom()) return -1;
      int row = Math.round(lyricStart() + (point[1] - lyricTop() - lyricStep() / 2) / lyricStep());
      float slot = row - lyricStart();
      if (row < 0 || row >= lyricTimes.size() || slot <= -.5f || slot >= 4.5f + 2 * extraLyricRows()) return -1;
      return lyricTimes.get(row);
    }

    private boolean blankGesture, doubleTapPending, firstTapOnCard, doubleTapOnCard;

    void cancelBlankGesture() {
      tappedLyricTime = -1;
      blankGesture = false;
      doubleTapPending = false;
      firstTapOnCard = doubleTapOnCard = false;
      long now = android.os.SystemClock.uptimeMillis();
      MotionEvent cancel = MotionEvent.obtain(now, now, MotionEvent.ACTION_CANCEL, 0, 0, 0);
      blankGestures.onTouchEvent(cancel);
      cancel.recycle();
    }

    void refreshTransitionArtwork() {
      if (morphProgress <= 0 || closed || getWidth() <= 0 || getHeight() <= 0) return;
      flyingCover = cover(current);
      if (pageSnapshot == null || pageSnapshot.isRecycled()) return;
      pageSnapshot.eraseColor(Color.TRANSPARENT);
      Canvas snapshot = new Canvas(pageSnapshot);
      snapshot.scale(pageSnapshot.getWidth()/(float)getWidth(),
          pageSnapshot.getHeight()/(float)getHeight());
      capturingSnapshot = true;
      try {
        scene.invalidate();
        super.dispatchDraw(snapshot);
      } finally { capturingSnapshot = false; }
      invalidate();
    }

    private float pullStartFace;
    private float coverTail = -1f;
    private ValueAnimator coverTailAnimator;

    private void startCoverTailIfReady() {
      if (coverTail < 0f || coverTailAnimator != null || morphProgress != 0f) return;
      coverTailAnimator = ValueAnimator.ofFloat(0f, 1f);
      coverTailAnimator.setInterpolator(new android.view.animation.LinearInterpolator());
      coverTailAnimator.setDuration(260);
      coverTailAnimator.addUpdateListener(animation -> {
        float progress = (float) animation.getAnimatedValue();
        coverTail = progress < 1f ? progress : -1f;
        scene.invalidate();
        invalidate();
      });
      coverTailAnimator.start();
    }

    private void cancelCoverTail() {
      if (coverTailAnimator != null) coverTailAnimator.cancel();
      coverTailAnimator = null;
      coverTail = -1f;
    }

    private void beginOpening() {
      cancelCoverTail();
      openingOrigin = true;
      pullStartFace = lyricsBack ? 1 : 0;
      flippingToClose = false;
      if (lyricsBack) {
        if (ValueAnimator.areAnimatorsEnabled()) coverTail = 0f;
        coverSource = new RectF(PlayerMorph.LARGE_COVER);
        coverSourceRadius = 41;
      }
    }

    private void preparePull() {
      cancelCoverTail();
      pullStartFace = flipProgress;
      flippingToClose = lyricsBack || flipProgress > 0;
      prepareCover();
    }

    void prepareCover() {
      stopPoseFrames();
      if (capsuleAnimation != null) capsuleAnimation.cancel();
      capsuleSpring = null;
      if (flipAnimation != null) flipAnimation.cancel();
      boolean useLyricCover = !lyricsBack && !openingOrigin && !flippingToClose && flipProgress >= .5f;
      coverSource = new RectF(useLyricCover ? PlayerMorph.LYRIC_COVER : PlayerMorph.LARGE_COVER);
      coverSourceRadius = useLyricCover ? 18 : 41;
      coverStart = cardMatrix();
      flyingCover = cover(current);
      motionFrames.removeCallbacks(resetPlane);
      if (orientationReturn != null) orientationReturn.cancel();
      returningToPlane = false;
      if (getWidth() > 0 && getHeight() > 0) {
        pageSnapshot =
            Bitmap.createBitmap(
                Math.max(1, getWidth() / 2), Math.max(1, getHeight() / 2), Bitmap.Config.ARGB_8888);
        Canvas snapshot = new Canvas(pageSnapshot);
        snapshot.scale(
            pageSnapshot.getWidth() / (float) getWidth(),
            pageSnapshot.getHeight() / (float) getHeight());
        capturingSnapshot = true;
        scene.invalidate();
        super.dispatchDraw(snapshot);
        capturingSnapshot = false;
      }
    }

    void setMorph(float value) {
      float previous = morphProgress;
      morphProgress = Math.max(0, Math.min(1, value));
      if (flippingToClose && !lyricsBack) {
        flipProgress = pullStartFace * (1 - smoothRange(morphProgress, 0, .55f));
      }
      if (flippingToClose || lyricsBack) scene.invalidate();
      if (previous == 0 && morphProgress > 0) {
        cancelBlankGesture();
        capsuleIdle.removeCallbacks(hideIdleCapsule);
      }
      if (previous > 0 && morphProgress == 0) {
        startCoverTailIfReady();
        motionFrames.removeCallbacks(resetPlane);
        motionFrames.postDelayed(resetPlane, 500);
        armCapsuleIdle();
        settleCapsule(capsuleHidden);
      }
      invalidate();
      if (morphProgress == 0) scene.invalidate();
    }

    protected void dispatchDraw(Canvas c) {
      float sx = getWidth() / 931f, sy = getHeight() / 2048f;
      float dockX = 0, dockY = 0, dockScale = 1, dockHeight = 1;
      if (morphProgress > 0) {
        android.view.WindowMetrics metrics = activity.getWindowManager().getCurrentWindowMetrics();
        dockX = PlayerMorph.dockRightOffset(activity, metrics);
        dockY = PlayerMorph.dockOffset(activity, metrics);
        dockScale = PlayerMorph.dockScaleX(activity, metrics)/sx;
        dockHeight = PlayerMorph.dockHeightFactor(activity, metrics);
      }
      RectF frame = PlayerMorph.frame(morphProgress, dockX, dockY);
      float dockBlend = Math.max(0,(morphProgress-.85f)/.15f);
      frame.top += PlayerMorph.PILL.height()*(1-dockHeight)*dockBlend;
      frame.left += PlayerMorph.PILL.width()*(1-dockScale)*dockBlend;
      float radius = PlayerMorph.radius(morphProgress);
      float reveal = Math.max(0, (morphProgress - .5f) / .5f);
      // Keep the artwork moving throughout the transition, rather than rushing
      // its entire size/shape change into the final circular crop.
      float fly = morphProgress * morphProgress * (3 - 2 * morphProgress);
      float fade = Math.max(0, Math.min(1, (morphProgress - .55f) / .37f));
      fade = fade * fade * (3 - 2 * fade);
      Paint background = new Paint(3);
      background.setColor(Color.BLACK);
      c.drawRoundRect(
          new RectF(frame.left * sx, frame.top * sy, frame.right * sx, frame.bottom * sy),
          radius * sx,
          radius * sy,
          background);
      int saved = c.save();
      Path crop = new Path();
      crop.addRoundRect(
          new RectF(frame.left * sx, frame.top * sy, frame.right * sx, frame.bottom * sy),
          radius * sx,
          radius * sy,
          Path.Direction.CW);
      c.clipPath(crop);
      float scale = Math.min(frame.width() / 931, frame.height() / 2048);
      c.translate(
          frame.centerX() * sx - getWidth() * scale / 2,
          frame.centerY() * sy - getHeight() * scale / 2);
      c.scale(scale, scale);
      Paint alpha = new Paint();
      alpha.setAlpha(Math.round(255 * (1 - fade)));
      if (fade < 1) {
        if (morphProgress > 0 && pageSnapshot != null && !openingOrigin && !flippingToClose) {
          alpha.setFilterBitmap(true);
          c.drawBitmap(pageSnapshot, null, new RectF(0, 0, getWidth(), getHeight()), alpha);
        } else if (fade == 0) {
          super.dispatchDraw(c);
        } else {
          int content = c.saveLayer(0, 0, getWidth(), getHeight(), alpha);
          super.dispatchDraw(c);
          c.restoreToCount(content);
        }
      }
      c.restoreToCount(saved);
      saved = c.save();
      c.scale(sx, sy);
      if (morphProgress > 0 || coverTail >= 0f) {
        if (reveal > 0) {
          int dock = c.save();
          c.translate(dockX, dockY);
          c.scale(dockScale,dockHeight,PlayerMorph.PILL.right,PlayerMorph.PILL.bottom);
          PlayerMorph.pill(c, reveal);
          c.restoreToCount(dock);
        }
        RectF dockCover = new RectF(PlayerMorph.COVER);
        dockCover.left = PlayerMorph.PILL.right+(dockCover.left-PlayerMorph.PILL.right)*dockScale;
        dockCover.right = PlayerMorph.PILL.right+(dockCover.right-PlayerMorph.PILL.right)*dockScale;
        dockCover.top = PlayerMorph.PILL.bottom+(dockCover.top-PlayerMorph.PILL.bottom)*dockHeight;
        dockCover.bottom = PlayerMorph.PILL.bottom+(dockCover.bottom-PlayerMorph.PILL.bottom)*dockHeight;
        dockCover.offset(dockX, dockY);
        Matrix destination = new Matrix();
        destination.setRectToRect(coverSource, dockCover, Matrix.ScaleToFit.FILL);
        float[] start = new float[9], end = new float[9];
        Matrix sourceMatrix = new Matrix(flippingToClose || coverStart == null ? cardMatrix() : coverStart);
        if (wide()) {
          sourceMatrix.postScale(unitX()/sx,unitY()/sy);
          sourceMatrix.postTranslate(originX(false)/sx,originY(false)/sy);
        }
        sourceMatrix.getValues(start);
        destination.getValues(end);
        for (int i = 0; i < 9; i++) start[i] += (end[i] - start[i]) * fly;
        Matrix image = new Matrix();
        image.setValues(start);
        if (lyricsBack) {
          float exit = coverTail >= 0f ? smoothRange(coverTail, 0f, 1f)
              : 1f - smoothRange(morphProgress, 0f, .24f);
          float[] center = {coverSource.centerX(), coverSource.centerY()};
          image.mapPoints(center);
          float spread = 1f + .20f * exit;
          image.postScale(spread, spread, center[0], center[1]);
        }
        c.save();
        Path flyingClip = new Path();
        flyingClip.addRoundRect(frame, radius, radius, Path.Direction.CW);
        c.clipPath(flyingClip);
        c.concat(image);
        if (!lyricsBack) c.translate(0, entranceOffset(0) * (1-fly));
        float coverOpacity = coverTail >= 0f ? 1f - smoothRange(coverTail, 0f, 1f)
            : smoothRange(morphProgress, 0f, .30f);
        int coverLayer = lyricsBack
            ? c.saveLayerAlpha(coverSource, Math.round(255 * coverOpacity))
            : c.save();
        if (lyricsBack || !flippingToClose || flipProgress < .5f) PlayerMorph.photo(
            c,
            cover(current),
            coverSource,
            coverSourceRadius + (coverSource.width() / 2 - coverSourceRadius) * fly,
            coverSourceRadius + (coverSource.height() / 2 - coverSourceRadius) * fly);
        c.restoreToCount(coverLayer);
        c.restore();
      }
      c.restoreToCount(saved);
    }

    private boolean blankAt(float x, float y) {
      if (cardAt(x, y)) return false;
      for (View child : bounds.keySet()) {
        if (child.getVisibility() != View.VISIBLE) continue;
        Matrix inverse = new Matrix();
        if (!child.getMatrix().invert(inverse)) continue;
        float[] point = {x-child.getLeft(), y-child.getTop()};
        inverse.mapPoints(point);
        if (point[0]>=0 && point[0]<child.getWidth() && point[1]>=0 && point[1]<child.getHeight()) return false;
      }
      return true;
    }

    private boolean wakingFocusButtons, effectsCandidate, effectsSwipe;
    private float wakeX, wakeY;

    public boolean dispatchTouchEvent(MotionEvent e) {
      if (e.getActionMasked() == MotionEvent.ACTION_DOWN) {
        wakingFocusButtons = controlsCollapsed && controlsSwitch.getVisibility() != View.VISIBLE;
        showFocusButtons();
        wakeX = e.getRawX();
        wakeY = e.getRawY();
      }
      if (wakingFocusButtons) {
        if (e.getActionMasked() == MotionEvent.ACTION_UP
            && wakeY - e.getRawY() >= MobileUi.dp(getContext(), 48)
            && wakeY - e.getRawY() > Math.abs(e.getRawX() - wakeX)) {
          post(actions::showEffects);
        }
        if (e.getPointerCount() > 1) wakeY = Float.NEGATIVE_INFINITY;
        return true;
      }
      if (e.getActionMasked() == MotionEvent.ACTION_DOWN) {
        capsuleTouching = true;
        capsuleIdle.removeCallbacks(hideIdleCapsule);
        openingRegrab = openingOrigin && morphProgress > 0;
        regrabAxisLocked = false;
        if (openingRegrab) {
          if (pullAnimation != null) pullAnimation.cancel();
          settlingClosed = false;
        } else if (settlingClosed) return true;
        boolean favoriteSurface = blankAt(e.getX(), e.getY()) || cardAt(e.getX(), e.getY());
        pullCandidate = !railAt(e.getX(), e.getY());
        effectsSwipe = false;
        effectsCandidate = morphProgress == 0;
        cancelSeekCommit = false;
        if (!favoriteSurface || openingRegrab || morphProgress > 0) cancelBlankGesture();
        else blankGesture = true;
        pulling = false;
        downX = e.getRawX();
        downY = e.getRawY();
        initialOffset = morphProgress * getHeight() * .34f;
        if (pullCandidate) {
          if (pullAnimation != null) pullAnimation.cancel();
        }
        if (velocity != null) velocity.recycle();
        velocity = VelocityTracker.obtain();
      }
      if (settlingClosed) return true;
      if (blankGesture) {
        if (e.getPointerCount() > 1
            || e.getActionMasked() == MotionEvent.ACTION_CANCEL
            || morphProgress > 0
            || Math.hypot(e.getRawX() - downX, e.getRawY() - downY)
                > ViewConfiguration.get(getContext()).getScaledTouchSlop()) {
          cancelBlankGesture();
        } else blankGestures.onTouchEvent(e);
      }
      if (velocity != null) {
        // Track screen-space velocity: this view moves beneath the finger during a pull.
        MotionEvent screenEvent = MotionEvent.obtain(e);
        screenEvent.offsetLocation(e.getRawX() - e.getX(), e.getRawY() - e.getY());
        velocity.addMovement(screenEvent);
        screenEvent.recycle();
      }
      boolean handled;
      if (openingRegrab) {
        float dx = e.getRawX() - downX, dy = e.getRawY() - downY;
        if (!regrabAxisLocked
            && e.getActionMasked() == MotionEvent.ACTION_MOVE
            && Math.hypot(dx, dy) > ViewConfiguration.get(getContext()).getScaledTouchSlop()) {
          openingHorizontal = Math.abs(dx) > Math.abs(dy);
          regrabAxisLocked = true;
        }
        float range = openingHorizontal ? getWidth() * .48f : getHeight() * .34f;
        float initial = initialOffset / (getHeight() * .34f);
        float delta = openingHorizontal ? e.getRawX() - downX : e.getRawY() - downY;
        if (e.getActionMasked() == MotionEvent.ACTION_MOVE
            || e.getActionMasked() == MotionEvent.ACTION_UP) setMorph(initial + delta / range);
        if (e.getActionMasked() == MotionEvent.ACTION_UP
            || e.getActionMasked() == MotionEvent.ACTION_CANCEL) {
          velocity.computeCurrentVelocity(1000);
          float speed = openingHorizontal ? velocity.getXVelocity() : velocity.getYVelocity();
          openingRegrab = false;
          finishOpeningGesture(-speed / range, e.getActionMasked() == MotionEvent.ACTION_CANCEL);
        }
        handled = true;
      } else handled = super.dispatchTouchEvent(e);
      if (e.getActionMasked() == MotionEvent.ACTION_UP
          || e.getActionMasked() == MotionEvent.ACTION_CANCEL) {
        if (velocity != null) velocity.recycle();
        velocity = null;
        capsuleTouching = false;
        armCapsuleIdle();
      }
      return handled;
    }

    private boolean beginPull(MotionEvent e) {
      if (effectsSwipe) return true;
      if (!pullCandidate && !effectsCandidate) return false;
      float dx = e.getRawX() - downX, dy = e.getRawY() - downY;
      int slop = ViewConfiguration.get(getContext()).getScaledTouchSlop();
      if (Math.abs(dx) > slop && Math.abs(dx) > Math.abs(dy)) {
        pullCandidate = false;
        effectsCandidate = false;
      }
      if (-dy > slop && -dy > Math.abs(dx)) {
        effectsSwipe = effectsCandidate && !pulling && e.getPointerCount() == 1;
        pullCandidate = false;
        if (effectsSwipe) cancelSeekCommit = true;
        return effectsSwipe;
      }
      if (dy > slop && dy > Math.abs(dx)) effectsCandidate = false;
      if (pullCandidate && dy > slop && dy > Math.abs(dx) && !pulling) {
        cancelSeekCommit = true;
        pulling = true;
        if (morphProgress == 0) preparePull();
        // The intercepting MOVE first cancels the child; move the page immediately.
        setPullProgress(Math.max(0, initialOffset + dy) / (getHeight() * .34f));
      }
      return pulling;
    }

    private boolean railAt(float x, float y) {
      if (rail.getVisibility() != View.VISIBLE) return false;
      Matrix inverse = new Matrix();
      if (!rail.getMatrix().invert(inverse)) return false;
      float[] point = {x - rail.getLeft(), y - rail.getTop()};
      inverse.mapPoints(point);
      return point[0] >= 0
          && point[0] < rail.getWidth()
          && point[1] >= 0
          && point[1] < rail.getHeight();
    }

    public boolean onInterceptTouchEvent(MotionEvent e) {
      return e.getActionMasked() == MotionEvent.ACTION_MOVE && beginPull(e);
    }

    public void requestDisallowInterceptTouchEvent(boolean disallow) {
      // Keep directional arbitration available even when a SeekBar owns DOWN.
      super.requestDisallowInterceptTouchEvent(false);
    }

    public boolean onTouchEvent(MotionEvent e) {
      switch (e.getActionMasked()) {
        case MotionEvent.ACTION_DOWN:
          return pullCandidate || effectsCandidate;
        case MotionEvent.ACTION_MOVE:
          if (beginPull(e) && !effectsSwipe)
            setPullProgress(Math.max(0, initialOffset + e.getRawY() - downY) / (getHeight() * .34f));
          return true;
        case MotionEvent.ACTION_POINTER_DOWN:
        case MotionEvent.ACTION_CANCEL:
          effectsSwipe = false;
          finishPull(false);
          pullCandidate = false;
          return true;
        case MotionEvent.ACTION_UP:
          if (effectsSwipe) {
            effectsSwipe = false;
            if (downY - e.getRawY() >= MobileUi.dp(getContext(), 48)) post(actions::showEffects);
            return true;
          }
          if (pulling) {
            if (velocity != null) velocity.computeCurrentVelocity(1000);
            float speed = velocity == null ? 0 : velocity.getYVelocity();
            setPullProgress(Math.max(0, initialOffset + e.getRawY() - downY) / (getHeight() * .34f));
            float minimum = ViewConfiguration.get(getContext()).getScaledTouchSlop() * 1.5f;
            finishPull(
                gestureProgress * .34f > .08f
                    || (gestureProgress * getHeight() * .34f > minimum
                        && speed > 500 * getResources().getDisplayMetrics().density),
                speed);
          }
          return true;
      }
      return super.onTouchEvent(e);
    }

    private float gestureProgress;

    private void setPullProgress(float value) {
      gestureProgress = Math.max(0, Math.min(1, value));
      setMorph(gestureProgress);
    }

    private void finishPull(boolean collapse) {
      finishPull(collapse, 0);
    }

    private void finishOpeningGesture(float speed, boolean cancelled) {
      float opened = 1 - morphProgress;
      boolean complete = !cancelled && (speed > 1 && opened > .03f || speed >= -1 && opened >= .4f);
      // Reuse the current frame and snapshot, including after an interrupted settle.
      pulling = true;
      finishPull(!complete, -speed * getHeight() * .34f);
      if (complete && pullAnimation != null) {
        float remaining = Math.max(.001f, morphProgress);
        float seconds = .52f * (float) Math.sqrt(remaining);
        if (speed > 0) seconds = Math.min(seconds, 3 * remaining / speed);
        long millis = Math.max(16, Math.round(seconds * 1000));
        final float tangent = Math.min(3, Math.max(0, speed) * (millis / 1000f) / remaining);
        pullAnimation.setDuration(millis);
        pullAnimation.setInterpolator(t -> t * t * (3 - 2 * t) + tangent * t * (1 - t) * (1 - t));
      }
    }

    private void finishPull(boolean collapse, float releaseSpeed) {
      if (collapse) cancelCoverTail();
      if (collapse && !pulling && morphProgress == 0) preparePull();
      boolean fromGesture = pulling;
      pulling = false;
      settlingClosed = collapse;
      if (pullAnimation != null) pullAnimation.cancel();
      pullAnimation = ValueAnimator.ofFloat(morphProgress, collapse ? 1 : 0);
      pullAnimation.setDuration(lyricsBack ? (collapse ? 760 : morphProgress > .95f ? 580 : 420)
          : (collapse ? 480 : morphProgress > .95f ? 520 : 280));
      pullAnimation.setInterpolator(lyricsBack ? UiMotion.CURVE
          : new android.view.animation.PathInterpolator(.45f, 0, .25f, 1));
      if (fromGesture && collapse) {
        float remaining = Math.max(.001f, 1 - morphProgress);
        float progressSpeed = Math.max(0, releaseSpeed) / (getHeight() * .34f);
        float seconds = (lyricsBack ? .68f : .48f) * (float) Math.sqrt(remaining);
        // A monotone Hermite segment carries release velocity into the settle,
        // then reaches the capsule with zero velocity, without a fresh ease-in.
        if (progressSpeed > 0) seconds = Math.min(seconds, 3 * remaining / progressSpeed);
        long millis = Math.max(16, Math.round(seconds * 1000));
        final float tangent = Math.min(3, progressSpeed * (millis / 1000f) / remaining);
        pullAnimation.setDuration(millis);
        pullAnimation.setInterpolator(t -> t * t * (3 - 2 * t) + tangent * t * (1 - t) * (1 - t));
      }
      pullAnimation.addUpdateListener(a -> setMorph((Float) a.getAnimatedValue()));
      pullAnimation.addListener(
          new android.animation.AnimatorListenerAdapter() {
            boolean cancelled;

            public void onAnimationCancel(android.animation.Animator a) {
              cancelled = true;
            }

            public void onAnimationEnd(android.animation.Animator a) {
              if (cancelled) return;
              if (flippingToClose) {
                flippingToClose = false;
                if (!collapse) restoreLyricsFace(lyricsBack);
              }
              if (collapse) {
                if (onCollapsed != null)
                  onCollapsed.accept(cover(current));
                SpatialPlayer.this.dismiss();
              } else if (morphProgress == 0) openingOrigin = false;
            }
          });
      pullAnimation.start();
    }

    protected void onDetachedFromWindow() {
      cancelBlankGesture();
      if (pullAnimation != null) pullAnimation.cancel();
      pageSnapshot = null;
      animate().cancel();
      if (velocity != null) velocity.recycle();
      velocity = null;
      super.onDetachedFromWindow();
    }

    Layout(Context c) {
      super(c);
      blankGestures =
          new GestureDetector(
              c,
              new GestureDetector.SimpleOnGestureListener() {
                public boolean onDown(MotionEvent e) {
                  return true;
                }

                public boolean onSingleTapUp(MotionEvent e) {
                  tappedLyricTime = lyricTimeAt(e);
                  firstTapOnCard = cardAt(e.getX(), e.getY());
                  return true;
                }

                public boolean onSingleTapConfirmed(MotionEvent e) {
                  int target = tappedLyricTime;
                  tappedLyricTime = -1;
                  if (target < 0 || target >= duration || !isShowing() || (!lyricsBack && !splitActive()) || flippingToClose) return false;
                  actions.seekLyric(target, duration);
                  return true;
                }

                public boolean onDoubleTap(MotionEvent e) {
                  tappedLyricTime = -1;
                  doubleTapOnCard = firstTapOnCard && cardAt(e.getX(), e.getY());
                  doubleTapPending = true;
                  return true;
                }

                public boolean onDoubleTapEvent(MotionEvent e) {
                  if (e.getActionMasked() == MotionEvent.ACTION_UP) {
                    if (doubleTapPending
                        && blankGesture
                        && morphProgress == 0
                        && e.getEventTime() - e.getDownTime()
                            < ViewConfiguration.getLongPressTimeout()
                        && (blankAt(e.getX(), e.getY()) || cardAt(e.getX(), e.getY()))) {
                      flipCard();
                    }
                    doubleTapPending = false;
                  }
                  return true;
                }
              });
    }

    // Both drawing and hit testing use these two coordinate spaces.
    private boolean wide() { return getMeasuredWidth() > getMeasuredHeight(); }
    private float paneScale() {
      return Math.min(getMeasuredWidth() / 1960f, getMeasuredHeight() / 1240f);
    }
    private float unitX() { return wide() ? paneScale() : getMeasuredWidth()/931f; }
    private float unitY() { return wide() ? paneScale() : getMeasuredHeight()/2048f; }
    private float originX(boolean controls) {
      return wide() ? getMeasuredWidth()*(controls ? .75f : .25f) - 465.5f*paneScale() : 0;
    }
    private float originY(boolean controls) {
      return wide() ? getMeasuredHeight()*.5f - (controls ? 1590 : 705)*paneScale() : 0;
    }
    private float railOriginX() {
      if (!wide()) return originX(false);
      WindowInsets insets = getRootWindowInsets();
      int rightInset = insets == null ? 0 : insets.getInsetsIgnoringVisibility(
          WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()).right;
      return getMeasuredWidth() - rightInset - GlassUi.dp(activity, 8) - 896 * unitX();
    }

    private float railLeftOffset() {
      if (!wide() || unitX() <= 0) return -672f;
      WindowInsets insets = getRootWindowInsets();
      int leftInset = insets == null ? 0 : insets.getInsetsIgnoringVisibility(
          WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()).left;
      float left = leftInset + GlassUi.dp(activity, 8);
      return (left - railOriginX()) / unitX() - 706f;
    }

    private float railShiftY() {
      return wide() ? 0f : (getMeasuredHeight() / 2f - 763f * unitY()) * focusAmount;
    }

    private float splitLyricsX() { return getMeasuredWidth() * .75f - 358f * unitX(); }
    private float splitLyricsY() { return getMeasuredHeight() / 2f - 672f * unitY(); }

    private float controlDrop() { return getMeasuredHeight() * focusAmount; }

    private float visibleSplit() { return wide() ? splitAmount : 0f; }

    private float artScale() {
      float enlargement = wide() ? .08f : .19f - .25f * (1f - capsuleFraction);
      return 1f + enlargement * focusAmount * (1f - flipProgress) * (1f - visibleSplit());
    }

    private float artX() {
      float start = originX(false) + 465.5f * unitX();
      float destination = getMeasuredWidth() * (.5f - .25f * visibleSplit());
      float center = start + (destination - start) * focusAmount;
      return center - 465.5f * unitX() * artScale();
    }

    private float artY() {
      float anchor = 722f;
      float start = originY(false) + anchor * unitY();
      float center = start + (getMeasuredHeight() / 2f - start) * focusAmount;
      float targetAnchor = lyricsBack ? lyricTop() + (2.5f + extraLyricRows()) * lyricStep() : anchor;
      return center - (anchor + (targetAnchor - anchor) * focusAmount) * unitY() * artScale();
    }

    private float[] artPoint(float x, float y) {
      return new float[] {(x - artX()) / (unitX() * artScale()), (y - artY()) / (unitY() * artScale())};
    }

    private void transformArt(Canvas canvas) {
      canvas.translate(artX(), artY());
      canvas.scale(unitX() * artScale(), unitY() * artScale());
    }

    private void transformPane(Canvas c, boolean controls) {
      c.translate(controls ? originX(true) : railOriginX(), originY(controls) + (controls ? controlDrop() : railShiftY()));
      c.scale(unitX(), unitY());
    }

    private boolean isFocusButton(View child) {
      return child == lightSwitch || child == controlsSwitch;
    }

    void place(View view, float x, float y, float w, float h) {
      bounds.put(view, new RectF(x, y, x + w, y + h));
      addView(view);
    }

    protected void onMeasure(int w, int h) {
      int width = MeasureSpec.getSize(w), height = MeasureSpec.getSize(h);
      setMeasuredDimension(width, height);
      for (int i = 0; i < getChildCount(); i++) {
        View child = getChildAt(i);
        if (isFocusButton(child)) {
          int size = MeasureSpec.makeMeasureSpec(GlassUi.dp(activity, 48), MeasureSpec.EXACTLY);
          child.measure(size, size);
          continue;
        }
        RectF r = bounds.get(child);
        child.measure(
            MeasureSpec.makeMeasureSpec(
                r == null ? width : Math.round(r.width() * unitX()), MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(
                r == null ? height : Math.round(r.height() * unitY()), MeasureSpec.EXACTLY));
      }
    }

    protected void onLayout(boolean changed, int l, int t, int r, int b) {
      for (int i = 0; i < getChildCount(); i++) {
        View child = getChildAt(i);
        if (isFocusButton(child)) {
          WindowInsets insets = getRootWindowInsets();
          android.graphics.Insets safe = insets == null ? android.graphics.Insets.NONE
              : insets.getInsetsIgnoringVisibility(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
          int margin = GlassUi.dp(activity, 8);
          int size = child.getMeasuredWidth();
          int left = child == lightSwitch ? safe.left + margin : getWidth() - safe.right - margin - size;
          int bottom = getHeight() - safe.bottom - margin;
          child.layout(left, bottom - size, left + size, bottom);
          continue;
        }
        RectF rect = bounds.get(child);
        int x = rect == null ? 0 : Math.round((child == rail ? railOriginX() : originX(true)) + rect.left * unitX()),
            y = rect == null ? 0 : Math.round(originY(child != rail) + rect.top * unitY());
        if (child == rail) {
          child.setTranslationX(capsuleOffset()*unitX());
          child.setTranslationY(railShiftY());
        }
        child.layout(x, y, x + child.getMeasuredWidth(), y + child.getMeasuredHeight());
      }
    }
  }

  private ValueAnimator railScrollAnimation;
  private float railScrollPosition;
  private boolean railScrollActive;

  private void animateRailScroll(float from, float to) {
    if (railScrollAnimation != null) railScrollAnimation.cancel();
    railScrollActive = true;
    railScrollPosition = from;
    if (Math.abs(to - from) < .001f || !ValueAnimator.areAnimatorsEnabled()) {
      railScrollPosition = to;
      railScrollActive = false;
      railScrollAnimation = null;
      return;
    }
    railScrollAnimation = ValueAnimator.ofFloat(0, 1);
    railScrollAnimation.setDuration(420);
    railScrollAnimation.setInterpolator(new android.view.animation.LinearInterpolator());
    railScrollAnimation.addUpdateListener(
        a -> {
          float t = (float) a.getAnimatedValue();
          float eased = t * t * t * (10 + t * (-15 + 6 * t));
          railScrollPosition = from + (to - from) * eased;
          if (t >= 1) {
            railScrollActive = false;
            railScrollAnimation = null;
          }
          redraw();
        });
    railScrollAnimation.start();
  }

  private float railOffset() {
    if (!draggingRail && rail.cancelAmount > 0)
      return start() + (rail.cancelOffset - start()) * rail.cancelAmount;
    if (!draggingRail && railScrollActive) return railScrollPosition;
    return draggingRail && scrub != null
        ? (float) Math.max(0, Math.min(Math.max(0, queue.length - 5), scrub.cursor() - 2))
        : start();
  }

  private static final float RAIL_FIT = 808f/905f;
  private float railOriginalX(float x) {return (x-882)/RAIL_FIT+883;}
  private float railOriginalY(float y) {return (y-318)/RAIL_FIT+310;}

  private final class Rail extends View {
    float downY, touchY, cancelAmount, cancelOffset;
    int downSlot, cancelIndex = -1;
    boolean cancelFloating;
    ValueAnimator cancelAnimation;
    boolean moved;
    final Handler handler = new Handler();
    final Runnable longPress =
        () -> {
          moved = true;
          draggingRail = false;
          railFrames.removeCallbacksAndMessages(null);
          redraw();
          showQueue();
        };

    Rail(Context c) {
      super(c);
      setFocusable(true);
    }

    int selectedIndex() {
      if (!draggingRail) return preview;
      if (queue.length == 0) return -1;
      float offset = railOffset();
      int touched = Math.round(offset + (touchY - 472.5f) / 148);
      return Math.max(0, Math.min(queue.length - 1, touched));
    }

    private boolean insideCapsule(MotionEvent event) {
      // Events are already mapped into this translated/scaled View's local coordinates.
      float x = railOriginalX(event.getX() / root.unitX() + 706);
      float y = railOriginalY(event.getY() / root.unitY() + 298);
      float centerY = Math.max(391.5f, Math.min(1133.5f, y));
      float dx = x - 801.5f, dy = y - centerY;
      return dx * dx + dy * dy <= 81.5f * 81.5f;
    }

    private void cancelSelection() {
      if (!draggingRail) return;
      if (draggingRail) {
        if (cancelAnimation != null) cancelAnimation.cancel();
        cancelIndex = selectedIndex();
        cancelOffset = railOffset();
        cancelFloating = moved;
        cancelAmount = 1;
      }
      handler.removeCallbacks(longPress);
      railFrames.removeCallbacksAndMessages(null);
      draggingRail = false;
      scrub = null;
      preview = current;
      if (cancelAmount > 0) {
        cancelAnimation = ValueAnimator.ofFloat(0, 1);
        cancelAnimation.setDuration(ValueAnimator.areAnimatorsEnabled() ? 320 : 0);
        cancelAnimation.setInterpolator(new android.view.animation.LinearInterpolator());
        cancelAnimation.addUpdateListener(
            a -> {
              float t = (float) a.getAnimatedValue();
              cancelAmount = 1 - t * t * t * (10 + t * (-15 + 6 * t));
              if (t >= 1) {
                cancelAmount = 0;
                cancelIndex = -1;
              }
              redraw();
            });
        cancelAnimation.start();
      }
      redraw();
      settleCapsule(false);
    }

    public boolean onTouchEvent(MotionEvent e) {
      float virtualY = railOriginalY(e.getY() / root.unitY() + 298);
      if (e.getActionMasked() == MotionEvent.ACTION_DOWN && !insideCapsule(e)) return false;
      if (draggingRail
          && (e.getActionMasked() == MotionEvent.ACTION_MOVE
              || e.getActionMasked() == MotionEvent.ACTION_UP)
          && !insideCapsule(e)) {
        cancelSelection();
        return true;
      }
      touchY = virtualY;
      switch (e.getActionMasked()) {
        case MotionEvent.ACTION_DOWN:
          float touchedOffset = railOffset();
          if (railScrollAnimation != null) railScrollAnimation.cancel();
          railScrollAnimation = null;
          railScrollActive = false;
          if (cancelAnimation != null) cancelAnimation.cancel();
          cancelAmount = 0;
          cancelIndex = -1;
          downY = e.getY();
          if (capsuleAnimation != null) capsuleAnimation.cancel();
          capsuleSpring = null;
          capsuleHidden = false;
          preview = current;
          moved = false;
          draggingRail = true;
          scrub = new ElasticScrub(queue.length, current);
          if (queue.length > 5) scrub.anchor(touchedOffset + 2);
          downSlot = Math.max(0, Math.min(4, Math.round((virtualY - 472) / 148)));
          handler.postDelayed(longPress, 600);
          redraw();
          return true;
        case MotionEvent.ACTION_MOVE:
          if (!draggingRail || scrub == null) return true;
          float pull = (e.getY() - downY) / root.unitY() / RAIL_FIT;
          if (Math.abs(pull) > 12 || moved) {
            handler.removeCallbacks(longPress);
            scrub.pull(pull);
            if (!moved) {
              moved = true;
              lastFrame = android.os.SystemClock.uptimeMillis();
              railFrames.post(railTick);
            }
            redraw();
          }
          return true;
        case MotionEvent.ACTION_UP:
          handler.removeCallbacks(longPress);
          railFrames.removeCallbacksAndMessages(null);
          if (!draggingRail) return true;
          int releasedSelection = selectedIndex();
          float releasedOffset = railOffset();
          draggingRail = false;
          scrub = null;
          // Keep the large card on the playing song until playback confirms the released choice.
          railScrollPosition = releasedOffset;
          railScrollActive = true;
          if (releasedSelection >= 0 && releasedSelection != current)
            actions.queue(releasedSelection);
          if (railScrollAnimation == null) animateRailScroll(releasedOffset, start());
          preload();
          redraw();
          settleCapsule(false);
          return true;
        case MotionEvent.ACTION_CANCEL:
          cancelSelection();
          return true;
      }
      return true;
    }

    protected void onDetachedFromWindow() {
      if (cancelAnimation != null) cancelAnimation.cancel();
      handler.removeCallbacksAndMessages(null);
      railFrames.removeCallbacksAndMessages(null);
      super.onDetachedFromWindow();
    }
  }

  private final class Scene extends View {
    final Paint p = new Paint(3);

    private Bitmap tintCover;
    private int timelineTint = Color.WHITE;
    private int mappedDuration = -1;
    private final int[] lyricLengths = new int[56];
    private final float[] displayedLengths = new float[56];
    private final float[] startingLengths = new float[56];
    private long shapeChangedAt;

    private void drawTimeline(Canvas c, float thumb) {
      Bitmap bitmap = cover(current);
      if (bitmap != tintCover) {
        tintCover = bitmap;
        int sample = 0xffdddddd, best = -1;
        if (bitmap != null) {
          for (int y = 1; y <= 5; y++) {
            for (int x = 1; x <= 5; x++) {
              int pixel = bitmap.getPixel(bitmap.getWidth()*x/6, bitmap.getHeight()*y/6);
              int r = Color.red(pixel), g = Color.green(pixel), b = Color.blue(pixel);
              int chroma = Math.max(r, Math.max(g,b)) - Math.min(r, Math.min(g,b));
              if (Color.alpha(pixel) > 180 && chroma > best) {
                sample = pixel;
                best = chroma;
              }
            }
          }
        }
        timelineTint = Color.rgb(170 + Color.red(sample)*85/255,
            170 + Color.green(sample)*85/255, 170 + Color.blue(sample)*85/255);
      }
      if (mappedDuration != duration) {
        mappedDuration = duration;
        System.arraycopy(displayedLengths, 0, startingLengths, 0, displayedLengths.length);
        java.util.Arrays.fill(lyricLengths, 0);
        if (timelineStarted && duration > 0) {
          for (int j = 0; j < lyricTimes.size() && j < lyricSentences.length; j++) {
            int stamp = lyricTimes.get(j);
            if (stamp < 0 || stamp >= duration) continue;
            int bin = (int)((long)stamp * lyricLengths.length / duration);
            String line = lyricSentences[j];
            lyricLengths[bin] = Math.max(lyricLengths[bin], line.codePointCount(0, line.length()));
          }
        }
        shapeChangedAt = android.os.SystemClock.uptimeMillis();
      }
      boolean animate = ValueAnimator.areAnimatorsEnabled();
      float phase = animate ? (android.os.SystemClock.uptimeMillis() - shapeChangedAt) / 650f : 2;
      if (phase < 1.35f && !closed && isShown()) postInvalidateOnAnimation();
      float rest = playing && animate ? 6 : 0;
      float release = animate ? Math.max(0, 1 - (android.os.SystemClock.uptimeMillis() - seekReleasedAt) / 360f) : 0;
      float lift = draggingSeek ? 15 : rest + (15 - rest) * release * release;
      if (!draggingSeek && release > 0) postInvalidateOnAnimation();
      for (int i = 0; i < lyricLengths.length; i++) {
        float x = 96 + 735f*i/(lyricLengths.length-1);
        float t = Math.max(0, Math.min(1, phase - .35f*i/(lyricLengths.length-1)));
        float eased = t*t*(3-2*t);
        float target = Math.min(17, 2.5f*(float)Math.sqrt(lyricLengths[i]));
        displayedLengths[i] = startingLengths[i] + (target-startingLengths[i])*eased;
        float h = 4 + displayedLengths[i];
        if (lift > 0) {
          float proximity = Math.max(0, 1 - Math.abs(x-thumb)/65f);
          h += lift * proximity * proximity;
        }
        boolean elapsed = x <= thumb;
        float radius = elapsed ? 3.8f : 3f;
        color(elapsed ? timelineTint : 0x60ffffff);
        c.drawRoundRect(x-radius,1325-h,x+radius,1325+h,radius,radius,p);
      }
      color(Color.WHITE);
      c.drawRoundRect(thumb-7,1305,thumb+7,1345,7,7,p);
    }

    Scene(Context c) {
      super(c);
      lyricMask.setShader(new LinearGradient(0,185,0,1160,
          new int[]{0, Color.BLACK, Color.BLACK, 0}, new float[]{0,.09f,.91f,1}, Shader.TileMode.CLAMP));
      lyricMask.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.DST_IN));
      // Native GPU canvas handles perspective and compositing; avoid a full-screen CPU bitmap
      // layer.
      setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
    }

    private void color(int value) {
      p.setShader(null);
      p.setStyle(Paint.Style.FILL);
      p.setColor(value);
      p.clearShadowLayer();
    }

    private void text(
        Canvas c, String value, float x, float y, float size, int color, float width) {
      color(color);
      p.setTextSize(size);
      p.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
      android.text.TextPaint textPaint = new android.text.TextPaint(p);
      String fitted =
          android.text.TextUtils.ellipsize(
                  value == null ? "" : value,
                  textPaint,
                  width,
                  android.text.TextUtils.TruncateAt.END)
              .toString();
      c.drawText(fitted, x, y, p);
    }

    private void photo(Canvas c, Bitmap bitmap, RectF r, float radius) {
      c.save();
      Path clip = new Path();
      clip.addRoundRect(r, radius, radius, Path.Direction.CW);
      c.clipPath(clip);
      color(0xff353535);
      if (bitmap == null) c.drawRect(r, p);
      else {
        float scale = Math.max(r.width() / bitmap.getWidth(), r.height() / bitmap.getHeight()),
            w = bitmap.getWidth() * scale,
            h = bitmap.getHeight() * scale;
        c.drawBitmap(
            bitmap,
            null,
            new RectF(
                r.centerX() - w / 2, r.centerY() - h / 2, r.centerX() + w / 2, r.centerY() + h / 2),
            p);
      }
      c.restore();
    }

    private final class TrackTexture {
      Bitmap image, cover;
      float resolution;
      String label, singer;

      boolean matches(Bitmap bitmap, String title, String artist) {
        return image != null && cover == bitmap && title.equals(label) && artist.equals(singer);
      }

      void clear() {
        if (image != null) image.recycle();
        image = cover = null;
        label = singer = null;
      }
    }

    private final TrackTexture[] trackTextures = {new TrackTexture(), new TrackTexture()};
    private int nextTrackTexture;
    private boolean capturingTrackTexture;
    private final RectF trackTextureBounds = new RectF(-80, 190, 800, 1290);
    private final Paint trackTexturePaint =
        new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);

    private void clearTrackTextures() {
      for (TrackTexture texture : trackTextures) texture.clear();
    }

    private TrackTexture trackTexture(Bitmap bitmap, String label, String singer) {
      for (TrackTexture cached : trackTextures)
        if (cached.matches(bitmap, label, singer)) return cached;
      TrackTexture texture = trackTextures[nextTrackTexture++ % 2];
      texture.clear();
      texture.resolution = Math.max(.5f, Math.min(1.5f, getWidth() / 931f));
      int width = Math.round(trackTextureBounds.width() * texture.resolution);
      int height = Math.round(trackTextureBounds.height() * texture.resolution);
      texture.image = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
      Canvas buffer = new Canvas(texture.image);
      buffer.scale(texture.resolution, texture.resolution);
      buffer.translate(-trackTextureBounds.left, -trackTextureBounds.top);
      capturingTrackTexture = true;
      try {
        drawTrackCard(buffer, new Matrix(), bitmap, label, singer, 1);
      } finally {
        capturingTrackTexture = false;
      }
      texture.cover = bitmap;
      texture.label = label;
      texture.singer = singer;
      return texture;
    }

    private android.text.StaticLayout lyricSentence(CharSequence sentence, float size) {
      android.text.TextPaint ink = new android.text.TextPaint(Paint.ANTI_ALIAS_FLAG);
      ink.setColor(Color.WHITE);
      ink.setTextSize(size);
      ink.setTypeface(Typeface.create("sans-serif-black", Typeface.BOLD));
      ink.setShadowLayer(8, 5, 9, 0x77000000);
      return android.text.StaticLayout.Builder.obtain(sentence, 0, sentence.length(), ink, 752)
          .setAlignment(android.text.Layout.Alignment.ALIGN_CENTER)
          .setLineSpacing(0, .9f)
          .setIncludePad(false)
          .build();
    }

    private android.text.StaticLayout fitLyricSentence(CharSequence sentence) {
      android.text.StaticLayout full = lyricSentence(sentence, 62);
      if (full.getHeight() <= 168) return full;
      float low = 1, high = 62;
      android.text.StaticLayout fitted = lyricSentence(sentence, low);
      for (int i = 0; i < 8; i++) {
        float size = (low + high) / 2;
        android.text.StaticLayout candidate = lyricSentence(sentence, size);
        if (candidate.getHeight() <= 168) {
          low = size;
          fitted = candidate;
        } else high = size;
      }
      return fitted;
    }

    private void drawLyrics(Canvas c, Bitmap bitmap, String label, String singer) {
      int layer = c.saveLayer(-36, lyricTop() - 17, 752, lyricBottom(), null);
      String[] sentences = lyricSentences;
      if (lyricRows.isEmpty()) {
        for (String sentence : sentences) lyricRows.add(null);
      }
      int first = Math.max(0, (int)Math.floor(lyricStart()));
      int count = Math.min(lyricRows.size(), (int)Math.ceil(lyricStart() + 5 + 2 * extraLyricRows())) - first;
      for (int row = 0; row < count; row++) {
        int index = first + row;
        android.text.StaticLayout layout = lyricRows.get(index);
        if (layout == null) {
          String original = sentences[index];
          String subtitle = index < translatedLines.size() ? translatedLines.get(index) : null;
          CharSequence rowText = original;
          if (subtitle != null) {
            android.text.SpannableString pair = new android.text.SpannableString(original + "\n" + subtitle);
            int start = original.length() + 1;
            pair.setSpan(new android.text.style.RelativeSizeSpan(.65f), start, pair.length(), 0);
            rowText = pair;
          }
          layout = fitLyricSentence(rowText);
          lyricRows.set(index, layout);
        }
        float emphasis = Math.max(0, 1 - Math.abs(index - lyricFocus));
        float slot = index - lyricStart();
        // At the window handoff the leaving/entering rows are already fully transparent.
        float edge = smoothRange(slot, -.5f, 0) * (1 - smoothRange(slot, 4 + 2 * extraLyricRows(), 4.5f + 2 * extraLyricRows()));
        android.text.TextPaint ink = layout.getPaint();
        ink.setAlpha(Math.round(255 * (.48f + .52f * emphasis) * edge));
        ink.setShadowLayer(8 + 2 * emphasis, 5, 9 + 2 * emphasis,
            Math.round(119 * (.48f + .52f * emphasis) * edge) << 24);
        int save = c.save();
        c.clipRect(-36, lyricTop() - 17, 752, lyricBottom());
        float y = lyricTop() + slot * lyricStep() + (lyricStep() - layout.getHeight()) / 2f;
        c.scale(1 + .02f * emphasis, 1 + .02f * emphasis, 358, y + layout.getHeight() / 2f);
        c.translate(-18, y);
        layout.draw(c);
        c.restoreToCount(save);
      }
      float maskTop = lyricTop() - 17;
      float maskScale = (lyricBottom() - maskTop) / (1160f - 185f);
      lyricMaskTransform.setScale(1f, maskScale);
      lyricMaskTransform.postTranslate(0f, maskTop - 185f * maskScale);
      lyricMask.getShader().setLocalMatrix(lyricMaskTransform);
      c.drawRect(-36, maskTop, 752, lyricBottom(), lyricMask);
      c.restoreToCount(layer);
    }

    private final Paint lyricMask = new Paint();
    private final Matrix lyricMaskTransform = new Matrix();
    private final android.util.LruCache<String, android.text.StaticLayout> metadataLayouts =
        new android.util.LruCache<>(8);

    private android.text.StaticLayout metadataLayout(String value) {
      android.text.StaticLayout layout = metadataLayouts.get(value);
      if (layout == null) {
        layout = fitLyricSentence(value);
        metadataLayouts.put(value, layout);
      }
      return layout;
    }

    private void drawPendingMetadata(Canvas c, Bitmap bitmap, String label, String singer) {
      android.text.StaticLayout title = metadataLayout(label);
      android.text.StaticLayout artist = metadataLayout(singer.isEmpty() ? "本地音频" : singer);
      int save = c.save();
      c.translate(-18, 610 - title.getHeight() / 2f);
      title.draw(c);
      c.restoreToCount(save);
      save = c.save();
      c.translate(-18, 800 - artist.getHeight() / 2f);
      artist.draw(c);
      c.restoreToCount(save);
    }

    private BitmapShader paperGrain;
    private final Paint paperPaint=new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path paperClip=new Path();

    private void drawGlossPaper(Canvas c,RectF card) {
      if(paperGrain==null) {
        Bitmap grain=Bitmap.createBitmap(128,128,Bitmap.Config.ARGB_8888);
        java.util.Random random=new java.util.Random(42);
        int[] pixels=new int[128*128];
        for(int i=0;i<pixels.length;i++) {
          int alpha=3+random.nextInt(9);
          pixels[i]=(alpha<<24)|(random.nextBoolean()?0x00ffffff:0);
        }
        grain.setPixels(pixels,0,128,0,0,128,128);
        paperGrain=new BitmapShader(grain,Shader.TileMode.REPEAT,Shader.TileMode.REPEAT);
      }
      int save=c.save();
      paperClip.reset();paperClip.addRoundRect(card,42,42,Path.Direction.CW);c.clipPath(paperClip);
      paperPaint.setStyle(Paint.Style.FILL);paperPaint.setAlpha(255);
      paperPaint.setShader(paperGrain);c.drawRect(card,paperPaint);
      // A broad low-contrast sheen, shifted slightly with the existing card tilt.
      float shift=tiltY*3;
      paperPaint.setShader(new LinearGradient(card.left-80+shift,card.top,
          card.right+160+shift,card.bottom,
          new int[]{0x00ffffff,0x05ffffff,0x24ffffff,0x08ffffff,0x00000000,0x09000000},
          new float[]{0,.22f,.40f,.54f,.70f,1},Shader.TileMode.CLAMP));
      c.drawRect(card,paperPaint);
      paperPaint.setShader(null);
      paperPaint.setStyle(Paint.Style.STROKE);paperPaint.setStrokeWidth(1.5f);
      paperPaint.setColor(0x42ffffff);
      c.drawRoundRect(card.left+1,card.top+1,card.right-1,card.bottom-1,41,41,paperPaint);
      paperPaint.setStyle(Paint.Style.FILL);
      c.restoreToCount(save);
    }

    private void drawTrackCard(
        Canvas c, Matrix matrix, Bitmap bitmap, String label, String singer, float opacity) {
      drawTrackCard(c, matrix, bitmap, label, singer, opacity, false);
    }

    private void drawTrackCard(
        Canvas c,
        Matrix matrix,
        Bitmap bitmap,
        String label,
        String singer,
        float opacity,
        boolean metadataOnly) {
      if (opacity <= 0) return;
      if (!capturingTrackTexture
          && !c.isHardwareAccelerated()
          && flipProgress == 0
          && (trackProgress > 0 || outgoingSong != null)) {
        TrackTexture texture = trackTexture(bitmap, label, singer);
        int save = c.save();
        c.concat(matrix);
        trackTexturePaint.setAlpha(Math.round(255 * opacity));
        c.drawBitmap(texture.image, null, trackTextureBounds, trackTexturePaint);
        c.restoreToCount(save);
        return;
      }
      int layer =
          opacity < 1 ? c.saveLayerAlpha(null, Math.round(255 * opacity)) : c.save();
      c.concat(matrix);
      if (flipProgress >= .5f) {
        if (metadataOnly || lyricReveal <= 0) {
          drawPendingMetadata(c, bitmap, label, singer);
        } else if (lyricReveal < 1) {
          float names = 1 - smoothRange(lyricReveal, 0, .65f);
          float lines = smoothRange(lyricReveal, .15f, 1);
          int namesLayer = c.saveLayerAlpha(-36, 160, 752, 1160, Math.round(255 * names));
          c.translate(0, -8 * lyricReveal);
          drawPendingMetadata(c, bitmap, label, singer);
          c.restoreToCount(namesLayer);
          int lyricLayer = c.saveLayerAlpha(-36, 160, 752, 1160, Math.round(255 * lines));
          c.translate(0, 18 * (1 - lyricReveal));
          drawLyrics(c, bitmap, label, singer);
          c.restoreToCount(lyricLayer);
        } else drawLyrics(c, bitmap, label, singer);
        c.restoreToCount(layer);
        return;
      }
      RectF card = new RectF(49, 318, 667, 1126);
      color(PLAYER_CARD);
      p.setShadowLayer(
          55 + (Math.abs(tiltX) + Math.abs(tiltY)) * .5f, -tiltY * 3, -tiltX * 3, 0x66888888);
      c.drawRoundRect(card, 42, 42, p);
      p.clearShadowLayer();
      c.drawRoundRect(card, 42, 42, p);
      drawGlossPaper(c,card);
      if (!root.capturingSnapshot && root.morphProgress == 0)
        photo(c, bitmap, new RectF(78, 354, 639, 915), 41);
      text(c, label, 78, 1008, 44, PLAYER_CARD_INK, 540);
      text(c, singer.isEmpty() ? "本地音频" : singer, 78, 1070, 35, PLAYER_CARD_MUTED, 540);
      c.restoreToCount(layer);
    }

    protected void onDraw(Canvas c) {
      c.save();
      float morphDarkness = lyricsBack ? smoothRange(root.morphProgress, 0f, .18f) : 0f;
      if (root.coverTail >= 0f) morphDarkness = 1f - smoothRange(root.coverTail, .28f, 1f);
      float backgroundDarkness = Math.max(darkness, morphDarkness);
      if (backgroundDarkness < 1f)
        DotoAppearance.drawPlayer(c,getWidth(),getHeight(),cover(current),this::invalidate);
      if (backgroundDarkness > 0f)
        c.drawColor(Color.argb(Math.round(255 * backgroundDarkness), 0, 0, 0));
      int artPane = c.save();
      root.transformArt(c);
      if (trackAnimation != null) trackRenderedFrames++;
      String label = preview >= 0 && preview < queue.length ? queue[preview] : song;
      String singer = preview >= 0 && preview < artists.length ? artists[preview] : artist;
      int entranceCard=c.save();
      float lyricArrival = lyricsBack ? 1f - smoothRange(root.morphProgress, 0f, .45f) : 1f;
      if (root.coverTail >= 0f) lyricArrival *= smoothRange(root.coverTail, 0f, .9f);
      c.translate(0, lyricsBack ? 16f * (1f - lyricArrival) : entranceOffset(0));
      int entranceLayer = lyricArrival < 1f
          ? c.saveLayerAlpha(null, Math.round(255 * lyricArrival)) : c.save();
      if (outgoingSong != null || trackProgress > 0 && dragTrackIndex >= 0) {
        int incomingIndex = dragTrackIndex >= 0 ? dragTrackIndex : preview;
        String incomingLabel =
            incomingIndex >= 0 && incomingIndex < queue.length ? queue[incomingIndex] : label;
        String incomingSinger =
            incomingIndex >= 0 && incomingIndex < artists.length ? artists[incomingIndex] : singer;
        // Reveal the real adjacent card during the drag, before playback is committed.
        float incomingOpacity = smoothRange(trackProgress, 0, .24f);
        if (incomingOpacity > 0) trackIncomingDraws++;
        drawTrackCard(
            c,
            trackCardMatrix(true),
            cover(incomingIndex),
            incomingLabel,
            incomingSinger,
            incomingOpacity,
            true);
        drawTrackCard(
            c,
            trackCardMatrix(false),
            outgoingSong != null ? outgoingCover : cover(preview),
            outgoingSong != null ? outgoingSong : label,
            outgoingSong != null ? outgoingArtist : singer,
            1 - smoothRange(trackProgress, .28f, .82f),
            outgoingSong != null);
      } else {
        drawTrackCard(
            c,
            trackProgress > 0 ? trackCardMatrix(false) : cardMatrix(),
            cover(preview),
            label,
            singer,
            1);
      }
      c.restoreToCount(entranceLayer);
      c.restoreToCount(entranceCard);
      c.restoreToCount(artPane);
      float splitVisibility = root.visibleSplit() * focusAmount;
      if (splitVisibility > 0f) {
        int lyricsPane = c.saveLayerAlpha(null, Math.round(255 * splitVisibility));
        c.translate(root.splitLyricsX() + (1f - splitVisibility) * 24f * root.unitX(),
            root.splitLyricsY());
        c.scale(root.unitX(), root.unitY());
        if (lyricReady) drawLyrics(c, cover(preview), label, singer);
        else drawPendingMetadata(c, cover(preview), label, singer);
        c.restoreToCount(lyricsPane);
      }
      artPane = c.save();
      root.transformPane(c, false);
      int capsulePosition = c.save();
      c.translate(0,entranceOffset(2));
      c.translate(capsuleOffset(), 0);
      c.scale(capsuleDepth(), capsuleDepth(), 809.2f, 722);
      c.translate(882,318);c.scale(RAIL_FIT,RAIL_FIT);c.translate(-883,-310);
      int capsuleLayer = c.saveLayer(640, 300, 1130, 1230, null);
      color((0xfffafafa&0xffffff)|0x80000000);
      c.drawRoundRect(720, 310, 883, 1215, 82, 82, p);
      float tension = draggingRail && scrub != null ? (float) scrub.strength() : 0;
      color(0xfffafafa);
      p.setStyle(Paint.Style.STROKE);
      p.setStrokeWidth(4);
      p.setStrokeCap(Paint.Cap.ROUND);
      Path wave = new Path();
      float length = 55 + 11 * tension, amplitude = 9 * (1 - tension);
      for (int step = 0; step <= 32; step++) {
        float t = step / 32f,
            x = 801.5f + (float) Math.sin(t * Math.PI * 4) * amplitude,
            y = 330 + t * length;
        if (step == 0) wave.moveTo(x, y);
        else wave.lineTo(x, y);
      }
      c.drawPath(wave, p);
      p.setStyle(Paint.Style.FILL);
      float offset = railOffset();
      int selectedCover = rail.selectedIndex();
      int railLayer = c.saveLayer(724, 405, 879, 1132, null);
      c.clipRect(724, 405, 879, 1132);
      for (int i = sortingProgress<1?0:Math.max(0,(int)Math.floor(offset));
          i < (sortingProgress<1?queue.length:Math.min(queue.length,(int)Math.ceil(offset)+5)); i++) {
        float row=i-offset;
        if(sortingProgress<1&&sortingFrom!=null) {
          int old=i;
          for(int j=0;j<sortingFrom.length;j++)if(java.util.Objects.equals(sortingFrom[j],covers[i])){old=j;break;}
          row=(old-sortingOffset)+(row-(old-sortingOffset))*sortingProgress;
        }
        if(row < -1 || row > 5)continue;
        RectF r = new RectF(740, 411 + row * 148, 862, 534 + row * 148);
        int coverTransform = c.save();
        float emphasis =
            rail.cancelAmount > 0
                ? (i == rail.cancelIndex ? rail.cancelAmount : 0)
                    + (i == current ? 1 - rail.cancelAmount : 0)
                : (i == selectedCover ? 1 : 0);
        if (emphasis > 0) {
          c.rotate(-4 * emphasis, r.centerX(), r.centerY());
          c.scale(1 + .06f * emphasis, 1 + .06f * emphasis, r.centerX(), r.centerY());
        }
        photo(c, cover(i), r, 33);
        if (emphasis > 0) {
          color(0xffD9E0E5);
          p.setAlpha(Math.round(255 * emphasis));
          p.setStyle(Paint.Style.STROKE);
          p.setStrokeWidth(3);
          c.drawRoundRect(r, 33, 33, p);
          p.setStyle(Paint.Style.FILL);
        }
        c.restoreToCount(coverTransform);
      }
      color(0xfffafafa);
      p.setShader(
          new LinearGradient(
              0,
              405,
              0,
              1132,
              new int[] {Color.TRANSPARENT, 0xfffafafa, 0xfffafafa, Color.TRANSPARENT},
              new float[] {0, .045f, .955f, 1},
              Shader.TileMode.CLAMP));
      p.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.DST_IN));
      c.drawRect(724, 405, 879, 1132, p);
      p.setXfermode(null);
      p.setShader(null);
      c.restoreToCount(railLayer);
      color(0xfffafafa);
      p.setAlpha(Math.round(255 * (1 - capsuleFraction)));
      p.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.DST_IN));
      c.drawRect(640, 300, 1130, 1230, p);
      p.setXfermode(null);
      p.setAlpha(255);
      c.restoreToCount(capsuleLayer);
      boolean cancelPreview = rail.cancelAmount > 0 && rail.cancelFloating;
      int floatingIndex = cancelPreview ? rail.cancelIndex : selectedCover;
      if ((draggingRail && rail.moved || cancelPreview)
          && floatingIndex >= 0
          && floatingIndex < queue.length) {
        // Keep this preview outside the rail mask so it stays visible beside the finger.
        float remaining = cancelPreview ? rail.cancelAmount : 1;
        float centerX = capsuleSide > 0 ? 600 : 1003;
        centerX += (801.5f - centerX) * (1 - remaining) * .5f;
        float centerY = Math.max(500, Math.min(1040, 472.5f + (floatingIndex - offset) * 148));
        int floating =
            c.saveLayerAlpha(
                490, 390, 1110, 1210, Math.round(255 * (1 - capsuleFraction) * remaining));
        c.scale(.75f + .25f * remaining, .75f + .25f * remaining, centerX, centerY);
        RectF frame = new RectF(centerX - 92, centerY - 92, centerX + 92, centerY + 92);
        color(0xfffafafa);
        p.setShadowLayer(18, 0, 8, 0x66000000);
        c.drawRoundRect(frame, 32, 32, p);
        p.clearShadowLayer();
        photo(
            c,
            cover(floatingIndex),
            new RectF(centerX - 87, centerY - 87, centerX + 87, centerY + 87),
            28);
        p.setTextAlign(Paint.Align.CENTER);
        text(c, queue[floatingIndex], centerX, centerY + 134, 26, 0xfffafafa, 184);
        p.setTextAlign(Paint.Align.LEFT);
        c.restoreToCount(floating);
      }
      c.restoreToCount(capsulePosition);
      c.restoreToCount(artPane);
      root.transformPane(c,true);
      c.translate(0,entranceOffset(1));
      float visualPosition=displayedPosition();
      float fraction = duration>0 ? visualPosition/duration : 0;
      float thumb = 93 + 741 * fraction;
      int shown = (int)visualPosition;
      text(c, format(shown), 93, 1403, 34, 0xfffafafa, 145);
      p.setTextAlign(Paint.Align.RIGHT);
      text(c, "-" + format(Math.max(0, duration - shown)), 834, 1403, 34, 0xfffafafa, 180);
      p.setTextAlign(Paint.Align.LEFT);
      if (draggingSeek && duration > 0 && !lyricTimes.isEmpty()) {
        int index = java.util.Collections.binarySearch(lyricTimes, shown);
        if (index < 0) index = -index - 2;
        if (index >= 0 && index < lyricSentences.length) {
          p.setTextAlign(Paint.Align.CENTER);
          String subtitle = index < translatedLines.size() ? translatedLines.get(index) : null;
          text(c, lyricSentences[index], 463.5f, subtitle == null ? 1263 : 1236, 32, 0xfffafafa, 741);
          if (subtitle != null) text(c, subtitle, 463.5f, 1271, 24, 0xffeeeeee, 741);
          p.setTextAlign(Paint.Align.LEFT);
        }
      }
      drawTimeline(c, thumb);
      c.restore();
      if (playing && duration>0 && !draggingSeek && !closed && isShown()
          && root.morphProgress==0) postInvalidateOnAnimation();
    }
  }

  private static String format(int ms) {
    return String.format(Locale.ROOT, "%d:%02d", ms / 60000, ms / 1000 % 60);
  }
}
