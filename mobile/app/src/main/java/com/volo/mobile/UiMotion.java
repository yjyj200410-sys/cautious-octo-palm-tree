package com.volo.mobile;

import android.view.animation.Interpolator;
import android.view.animation.PathInterpolator;

/** Shared soft ease-out for interface transitions, inspired by native sheet/card motion. */
final class UiMotion {
  static final Interpolator CURVE = new PathInterpolator(.22f, 1f, .36f, 1f);

  private UiMotion() {}
}
