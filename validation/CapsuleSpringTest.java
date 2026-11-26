package com.volo.mobile;

public final class CapsuleSpringTest {
  private static void near(double a, double b, double tolerance) {
    if (Math.abs(a - b) > tolerance) throw new AssertionError(a + " != " + b);
  }

  public static void main(String[] args) {
    for (double velocity : new double[] {-2000, -100, 0, 100, 2000}) {
      CapsuleSpring spring = new CapsuleSpring(120, velocity, 0);
      near(spring.position(0), 120, 1e-8);
      near(spring.velocity(0), velocity, 1e-8);
      near((spring.position(.000001) - spring.position(0)) / .000001, velocity, .1);
      near(spring.position(1), 0, .01);
      near(spring.velocity(1), 0, .1);
      CapsuleSpring reversed = new CapsuleSpring(spring.position(.08), spring.velocity(.08), 260);
      near(reversed.position(0), spring.position(.08), 1e-8);
      near(reversed.velocity(0), spring.velocity(.08), 1e-8);
      near(reversed.position(1), 260, .01);
    }
    System.out.println(
        "PASS: initial position/velocity, continuous retargeting and stable settling across release"
            + " speeds");
  }
}
