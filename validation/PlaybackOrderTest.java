package com.volo.mobile;

import java.util.*;

public final class PlaybackOrderTest {
  static void eq(int actual, int expected) {
    if (actual != expected) throw new AssertionError(actual + " != " + expected);
  }

  public static void main(String[] args) {
    PlaybackOrder previewOrder = new PlaybackOrder(new Random(17));
    eq(previewOrder.peek(3, 0, -1), 2);
    eq(previewOrder.peek(3, 0, 1), 1);
    previewOrder.setShuffle(true);
    int previewAt = 0;
    for (int i = 0; i < 30; i++) {
      int candidate = previewOrder.peek(5, previewAt, 1);
      eq(previewOrder.peek(5, previewAt, 1), candidate);
      eq(previewOrder.next(5, previewAt, false), candidate);
      int back = previewOrder.peek(5, candidate, -1);
      eq(previewOrder.previous(5, candidate), back);
      eq(previewOrder.next(5, back, false), candidate);
      previewAt = candidate;
    }
    PlaybackOrder fresh = new PlaybackOrder(new Random(23));
    fresh.setShuffle(true);
    int current = 2;
    for (int i=0; i<20; i++) {
      int candidate=fresh.peek(5,current,-1);
      eq(fresh.peek(5,current,-1),candidate);
      if (candidate==current) throw new AssertionError("fresh shuffle previous repeats current");
      eq(fresh.previous(5,current),candidate);
      eq(fresh.next(5,candidate,false),current);
      eq(fresh.previous(5,current),candidate);
      current=candidate;
    }
    eq(fresh.previous(0,-1),-1);
    fresh.reset();
    eq(fresh.previous(1,0),0);
    PlaybackOrder permutation = new PlaybackOrder(new Random(29));
    permutation.setShuffle(true);
    int position=3;
    int[] round=new int[7];
    for(int i=0;i<7;i++) {
      round[i]=position;
      position=permutation.next(7,position,false);
    }
    eq(position,3);
    if (Arrays.stream(round).distinct().count()!=7)
      throw new AssertionError("shuffle round duplicated a song");
    for(int i=6;i>=0;i--) {
      position=permutation.previous(7,position);
      eq(position,round[i]);
    }
    PlaybackOrder order = new PlaybackOrder(new Random(7));
    eq(order.next(0, -1, true), -1);
    order.mode = PlaybackOrder.Mode.SEQUENTIAL;
    eq(order.next(3, 2, true), -1);
    eq(order.next(3, 2, false), 0);
    eq(order.previous(3, 0), 2);
    order.mode = PlaybackOrder.Mode.LIST_LOOP;
    eq(order.next(3, 2, true), 0);
    eq(order.next(1, 0, true), 0);
    order.mode = PlaybackOrder.Mode.SINGLE_LOOP;
    eq(order.next(3, 1, true), 1);
    eq(order.next(3, 1, false), 2);
    order.mode = PlaybackOrder.Mode.SHUFFLE;
    order.reset();
    Set<Integer> seen = new HashSet<>();
    seen.add(0);
    int at = 0;
    for (int i = 0; i < 9; i++) {
      int next = order.next(10, at, true);
      if (!seen.add(next)) throw new AssertionError("early shuffle repeat");
      at = next;
    }
    int previous = order.previous(10, at);
    eq(order.next(10, previous, false), at);
    for (int i = 0; i < 100; i++) {
      int next = order.next(10, at, true);
      if (next == at) throw new AssertionError("immediate repeat");
      at = next;
    }
    order.reset();
    eq(order.next(1, 0, true), 0);
    order.restore(PlaybackOrder.Mode.LIST_LOOP, true);
    if (!order.isShuffled()) throw new AssertionError("shuffle flag not restored");
    seen.clear();
    seen.add(0);
    at = 0;
    for (int i = 0; i < 9; i++) {
      int next = order.next(10, at, true);
      if (!seen.add(next))
        throw new AssertionError("list-loop shuffle repeats before visiting all songs");
      at = next;
    }
    int continued = order.next(10, at, true);
    if (continued < 0 || continued == at)
      throw new AssertionError("list-loop shuffle does not continue");
    order.setRepeat(PlaybackOrder.Mode.SINGLE_LOOP);
    if (!order.isShuffled()) throw new AssertionError("repeat switch disabled shuffle");
    eq(order.next(10, continued, true), continued);
    if (order.next(10, continued, false) == continued)
      throw new AssertionError("single-loop manual next is not shuffled");
    order.setShuffle(false);
    if (order.mode != PlaybackOrder.Mode.SINGLE_LOOP)
      throw new AssertionError("shuffle toggle changed repeat");
    order.restore(PlaybackOrder.Mode.SEQUENTIAL, true);
    at = 3;
    seen.clear();
    seen.add(at);
    for (int i = 0; i < 4; i++) {
      int next = order.next(5, at, true);
      if (next < 0 || !seen.add(next)) throw new AssertionError("non-loop shuffle lost a song");
      at = next;
    }
    eq(order.next(5, at, true), -1);
    int back = order.previous(5, at);
    eq(order.next(5, back, true), at);
    eq(order.next(5, at, true), -1);
    order.setRepeat(PlaybackOrder.Mode.LIST_LOOP);
    if (!order.isShuffled() || order.next(5, at, true) < 0)
      throw new AssertionError("enabling repeat did not resume random traversal");
    order.restore(PlaybackOrder.Mode.SEQUENTIAL, true);
    eq(order.next(1, 0, true), -1);
    eq(order.next(1, 0, false), 0);
    order.restore(PlaybackOrder.Mode.SINGLE_LOOP, true);
    eq(order.next(1, 0, true), 0);
    order.restore(PlaybackOrder.Mode.SHUFFLE, false);
    if (order.mode != PlaybackOrder.Mode.LIST_LOOP || !order.isShuffled())
      throw new AssertionError("legacy shuffle migration failed");
    PlaybackOrder restored = new PlaybackOrder();
    restored.restore(order.mode, order.isShuffled());
    if (restored.mode != PlaybackOrder.Mode.LIST_LOOP || !restored.isShuffled())
      throw new AssertionError("independent state round trip failed");
    System.out.println(
        "PASS: queue boundaries, independent repeat/shuffle combinations, round exhaustion, history"
            + " and legacy restore");
  }
}
