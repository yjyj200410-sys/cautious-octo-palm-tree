package com.volo.mobile;

/** Bounded, short-lived inertial illusion; deliberately does not estimate world position. */
final class SpatialHold {
  static final float LIMIT = 42f;
  float x, y;
  private float vx, vy, ax, ay, quiet;

  void pause() {
    vx = vy = ax = ay = 0;
    quiet = .5f;
  }

  boolean step(float screenAx, float screenAy, float seconds) {
    float dt = Math.max(0, Math.min(.035f, seconds));
    float magnitude = (float) Math.hypot(screenAx, screenAy);
    boolean moving = magnitude > .12f;
    quiet = moving ? 0 : quiet + dt;
    float blend = (float) -Math.expm1(-dt / .04);
    ax += ((moving ? screenAx : 0) - ax) * blend;
    ay += ((moving ? screenAy : 0) - ay) * blend;
    // Counter motion first, briefly retain displacement, then ease back without a snap.
    float spring = quiet < .5f ? 4f : 64f;
    float damping = quiet < .5f ? 7f : 16f;
    vx += (-ax * 900 - spring * x - damping * vx) * dt;
    vy += (-ay * 900 - spring * y - damping * vy) * dt;
    x += vx * dt;
    y += vy * dt;
    float distance = (float) Math.hypot(x, y);
    if (distance > LIMIT) {
      x *= LIMIT / distance;
      y *= LIMIT / distance;
      float outward = (vx * x + vy * y) / (LIMIT * LIMIT);
      if (outward > 0) {
        vx -= outward * x;
        vy -= outward * y;
      }
    }
    if (!moving && quiet > .5f && Math.hypot(x, y) < .03 && Math.hypot(vx, vy) < .15) {
      x = y = vx = vy = ax = ay = 0;
      return false;
    }
    return moving || Math.hypot(x, y) > .001 || Math.hypot(vx, vy) > .001;
  }
}
