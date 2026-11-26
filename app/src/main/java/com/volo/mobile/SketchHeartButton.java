package com.volo.mobile;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.*;
import android.util.Xml;
import android.view.*;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.ToggleButton;
import java.io.InputStream;
import java.util.*;
import java.util.regex.*;
import org.xmlpull.v1.XmlPullParser;

/** Native rendering of the bundled SVG paths and dry-pen masks, without a WebView. */
final class SketchHeartButton extends View {

  private record Stroke(Path path, float width, float alpha) {}

  private final List<Stroke> ink = new ArrayList<>(),
      outline = new ArrayList<>(),
      whiteGrain = new ArrayList<>(),
      redGrain = new ArrayList<>();
  private final List<PathMeasure> measures = new ArrayList<>();
  private final RectF bounds = new RectF();
  private final Paint pen = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Paint erase = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Path visibleStroke = new Path();
  private Path interior;
  private float totalLength, progress;
  private boolean liked, initialized;
  private ValueAnimator fill;

  SketchHeartButton(Context context) {
    super(context);
    setFocusable(true);
    setClickable(true);

    pen.setStyle(Paint.Style.STROKE);
    pen.setStrokeCap(Paint.Cap.ROUND);
    pen.setStrokeJoin(Paint.Join.ROUND);
    erase.setStyle(Paint.Style.STROKE);
    erase.setStrokeCap(Paint.Cap.ROUND);
    erase.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.DST_OUT));
    interior = new Path();
    interior.moveTo(50,81);
    interior.cubicTo(40,72,18,55,18,36);
    interior.cubicTo(18,15,42,13,50,30);
    interior.cubicTo(58,13,82,15,82,36);
    interior.cubicTo(82,55,60,72,50,81);
    interior.close();
    bounds.set(0,0,100,100);
    setLiked(false, false);
  }

  void setLiked(boolean value, boolean animate) {
    if (initialized && liked == value) return;
    initialized = true;
    liked = value;
    setContentDescription(value ? "取消喜欢歌曲" : "喜欢歌曲");
    setStateDescription(value ? "已喜欢" : "未喜欢");
    if (fill != null) fill.cancel();
    float target = value ? 1 : 0;
    if (!animate || !ValueAnimator.areAnimatorsEnabled()) {
      progress = target;
      invalidate();
      return;
    }
    fill = ValueAnimator.ofFloat(progress, target);
    fill.setDuration(Math.max(1, Math.round(380 * Math.abs(target - progress))));
    fill.setInterpolator(UiMotion.CURVE);
    fill.addUpdateListener(a -> {
      progress = (Float) a.getAnimatedValue();
      invalidate();
    });
    fill.start();
  }

  void finishAnimation() {
    if (fill != null) fill.cancel();
    progress = liked ? 1 : 0;
    invalidate();
  }

  float fillProgress() {
    return progress;
  }

  boolean fillAnimating() {
    return fill != null && fill.isRunning();
  }

  public CharSequence getAccessibilityClassName() {
    return ToggleButton.class.getName();
  }

  public void onInitializeAccessibilityNodeInfo(AccessibilityNodeInfo info) {
    super.onInitializeAccessibilityNodeInfo(info);
    info.setCheckable(true);
    info.setChecked(liked);
  }

  public boolean onTouchEvent(MotionEvent event) {
    if (event.getActionMasked() == MotionEvent.ACTION_DOWN)
      animate().scaleX(.84f).scaleY(.84f).setDuration(65)
          .setInterpolator(new android.view.animation.AccelerateDecelerateInterpolator()).start();
    else if (event.getActionMasked() == MotionEvent.ACTION_UP
        || event.getActionMasked() == MotionEvent.ACTION_CANCEL)
      animate().scaleX(1).scaleY(1).setDuration(310)
          .setInterpolator(new android.view.animation.OvershootInterpolator(2)).start();
    return super.onTouchEvent(event);
  }

  protected void onDetachedFromWindow() {
    if (fill != null) fill.cancel();
    animate().cancel();
    super.onDetachedFromWindow();
  }

  protected void onDraw(Canvas canvas) {
    super.onDraw(canvas);
    int saved=canvas.save();
    float scale=Math.min(getWidth()*.76f/100,getHeight()*.70f/100);
    canvas.translate(getWidth()/2f,getHeight()/2f);
    canvas.scale(scale,scale); canvas.translate(-50,-50);
    // A radial fill expands from the heart's center with a soft elastic settle.
    float beat=fillAnimating() ? .07f*(float)Math.sin(Math.PI*progress) : 0;
    canvas.scale(1+beat,1+beat,50,50);
    if (progress>0) {
      int fillLayer=canvas.save();
      canvas.clipPath(interior);
      pen.setStyle(Paint.Style.FILL); pen.setColor(DotoDesign.FAVORITE);
      canvas.drawCircle(50,49,50*progress,pen);
      canvas.restoreToCount(fillLayer);
    }
    pen.setStyle(Paint.Style.STROKE); pen.setStrokeWidth(7);
    float tint=Math.max(0,Math.min(1,progress));
    int active=DotoDesign.FAVORITE;
    pen.setColor(Color.rgb(Math.round(250+(Color.red(active)-250)*tint),Math.round(250+(Color.green(active)-250)*tint),Math.round(250+(Color.blue(active)-250)*tint)));
    canvas.drawPath(interior,pen);
    canvas.restoreToCount(saved);
  }

  private void grain(Canvas canvas, List<Stroke> scratches) {
    for (Stroke stroke : scratches) {
      erase.setAlpha(Math.round(255 * stroke.alpha()));
      erase.setStrokeWidth(stroke.width());
      canvas.drawPath(stroke.path(), erase);
    }
  }

  private void readSvg(Context context) {
    try (InputStream input = context.getAssets().open("hand-drawn-heart-button.svg")) {
      XmlPullParser xml = Xml.newPullParser();
      xml.setInput(input, "UTF-8");
      String mask = null;
      boolean clip = false;
      for (int event = xml.next(); event != XmlPullParser.END_DOCUMENT; event = xml.next()) {
        if (event == XmlPullParser.END_TAG) {
          if (xml.getName().equals("mask")) mask = null;
          if (xml.getName().equals("clipPath")) clip = false;
        } else if (event == XmlPullParser.START_TAG) {
          if (xml.getName().equals("mask")) mask = xml.getAttributeValue(null, "id");
          else if (xml.getName().equals("clipPath")) clip = true;
          else if (xml.getName().equals("path")) {
            Path path = parsePath(xml.getAttributeValue(null, "d"));
            if (clip) {
              interior = path;
              continue;
            }
            Stroke stroke =
                new Stroke(path, number(xml, "stroke-width", 1), number(xml, "stroke-opacity", 1));
            if ("dry-white".equals(mask)) whiteGrain.add(stroke);
            else if ("dry-red".equals(mask)) redGrain.add(stroke);
            else if ("ink".equals(xml.getAttributeValue(null, "class"))) {
              ink.add(stroke);
              PathMeasure measure = new PathMeasure(path, false);
              measures.add(measure);
              totalLength += measure.getLength();
            } else outline.add(stroke);
          }
        }
      }
      if (interior == null || ink.isEmpty() || outline.isEmpty())
        throw new IllegalArgumentException("Incomplete heart SVG");
      for (Stroke stroke : outline) {
        RectF piece = new RectF();
        stroke.path().computeBounds(piece, true);
        bounds.union(piece);
      }
      bounds.inset(-6, -6);
    } catch (Exception error) {
      throw new IllegalStateException("Cannot read heart SVG", error);
    }
  }

  private static float number(XmlPullParser xml, String name, float fallback) {
    String value = xml.getAttributeValue(null, name);
    return value == null ? fallback : Float.parseFloat(value);
  }

  /** Deliberately limited to the M/L/Q/Z commands used by our bundled, editable SVG. */
  static Path parsePath(String data) {
    ArrayList<String> tokens = new ArrayList<>();
    Matcher matcher =
        Pattern.compile("[MmLlQqZz]|[-+]?(?:\\d*\\.\\d+|\\d+)(?:[eE][-+]?\\d+)?").matcher(data);
    while (matcher.find()) tokens.add(matcher.group());
    Path path = new Path();
    char command = 'M';
    float x = 0, y = 0, startX = 0, startY = 0;
    int i = 0;
    while (i < tokens.size()) {
      if (Character.isLetter(tokens.get(i).charAt(0))) command = tokens.get(i++).charAt(0);
      boolean relative = Character.isLowerCase(command);
      char kind = Character.toUpperCase(command);
      if (kind == 'Z') {
        path.close();
        x = startX;
        y = startY;
        continue;
      }
      float a = Float.parseFloat(tokens.get(i++)), b = Float.parseFloat(tokens.get(i++));
      if (kind == 'Q') {
        float endX = Float.parseFloat(tokens.get(i++)), endY = Float.parseFloat(tokens.get(i++));
        if (relative) {
          a += x;
          b += y;
          endX += x;
          endY += y;
        }
        path.quadTo(a, b, endX, endY);
        x = endX;
        y = endY;
      } else {
        if (relative) {
          a += x;
          b += y;
        }
        if (kind == 'M') {
          path.moveTo(a, b);
          startX = a;
          startY = b;
          command = relative ? 'l' : 'L';
        } else if (kind == 'L') path.lineTo(a, b);
        else throw new IllegalArgumentException("Unsupported SVG command");
        x = a;
        y = b;
      }
    }
    return path;
  }
}
