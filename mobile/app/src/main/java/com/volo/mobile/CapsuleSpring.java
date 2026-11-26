package com.volo.mobile;

/** Analytic, lightly damped spring. Position and velocity survive retargeting. */
final class CapsuleSpring {
  final double target;
  private final double offset, coefficient;
  private static final double OMEGA = 19, DAMPING = .9;
  private static final double DECAY = OMEGA * DAMPING;
  private static final double FREQUENCY = OMEGA * Math.sqrt(1 - DAMPING * DAMPING);

  CapsuleSpring(double position, double velocity, double target) {
    this.target = target;
    offset = position - target;
    coefficient = (velocity + DECAY * offset) / FREQUENCY;
  }

  double position(double seconds) {
    return target
        + Math.exp(-DECAY * seconds)
            * (offset * Math.cos(FREQUENCY * seconds)
                + coefficient * Math.sin(FREQUENCY * seconds));
  }

  double velocity(double seconds) {
    double c = Math.cos(FREQUENCY * seconds), s = Math.sin(FREQUENCY * seconds);
    return Math.exp(-DECAY * seconds)
        * (-DECAY * (offset * c + coefficient * s) + FREQUENCY * (-offset * s + coefficient * c));
  }
}
