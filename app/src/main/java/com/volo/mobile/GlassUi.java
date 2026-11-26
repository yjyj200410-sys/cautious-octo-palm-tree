package com.volo.mobile;

import android.content.Context;
import android.graphics.*;
import android.graphics.drawable.*;
import android.view.*;
import android.widget.*;

/** Shared geometry and materials for the two home destinations. */
final class GlassUi {
  static int INK = DotoDesign.INK, MUTED = DotoDesign.MUTED, WARM = DotoDesign.PAPER;

  static int dp(Context c, float value) {
    return MobileUi.dp(c, value);
  }

  static TextView label(Context c, String value, int size, boolean bold) {
    TextView t = new TextView(c);
    t.setText(value);
    t.setTextColor(INK);
    t.setTextSize(size);
    t.setIncludeFontPadding(false);
    t.setTypeface(Typeface.create(bold ? "sans-serif-medium" : "sans-serif", Typeface.NORMAL));
    t.setGravity(Gravity.CENTER_VERTICAL);
    return t;
  }

  static void touch(View v, Runnable action) {
    v.setFocusable(true);
    v.setOnClickListener(x -> action.run());
    DotoDesign.press(v);
  }

  static Drawable glass(Context c, int radius) {
    return DotoDesign.surface(c, radius);
  }

  static GradientDrawable selected(Context c, int radius) {
    return DotoDesign.shape(c,DotoDesign.PAPER,radius);
  }

  static void rounded(View v, int radius) {
    v.setOutlineProvider(
        new ViewOutlineProvider() {
          public void getOutline(View view, Outline outline) {
            outline.setRoundRect(
                0, 0, view.getWidth(), view.getHeight(), dp(view.getContext(), radius));
          }
        });
    v.setClipToOutline(true);
  }

  static ImageView art(Context c, int radius) {
    ImageView v = new ImageView(c);
    v.setScaleType(ImageView.ScaleType.CENTER_CROP);
    v.setBackgroundColor(0xff242424);
    rounded(v, radius);
    return v;
  }

  static final class Surface extends FrameLayout {
    private final ImageView light;

    Surface(Context c, int radius) {
      super(c);
      setBackground(DotoDesign.cardSurface(c,radius));
      DotoDesign.cardTone(this);
      rounded(this, radius);
      light = new ImageView(c) {
        @Override protected void onMeasure(int widthSpec, int heightSpec) {
          // A decorative cover must never contribute its bitmap's intrinsic size.
          setMeasuredDimension(
              MeasureSpec.getMode(widthSpec) == MeasureSpec.EXACTLY ? MeasureSpec.getSize(widthSpec) : 0,
              MeasureSpec.getMode(heightSpec) == MeasureSpec.EXACTLY ? MeasureSpec.getSize(heightSpec) : 0);
        }
      };
      light.setScaleType(ImageView.ScaleType.CENTER_CROP);
      light.setVisibility(View.GONE);
      addView(light, new FrameLayout.LayoutParams(-1, -1));
    }

    @Override protected void onMeasure(int widthSpec, int heightSpec) {
      super.onMeasure(widthSpec, heightSpec);
      if (light.getVisibility() == View.VISIBLE) {
        measureChild(light,
            MeasureSpec.makeMeasureSpec(getMeasuredWidth(), MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(getMeasuredHeight(), MeasureSpec.EXACTLY));
      }
    }

    void solidGlass(int radius) {
      setForeground(null);
      setElevation(dp(getContext(), 6));
      setOutlineAmbientShadowColor(0x33000000);
      setOutlineSpotShadowColor(0x55000000);
    }

    void blurredCover(Bitmap image) {
      if (image == null) return;
      light.setImageBitmap(image);
      light.setRenderEffect(RenderEffect.createBlurEffect(dp(getContext(), 28), dp(getContext(), 28), Shader.TileMode.CLAMP));
      light.setScaleX(1.18f);
      light.setScaleY(1.18f);
      light.setAlpha(.38f);
      light.setVisibility(View.VISIBLE);
    }

    void glow(Bitmap image) {
      // Artwork is not used as a blurred background; keep the surface neutral.
    }
  }

  static final class Symbol extends View {
    final String kind;
    private final Paint p = new Paint(3);
    int color = INK;

    Symbol(Context c, String kind, String description, Runnable action) {
      super(c);
      this.kind = kind;
      setContentDescription(description);
      touch(this, action);
    }

    boolean bare;

    protected void onDraw(Canvas c) {
      int size=dp(getContext(),24);
      DotoIcon icon=new DotoIcon(kind,color);
      icon.setBounds((getWidth()-size)/2,(getHeight()-size)/2,(getWidth()+size)/2,(getHeight()+size)/2);
      icon.draw(c);
    }
  }

  static final class DailyArtwork extends View {
    private final Paint p = new Paint(3);
    private final Bitmap[] covers = new Bitmap[3];

    DailyArtwork(Context c) {
      super(c);
      setLayerType(View.LAYER_TYPE_SOFTWARE, null);
      setContentDescription("每日推荐专辑封面");
    }

    void cover(int index, Bitmap bitmap) {
      covers[index] = bitmap;
      invalidate();
    }

    protected void onDraw(Canvas c) {
      // Reserve room for rotated corners and the drop shadow.
      float w = getWidth(), h = getHeight(), cw = Math.max(w, h) * 1.02f;
      for (int i = 2; i >= 0; i--) {
        float x = w - cw - w * .06f + i * w * .055f, y = (h - cw) * .5f;
        c.save();
        c.rotate(i * 3, x + cw / 2, y + cw / 2);
        RectF r = new RectF(x, y, x + cw, y + cw);
        p.setAlpha(255);
        p.setColor(0xff303030);
        p.setShadowLayer(14, 0, 9, 0x99000000);
        c.drawRoundRect(r, 12, 12, p);
        p.clearShadowLayer();
        c.save();
        Path clip = new Path();
        clip.addRoundRect(r, 12, 12, Path.Direction.CW);
        c.clipPath(clip);
        p.setAlpha(255);
        if (covers[i] != null) c.drawBitmap(covers[i], null, r, p);
        else {
          p.setShader(
              new LinearGradient(
                  x, y, x + cw, y + cw, 0xff555555, 0xff282828, Shader.TileMode.CLAMP));
          c.drawRect(r, p);
          p.setShader(null);
        }
        c.restore();
        p.setStyle(Paint.Style.STROKE);
        p.setColor(0x44ffffff);
        p.setStrokeWidth(1);
        c.drawRoundRect(r, 12, 12, p);
        p.setStyle(Paint.Style.FILL);
        c.restore();
      }
    }
  }
}
