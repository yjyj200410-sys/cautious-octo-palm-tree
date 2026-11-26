package com.volo.mobile;
public final class SpatialHoldTest {
  static void check(boolean ok) { if (!ok) throw new AssertionError(); }
  public static void main(String[] args) {
    for (float hz : new float[]{30,60,90,120}) {
      SpatialHold h = new SpatialHold();
      for (int i=0;i<hz/5;i++) h.step(2,-1,1/hz);
      check(h.x < -3 && h.y > 1);
      float before=h.x;
      h.step(0,0,1/hz);
      check(Math.abs(h.x-before)<8);
      for(int i=0;i<hz*5;i++) h.step(0,0,1/hz);
      check(h.x==0 && h.y==0);
      for(int i=0;i<1000;i++) { h.step(100,-100,1/hz); check(Math.hypot(h.x,h.y)<=42.001); }
      h.pause();
      for(int i=0;i<hz*5;i++) h.step(0,0,1/hz);
      check(h.x==0 && h.y==0);
      SpatialHold noise=new SpatialHold();
      for(int i=0;i<100;i++) noise.step(.04f,-.03f,1/hz);
      check(noise.x==0 && noise.y==0);
    }
    System.out.println("PASS: direction, bounds, quiet return, pause recovery and noise rejection at 30/60/90/120Hz");
  }
}
