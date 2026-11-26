package com.volo.mobile;

/** Pull displacement controls velocity, not a one-off item offset. */
final class ElasticScrub {
  static final double MAX_ITEMS_PER_SECOND = 24;
  private final int count;
  private double cursor, strength;
  private int direction;

  ElasticScrub(int count, int initial) {
    this.count = count;
    cursor = Math.max(0, Math.min(count - 1, initial));
  }

  void anchor(double position) {
    cursor = Math.max(0, Math.min(Math.max(0, count - 1), position));
  }

  void pull(double displacement) {
    direction = displacement < 0 ? -1 : 1;
    strength = Math.min(1, Math.abs(displacement) / 220.0);
  }

  void advance(double seconds) {
    cursor =
        Math.max(
            0,
            Math.min(
                Math.max(0, count - 1),
                cursor
                    + direction
                        * MAX_ITEMS_PER_SECOND
                        * strength
                        * strength
                        * Math.max(0, seconds)));
  }

  double cursor() {
    return cursor;
  }

  double strength() {
    return strength;
  }

  int selected() {
    return count == 0 ? -1 : (int) Math.round(cursor);
  }
}
